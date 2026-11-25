import * as stylex from "@stylexjs/stylex";
import type { DevicesView } from "@ganger/app/devices/connection";
import type { MobileAccessResult, MobileAccessView, PortInUse } from "@ganger/app/mobile-access";
import {
  Actions,
  Button,
  InfoTip,
  SettingsGroup,
  NumberedList,
  SettingsRow,
  Text,
  TextLink,
  VisuallyHidden,
  buttonStyles,
  focusStyles,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslations } from "use-intl";
import { PhoneList, PhoneQr, type DeviceActions } from "./mobile-phones";
import { SettingsFrame } from "./settings-frame";

export const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";

export interface MobileActions {
  turnOn: () => Promise<MobileAccessResult>;
  turnOff: () => Promise<MobileAccessResult>;
  recheck: () => Promise<MobileAccessView | null>;
}

export interface MobileScreenProps {
  access: MobileAccessView;
  devices: DevicesView;
  deviceActions: DeviceActions;
  actions: MobileActions;
  nav: ReactNode;
}

type Status = { tone: "done" | "problem"; text: ReactNode } | null;

export function MobileScreen({ access, devices, deviceActions, actions, nav }: MobileScreenProps) {
  const t = useTranslations("settings");
  const [status, setStatus] = useState<Status>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const report = (next: Status) => {
    setStatus(next);
    statusRef.current?.focus();
  };
  return (
    <SettingsFrame title={t("pages.mobile")} nav={nav}>
      {access.kind === "needs-tailscale" ? (
        <NeedsTailscale actions={actions} report={report} />
      ) : access.kind === "off" ? (
        <TurnedOff access={access} actions={actions} report={report} />
      ) : (
        <TurnedOn
          access={access}
          devices={devices}
          deviceActions={deviceActions}
          actions={actions}
          report={report}
          statusRef={statusRef}
        />
      )}
      {access.kind === "on" || devices.devices.length === 0 ? null : (
        <SettingsGroup>
          <PhoneList view={devices} actions={deviceActions} report={report} statusRef={statusRef} />
        </SettingsGroup>
      )}
      <div ref={statusRef} tabIndex={-1} role="status" {...stylex.props(focusStyles.target)}>
        {status === null ? null : (
          <Text variant="meta" {...(status.tone === "problem" ? { tone: "problem" } : {})}>
            {status.text}
          </Text>
        )}
      </div>
    </SettingsFrame>
  );
}

type Report = (status: Status) => void;

function OpenLabelInfo({ content }: { content: string }) {
  const t = useTranslations("settings");
  return <InfoTip label={t("infoLabel", { label: t("mobile.open") })} content={content} />;
}

function usePortInUseText(): (port: PortInUse) => string {
  const t = useTranslations("settings.mobile");
  return (port) =>
    t(port.isPublic ? "portInUsePublic" : "portInUse", { uses: port.uses.join(", ") });
}

function useRefusalText(): (result: Exclude<MobileAccessResult, { ok: true }>) => ReactNode {
  const t = useTranslations("settings.mobile");
  const portText = usePortInUseText();
  return (result) => {
    if (result.reason === "port-in-use" && result.portInUse !== undefined) {
      return portText(result.portInUse);
    }
    if (result.reason === "serve-failed" && result.approvalUrl !== undefined) {
      return (
        <>
          {t("needsHttps")}{" "}
          <TextLink href={result.approvalUrl} external>
            {t("approve")}
          </TextLink>
        </>
      );
    }
    return t(`refusal.${result.reason}`);
  };
}

function TurnedOff({
  access,
  actions,
  report,
}: {
  access: Extract<MobileAccessView, { kind: "off" }>;
  actions: MobileActions;
  report: Report;
}) {
  const t = useTranslations("settings.mobile");
  const portText = usePortInUseText();
  const refusalText = useRefusalText();
  const [busy, setBusy] = useState(false);
  const turnOn = async () => {
    setBusy(true);
    try {
      const result = await actions.turnOn();
      report(
        result.ok
          ? { tone: "done", text: t("turnedOn") }
          : { tone: "problem", text: refusalText(result) },
      );
    } catch {
      report({ tone: "problem", text: t("failed") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsGroup>
      <SettingsRow
        label={t("open")}
        info={<OpenLabelInfo content={t("offInfo")} />}
        detail={t("tailscaleConnected", { host: access.host })}
        detailTone="pass"
        control={
          <Button
            variant="primary"
            disabled={busy || access.portInUse !== null}
            busy={{ active: busy, label: t("turningOn") }}
            onClick={() => void turnOn()}
          >
            {t("turnOn")}
          </Button>
        }
        message={
          access.portInUse === null ? null : (
            <Text variant="meta" tone="problem">
              {portText(access.portInUse)}
            </Text>
          )
        }
      />
    </SettingsGroup>
  );
}

function TurnedOn({
  access,
  devices,
  deviceActions,
  actions,
  report,
  statusRef,
}: {
  access: Extract<MobileAccessView, { kind: "on" }>;
  devices: DevicesView;
  deviceActions: DeviceActions;
  actions: MobileActions;
  report: Report;
  statusRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations("settings.mobile");
  const refusalText = useRefusalText();
  const [busy, setBusy] = useState(false);
  const turnOff = async () => {
    setBusy(true);
    try {
      const result = await actions.turnOff();
      report(
        result.ok
          ? { tone: "done", text: t("turnedOff") }
          : { tone: "problem", text: refusalText(result) },
      );
    } catch {
      report({ tone: "problem", text: t("failed") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsGroup>
      <SettingsRow
        label={t("open")}
        info={<OpenLabelInfo content={access.viaTailscale ? t("onInfo") : t("savedInfo")} />}
        detail={
          <>
            <Text variant="meta" mono>
              {access.address}
            </Text>
            {t("onDetail")}
          </>
        }
        control={
          <Button
            disabled={busy}
            busy={{ active: busy, label: t("turningOff") }}
            onClick={() => void turnOff()}
          >
            {t("turnOff")}
          </Button>
        }
        message={
          access.fallbackPort === null ? null : (
            <Text variant="meta">{t("fallbackPort", { port: String(access.fallbackPort) })}</Text>
          )
        }
        expanded={<PhoneQr view={devices} actions={deviceActions} />}
      />
      <PhoneList view={devices} actions={deviceActions} report={report} statusRef={statusRef} />
    </SettingsGroup>
  );
}

function NeedsTailscale({ actions, report }: { actions: MobileActions; report: Report }) {
  const t = useTranslations("settings.mobile.needs");
  const tSettings = useTranslations("settings");
  const [busy, setBusy] = useState(false);
  const recheck = async () => {
    setBusy(true);
    try {
      const next = await actions.recheck();
      if (next?.kind === "needs-tailscale") report({ tone: "problem", text: t("stillMissing") });
      else report(null);
    } catch {
      report({ tone: "problem", text: tSettings("mobile.failed") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsGroup padded>
      <div {...stylex.props(styles.needs)}>
        <div {...stylex.props(styles.lines)}>
          <Text variant="title" tone="strong">
            {t("title")}
          </Text>
          <Text variant="meta">{t("body")}</Text>
        </div>
        <NumberedList items={[t("step1"), t("step2")]} />
        <Actions>
          <a
            href={TAILSCALE_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            data-variant="primary"
            {...stylex.props(...buttonStyles("primary"))}
          >
            {t("download")}
            <span aria-hidden="true">{t("externalMark")}</span>
            <VisuallyHidden>{tSettings("externalLink")}</VisuallyHidden>
          </a>
          <Button
            disabled={busy}
            busy={{ active: busy, label: t("rechecking") }}
            onClick={() => void recheck()}
          >
            {t("recheck")}
          </Button>
        </Actions>
      </div>
    </SettingsGroup>
  );
}

const styles = stylex.create({
  needs: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s4 },
  lines: { display: "flex", flexDirection: "column", gap: space.s1 },
});
