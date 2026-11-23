import {
  notifyManager,
  queryOptions,
  skipToken,
  useQueries,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { mergeSettingsPage } from "@ganger/app/settings/merge";
import type {
  BoundProjectReads,
  Choice,
  Remote,
  SettingsPage,
  TrackerProjectList,
} from "@ganger/app/settings/model";
import type { ChangeKind } from "@ganger/db/change-events-model";
import { invalidatedKeysOf } from "../change-events/invalidation";
import { DB_STALE_TIME_MS } from "../query/query-client";
import {
  getBoundProjectReads,
  getGitHubAuthView,
  getSettings,
  getTrackerProjects,
  getWebhookSetup,
} from "../server/settings-functions";
import { TRACKER_KEY, TRACKER_STALE_TIME_MS, trackerLabelsKey } from "../tickets/tickets-query";

export const SETTINGS_KEY = ["settings"] as const;

function wsKey(ws: string | undefined): string {
  return ws ?? "";
}

export function settingsQuery(ws: string | undefined) {
  return queryOptions({
    queryKey: [...SETTINGS_KEY, wsKey(ws)],
    queryFn: () => getSettings({ data: { ws } }),
  });
}

export function trackerReadStaleTime(reads: ReadonlyArray<Remote<unknown>> | undefined): number {
  return reads !== undefined && reads.some((read) => !read.ok)
    ? DB_STALE_TIME_MS
    : TRACKER_STALE_TIME_MS;
}

export const trackerProjectsQuery = queryOptions({
  queryKey: [...TRACKER_KEY, "projects"],
  queryFn: () => getTrackerProjects(),
  staleTime: (query) =>
    trackerReadStaleTime(query.state.data?.map((list: TrackerProjectList) => list.projects)),
});

export function boundProjectReadsQuery(queryClient: QueryClient, ws: string | undefined) {
  return queryOptions({
    queryKey: [...TRACKER_KEY, "states", wsKey(ws)],
    queryFn: async () => {
      const reads = await getBoundProjectReads({ data: { ws } });
      for (const read of reads) {
        if (!read.labels.ok) continue;
        queryClient.setQueryData(trackerLabelsKey(read.connection, read.projectId), read.labels);
      }
      return reads;
    },
    staleTime: (query) =>
      trackerReadStaleTime(
        query.state.data?.flatMap((read: BoundProjectReads) => [read.states, read.labels]),
      ),
  });
}

function sharedLabelsQuery(read: BoundProjectReads) {
  return queryOptions<Remote<Choice>>({
    queryKey: trackerLabelsKey(read.connection, read.projectId),
    queryFn: skipToken,
  });
}

export const GITHUB_AUTH_KEY = ["github-auth"] as const;

export const githubAuthQuery = queryOptions({
  queryKey: GITHUB_AUTH_KEY,
  queryFn: () => getGitHubAuthView(),
});

export const webhookSetupQuery = queryOptions({
  queryKey: ["webhook-setup"],
  queryFn: () => getWebhookSetup(),
});

export function useSettingsPage(ws: string | undefined): SettingsPage {
  const queryClient = useQueryClient();
  const { data: db } = useSuspenseQuery(settingsQuery(ws));
  const { data: projects } = useSuspenseQuery(trackerProjectsQuery);
  const { data: reads } = useSuspenseQuery(boundProjectReadsQuery(queryClient, ws));
  const sharedLabels = useQueries({
    queries: reads.map(sharedLabelsQuery),
    combine: (results) => results.map((result) => result.data),
  });
  return useMemo(
    () => mergeSettingsPage(db, { projects, reads: withSharedLabels(reads, sharedLabels) }),
    [db, projects, reads, sharedLabels],
  );
}

export function withSharedLabels(
  reads: ReadonlyArray<BoundProjectReads>,
  shared: ReadonlyArray<Remote<Choice> | undefined>,
): BoundProjectReads[] {
  return reads.map((read, index) => {
    const labels = shared[index];
    return read.labels.ok && labels !== undefined ? { ...read, labels } : read;
  });
}

export async function invalidateChanged(
  queryClient: QueryClient,
  kinds: ReadonlyArray<ChangeKind>,
): Promise<void> {
  const keys = invalidatedKeysOf(
    kinds.map((kind) => ({ kind, targetId: null, workspaceId: null, part: null })),
  );
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export function queryNotificationsDelivered(): Promise<void> {
  return new Promise((resolve) => {
    notifyManager.schedule(resolve);
  });
}
