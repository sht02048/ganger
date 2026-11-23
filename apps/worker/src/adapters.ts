import { createHash } from "node:crypto";
import { AdapterError, NO_TICKET_RELATIONS } from "@ganger/core";
import type {
  AdapterRegistry,
  CodeHost,
  CodeHostKind,
  RepoRef,
  Runner,
  RunnerId,
  RunnerProjectId,
  TicketKey,
  TicketRelations,
  Tracker,
  TrackerConnectionId,
  TrackerKind,
} from "@ganger/core";
import { getTrackerConnection, listCodeHostConnections, listTrackerConnections } from "@ganger/db";
import type { CodeHostConnectionId, Database, SecretBox, StoredRunner } from "@ganger/db";

export class WorkerAdapters {
  private readonly registry: AdapterRegistry;
  private readonly secretBox: SecretBox;
  private readonly now: () => Date;
  private readonly runners = new Map<RunnerId, Cached<Runner>>();
  private readonly trackers = new Map<TrackerConnectionId, Cached<Tracker>>();
  private readonly codeHosts = new Map<CodeHostConnectionId, Cached<CodeHost>>();

  constructor(registry: AdapterRegistry, secretBox: SecretBox, now: () => Date = () => new Date()) {
    this.registry = registry;
    this.secretBox = secretBox;
    this.now = now;
  }

  runner(stored: StoredRunner): Runner {
    return reuse(this.runners, stored.id, { kind: stored.kind, config: stored.config }, () =>
      this.registry.createRunner(stored.kind, stored.config),
    );
  }

  tracker(db: Database, id: TrackerConnectionId): Tracker | null {
    const stored = getTrackerConnection(db, this.secretBox, id);
    if (stored === null) return null;
    const config = { config: stored.config, secrets: stored.secrets };
    return reuse(
      this.trackers,
      stored.id,
      { kind: stored.kind, config },
      () =>
        new PausableTracker(
          this.registry.createTracker(stored.kind, config),
          new ConnectionPause(this.now, { pauseOnUnauthorized: true }),
        ),
    );
  }

  trackerConnectionIds(db: Database): TrackerConnectionId[] {
    return listTrackerConnections(db, this.secretBox).map((stored) => stored.id);
  }

  codeHostsKey(db: Database): string {
    const settings = listCodeHostConnections(db, this.secretBox).map((stored) => ({
      id: stored.id,
      kind: stored.kind,
      config: stored.config,
      secrets: stored.secrets,
    }));
    return createHash("sha256").update(JSON.stringify(settings)).digest("hex");
  }

  allCodeHosts(
    db: Database,
    onError: (id: CodeHostConnectionId, error: unknown) => void,
  ): CodeHost[] {
    return listCodeHostConnections(db, this.secretBox).flatMap((stored) => {
      const config = { config: stored.config, secrets: stored.secrets };
      try {
        return [
          reuse(
            this.codeHosts,
            stored.id,
            { kind: stored.kind, config },
            () =>
              new PausableCodeHost(
                this.registry.createCodeHost(stored.kind, config),
                new ConnectionPause(this.now, { pauseOnUnauthorized: false }),
              ),
          ),
        ];
      } catch (error) {
        onError(stored.id, error);
        return [];
      }
    });
  }
}

interface Cached<A> {
  key: string;
  adapter: A;
}

function reuse<Id extends string, A>(
  cache: Map<Id, Cached<A>>,
  id: Id,
  settings: { kind: string; config: unknown },
  create: () => A,
): A {
  const key = createHash("sha256").update(JSON.stringify(settings)).digest("hex");
  const cached = cache.get(id);
  if (cached?.key === key) return cached.adapter;
  const adapter = create();
  cache.set(id, { key, adapter });
  return adapter;
}

export const UNAUTHORIZED_PAUSE_MS = 5 * 60_000;
export const RATE_LIMIT_PAUSE_MS = 60_000;
export const MAX_PAUSE_MS = 60 * 60_000;

export class ConnectionPausedError extends AdapterError<{ kind: string }> {
  readonly until: Date;

  constructor(detail: { kind: string }, until: Date) {
    super(detail);
    this.name = "ConnectionPausedError";
    this.message = `connection paused after ${detail.kind} until ${until.toISOString()}`;
    this.until = until;
  }
}

export class ConnectionPause {
  private readonly now: () => Date;
  private readonly pauseOnUnauthorized: boolean;
  private until = 0;
  private detail: { kind: string } | null = null;

  constructor(now: () => Date, options: { pauseOnUnauthorized: boolean }) {
    this.now = now;
    this.pauseOnUnauthorized = options.pauseOnUnauthorized;
  }

  async run<T>(call: () => Promise<T>): Promise<T> {
    if (this.detail !== null && this.now().getTime() < this.until) {
      throw new ConnectionPausedError(this.detail, new Date(this.until));
    }
    try {
      return await call();
    } catch (error) {
      this.record(error);
      throw error;
    }
  }

  private record(error: unknown): void {
    if (!(error instanceof AdapterError) || error instanceof ConnectionPausedError) return;
    const detail: unknown = error.detail;
    const now = this.now().getTime();
    if (typeof detail !== "object" || detail === null || !("kind" in detail)) return;
    if (!this.pauseOnUnauthorized && detail.kind === "unauthorized") return;
    const ms = pauseMs(detail, now);
    if (ms === null) return;
    this.detail = { kind: String(detail.kind) };
    this.until = now + Math.min(Math.max(ms, 0), MAX_PAUSE_MS);
  }
}

export function pauseMs(detail: unknown, now: number): number | null {
  if (typeof detail !== "object" || detail === null || !("kind" in detail)) return null;
  if (detail.kind === "unauthorized") return UNAUTHORIZED_PAUSE_MS;
  if (detail.kind !== "rate-limited") return null;
  if ("retryAfterSeconds" in detail && typeof detail.retryAfterSeconds === "number") {
    return detail.retryAfterSeconds * 1000;
  }
  if ("resetAt" in detail && detail.resetAt instanceof Date) {
    return detail.resetAt.getTime() - now;
  }
  return RATE_LIMIT_PAUSE_MS;
}

class PausableTracker implements Tracker {
  readonly kind: TrackerKind;
  private readonly inner: Tracker;
  private readonly pause: ConnectionPause;

  constructor(inner: Tracker, pause: ConnectionPause) {
    this.kind = inner.kind;
    this.inner = inner;
    this.pause = pause;
  }

  checkConnection(): ReturnType<Tracker["checkConnection"]> {
    return this.inner.checkConnection();
  }

  verifyWebhook(
    input: Parameters<Tracker["verifyWebhook"]>[0],
  ): ReturnType<Tracker["verifyWebhook"]> {
    return this.inner.verifyWebhook(input);
  }

  getTicket(key: TicketKey): ReturnType<Tracker["getTicket"]> {
    return this.pause.run(() => this.inner.getTicket(key));
  }

  getTicketRelations(key: TicketKey): Promise<TicketRelations | null> {
    return this.pause.run(
      () => this.inner.getTicketRelations?.(key) ?? Promise.resolve(NO_TICKET_RELATIONS),
    );
  }

  listProjectTickets(
    ...args: Parameters<Tracker["listProjectTickets"]>
  ): ReturnType<Tracker["listProjectTickets"]> {
    return this.pause.run(() => this.inner.listProjectTickets(...args));
  }

  listLabeledTickets(
    ...args: Parameters<Tracker["listLabeledTickets"]>
  ): ReturnType<Tracker["listLabeledTickets"]> {
    return this.pause.run(() => this.inner.listLabeledTickets(...args));
  }

  listComments(...args: Parameters<Tracker["listComments"]>): ReturnType<Tracker["listComments"]> {
    return this.pause.run(() => this.inner.listComments(...args));
  }

  listProjects(): ReturnType<Tracker["listProjects"]> {
    return this.pause.run(() => this.inner.listProjects());
  }

  listLabels(...args: Parameters<Tracker["listLabels"]>): ReturnType<Tracker["listLabels"]> {
    return this.pause.run(() => this.inner.listLabels(...args));
  }

  createLabel(...args: Parameters<Tracker["createLabel"]>): ReturnType<Tracker["createLabel"]> {
    return this.pause.run(() => this.inner.createLabel(...args));
  }

  listStates(...args: Parameters<Tracker["listStates"]>): ReturnType<Tracker["listStates"]> {
    return this.pause.run(() => this.inner.listStates(...args));
  }

  setState(...args: Parameters<Tracker["setState"]>): ReturnType<Tracker["setState"]> {
    return this.pause.run(() => this.inner.setState(...args));
  }

  addComment(...args: Parameters<Tracker["addComment"]>): ReturnType<Tracker["addComment"]> {
    return this.pause.run(() => this.inner.addComment(...args));
  }
}

class PausableCodeHost implements CodeHost {
  readonly kind: CodeHostKind;
  private readonly inner: CodeHost;
  private readonly pause: ConnectionPause;

  constructor(inner: CodeHost, pause: ConnectionPause) {
    this.kind = inner.kind;
    this.inner = inner;
    this.pause = pause;
  }

  checkConnection(): ReturnType<CodeHost["checkConnection"]> {
    return this.inner.checkConnection();
  }

  repoOf(project: RunnerProjectId): RepoRef | null {
    return this.inner.repoOf(project);
  }

  findPullRequestsByBranch(
    ...args: Parameters<CodeHost["findPullRequestsByBranch"]>
  ): ReturnType<CodeHost["findPullRequestsByBranch"]> {
    return this.pause.run(() => this.inner.findPullRequestsByBranch(...args));
  }

  findPullRequestsByTicketKey(
    ...args: Parameters<CodeHost["findPullRequestsByTicketKey"]>
  ): ReturnType<CodeHost["findPullRequestsByTicketKey"]> {
    return this.pause.run(() => this.inner.findPullRequestsByTicketKey(...args));
  }

  getPullRequest(
    ...args: Parameters<CodeHost["getPullRequest"]>
  ): ReturnType<CodeHost["getPullRequest"]> {
    return this.pause.run(() => this.inner.getPullRequest(...args));
  }

  mergePullRequest(
    ...args: Parameters<CodeHost["mergePullRequest"]>
  ): ReturnType<CodeHost["mergePullRequest"]> {
    return this.pause.run(() => this.inner.mergePullRequest(...args));
  }

  rateLimit(): ReturnType<CodeHost["rateLimit"]> {
    return this.pause.run(() => this.inner.rateLimit());
  }
}
