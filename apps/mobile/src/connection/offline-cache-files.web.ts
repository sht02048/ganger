import type { CacheFiles } from "./offline-cache";

const KEY_PREFIX = "ganger.offline.";

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export const cacheFiles: CacheFiles = {
  read: (server) => Promise.resolve(storage()?.getItem(`${KEY_PREFIX}${server}`) ?? null),
  write: (server, text) => {
    try {
      storage()?.setItem(`${KEY_PREFIX}${server}`, text);
    } catch {
      return Promise.resolve();
    }
    return Promise.resolve();
  },
  remove: (server) => {
    storage()?.removeItem(`${KEY_PREFIX}${server}`);
    return Promise.resolve();
  },
  removeAll: () => {
    const target = storage();
    if (target === null) return Promise.resolve();
    const keys = Array.from({ length: target.length }, (_, index) => target.key(index));
    for (const key of keys) {
      if (key?.startsWith(KEY_PREFIX) === true) target.removeItem(key);
    }
    return Promise.resolve();
  },
};
