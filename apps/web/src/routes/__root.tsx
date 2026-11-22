import * as stylex from "@stylexjs/stylex";
import { Toaster, WindowChrome, WindowDragFrame, documentStyles } from "@ganger/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  ErrorComponent,
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  redirect,
  rootRouteId,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactNode } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { z } from "zod";
import { IntlProvider, useTranslations } from "use-intl";
import { appMessages, defaultLocale, t } from "../i18n";
import { renderedChangeSeq } from "../change-events/rendered-seq";
import { QueryDevtools } from "../query/devtools";
import { RenderedChangeSeqProvider } from "../change-events/subscription";
import { NotFoundScreen } from "../not-found/not-found-screen";
import { useBrowserErrorWatch, useReportCaughtError } from "../shell/browser-error-watch";
import { useDesktopUpdates } from "../shell/desktop-updates";
import { useErrorScreenShown } from "../shell/screen-error";
import {
  serverBuild,
  showsServerBuildNotice,
  useServerBuildStale,
  useServerBuildWatch,
} from "../shell/server-build";
import { ServerBuildToast } from "../shell/server-build-toast";
import { UpdateToast } from "../shell/update-toast";
import { ONBOARDING_PATH, isOpenPath, onboardingRedirect } from "../onboarding/model";
import { getTimeZone, getTitleBarHidden } from "../server/functions";
import { getOnboardingComplete } from "../server/onboarding-functions";
import { localTimeZone, timeZoneCookie, timeZoneFromCookies } from "@ganger/app/time-zone";
import appCss from "../styles/app.css?url";

let completeInBrowser = false;

function rememberOnboardingComplete(complete: boolean): void {
  if (complete && typeof window !== "undefined") completeInBrowser = true;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ location }) => {
    const changeSeq = renderedChangeSeq();
    if (completeInBrowser || isOpenPath(location.pathname))
      return { onboardingComplete: null, changeSeq };
    const complete = await getOnboardingComplete();
    rememberOnboardingComplete(complete);
    if (onboardingRedirect(location.pathname, complete) !== null)
      throw redirect({ to: ONBOARDING_PATH });
    return { onboardingComplete: complete, changeSeq };
  },
  loader: async ({ context }) => {
    const [timeZone, titleBarHidden] = await Promise.all([getTimeZone(), getTitleBarHidden()]);
    return {
      timeZone,
      titleBarHidden,
      onboardingComplete: context.onboardingComplete === true,
      changeSeq: context.changeSeq,
    };
  },
  shouldReload: false,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: t("shell.documentTitle") },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: NotFoundScreen,
  errorComponent: RootError,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang={defaultLocale}>
      <head>
        <HeadContent />
        {import.meta.env.DEV ? <DevStyleXStyles /> : null}
      </head>
      <body {...stylex.props(documentStyles.body)}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function DevStyleXStyles() {
  return (
    <>
      <link rel="stylesheet" href="/virtual:stylex.css" />
      <script type="module" src="/@id/virtual:stylex:runtime" />
    </>
  );
}

const rootLoaderSchema = z.object({ titleBarHidden: z.boolean() });

function RootError({ error }: ErrorComponentProps) {
  useReportCaughtError(error);
  const stale = useServerBuildStale();
  useServerBuildWatch(useQueryClient());
  useEffect(() => {
    void serverBuild.check();
  }, []);
  const titleBarHidden = useRouterState({
    select: (state) =>
      rootLoaderSchema.safeParse(state.matches[0]?.loaderData).data?.titleBarHidden ?? false,
  });
  return (
    <WindowChrome titleBarHidden={titleBarHidden}>
      <WindowDragFrame>
        <ErrorComponent error={error} />
      </WindowDragFrame>
      {stale ? <Toaster label={t("shell.toastRegion")} pinned={<ServerBuildToast />} /> : null}
    </WindowChrome>
  );
}

function RootLayout() {
  const { timeZone, titleBarHidden, onboardingComplete, changeSeq } = Route.useLoaderData();
  const { queryClient } = Route.useRouteContext();
  useBrowserErrorWatch();
  useServerBuildWatch(queryClient);
  useEffect(() => {
    rememberOnboardingComplete(onboardingComplete);
  }, [onboardingComplete]);
  return (
    <IntlProvider locale={defaultLocale} messages={appMessages} timeZone={timeZone}>
      <WindowChrome titleBarHidden={titleBarHidden}>
        <TimeZoneSync timeZone={timeZone} />
        <RenderedChangeSeqProvider seq={changeSeq}>
          <Outlet />
        </RenderedChangeSeqProvider>
        <AppToaster />
        <QueryDevtools />
      </WindowChrome>
    </IntlProvider>
  );
}

function TimeZoneSync({ timeZone }: { timeZone: string }) {
  const router = useRouter();
  useEffect(() => {
    const local = localTimeZone();
    if (local === timeZone || timeZoneFromCookies(document.cookie) === local) return;
    document.cookie = timeZoneCookie(local);
    void router.invalidate({ filter: (match) => match.routeId === rootRouteId });
  }, [router, timeZone]);
  return null;
}

function AppToaster() {
  const tShell = useTranslations("shell");
  const updates = useDesktopUpdates();
  const stale = useServerBuildStale();
  const errorScreen = useErrorScreenShown();
  const view = updates.kind === "desktop" ? updates.view : null;
  if (showsServerBuildNotice({ stale, errorScreen })) {
    return <Toaster label={tShell("toastRegion")} pinned={<ServerBuildToast />} />;
  }
  if (updates.kind !== "desktop" || view === null || view.toast === null) {
    return <Toaster label={tShell("toastRegion")} />;
  }
  return (
    <Toaster
      label={tShell("toastRegion")}
      pinned={
        <UpdateToast
          toast={view.toast}
          serverKind={view.server.kind}
          serverVersion={view.server.version}
          act={updates.act}
        />
      }
    />
  );
}
