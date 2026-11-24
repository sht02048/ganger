import type { QueryKey } from "@tanstack/react-query";
import { changeMessageSchema, invalidatedKeysOf } from "./invalidation";
import type { ReceivedChange } from "./invalidation";

export const CHANGE_STREAM_PATH = "/api/change-events/stream";
export const CHANGE_BATCH_MS = 100;
export const CHANGE_SILENCE_MS = 40_000;
export const CHANGE_REOPEN_MS = 5_000;
export const DISCONNECTED_POLL_MS = 30_000;
export const SHOWN_REFRESH_AFTER_MS = 60_000;

export interface ChangeEventSource {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export const EVENT_SOURCE_OPEN = 1;
export const EVENT_SOURCE_CLOSED = 2;

export interface ChangeChannelTarget {
  invalidate(keys: ReadonlyArray<QueryKey>): void;
  invalidateAll(): void;
  refetchVisible(): void;
}

export interface ChangeChannelOptions {
  after: number | null;
  open: (url: string) => ChangeEventSource;
  target: ChangeChannelTarget;
  path?: string;
}

function parseData(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return null;
  }
}

function seqOf(event: MessageEvent<string>): number | null {
  const seq = Number(event.lastEventId);
  return event.lastEventId !== "" && Number.isSafeInteger(seq) && seq >= 0 ? seq : null;
}

export function changeStreamUrl(path: string, after: number | null): string {
  return after === null ? path : `${path}?after=${after}`;
}

export class ChangeChannel {
  readonly #options: ChangeChannelOptions;
  #source: ChangeEventSource | null = null;
  #lastSeq: number | null;
  #pending: ReceivedChange[] = [];
  #batch: ReturnType<typeof setTimeout> | undefined;
  #silence: ReturnType<typeof setTimeout> | undefined;
  #reopen: ReturnType<typeof setTimeout> | undefined;
  #poll: ReturnType<typeof setInterval> | undefined;
  #closed = false;
  #hidden = false;
  #heardAt = Date.now();

  constructor(options: ChangeChannelOptions) {
    this.#options = options;
    this.#lastSeq = options.after;
  }

  get disconnected(): boolean {
    return this.#poll !== undefined;
  }

  get lastSeq(): number | null {
    return this.#lastSeq;
  }

  start(): void {
    this.#connect();
  }

  close(): void {
    this.#closed = true;
    this.#stop();
  }

  hide(): void {
    if (this.#closed || this.#hidden) return;
    this.#hidden = true;
    clearTimeout(this.#batch);
    this.#flush();
    this.#stop();
  }

  show(): void {
    if (this.#closed) return;
    const unheard = Date.now() - this.#heardAt > SHOWN_REFRESH_AFTER_MS;
    if (this.#hidden) {
      this.#hidden = false;
      this.#connect();
    } else if (unheard) {
      clearTimeout(this.#batch);
      this.#flush();
      this.#stop();
      this.#connect();
    }
    if (!unheard) return;
    this.#heardAt = Date.now();
    this.#options.target.refetchVisible();
  }

  get #idle(): boolean {
    return this.#closed || this.#hidden;
  }

  #stop(): void {
    this.#source?.close();
    this.#source = null;
    for (const timer of [this.#batch, this.#silence, this.#reopen]) clearTimeout(timer);
    clearInterval(this.#poll);
    this.#batch = undefined;
    this.#silence = undefined;
    this.#reopen = undefined;
    this.#poll = undefined;
  }

  #connect(): void {
    if (this.#idle) return;
    const source = this.#options.open(
      changeStreamUrl(this.#options.path ?? CHANGE_STREAM_PATH, this.#lastSeq),
    );
    this.#source = source;
    source.onopen = () => this.#alive();
    source.onerror = () => this.#failed(source);
    source.addEventListener("change", (event) => this.#onChange(event));
    source.addEventListener("ready", (event) => this.#onSeq(event));
    source.addEventListener("heartbeat", () => this.#alive());
    source.addEventListener("reset", (event) => this.#onReset(event));
    this.#watchSilence();
  }

  #onChange(event: MessageEvent<string>): void {
    this.#onSeq(event);
    const change = changeMessageSchema.safeParse(parseData(event.data));
    if (!change.success) return;
    this.#pending.push(change.data);
    this.#batch ??= setTimeout(() => this.#flush(), CHANGE_BATCH_MS);
  }

  #onReset(event: MessageEvent<string>): void {
    this.#onSeq(event);
    this.#pending = [];
    clearTimeout(this.#batch);
    this.#batch = undefined;
    this.#options.target.invalidateAll();
  }

  #onSeq(event: MessageEvent<string>): void {
    this.#alive();
    const seq = seqOf(event);
    if (seq !== null) this.#lastSeq = seq;
  }

  #flush(): void {
    this.#batch = undefined;
    const changes = this.#pending;
    this.#pending = [];
    const keys = invalidatedKeysOf(changes);
    if (keys.length > 0) this.#options.target.invalidate(keys);
  }

  #alive(): void {
    this.#heardAt = Date.now();
    this.#watchSilence();
    if (this.#poll === undefined) return;
    clearInterval(this.#poll);
    this.#poll = undefined;
  }

  #failed(source: ChangeEventSource): void {
    if (this.#idle || source !== this.#source) return;
    if (source.readyState === EVENT_SOURCE_OPEN) return;
    this.#startPolling();
    if (source.readyState === EVENT_SOURCE_CLOSED) this.#scheduleReopen();
  }

  #watchSilence(): void {
    clearTimeout(this.#silence);
    this.#silence = setTimeout(() => {
      this.#startPolling();
      this.#source?.close();
      this.#source = null;
      this.#scheduleReopen();
    }, CHANGE_SILENCE_MS);
  }

  #scheduleReopen(): void {
    if (this.#idle || this.#reopen !== undefined) return;
    this.#source?.close();
    this.#source = null;
    this.#reopen = setTimeout(() => {
      this.#reopen = undefined;
      this.#connect();
    }, CHANGE_REOPEN_MS);
  }

  #startPolling(): void {
    if (this.#idle || this.#poll !== undefined) return;
    this.#poll = setInterval(() => this.#options.target.refetchVisible(), DISCONNECTED_POLL_MS);
  }
}
