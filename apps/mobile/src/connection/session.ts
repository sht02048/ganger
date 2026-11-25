import type { AppDashboard, AppRunner, V1ThisDevice, V1Workspaces } from "@ganger/api";

import type { V1Client, V1Failure, V1Result } from "./client";
import type { ChangeStreamHandlers } from "./change-stream";
import { EVERYTHING, readScopeOf } from "./read-scope";
import type { ReadPart, ReadScope } from "./read-scope";
import { sameValue } from "./same-value";
import type { NeededUpdate } from "./version";

export const POLL_INTERVAL_MS = 15_000;
export const STREAM_RETRY_MS = 15_000;
export const RETRY_MAX_MS = 60_000;
export const STREAM_SILENCE_MS = 35_000;
export const STREAM_READY_WAIT_MS = 2_000;
export const CHANGE_DEBOUNCE_MS = 300;

const SERVER_DATA: ReadScope = new Set<ReadPart>(["dashboard", "workspaces", "runners"]);
const DASHBOARD_ONLY: ReadScope = new Set<ReadPart>(["dashboard"]);

export function retryDelay(firstMs: number, failures: number): number {
  return Math.min(firstMs * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
}

export type SessionPhase =
  | "loading"
  | "live"
  | "stale"
  | "host-blocked"
  | "incompatible"
  | "rejected";

export interface DashboardEntry {
  data: AppDashboard;
  fetchedAt: number;
}

export interface SessionState {
  phase: SessionPhase;
  transport: "stream" | "polling";
  dashboards: ReadonlyMap<string, DashboardEntry>;
  staleReason: "unreachable" | "server-error";
  neededUpdate: NeededUpdate;
  workspaces: V1Workspaces["workspaces"];
  runners: AppRunner[];
  runnersRead: boolean;
  device: V1ThisDevice | null;
  serverVersion: string | null;
  fetchedAt: number | null;
  actionsReady: boolean;
}

export interface SessionDeps {
  client: V1Client;
  openStream: (handlers: ChangeStreamHandlers) => () => void;
  timeZone: string;
  now: () => number;
  onRejected: () => void;
  onDashboardRead?: (
    workspaceId: string,
    data: AppDashboard,
    fetchedAt: number,
    workspaces: V1Workspaces["workspaces"],
  ) => void;
  onDashboardConfirmed?: (workspaceId: string, fetchedAt: number) => void;
}

export interface SessionRestore {
  dashboards: ReadonlyMap<string, DashboardEntry>;
  workspaces: V1Workspaces["workspaces"];
}

const FAILURE_RANK: Record<V1Failure["kind"], number> = {
  "token-rejected": 4,
  "host-blocked": 3,
  incompatible: 2,
  "server-error": 1,
  unreachable: 0,
};

function worstFailure(results: ReadonlyArray<V1Result<unknown> | null>): V1Failure | null {
  let worst: V1Failure | null = null;
  for (const result of results) {
    if (result === null || result.ok) continue;
    if (worst === null || FAILURE_RANK[result.failure.kind] > FAILURE_RANK[worst.kind]) {
      worst = result.failure;
    }
  }
  return worst;
}

function phaseOf(failure: V1Failure): SessionPhase {
  switch (failure.kind) {
    case "token-rejected":
      return "rejected";
    case "host-blocked":
      return "host-blocked";
    case "incompatible":
      return "incompatible";
    case "server-error":
    case "unreachable":
      return "stale";
  }
}

function readIf<Data>(
  scope: ReadScope,
  part: ReadPart,
  read: () => Promise<V1Result<Data>>,
): Promise<V1Result<Data> | null> {
  return scope.has(part) ? read() : Promise.resolve(null);
}

function serverVersionOf(results: ReadonlyArray<V1Result<unknown> | null>): string | null {
  for (const result of results) {
    if (result?.ok) return result.serverVersion;
  }
  return null;
}

export class LiveSession {
  readonly #deps: SessionDeps;
  readonly #listeners = new Set<() => void>();
  #state: SessionState = {
    phase: "loading",
    transport: "polling",
    dashboards: new Map(),
    staleReason: "unreachable",
    neededUpdate: "server",
    workspaces: [],
    runners: [],
    runnersRead: false,
    device: null,
    serverVersion: null,
    fetchedAt: null,
    actionsReady: false,
  };
  #workspaceId: string;
  #generation = 0;
  #trustEpoch = 0;
  #readSucceeded = false;
  #active = false;
  #reading = false;
  readonly #pending = new Set<ReadPart>();
  #publishPending = false;
  readonly #queued = new Set<ReadPart>();
  readonly #confirmedAt = new Map<string, number>();
  #pollFailures = 0;
  #streamFailures = 0;
  #closeStream: (() => void) | null = null;
  #poll: ReturnType<typeof setTimeout> | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #silence: ReturnType<typeof setTimeout> | null = null;
  #debounce: ReturnType<typeof setTimeout> | null = null;
  #readyWait: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: SessionDeps, workspaceId: string) {
    this.#deps = deps;
    this.#workspaceId = workspaceId;
  }

  readonly getState = (): SessionState => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  setForeground(foreground: boolean): void {
    if (foreground === this.#active || this.#state.phase === "rejected") return;
    this.#active = foreground;
    this.#distrustActions();
    if (!foreground) {
      this.#generation += 1;
      this.#clearTransport();
      return;
    }
    this.#pollFailures = 0;
    this.#streamFailures = 0;
    this.#startPolling();
    this.#openStream();
    this.#readyWait = setTimeout(() => {
      this.#readyWait = null;
      void this.#read(EVERYTHING, false);
    }, STREAM_READY_WAIT_MS);
  }

  stop(): void {
    this.#active = false;
    this.#generation += 1;
    this.#clearTransport();
  }

  setWorkspace(workspaceId: string): void {
    if (workspaceId === this.#workspaceId) return;
    this.#workspaceId = workspaceId;
    this.#distrustActions();
    if (this.#active) void this.#read(DASHBOARD_ONLY, false);
  }

  refresh(): Promise<void> {
    return this.#read(EVERYTHING, true);
  }

  restore({ dashboards, workspaces }: SessionRestore): void {
    if (this.#state.phase === "rejected" || dashboards.size === 0) return;
    const merged = new Map([...dashboards, ...this.#state.dashboards]);
    const newest = Math.max(...[...dashboards.values()].map((entry) => entry.fetchedAt));
    this.#setState({
      ...this.#state,
      dashboards: merged,
      workspaces: this.#readSucceeded ? this.#state.workspaces : workspaces,
      fetchedAt: this.#state.fetchedAt ?? newest,
    });
  }

  noteFailure(failure: V1Failure): void {
    if (!this.#active) return;
    this.#distrustActions();
    this.#applyFailure(failure);
    if (failure.kind !== "token-rejected") void this.refresh();
  }

  #distrustActions(): void {
    this.#trustEpoch += 1;
    if (this.#state.actionsReady) this.#setState({ ...this.#state, actionsReady: false });
  }

  async #read(scope: ReadScope, publish: boolean): Promise<void> {
    if (!this.#active) return;
    for (const part of scope) this.#pending.add(part);
    this.#publishPending ||= publish;
    if (this.#reading) return;
    this.#reading = true;
    try {
      while (this.#active && this.#pending.size > 0) {
        const parts = this.#widened(this.#pending);
        const publishNow = this.#publishPending;
        this.#pending.clear();
        this.#publishPending = false;
        await this.#readOnce(parts, publishNow);
      }
    } finally {
      this.#reading = false;
    }
  }

  #widened(scope: ReadScope): ReadScope {
    if (!this.#readSucceeded) return EVERYTHING;
    if (this.#state.phase === "live") return new Set(scope);
    return new Set([...scope, ...SERVER_DATA]);
  }

  async #readOnce(parts: ReadScope, publishRequested: boolean): Promise<void> {
    const generation = this.#generation;
    const trustEpoch = this.#trustEpoch;
    const workspaceId = this.#workspaceId;
    const { client, timeZone, now } = this.#deps;
    const [dashboard, workspaces, runners, device] = await Promise.all([
      readIf(parts, "dashboard", () => client.dashboard(workspaceId, timeZone)),
      readIf(parts, "workspaces", () => client.workspaces()),
      readIf(parts, "runners", () => client.runners()),
      readIf(parts, "device", () => client.thisDevice()),
    ]);
    if (generation !== this.#generation || !this.#active) return;
    const results = [dashboard, workspaces, runners, device];
    const failure = worstFailure(results);
    if (failure !== null) {
      this.#pollFailures += 1;
      this.#applyFailure(failure);
      return;
    }
    this.#pollFailures = 0;
    this.#readSucceeded = true;
    const state = this.#state;
    const publish = publishRequested || state.phase !== "live";
    const fetchedAt = now();
    let dashboards = state.dashboards;
    let dashboardChanged = false;
    if (dashboard?.ok) {
      this.#confirmedAt.set(workspaceId, fetchedAt);
      const previous = state.dashboards.get(workspaceId);
      if (publish || previous === undefined || !sameValue(previous.data, dashboard.data)) {
        dashboards = new Map([
          ...state.dashboards,
          [workspaceId, { data: dashboard.data, fetchedAt }],
        ]);
        dashboardChanged = true;
      }
    }
    const workspacesChanged =
      workspaces?.ok === true && !sameValue(state.workspaces, workspaces.data.workspaces);
    const runnersChanged =
      runners?.ok === true &&
      (!state.runnersRead || !sameValue(state.runners, runners.data.runners));
    const deviceChanged = device?.ok === true && !sameValue(state.device, device.data);
    const changed = dashboardChanged || workspacesChanged || runnersChanged || deviceChanged;
    const serverVersion = serverVersionOf(results) ?? state.serverVersion;
    const actionsReady = trustEpoch === this.#trustEpoch;
    if (
      changed ||
      state.phase !== "live" ||
      state.serverVersion !== serverVersion ||
      state.actionsReady !== actionsReady
    ) {
      this.#setState({
        ...state,
        phase: "live",
        dashboards,
        workspaces:
          workspacesChanged && workspaces?.ok ? workspaces.data.workspaces : state.workspaces,
        runners: runnersChanged && runners?.ok ? runners.data.runners : state.runners,
        runnersRead: state.runnersRead || runners !== null,
        device: deviceChanged && device?.ok ? device.data : state.device,
        serverVersion,
        fetchedAt: changed || state.fetchedAt === null ? fetchedAt : state.fetchedAt,
        actionsReady,
      });
    }
    if (dashboard?.ok) {
      if (dashboardChanged || workspacesChanged) {
        this.#deps.onDashboardRead?.(
          workspaceId,
          dashboard.data,
          fetchedAt,
          this.#state.workspaces,
        );
      } else {
        this.#deps.onDashboardConfirmed?.(workspaceId, fetchedAt);
      }
    }
    if (!actionsReady) for (const part of EVERYTHING) this.#pending.add(part);
    else if (this.#state.transport === "stream") this.#stopPolling();
    else this.#startPolling();
  }

  #applyFailure(failure: V1Failure): void {
    const phase = phaseOf(failure);
    const serverVersion =
      failure.kind === "incompatible" ? failure.serverVersion : this.#state.serverVersion;
    const staleReason =
      failure.kind === "server-error" || failure.kind === "unreachable"
        ? failure.kind
        : this.#state.staleReason;
    const neededUpdate =
      failure.kind === "incompatible" ? failure.update : this.#state.neededUpdate;
    this.#setState({
      ...this.#state,
      ...this.#confirmedTimes(),
      phase,
      serverVersion,
      staleReason,
      neededUpdate,
      actionsReady: false,
    });
    if (phase === "rejected") {
      this.stop();
      this.#deps.onRejected();
      return;
    }
    this.#startPolling();
  }

  #confirmedTimes(): Pick<SessionState, "dashboards" | "fetchedAt"> {
    const { dashboards, fetchedAt } = this.#state;
    let latest = fetchedAt;
    const refreshed = new Map<string, DashboardEntry>();
    for (const [workspaceId, at] of this.#confirmedAt) {
      latest = Math.max(latest ?? at, at);
      const entry = dashboards.get(workspaceId);
      if (entry !== undefined && entry.fetchedAt < at)
        refreshed.set(workspaceId, { ...entry, fetchedAt: at });
    }
    if (refreshed.size === 0) return { dashboards, fetchedAt: latest };
    return { dashboards: new Map([...dashboards, ...refreshed]), fetchedAt: latest };
  }

  #openStream(): void {
    this.#closeStream?.();
    this.#armSilence();
    this.#closeStream = this.#deps.openStream({
      onReady: () => {
        this.#streamFailures = 0;
        this.#clearRetry();
        this.#clearReadyWait();
        if (this.#state.transport !== "stream") {
          this.#setState({ ...this.#state, transport: "stream" });
        }
        void this.#read(EVERYTHING, false);
      },
      onChange: (notice) =>
        this.#queueRead(
          readScopeOf(notice, {
            workspaceId: this.#workspaceId,
            hasQueuedRuns:
              (this.#state.dashboards.get(this.#workspaceId)?.data.columns.queued.length ?? 0) > 0,
          }),
        ),
      onAlive: () => this.#armSilence(),
      onEnd: () => this.#fallBackToPolling(),
    });
  }

  #fallBackToPolling(): void {
    if (!this.#active) return;
    const missedChanges = this.#state.transport === "stream" || this.#readyWait !== null;
    this.#closeStream = null;
    this.#clearSilence();
    this.#clearReadyWait();
    this.#distrustActions();
    this.#setState({ ...this.#state, transport: "polling" });
    this.#startPolling();
    this.#clearRetry();
    this.#streamFailures += 1;
    this.#retry = setTimeout(
      () => {
        this.#retry = null;
        if (this.#active) this.#openStream();
      },
      retryDelay(STREAM_RETRY_MS, this.#streamFailures),
    );
    if (missedChanges) void this.#read(SERVER_DATA, false);
  }

  #armSilence(): void {
    this.#clearSilence();
    this.#silence = setTimeout(() => {
      this.#silence = null;
      this.#closeStream?.();
      this.#fallBackToPolling();
    }, STREAM_SILENCE_MS);
  }

  #queueRead(scope: ReadScope): void {
    if (scope.size === 0) return;
    for (const part of scope) this.#queued.add(part);
    if (this.#debounce !== null) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.#debounce = null;
      const queued = new Set(this.#queued);
      this.#queued.clear();
      void this.#read(queued, false);
    }, CHANGE_DEBOUNCE_MS);
  }

  #startPolling(): void {
    if (this.#poll !== null) return;
    this.#poll = setTimeout(
      () => {
        this.#poll = null;
        void this.#read(SERVER_DATA, false);
      },
      retryDelay(POLL_INTERVAL_MS, this.#pollFailures),
    );
  }

  #stopPolling(): void {
    if (this.#poll !== null) clearTimeout(this.#poll);
    this.#poll = null;
  }

  #clearRetry(): void {
    if (this.#retry !== null) clearTimeout(this.#retry);
    this.#retry = null;
  }

  #clearSilence(): void {
    if (this.#silence !== null) clearTimeout(this.#silence);
    this.#silence = null;
  }

  #clearReadyWait(): void {
    if (this.#readyWait !== null) clearTimeout(this.#readyWait);
    this.#readyWait = null;
  }

  #clearTransport(): void {
    this.#closeStream?.();
    this.#closeStream = null;
    this.#stopPolling();
    this.#clearRetry();
    this.#clearSilence();
    this.#clearReadyWait();
    if (this.#debounce !== null) clearTimeout(this.#debounce);
    this.#debounce = null;
    this.#queued.clear();
    this.#pending.clear();
    this.#publishPending = false;
    if (this.#state.transport !== "polling") {
      this.#setState({ ...this.#state, transport: "polling" });
    }
  }

  #setState(next: SessionState): void {
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}
