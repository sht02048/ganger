import { parsePushMemory } from "./push-memory-schema";
import type { PushMemory } from "./push-port";

const STORE_KEY = "ganger.push";

export const pushMemory: PushMemory = {
  load: () => {
    try {
      return Promise.resolve(parsePushMemory(globalThis.localStorage.getItem(STORE_KEY)));
    } catch {
      return Promise.resolve(parsePushMemory(null));
    }
  },
  save: (value) => {
    try {
      globalThis.localStorage.setItem(STORE_KEY, JSON.stringify(value));
    } catch {
      return Promise.resolve();
    }
    return Promise.resolve();
  },
  clear: () => {
    try {
      globalThis.localStorage.removeItem(STORE_KEY);
    } catch {
      return Promise.resolve();
    }
    return Promise.resolve();
  },
};
