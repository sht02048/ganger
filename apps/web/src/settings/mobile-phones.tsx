import * as stylex from "@stylexjs/stylex";
import type {
  DeviceRow,
  DevicesView,
  StartDeviceConnectionResult,
} from "@ganger/app/devices/connection";
import { Button, Dialog, DialogClose, QrCode, SettingsRow, Text, VisuallyHidden } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";

export interface DeviceActions {
  start: (replacing?: string) => Promise<StartDeviceConnectionResult>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<{ ok: boolean }>;
}

type Report = (status: { tone: "done" | "problem"; text: ReactNode } | null) => void;

type QrState =
  | { kind: "starting" }
  | { kind: "shown"; id: string; qr: string; expiresAt: number }
  | { kind: "expired" }
  | { kind: "connected"; name: string }
  | { kind: "needs-https" }
  | { kind: "failed" };

const SECOND_MS = 1_000;

export function remainingText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / SECOND_MS));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

export function PhoneQr({ view, actions }: { view: DevicesView; actions: DeviceActions }) {
  const t = useTranslations("settings.mobile.qr");
  const [state, setState] = useState<QrState>({ kind: "starting" });
  const [starting, setStarting] = useState(false);
  const openId = useRef<string | null>(null);
  const generation = useRef(0);
  const knownIds = useRef(new Set(view.devices.map((device) => device.id)));
  const now = useNow(state.kind === "shown");

  const cancelCode = (id: string) => {
    void actions.cancel(id).catch(() => undefined);
  };

  const show = (next: QrState) => {
    openId.current = next.kind === "shown" ? next.id : null;
    setState(next);
  };

  const start = async () => {
    generation.current += 1;
    const mine = generation.current;
    setStarting(true);
    try {
      const result = await actions.start(openId.current ?? undefined);
      if (generation.current !== mine) {
        if (result.ok) cancelCode(result.id);
        return;
      }
      show(
        result.ok
          ? {
              kind: "shown",
              id: result.id,
              qr: result.qr,
              expiresAt: Date.now() + result.expiresInMs,
            }
          : { kind: "needs-https" },
      );
    } catch {
      if (generation.current !== mine) return;
      show({ kind: "failed" });
    }
    setStarting(false);
  };

  useEffect(() => {
    if (view.address === null) {
      show({ kind: "needs-https" });
      return;
    }
    void start();
    return () => {
      generation.current += 1;
      if (openId.current !== null) cancelCode(openId.current);
      openId.current = null;
    };
  }, [view.address]);

  useEffect(() => {
    if (state.kind === "shown" && now >= state.expiresAt) show({ kind: "expired" });
  }, [now, state]);

  useEffect(() => {
    const added = view.devices.find((device) => !knownIds.current.has(device.id));
    knownIds.current = new Set(view.devices.map((device) => device.id));
    if (added === undefined || openId.current === null) return;
    generation.current += 1;
    cancelCode(openId.current);
    setStarting(false);
    show({ kind: "connected", name: added.name });
  }, [view.devices]);

  return (
    <div role="group" aria-label={t("label")} {...stylex.props(styles.panel)}>
      {state.kind === "shown" ? <QrCode value={state.qr} label={t("label")} /> : null}
      <div {...stylex.props(styles.lines)}>
        <QrMessage state={state} now={now} />
        {state.kind === "needs-https" ? null : (
          <span {...stylex.props(styles.renew)}>
            <Button
              disabled={starting}
              busy={{ active: starting, label: t("starting") }}
              onClick={() => void start()}
            >
              {t("renew")}
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

function QrMessage({ state, now }: { state: QrState; now: number }) {
  const t = useTranslations("settings.mobile.qr");
  switch (state.kind) {
    case "shown":
      return (
        <>
          <Text variant="title" tone="strong">
            {t("title")}
          </Text>
          <Text variant="meta">{t("tailscale")}</Text>
          <Text variant="meta" numeric>
            {t("once", { left: remainingText(state.expiresAt - now) })}
          </Text>
        </>
      );
    case "starting":
      return <Text variant="meta">{t("starting")}</Text>;
    case "expired":
      return (
        <Text variant="meta" tone="problem">
          {t("expired")}
        </Text>
      );
    case "connected":
      return (
        <Text variant="title" tone="strong">
          {t("connected", { name: state.name })}
        </Text>
      );
    case "needs-https":
      return (
        <Text variant="meta" tone="problem">
          {t("needsHttps")}
        </Text>
      );
    case "failed":
      return (
        <Text variant="meta" tone="problem">
          {t("startFailed")}
        </Text>
      );
  }
}

export function PhoneList({
  view,
  actions,
  report,
  statusRef,
}: {
  view: DevicesView;
  actions: DeviceActions;
  report: Report;
  statusRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations("settings.mobile.phone");
  const remove = async (device: DeviceRow) => {
    try {
      const result = await actions.remove(device.id);
      report(
        result.ok
          ? { tone: "done", text: t("removed", { name: device.name }) }
          : { tone: "problem", text: t("removeFailed") },
      );
    } catch {
      report({ tone: "problem", text: t("removeFailed") });
    }
  };
  return view.devices.map((device) => (
    <PhoneItem
      key={device.id}
      device={device}
      statusRef={statusRef}
      onRemove={() => void remove(device)}
    />
  ));
}

function PhoneItem({
  device,
  statusRef,
  onRemove,
}: {
  device: DeviceRow;
  statusRef: RefObject<HTMLDivElement | null>;
  onRemove: () => void;
}) {
  const t = useTranslations("settings.mobile.phone");
  const { ago } = useTime();
  const connected = ago(device.createdAt, device.createdAgoMs);
  const seen =
    device.lastSeenAt === null || device.lastSeenAgoMs === null
      ? t("neverSeen")
      : ago(device.lastSeenAt, device.lastSeenAgoMs);
  return (
    <SettingsRow
      label={device.name}
      detail={t("detail", { connected, seen })}
      control={
        <Dialog
          trigger={
            <>
              <VisuallyHidden>{t("removeTrigger", { name: device.name })}</VisuallyHidden>
              <span aria-hidden="true">{t("remove")}</span>
            </>
          }
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
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s5,
  },
  lines: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s1,
  },
  renew: { marginTop: space.s2 },
});
