import * as stylex from "@stylexjs/stylex";
import type {
  DeviceRow,
  DevicesView,
  StartDeviceConnectionResult,
} from "@ganger/app/devices/connection";
import {
  Actions,
  Button,
  Dialog,
  DialogClose,
  InfoTip,
  QrCode,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  Text,
  TextLink,
  VisuallyHidden,
  focusStyles,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { WEB_ADDRESS_ROW_ID } from "./settings-page";

export interface DeviceActions {
  start: (replacing?: string) => Promise<StartDeviceConnectionResult>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<{ ok: boolean }>;
}

interface OpenQr {
  id: string;
  qr: string;
  expiresInMs: number;
  expired: boolean;
}

type Status = { tone: "done" | "problem"; text: string } | null;

export function DevicesSection({ view, actions }: { view: DevicesView; actions: DeviceActions }) {
  const t = useTranslations("settings.devices");
  const tSettings = useTranslations("settings");
  const [qr, setQr] = useState<OpenQr | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [starting, setStarting] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const qrPanelRef = useRef<HTMLDivElement>(null);
  const qrIsOpen = qr !== null;
  const openId = useRef<string | null>(null);
  const qrGeneration = useRef(0);
  const shownAddress = useRef(view.address);
  const knownIds = useRef(new Set(view.devices.map((device) => device.id)));

  const showQr = (next: OpenQr | null) => {
    openId.current = next?.id ?? null;
    setQr(next);
  };

  const cancelCode = (id: string) => {
    void actions.cancel(id).catch(() => undefined);
  };

  const dropQr = () => {
    qrGeneration.current += 1;
    if (openId.current !== null) {
      const focused = document.activeElement;
      if (focused === document.body || qrPanelRef.current?.contains(focused)) {
        statusRef.current?.focus();
      }
      cancelCode(openId.current);
    }
    showQr(null);
    setStarting(false);
  };

  useEffect(
    () => () => {
      qrGeneration.current += 1;
      if (openId.current !== null) void actions.cancel(openId.current).catch(() => undefined);
    },
    [actions],
  );

  useEffect(() => {
    if (shownAddress.current === view.address) return;
    shownAddress.current = view.address;
    dropQr();
  }, [view.address]);

  useEffect(() => {
    if (qrIsOpen) qrPanelRef.current?.focus();
  }, [qrIsOpen]);

  useEffect(() => {
    if (qr === null || qr.expired) return;
    const timer = setTimeout(() => {
      setQr((current) => (current?.id === qr.id ? { ...current, expired: true } : current));
    }, qr.expiresInMs);
    return () => clearTimeout(timer);
  }, [qr]);

  useEffect(() => {
    const added = view.devices.find((device) => !knownIds.current.has(device.id));
    knownIds.current = new Set(view.devices.map((device) => device.id));
    if (added === undefined || openId.current === null) return;
    dropQr();
    setStatus({ tone: "done", text: t("connected", { name: added.name }) });
    statusRef.current?.focus();
  }, [view.devices, t]);

  const start = async () => {
    qrGeneration.current += 1;
    const generation = qrGeneration.current;
    setStarting(true);
    setStatus(null);
    try {
      const result = await actions.start(openId.current ?? undefined);
      if (qrGeneration.current !== generation) {
        if (result.ok) cancelCode(result.id);
        return;
      }
      if (result.ok) {
        showQr({ id: result.id, qr: result.qr, expiresInMs: result.expiresInMs, expired: false });
      } else {
        dropQr();
        setStatus({ tone: "problem", text: t("needsHttps") });
      }
      setStarting(false);
    } catch {
      if (qrGeneration.current !== generation) return;
      dropQr();
      setStatus({ tone: "problem", text: t("startFailed") });
    }
  };

  const close = () => {
    dropQr();
    statusRef.current?.focus();
  };

  const remove = async (device: DeviceRow) => {
    try {
      const result = await actions.remove(device.id);
      setStatus(
        result.ok
          ? { tone: "done", text: t("removed", { name: device.name }) }
          : { tone: "problem", text: t("removeFailed") },
      );
    } catch {
      setStatus({ tone: "problem", text: t("removeFailed") });
    }
    statusRef.current?.focus();
  };

  return (
    <SettingsSection id="devices" title={tSettings("sections.devices")}>
      <SettingsGroup>
        {view.address !== null ? (
          <SettingsRow
            label={t("connect")}
            info={
              <InfoTip
                label={tSettings("infoLabel", { label: t("connect") })}
                content={t("qrNote")}
              />
            }
            detail={t("connectDetail")}
            control={
              qr === null ? (
                <Button onClick={() => void start()} disabled={starting}>
                  {starting ? t("starting") : t("showQr")}
                </Button>
              ) : undefined
            }
            expanded={
              qr === null ? undefined : (
                <QrPanel
                  panelRef={qrPanelRef}
                  qr={qr}
                  starting={starting}
                  onRenew={() => void start()}
                  onClose={close}
                />
              )
            }
          />
        ) : (
          <SettingsRow
            label={t("connect")}
            detail={
              <>
                {t("needsHttps")}{" "}
                <TextLink href={`#${WEB_ADDRESS_ROW_ID}`}>{t("goToAddress")}</TextLink>
              </>
            }
          />
        )}
        {view.devices.length === 0 ? (
          <SettingsRow label={t("emptyLabel")} detail={t("empty")} />
        ) : (
          view.devices.map((device) => (
            <DeviceItem
              key={device.id}
              device={device}
              statusRef={statusRef}
              onRemove={() => void remove(device)}
            />
          ))
        )}
      </SettingsGroup>
      <div ref={statusRef} tabIndex={-1} role="status" {...stylex.props(focusStyles.target)}>
        {status === null ? null : (
          <Text variant="meta" {...(status.tone === "problem" ? { tone: "problem" } : {})}>
            {status.text}
          </Text>
        )}
      </div>
    </SettingsSection>
  );
}

function QrPanel({
  panelRef,
  qr,
  starting,
  onRenew,
  onClose,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  qr: OpenQr;
  starting: boolean;
  onRenew: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("settings.devices");
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="group"
      aria-label={t("qrLabel")}
      {...stylex.props(styles.panel, focusStyles.target)}
    >
      {qr.expired ? (
        <Text variant="meta" tone="problem" as="p" role="status">
          {t("expired")}
        </Text>
      ) : (
        <QrCode value={qr.qr} label={t("qrLabel")} />
      )}
      <Actions>
        <Button onClick={onRenew} disabled={starting}>
          {t("renew")}
        </Button>
        <Button onClick={onClose}>{t("close")}</Button>
      </Actions>
    </div>
  );
}

function DeviceItem({
  device,
  statusRef,
  onRemove,
}: {
  device: DeviceRow;
  statusRef: React.RefObject<HTMLDivElement | null>;
  onRemove: () => void;
}) {
  const t = useTranslations("settings.devices");
  const { ago } = useTime();
  const connected = ago(device.createdAt, device.createdAgoMs);
  const seen =
    device.lastSeenAt === null || device.lastSeenAgoMs === null
      ? t("neverSeen")
      : ago(device.lastSeenAt, device.lastSeenAgoMs);
  return (
    <SettingsRow
      label={device.name}
      detail={t("deviceDetail", { connected, seen })}
      control={
        <Dialog
          trigger={
            <>
              <VisuallyHidden>{t("removeTrigger", { name: device.name })}</VisuallyHidden>
              <span aria-hidden="true">{t("remove")}</span>
            </>
          }
          triggerVariant="danger"
          finalFocus={() => statusRef.current}
          title={t("removeTitle", { name: device.name })}
          description={t("removeBody")}
          actions={
            <>
              <DialogClose>{t("cancel")}</DialogClose>
              <DialogClose variant="danger" onClick={onRemove}>
                {t("remove")}
              </DialogClose>
            </>
          }
        />
      }
    />
  );
}

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s3,
  },
});
