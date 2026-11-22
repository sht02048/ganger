import type { V1Dashboard, V1Runner, V1ThisDevice, V1Workspaces } from "@ganger/api";

import type { V1Client, V1Failure, V1Result } from "./client";
import type { ChangeStreamHandlers } from "./change-stream";

export const POLL_INTERVAL_MS = 15_000;
export const STREAM_RETRY_MS = 60_000;
export const STREAM_SILENCE_MS = 35_000;
export const CHANGE_DEBOUNCE_MS = 300;

export type SessionPhase =
  | "loading"
  | "live"
  | "stale"
  | "host-blocked"
  | "incompatible"
  | "rejected";

export interface DashboardEntry {
  data: V1Dashboard;
  fetchedAt: number;
}

export interface SessionState {
  phase: SessionPhase;
  transport: "stream" | "polling";
  dashboards: ReadonlyMap<string, DashboardEntry>;
  staleReason: "unreachable" | "server-error";
  workspaces: V1Workspaces["workspaces"];
  runners: V1Runner[];
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
}

const FAILURE_RANK: Record<V1Failure["kind"], number> = {
  "token-rejected": 4,
  "host-blocked": 3,
  incompatible: 2,
  "server-error": 1,
  unreachable: 0,
};

function worstFailure(results: ReadonlyArray<V1Result<unknown>>): V1Failure | null {
  let worst: V1Failure | null = null;
  for (const result of results) {
    if (result.ok) continue;
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

export class LiveSession {
  readonly #deps: SessionDeps;
  readonly #listeners = new Set<() => void>();
  #state: SessionState = {
    phase: "loading",
    transport: "polling",
    dashboards: new Map(),
    staleReason: "unreachable",
    workspaces: [],
    runners: [],
    device: null,
    serverVersion: null,
    fetchedAt: null,
    actionsReady: false,
  };
  #workspaceId: string;
  #generation = 0;
  #trustEpoch = 0;
  #active = false;
  #refreshing = false;
  #refreshAgain = false;
  #closeStream: (() => void) | null = null;
  #poll: ReturnType<typeof setInterval> | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #silence: ReturnType<typeof setTimeout> | null = null;
  #debounce: ReturnType<typeof setTimeout> | null = null;

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
    this.#startPolling();
    this.#openStream();
    void this.refresh();
  }

  stop(): void {
    this.#active = false;
    this.#generation += 1;
    this.#clearTransport();
  }

  setWorkspace(workspaceId: string): void {
    if (workspaceId === this.#workspaceId) return;
    this.#workspaceId = workspaceId;
    if (this.#active) void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.#active) return;
    if (this.#refreshing) {
      this.#refreshAgain = true;
      return;
    }
    this.#refreshing = true;
    try {
      await this.#readAll();
    } finally {
      this.#refreshing = false;
      if (this.#refreshAgain) {
        this.#refreshAgain = false;
        void this.refresh();
      }
    }
  }

  noteFailure(failure: V1Failure): void {
    if (!this.#active) return;
    this.#distrustActions();
    this.#applyFailure(failure);
  }

  #distrustActions(): void {
    this.#trustEpoch += 1;
    if (this.#state.actionsReady) this.#setState({ ...this.#state, actionsReady: false });
  }

  async #readAll(): Promise<void> {
    const generation = this.#generation;
    const trustEpoch = this.#trustEpoch;
    const workspaceId = this.#workspaceId;
    const { client, timeZone, now } = this.#deps;
    const [dashboard, workspaces, runners, device] = await Promise.all([
      client.dashboard(workspaceId, timeZone),
      client.workspaces(),
      client.runners(),
      client.thisDevice(),
    ]);
    if (generation !== this.#generation || !this.#active) return;
    const failure = worstFailure([dashboard, workspaces, runners, device]);
    if (failure !== null || !dashboard.ok || !workspaces.ok || !runners.ok || !device.ok) {
      this.#applyFailure(failure ?? { kind: "server-error" });
      return;
    }
    const dashboards = new Map(this.#state.dashboards);
    const fetchedAt = now();
    dashboards.set(workspaceId, { data: dashboard.data, fetchedAt });
    this.#setState({
      ...this.#state,
      phase: "live",
      dashboards,
      workspaces: workspaces.data.workspaces,
      runners: runners.data.runners,
      device: device.data,
      serverVersion: dashboard.serverVersion,
      fetchedAt,
      actionsReady: trustEpoch === this.#trustEpoch,
    });
    if (this.#state.transport === "stream") this.#stopPolling();
  }

  #applyFailure(failure: V1Failure): void {
    const phase = phaseOf(failure);
    const serverVersion =
      failure.kind === "incompatible" ? failure.serverVersion : this.#state.serverVersion;
    const staleReason =
      failure.kind === "server-error" || failure.kind === "unreachable"
        ? failure.kind
        : this.#state.staleReason;
    this.#setState({ ...this.#state, phase, serverVersion, staleReason, actionsReady: false });
    if (phase === "rejected") {
      this.stop();
      this.#deps.onRejected();
      return;
    }
    this.#startPolling();
  }

  #openStream(): void {
    this.#closeStream?.();
    this.#armSilence();
    this.#closeStream = this.#deps.openStream({
      onReady: () => {
        this.#clearRetry();
        this.#setState({ ...this.#state, transport: "stream" });
        void this.refresh();
      },
      onChange: () => this.#scheduleRefresh(),
      onAlive: () => this.#armSilence(),
      onEnd: () => this.#fallBackToPolling(),
    });
  }

  #fallBackToPolling(): void {
    if (!this.#active) return;
    this.#closeStream = null;
    this.#clearSilence();
    this.#distrustActions();
    this.#setState({ ...this.#state, transport: "polling" });
    this.#startPolling();
    this.#clearRetry();
    this.#retry = setTimeout(() => {
      this.#retry = null;
      if (this.#active) this.#openStream();
    }, STREAM_RETRY_MS);
    void this.refresh();
  }

  #armSilence(): void {
    this.#clearSilence();
    this.#silence = setTimeout(() => {
      this.#silence = null;
      this.#closeStream?.();
      this.#fallBackToPolling();
    }, STREAM_SILENCE_MS);
  }

  #scheduleRefresh(): void {
    if (this.#debounce !== null) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.#debounce = null;
      void this.refresh();
    }, CHANGE_DEBOUNCE_MS);
  }

  #startPolling(): void {
    this.#poll ??= setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
  }

  #stopPolling(): void {
    if (this.#poll !== null) clearInterval(this.#poll);
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

  #clearTransport(): void {
    this.#closeStream?.();
    this.#closeStream = null;
    this.#stopPolling();
    this.#clearRetry();
    this.#clearSilence();
    if (this.#debounce !== null) clearTimeout(this.#debounce);
    this.#debounce = null;
    if (this.#state.transport !== "polling") {
      this.#setState({ ...this.#state, transport: "polling" });
    }
  }

  #setState(next: SessionState): void {
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}
