import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import type { ChangeKind } from "@ganger/db/change-events-model";
import { MutationRejectedError } from "../query/mutation-error";
import { rereadTrackers } from "../server/functions";
import {
  addWorkspaceTrackerProject,
  checkGitHubNow,
  checkWebhookAddressNow,
  checkTrackerConnectionNow,
  createWorkspaceAutoAssignLabel,
  getRunnerChecksPending,
  removeWorkspaceTrackerProject,
  requestRunnerCheckNow,
  saveAddressesSetting,
  saveGitHubTokenSetting,
  saveMcpWriteSettings,
  savePowerSettings,
  saveRunnerSettings,
  saveTrackerConnection,
  saveWorkspaceBrief,
  saveWorkspaceGeneral,
  saveWorkspaceInProgressState,
  saveWorkspaceLabel,
  saveWorkspaceMapping,
  saveWorkspaceMergedState,
  turnOffTrackerWebhook,
} from "../server/settings-functions";
import { GITHUB_AUTH_KEY, invalidateChanged, queryNotificationsDelivered } from "./settings-query";
import type { ActionResult, ProjectDetailActions, SettingsActions } from "./settings-screen";

export type AfterSave = () => Promise<unknown>;

export type AfterChange = (kinds: ReadonlyArray<ChangeKind>) => Promise<unknown>;

export type ReloadOnSuccess = <I>(
  call: (input: I) => Promise<ActionResult>,
  kinds: ReadonlyArray<ChangeKind>,
) => (input: I) => Promise<ActionResult>;

type Outcome = { ok: true } | { ok: false; reason: string };

const SETTINGS: ReadonlyArray<ChangeKind> = ["settings"];
const WORKSPACE: ReadonlyArray<ChangeKind> = ["workspace"];
const RUNNER: ReadonlyArray<ChangeKind> = ["runner"];
const TRACKER: ReadonlyArray<ChangeKind> = ["tracker"];
const SETTINGS_AND_TRACKER: ReadonlyArray<ChangeKind> = ["settings", "tracker"];

export function useSettingsQueryRefresh(): AfterChange {
  const queryClient = useQueryClient();
  return useCallback(
    async (kinds) => {
      await invalidateChanged(queryClient, kinds);
      await queryNotificationsDelivered();
    },
    [queryClient],
  );
}

export function useSettingsReload(): AfterChange {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(
    async (kinds) => {
      await invalidateChanged(queryClient, kinds);
      await router.invalidate({ sync: true });
    },
    [router, queryClient],
  );
}

export function useReloadOnSuccess(afterChange: AfterChange): ReloadOnSuccess {
  return useMemo(
    (): ReloadOnSuccess => (call, kinds) => async (input) => {
      const result = await call(input);
      if (result.ok) await afterChange(kinds);
      return result;
    },
    [afterChange],
  );
}

function rejectedOutcome(error: unknown): { ok: false; reason: string } {
  if (!(error instanceof MutationRejectedError)) throw error;
  const reason: unknown = error.reason;
  return { ok: false, reason: String(reason) };
}

function useSaveMutation<I, R extends Outcome>(
  call: (input: I) => Promise<R>,
  kinds: ReadonlyArray<ChangeKind>,
  afterChange: AfterChange,
): (input: I) => Promise<R | { ok: false; reason: string }> {
  const { mutateAsync } = useMutation({
    mutationFn: async (input: I): Promise<R> => {
      const result = await call(input);
      if (!result.ok) throw new MutationRejectedError(result.reason);
      return result;
    },
    onSuccess: () => afterChange(kinds),
  });
  return useCallback((input: I) => mutateAsync(input).catch(rejectedOutcome), [mutateAsync]);
}

export function useSettingsActions(afterChange: AfterChange): ProjectDetailActions {
  const saveGeneral = useSaveMutation(
    (data: Parameters<SettingsActions["saveGeneral"]>[0]) => saveWorkspaceGeneral({ data }),
    WORKSPACE,
    afterChange,
  );
  const saveBrief = useSaveMutation(
    (data: Parameters<SettingsActions["saveBrief"]>[0]) => saveWorkspaceBrief({ data }),
    WORKSPACE,
    afterChange,
  );
  const addProject = useSaveMutation(
    (data: Parameters<SettingsActions["addProject"]>[0]) => addWorkspaceTrackerProject({ data }),
    SETTINGS_AND_TRACKER,
    afterChange,
  );
  const removeProject = useSaveMutation(
    (data: Parameters<SettingsActions["removeProject"]>[0]) =>
      removeWorkspaceTrackerProject({ data }),
    SETTINGS_AND_TRACKER,
    afterChange,
  );
  const saveMapping = useSaveMutation(
    (data: Parameters<SettingsActions["saveMapping"]>[0]) => saveWorkspaceMapping({ data }),
    SETTINGS,
    afterChange,
  );
  const saveInProgress = useSaveMutation(
    (data: Parameters<SettingsActions["saveInProgress"]>[0]) =>
      saveWorkspaceInProgressState({ data }),
    SETTINGS,
    afterChange,
  );
  const saveMergedState = useSaveMutation(
    (data: Parameters<ProjectDetailActions["saveMergedState"]>[0]) =>
      saveWorkspaceMergedState({ data }),
    SETTINGS,
    afterChange,
  );
  const saveLabel = useSaveMutation(
    (data: Parameters<SettingsActions["saveLabel"]>[0]) => saveWorkspaceLabel({ data }),
    SETTINGS,
    afterChange,
  );
  const createLabel = useSaveMutation(
    (data: Parameters<SettingsActions["createLabel"]>[0]) =>
      createWorkspaceAutoAssignLabel({ data }),
    SETTINGS_AND_TRACKER,
    afterChange,
  );
  const saveConnection = useSaveMutation(
    (data: Parameters<SettingsActions["saveConnection"]>[0]) => saveTrackerConnection({ data }),
    SETTINGS_AND_TRACKER,
    afterChange,
  );
  const queryClient = useQueryClient();
  const afterGitHubChange = useCallback<AfterChange>(
    async (kinds) => {
      await queryClient.invalidateQueries({ queryKey: GITHUB_AUTH_KEY });
      await afterChange(kinds);
    },
    [queryClient, afterChange],
  );
  const saveGitHubToken = useSaveMutation(
    (data: Parameters<SettingsActions["saveGitHubToken"]>[0]) => saveGitHubTokenSetting({ data }),
    SETTINGS,
    afterGitHubChange,
  );
  const checkGitHub = useCallback(async (): Promise<ActionResult> => {
    try {
      return await checkGitHubNow();
    } finally {
      await afterGitHubChange(SETTINGS);
    }
  }, [afterGitHubChange]);
  const saveRunner = useSaveMutation(
    (data: Parameters<SettingsActions["saveRunner"]>[0]) => saveRunnerSettings({ data }),
    RUNNER,
    afterChange,
  );
  const recheckRunner = useSaveMutation(
    (data: Parameters<SettingsActions["recheckRunner"]>[0]) => requestRunnerCheckNow({ data }),
    SETTINGS,
    afterChange,
  );
  const saveAddresses = useSaveMutation(
    (data: Parameters<SettingsActions["saveAddresses"]>[0]) => saveAddressesSetting({ data }),
    SETTINGS,
    afterChange,
  );
  const savePower = useSaveMutation(
    (data: Parameters<SettingsActions["savePower"]>[0]) => savePowerSettings({ data }),
    SETTINGS,
    afterChange,
  );
  const saveMcpWrite = useSaveMutation(
    (data: Parameters<SettingsActions["saveMcpWrite"]>[0]) => saveMcpWriteSettings({ data }),
    SETTINGS,
    afterChange,
  );
  const checkWebhookAddress = useSaveMutation(
    (data: Parameters<SettingsActions["checkWebhookAddress"]>[0]) =>
      checkWebhookAddressNow({ data }),
    SETTINGS,
    afterChange,
  );
  const turnOffWebhook = useSaveMutation(
    (data: Parameters<SettingsActions["turnOffWebhook"]>[0]) => turnOffTrackerWebhook({ data }),
    SETTINGS_AND_TRACKER,
    afterChange,
  );
  return useMemo(
    (): ProjectDetailActions => ({
      saveGeneral,
      saveBrief,
      addProject,
      removeProject,
      saveMapping,
      saveInProgress,
      saveMergedState,
      saveLabel,
      createLabel,
      reloadFromTracker: async () => {
        await rereadTrackers();
        await afterChange(TRACKER);
      },
      saveConnection,
      checkConnection: (data) => checkTrackerConnectionNow({ data }),
      saveGitHubToken,
      checkGitHub,
      saveRunner,
      recheckRunner,
      saveAddresses,
      savePower,
      saveMcpWrite,
      pollRunnerChecks: async () => {
        const pending = await getRunnerChecksPending();
        if (!pending) await afterChange(RUNNER);
        return pending;
      },
      checkWebhookAddress,
      turnOffWebhook,
    }),
    [
      afterChange,
      saveGeneral,
      saveBrief,
      addProject,
      removeProject,
      saveMapping,
      saveInProgress,
      saveMergedState,
      saveLabel,
      createLabel,
      saveConnection,
      saveGitHubToken,
      checkGitHub,
      saveRunner,
      recheckRunner,
      saveAddresses,
      savePower,
      saveMcpWrite,
      checkWebhookAddress,
      turnOffWebhook,
    ],
  );
}
