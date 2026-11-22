import * as stylex from "@stylexjs/stylex";
import { Button, NoticeLayout, PageHeader, ScreenLayout, Text, focusStyles } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useQueryClient, useQueryErrorResetBoundary } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslations } from "use-intl";
import { reloadPage, retryOrReload, serverBuild } from "./server-build";

type RetryState =
  | { kind: "idle" }
  | { kind: "retrying"; href: string }
  | { kind: "failed"; href: string; attempt: number };

let retryState: RetryState = { kind: "idle" };
let failedAttempts = 0;
let mountedErrorScreens = 0;
const listeners = new Set<() => void>();

function setRetryState(next: RetryState): void {
  retryState = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function currentRetryState(): RetryState {
  return retryState;
}

const IDLE: RetryState = { kind: "idle" };

function idleRetryState(): RetryState {
  return IDLE;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function queriesSettled(queryClient: QueryClient): Promise<void> {
  if (queryClient.isFetching() === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = queryClient.getQueryCache().subscribe(() => {
      if (queryClient.isFetching() !== 0) return;
      stop();
      resolve();
    });
  });
}

async function retrySettled(queryClient: QueryClient): Promise<void> {
  await nextFrame();
  await queriesSettled(queryClient);
  await nextFrame();
  await nextFrame();
}

const errorScreenListeners = new Set<() => void>();

function changeMountedErrorScreens(by: 1 | -1): void {
  mountedErrorScreens += by;
  for (const listener of errorScreenListeners) listener();
}

function subscribeErrorScreens(listener: () => void): () => void {
  errorScreenListeners.add(listener);
  return () => errorScreenListeners.delete(listener);
}

export function useErrorScreenShown(): boolean {
  return useSyncExternalStore(
    subscribeErrorScreens,
    () => mountedErrorScreens > 0,
    () => false,
  );
}

function focusCurrentScreenLinkIfLost(): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    document.querySelector<HTMLElement>('nav a[aria-current="page"]')?.focus();
  });
}

export function ScreenError({ reset }: ErrorComponentProps) {
  const t = useTranslations("shell.screenError");
  const router = useRouter();
  const queryClient = useQueryClient();
  const queryErrorReset = useQueryErrorResetBoundary();
  const href = useRouterState({ select: (state) => state.location.href });
  const state = useSyncExternalStore(subscribe, currentRetryState, idleRetryState);
  const headingRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const failedRef = useRef<HTMLElement>(null);
  const retrying = state.kind === "retrying" && state.href === href;
  const failedAttempt = state.kind === "failed" && state.href === href ? state.attempt : null;

  useEffect(() => {
    changeMountedErrorScreens(1);
    void serverBuild.check();
    return () => changeMountedErrorScreens(-1);
  }, []);

  useEffect(() => {
    if (failedAttempt !== null) failedRef.current?.focus();
    else if (retryState.kind === "retrying") retryRef.current?.focus();
    else headingRef.current?.focus();
  }, [failedAttempt]);

  const retry = () => {
    if (retrying) return;
    setRetryState({ kind: "retrying", href });
    void retryOrReload({
      check: serverBuild.check,
      stillOnErrorScreen: () => mountedErrorScreens > 0 && router.state.location.href === href,
      reload: reloadPage,
      retry: retryReads,
      abandon: () => setRetryState(IDLE),
    });
  };

  const retryReads = () => {
    queryErrorReset.reset();
    const failed = () => {
      failedAttempts += 1;
      setRetryState({ kind: "failed", href, attempt: failedAttempts });
      const stopWatching = router.subscribe("onResolved", (event) => {
        if (event.toLocation.href === href) return;
        stopWatching();
        if (retryState.kind === "failed" && retryState.href === href) setRetryState(IDLE);
      });
    };
    router
      .invalidate({ filter: (match) => match.status === "error", sync: true })
      .then(() => {
        reset();
        return retrySettled(queryClient);
      })
      .then(() => {
        if (mountedErrorScreens > 0) failed();
        else {
          setRetryState(IDLE);
          focusCurrentScreenLinkIfLost();
        }
      }, failed);
  };

  return (
    <ScreenLayout
      header={
        <div ref={headingRef} tabIndex={-1} {...stylex.props(focusStyles.target)}>
          <PageHeader title={t("title")} />
        </div>
      }
    >
      <NoticeLayout>
        <div {...stylex.props(styles.body)}>
          <div>
            <Text variant="body">{t("body")}</Text>
            <div {...stylex.props(failedAttempt !== null && styles.retryFailed)}>
              <Text variant="body" role="status" tabIndex={-1} ref={failedRef}>
                {failedAttempt === null ? "" : t("retryFailed")}
              </Text>
            </div>
          </div>
          <div>
            <Button
              ref={retryRef}
              variant="secondary"
              busy={{ active: retrying, label: t("retrying") }}
              onClick={retry}
            >
              {t("retry")}
            </Button>
          </div>
        </div>
      </NoticeLayout>
    </ScreenLayout>
  );
}

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s4 },
  retryFailed: { marginTop: space.s2 },
});
