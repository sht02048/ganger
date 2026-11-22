import { fetch as expoFetch } from "expo/fetch";

import type { FetchLike } from "./client";

export const platformFetch: FetchLike = (url, init) => expoFetch(url, toExpoInit(init));

function toExpoInit(init: RequestInit | undefined) {
  if (init === undefined) return {};
  const { method, headers, body, signal } = init;
  return {
    ...(method === undefined ? {} : { method }),
    ...(headers === undefined ? {} : { headers }),
    ...(typeof body === "string" ? { body } : {}),
    ...(signal === undefined || signal === null ? {} : { signal }),
  };
}
