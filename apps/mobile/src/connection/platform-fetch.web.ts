import type { FetchLike } from "./client";

export const platformFetch: FetchLike = (url, init) => globalThis.fetch(url, init);
