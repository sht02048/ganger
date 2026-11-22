import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createNewWorkspace,
  firstWorkspaceInput,
  isOnboardingComplete,
  loadOnboardingPage,
  newWorkspaceInput,
  setUpFirstWorkspace,
} from "../onboarding/load";
import { loadTrackerProjectChoices } from "@ganger/app/settings/load";
import type { SettingsContext } from "@ganger/app/settings/load";
import { getAdapterRegistry, getSecretBox } from "./adapters";
import { getDatabase } from "./database";

function context(): SettingsContext {
  return { db: getDatabase(), secretBox: getSecretBox(), registry: getAdapterRegistry() };
}

export const getOnboardingComplete = createServerFn({ method: "GET" }).handler(() =>
  isOnboardingComplete(getDatabase(), getSecretBox()),
);

export const getOnboardingPage = createServerFn({ method: "GET" })
  .validator(z.object({ step: z.number().int().optional() }))
  .handler(({ data }) => loadOnboardingPage(context(), data.step, new Date()));

export const setUpWorkspace = createServerFn({ method: "POST" })
  .validator(firstWorkspaceInput)
  .handler(({ data }) => setUpFirstWorkspace(context(), data, new Date()));

export const createWorkspace = createServerFn({ method: "POST" })
  .validator(newWorkspaceInput)
  .handler(({ data }) => createNewWorkspace(context(), data, new Date()));

export const getWorkspaceProjectChoices = createServerFn({ method: "GET" }).handler(() =>
  loadTrackerProjectChoices(context(), null),
);
