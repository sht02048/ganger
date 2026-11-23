import { randomUUID } from "expo-crypto";

export const REQUEST_ID_RETRY_WINDOW_MS = 60_000;

interface KeptRequestId {
  requestId: string;
  content: string;
  keptAt: number;
}

export class RunRequestIds {
  readonly #kept = new Map<string, KeptRequestId>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  idFor(slot: string, content: string): string {
    const now = this.#now();
    const kept = this.#kept.get(slot);
    if (kept?.content === content && now - kept.keptAt < REQUEST_ID_RETRY_WINDOW_MS) {
      kept.keptAt = now;
      return kept.requestId;
    }
    const requestId = randomUUID();
    this.#kept.set(slot, { requestId, content, keptAt: now });
    return requestId;
  }

  forget(slot: string): void {
    this.#kept.delete(slot);
  }
}
