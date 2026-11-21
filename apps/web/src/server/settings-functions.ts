import { parseBootConfig } from "@ganger/db";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  addTrackerProject,
  addTrackerProjectInput,
  addressesInput,
  briefInput,
  checkGitHubToken,
  checkTrackerConnection,
  connectionIdInput,
  createAutoAssignLabel,
  createLabelInput,
  generalInput,
  githubTokenInput,
  inProgressInput,
  labelInput,
  mappingStateInput,
  mcpWriteInput,
  powerInput,
  removeTrackerProject,
  requestRunnerCheckSetting,
  runnerIdInput,
  runnerInput,
  saveAddresses,
  saveBrief,
  saveGeneral,
  saveGitHubToken,
  saveInProgressState,
  saveLabel,
  saveMappingState,
  saveMcpWriteSetting,
  saveMergedState,
  mergedStateInput,
  savePowerSetting,
  saveTrackerConnectionSetting,
  trackerConnectionInput,
  trackerProjectInput,
  turnOffWebhook,
  verifyWebhookAddress,
  webhookAddressInput,
} from "@ganger/app/settings/actions";
import { planFunnel } from "@ganger/app/funnel-setup";
import type { WebhookSetupView } from "@ganger/app/settings/model";
import { GANGER_YELLOW_HEX } from "@ganger/ui/brand-color";
import { saveRunnerFindingOrca } from "@ganger/app/runner-setup/remote-orca";
import {
  hasPendingRunnerChecks,
  loadBoundProjectReads,
  loadSettingsDb,
  loadTrackerProjectLists,
} from "@ganger/app/settings/load";
import type { SettingsContext } from "@ganger/app/settings/load";
import { getAdapterRegistry, getSecretBox } from "./adapters";
import { getDatabase } from "./database";
import { serverMcpLaunch } from "./mcp-launch";
import { installPowerSettings } from "./power-settings";
import { getTrackerReads } from "./tracker-reads";
import { autoAllowInput, autoAllowedAddresses, refreshAutoAllowedHosts } from "./request-access";
import {
  getServeStatusOutput,
  getThisTailnetAddresses,
  getThisTailnetDevice,
  getWebhookPingFetch,
} from "./webhook-reach";

function context(): SettingsContext {
  const power = installPowerSettings(process.env);
  return {
    db: getDatabase(),
    secretBox: getSecretBox(),
    registry: getAdapterRegistry(),
    mcpLaunch: serverMcpLaunch(process.env, process.execPath),
    trackerReads: getTrackerReads(),
    autoAllowedHosts: autoAllowedAddresses(),
    ...(power === undefined ? {} : { power }),
  };
}

const wsInput = z.object({ ws: z.string().optional() });

export const getSettings = createServerFn({ method: "GET" })
  .validator(wsInput)
  .handler(async ({ data }) => {
    await refreshAutoAllowedHosts();
    return loadSettingsDb(context(), data.ws, new Date());
  });

export const getTrackerProjects = createServerFn({ method: "GET" }).handler(() =>
  loadTrackerProjectLists(context()),
);

export const getBoundProjectReads = createServerFn({ method: "GET" })
  .validator(wsInput)
  .handler(({ data }) => loadBoundProjectReads(context(), data.ws));

export const getRunnerChecksPending = createServerFn({ method: "GET" }).handler(() =>
  hasPendingRunnerChecks(getDatabase()),
);

export const saveWorkspaceGeneral = createServerFn({ method: "POST" })
  .validator(generalInput)
  .handler(({ data }) => saveGeneral(context(), data));

export const saveWorkspaceBrief = createServerFn({ method: "POST" })
  .validator(briefInput)
  .handler(({ data }) => saveBrief(context(), data));

export const addWorkspaceTrackerProject = createServerFn({ method: "POST" })
  .validator(addTrackerProjectInput)
  .handler(({ data }) => addTrackerProject(context(), data));

export const removeWorkspaceTrackerProject = createServerFn({ method: "POST" })
  .validator(trackerProjectInput)
  .handler(({ data }) => removeTrackerProject(context(), data));

export const saveWorkspaceMapping = createServerFn({ method: "POST" })
  .validator(mappingStateInput)
  .handler(({ data }) => saveMappingState(context(), data));

export const saveWorkspaceInProgressState = createServerFn({ method: "POST" })
  .validator(inProgressInput)
  .handler(({ data }) => saveInProgressState(context(), data));

export const saveWorkspaceMergedState = createServerFn({ method: "POST" })
  .validator(mergedStateInput)
  .handler(({ data }) => saveMergedState(context(), data));

export const saveWorkspaceLabel = createServerFn({ method: "POST" })
  .validator(labelInput)
  .handler(({ data }) => saveLabel(context(), data));

export const createWorkspaceAutoAssignLabel = createServerFn({ method: "POST" })
  .validator(createLabelInput)
  .handler(({ data }) => createAutoAssignLabel(context(), data, GANGER_YELLOW_HEX));

export const saveTrackerConnection = createServerFn({ method: "POST" })
  .validator(trackerConnectionInput)
  .handler(({ data }) => saveTrackerConnectionSetting(context(), data, new Date()));

export const checkTrackerConnectionNow = createServerFn({ method: "POST" })
  .validator(connectionIdInput)
  .handler(({ data }) => checkTrackerConnection(context(), data));

export const saveGitHubTokenSetting = createServerFn({ method: "POST" })
  .validator(githubTokenInput)
  .handler(({ data }) => saveGitHubToken(context(), data, new Date()));

export const checkGitHubTokenNow = createServerFn({ method: "POST" }).handler(() =>
  checkGitHubToken(context()),
);

export const saveRunnerSettings = createServerFn({ method: "POST" })
  .validator(runnerInput)
  .handler(({ data }) => saveRunnerFindingOrca(context(), data, new Date()));

export const requestRunnerCheckNow = createServerFn({ method: "POST" })
  .validator(runnerIdInput)
  .handler(({ data }) => requestRunnerCheckSetting(context(), data, new Date()));

export const saveAddressesSetting = createServerFn({ method: "POST" })
  .validator(addressesInput)
  .handler(({ data }) =>
    saveAddresses(context(), data, new Date(), {
      host: getRequestHeader("host") ?? null,
      bindHost: parseBootConfig(process.env).host,
      ...autoAllowInput(),
    }),
  );

export const savePowerSettings = createServerFn({ method: "POST" })
  .validator(powerInput)
  .handler(({ data }) => savePowerSetting(context(), data));

export const saveMcpWriteSettings = createServerFn({ method: "POST" })
  .validator(mcpWriteInput)
  .handler(({ data }) => saveMcpWriteSetting(context(), data, new Date()));

export const turnOffTrackerWebhook = createServerFn({ method: "POST" })
  .validator(connectionIdInput)
  .handler(({ data }) => turnOffWebhook(context(), data, new Date()));

export const checkWebhookAddressNow = createServerFn({ method: "POST" })
  .validator(webhookAddressInput)
  .handler(({ data }) => verifyWebhookAddress(context(), data, new Date(), getWebhookPingFetch()));

function webPort(): number {
  try {
    return parseBootConfig(process.env).port;
  } catch {
    return 3000;
  }
}

function webBindHost(): string {
  try {
    return parseBootConfig(process.env).host;
  } catch {
    return "127.0.0.1";
  }
}

export const getWebhookSetup = createServerFn({ method: "GET" }).handler(
  async (): Promise<WebhookSetupView> => {
    const device = await getThisTailnetDevice();
    if (device === null) return { funnel: null };
    const [addresses, serveOutput] = await Promise.all([
      getThisTailnetAddresses(),
      getServeStatusOutput(device.cli),
    ]);
    return {
      funnel: planFunnel({
        cli: device.cli,
        deviceHost: device.host,
        deviceAddresses: addresses.kind === "known" ? addresses.hosts : [],
        bindHost: webBindHost(),
        webPort: webPort(),
        serveOutput,
      }),
    };
  },
);
