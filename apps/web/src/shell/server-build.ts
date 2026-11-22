import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { z } from "zod";
import { BUILD_ID } from "../identity/build-id";

const BUILD_CHECK_TIMEOUT_MS = 3_000;

const serverBuildSchema = z.object({ buildId: z.string().min(1) });

export type BuildCheck = "same" | "different" | "unknown";

export interface ServerBuildWatch {
  check: () => Promise<BuildCheck>;
  isStale: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

export function createServerBuildWatch(options: {
  clientBuildId: string;
  fetchBuild: () => Promise<unknown>;
}): ServerBuildWatch {
  let stale = false;
  let inFlight: Promise<BuildCheck> | null = null;
  const listeners = new Set<() => void>();

  const read = async (): Promise<BuildCheck> => {
    let body: unknown;
    try {
      body = await options.fetchBuild();
    } catch {
      return "unknown";
    }
    const parsed = serverBuildSchema.safeParse(body);
    if (!parsed.success) return "unknown";
    if (parsed.data.buildId === options.clientBuildId) return "same";
    stale = true;
    for (const listener of listeners) listener();
    return "different";
  };

  return {
    check: () => {
      if (stale) return Promise.resolve("different");
      inFlight ??= read().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    isStale: () => stale,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function fetchServerBuild(): Promise<unknown> {
  const response = await fetch("/api/build", {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(BUILD_CHECK_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return response.json();
}

export const serverBuild = createServerBuildWatch({
  clientBuildId: BUILD_ID,
  fetchBuild: fetchServerBuild,
});

export function reloadPage(): void {
  window.location.reload();
}

export async function checkBuildOnFailure<T>(
  next: () => Promise<T>,
  check: () => Promise<BuildCheck>,
): Promise<T> {
  try {
    return await next();
  } catch (error) {
    void check();
    throw error;
  }
}

export async function retryOrReload(actions: {
  check: () => Promise<BuildCheck>;
  stillOnErrorScreen: () => boolean;
  reload: () => void;
  retry: () => void;
  abandon: () => void;
}): Promise<void> {
  const result = await actions.check();
  if (!actions.stillOnErrorScreen()) actions.abandon();
  else if (result === "different") actions.reload();
  else actions.retry();
}

export function showsServerBuildNotice(state: { stale: boolean; errorScreen: boolean }): boolean {
  return state.stale && !state.errorScreen;
}

export function watchServerBuild(
  target: {
    window: EventTarget;
    document: EventTarget & { visibilityState: string };
    queryClient: QueryClient;
  },
  watch: Pick<ServerBuildWatch, "check">,
): () => void {
  const check = () => void watch.check();
  const onVisibility = () => {
    if (target.document.visibilityState === "visible") check();
  };
  target.window.addEventListener("focus", check);
  target.document.addEventListener("visibilitychange", onVisibility);
  const stopQueries = target.queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "error") check();
  });
  const stopMutations = target.queryClient.getMutationCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "error") check();
  });
  return () => {
    target.window.removeEventListener("focus", check);
    target.document.removeEventListener("visibilitychange", onVisibility);
    stopQueries();
    stopMutations();
  };
}

export function useServerBuildWatch(queryClient: QueryClient): void {
  useEffect(() => watchServerBuild({ window, document, queryClient }, serverBuild), [queryClient]);
}

export function useServerBuildStale(): boolean {
  return useSyncExternalStore(serverBuild.subscribe, serverBuild.isStale, () => false);
}
