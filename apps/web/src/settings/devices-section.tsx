import * as stylex from "@stylexjs/stylex";
import type {
  DeviceRow,
  DevicesView,
  StartDeviceConnectionResult,
} from "@ganger/app/devices/connection";
import {
  Button,
  Dialog,
  DialogClose,
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
  const tSections = useTranslations("settings.sections");
  const [qr, setQr] = useState<OpenQr | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [starting, setStarting] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const openId = useRef<string | null>(null);
  const knownIds = useRef(new Set(view.devices.map((device) => device.id)));

  const showQr = (next: OpenQr | null) => {
    openId.current = next?.id ?? null;
    setQr(next);
  };

  useEffect(
    () => () => {
      if (openId.current !== null) void actions.cancel(openId.current).catch(() => undefined);
    },
    [actions],
  );

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
    showQr(null);
    setStatus({ tone: "done", text: t("connected", { name: added.name }) });
    statusRef.current?.focus();
  }, [view.devices, t]);

  const start = async () => {
    setStarting(true);
    setStatus(null);
    try {
      const result = await actions.start(openId.current ?? undefined);
      if (result.ok) {
        showQr({ id: result.id, qr: result.qr, expiresInMs: result.expiresInMs, expired: false });
      } else {
        showQr(null);
        setStatus({ tone: "problem", text: t("needsHttps") });
      }
    } catch {
      setStatus({ tone: "problem", text: t("startFailed") });
    } finally {
      setStarting(false);
    }
  };

  const close = () => {
    if (qr !== null) void actions.cancel(qr.id).catch(() => undefined);
    showQr(null);
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
    <SettingsSection id="devices" title={tSections("devices")}>
      <SettingsGroup>
        {view.connectable ? (
          <SettingsRow
            label={t("connect")}
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
                <QrPanel qr={qr} starting={starting} onRenew={() => void start()} onClose={close} />
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
  qr,
  starting,
  onRenew,
  onClose,
}: {
  qr: OpenQr;
  starting: boolean;
  onRenew: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("settings.devices");
  return (
    <div {...stylex.props(styles.panel)}>
      {qr.expired ? (
        <Text variant="meta" tone="problem" as="p">
          {t("expired")}
        </Text>
      ) : (
        <>
          <QrCode value={qr.qr} label={t("qrLabel")} />
          <Text variant="meta" as="p">
            {t("qrNote")}
          </Text>
        </>
      )}
      <div {...stylex.props(styles.actions)}>
        <Button onClick={onRenew} disabled={starting}>
          {t("renew")}
        </Button>
        <Button onClick={onClose}>{t("close")}</Button>
      </div>
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
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.s2,
  },
});
