import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  InfoTip,
  ProblemCallout,
  SettingsRow,
  Switch,
  TextLink,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { serverVersionDiffers } from "@ganger/app/updates/view";
import type { UpdateAction, UpdateView } from "@ganger/app/updates/view";
import { useId } from "react";
import { useTranslations } from "use-intl";
import { LabeledTime } from "../format/labeled-time";
import { particlesOf } from "../format/particles";
import { useTime } from "../format/time";
import { PRODUCT_VERSION } from "../identity/identity";
import { useDesktopUpdates } from "../shell/desktop-updates";

export function UpdatesRows() {
  const updates = useDesktopUpdates();
  switch (updates.kind) {
    case "unknown":
      return <VersionRow />;
    case "browser":
      return <BrowserUpdates />;
    case "desktop":
      return updates.view === null ? (
        <VersionRow />
      ) : (
        <DesktopUpdates view={updates.view} act={updates.act} />
      );
  }
}

function VersionRow() {
  const t = useTranslations("settings.updates");
  return <SettingsRow label={t("label")} detail={PRODUCT_VERSION} />;
}

export function BrowserUpdates() {
  const t = useTranslations("settings.updates");
  const ts = useTranslations("settings");
  return (
    <SettingsRow
      label={t("label")}
      info={
        <InfoTip
          label={ts("infoLabel", { label: t("label") })}
          content={`${t("browserManual")} ${t("browserDesktop")}`}
        />
      }
      detail={t("browserDetail", { version: PRODUCT_VERSION })}
    />
  );
}

export function DesktopUpdates({
  view,
  act,
}: {
  view: UpdateView;
  act: (action: UpdateAction) => void;
}) {
  const t = useTranslations("settings.updates");
  const ts = useTranslations("settings");
  const autoId = useId();
  const autoSwitchId = useId();
  const checking = view.check.kind === "checking" || view.check.kind === "downloading";
  const ready = view.check.kind === "ready";
  return (
    <>
      <SettingsRow
        label={t("label")}
        detail={
          <span {...stylex.props(styles.detail)}>
            <span>
              <VersionLine view={view} />
            </span>
            <span role="status">{ready ? null : <CheckLine view={view} />}</span>
            {ready ? (
              <span>
                <CheckLine view={view} />
              </span>
            ) : null}
          </span>
        }
        control={
          view.check.kind === "unavailable" ? undefined : (
            <Button
              aria-disabled={checking}
              aria-busy={checking}
              onClick={() => {
                if (!checking) act("check-now");
              }}
            >
              {view.check.kind === "checking" ? t("checking") : t("checkNow")}
            </Button>
          )
        }
        message={<Situation view={view} act={act} />}
      />
      <SettingsRow
        label={t("auto")}
        labelId={autoId}
        labelFor={autoSwitchId}
        info={
          <InfoTip label={ts("infoLabel", { label: t("auto") })} content={t("autoDescription")} />
        }
        control={
          <Switch
            id={autoSwitchId}
            aria-labelledby={autoId}
            checked={view.autoUpdate}
            disabled={view.check.kind === "unavailable"}
            onCheckedChange={(checked) => act(checked ? "auto-on" : "auto-off")}
          />
        }
      />
    </>
  );
}

function VersionLine({ view }: { view: UpdateView }) {
  const t = useTranslations("settings.updates");
  if (view.server.version === null) return t("appOnly", { app: view.appVersion });
  if (!serverVersionDiffers(view)) return t("same", { version: view.appVersion });
  return t("differs", { app: view.appVersion, server: view.server.version });
}

function CheckLine({ view }: { view: UpdateView }) {
  const t = useTranslations("settings.updates");
  const time = useTime();
  const at = view.lastCheckedAt;
  const when =
    at === null ? (
      t("never")
    ) : (
      <LabeledTime dateTime={at} label={t("checkedLabel")}>
        {time.ago(at, Math.max(0, Date.now() - new Date(at).getTime()))}
      </LabeledTime>
    );
  const check = view.check;
  switch (check.kind) {
    case "unavailable":
      return t("unavailable");
    case "checking":
      return t("checkingStatus");
    case "failed":
      return t("failedStatus");
    case "idle":
      return when;
    case "latest":
      return t.rich("latestStatus", { when: () => when });
    case "downloading":
      return t("downloadingStatus", {
        version: check.version,
        object: particlesOf(check.version).object,
      });
    case "ready":
      return t("readyStatus", {
        version: check.version,
        object: particlesOf(check.version).object,
      });
    case "manual":
      return t.rich("manualStatus", {
        when: () => when,
        version: check.version,
        subject: particlesOf(check.version).subject,
      });
  }
}

function Situation({ view, act }: { view: UpdateView; act: (action: UpdateAction) => void }) {
  const t = useTranslations("settings.updates");
  const check = view.check;
  if (check.kind === "ready") {
    return (
      <Actions>
        <Button onClick={() => act("restart")}>{t("restart")}</Button>
        <TextLink href={check.notesUrl} external>
          {t("notes")}
        </TextLink>
      </Actions>
    );
  }
  if (check.kind === "manual") {
    const subject = particlesOf(check.version).subject;
    return (
      <ProblemCallout
        title={t(`manual.${check.reason}.title`)}
        actions={
          <TextLink href={check.notesUrl} external>
            {t("openRelease")}
          </TextLink>
        }
      >
        {t(`manual.${check.reason}.body`, { version: check.version, subject })}
      </ProblemCallout>
    );
  }
  if (view.server.kind !== "app" && serverVersionDiffers(view) && view.server.version !== null) {
    return (
      <ProblemCallout title={t(`serverDiffers.${view.server.kind}.title`)}>
        {t(`serverDiffers.${view.server.kind}.body`, {
          app: view.appVersion,
          server: view.server.version,
        })}
      </ProblemCallout>
    );
  }
  return null;
}

const styles = stylex.create({
  detail: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: space.s2,
    rowGap: space.px2,
  },
});
