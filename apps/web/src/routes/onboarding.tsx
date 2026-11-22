import { BackLink } from "@ganger/ui";
import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import type { ChangeKind } from "@ganger/db/change-events-model";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../i18n";
import { onboardingMessages } from "../onboarding/messages";
import { PRELOAD_FRESH_MS } from "../query/query-client";
import { HOME_PATH, ONBOARDING_PATH, resolveStep, stepToPin } from "../onboarding/model";
import { OnboardingScreen } from "../onboarding/onboarding-screen";
import type { OnboardingActions } from "../onboarding/onboarding-screen";
import type { DirectEntry } from "../runner-setup/runner-setup";
import { getOnboardingPage, setUpWorkspace } from "../server/onboarding-functions";
import { runnerSetupMessages } from "../runner-setup/messages";
import { useRunnerSetupActions } from "../runner-setup/use-runner-setup-actions";
import {
  useReloadOnSuccess,
  useSettingsActions,
  useSettingsReload,
} from "../settings/use-settings-actions";

const t = createTranslator({
  locale: defaultLocale,
  messages: onboardingMessages,
  namespace: "onboarding",
});

const RUNNER_ADDED: ReadonlyArray<ChangeKind> = ["runner"];
const WORKSPACE_SET_UP: ReadonlyArray<ChangeKind> = ["workspace", "settings", "tracker"];

export const Route = createFileRoute("/onboarding")({
  validateSearch: z.object({
    step: z.number().int().optional().catch(undefined),
    direct: z.boolean().optional().catch(undefined),
    from: z.literal("settings").optional().catch(undefined),
    ws: z.string().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ step: search.step, from: search.from, ws: search.ws }),
  preloadStaleTime: PRELOAD_FRESH_MS,
  loader: async ({ deps }) => {
    const loaded = await getOnboardingPage({
      data: deps.step === undefined ? {} : { step: deps.step },
    });
    const pinned = stepToPin(loaded.page, deps.step);
    if (pinned !== null) {
      throw redirect({
        to: ONBOARDING_PATH,
        search: { step: pinned, from: deps.from, ws: deps.ws },
        replace: true,
      });
    }
    return loaded;
  },
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const { page, trackerProjects } = Route.useLoaderData();
  const search = Route.useSearch();
  const { step } = search;
  const navigate = Route.useNavigate();
  const router = useRouter();
  const direct = useMemo(
    (): DirectEntry => ({
      open: search.direct === true,
      openHref: router.buildLocation({ to: ONBOARDING_PATH, search: { ...search, direct: true } })
        .href,
      closeHref: router.buildLocation({
        to: ONBOARDING_PATH,
        search: { ...search, direct: undefined },
      }).href,
      onChange: (open) => {
        void navigate({ search: (prev) => ({ ...prev, direct: open ? true : undefined }) });
      },
    }),
    [router, navigate, search],
  );
  const reload = useSettingsReload();
  const settingsActions = useSettingsActions(reload);
  const then = useReloadOnSuccess(reload);
  const reloadAfterRunnerAdded = useCallback(() => reload(RUNNER_ADDED), [reload]);
  const setupActions = useRunnerSetupActions(reloadAfterRunnerAdded);
  const actions = useMemo(
    (): OnboardingActions => ({
      ...settingsActions,
      ...setupActions,
      setUpWorkspace: then((data) => setUpWorkspace({ data }), WORKSPACE_SET_UP),
    }),
    [settingsActions, setupActions, then],
  );

  return (
    <ScreenMessages messages={{ ...onboardingMessages, ...runnerSetupMessages }}>
      <OnboardingScreen
        page={page}
        trackerProjects={trackerProjects}
        index={resolveStep(page, step)}
        onStep={(index) => {
          void navigate({ search: { step: index + 1, from: search.from, ws: search.ws } });
        }}
        {...(search.from === "settings"
          ? {
              settingsBack: (
                <BackLink
                  label={t("backToSettings")}
                  render={(anchor) => (
                    <Link to="/settings" search={{ ws: search.ws }} {...anchor} />
                  )}
                />
              ),
            }
          : {})}
        onFinish={() => {
          void navigate({ to: HOME_PATH });
        }}
        actions={actions}
        direct={direct}
      />
    </ScreenMessages>
  );
}
