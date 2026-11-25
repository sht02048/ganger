import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Field,
  Input,
  SettingsGroup,
  SettingsRow,
  focusStyles,
  type SettingsLinkRowRenderProps,
} from "@ganger/ui";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { TrackerConnectionView, WorkspaceSettings } from "@ganger/app/settings/model";
import { useTime } from "../format/time";
import { CredentialFormFrame } from "./credential-forms";
import { useFocusFirstField, type InlineEdit } from "./row-state";
import { SubmitError, useReportUnsaved, useSubmit } from "./settings-screen";

export const SETTINGS_PAGES = [
  "general",
  "projects",
  "connections",
  "mobile",
  "server",
  "mcp",
  "notifications",
] as const;
export type SettingsPageId = (typeof SETTINGS_PAGES)[number];

export const SETTINGS_NAV_GROUPS = {
  workspace: ["general", "projects"],
  install: ["connections", "mobile", "server", "mcp"],
  mac: ["notifications"],
} as const satisfies Record<string, ReadonlyArray<SettingsPageId>>;
export type SettingsNavGroupId = keyof typeof SETTINGS_NAV_GROUPS;

export const SETTINGS_PAGE_PATHS = {
  general: "/settings/general",
  projects: "/settings/projects",
  connections: "/settings/connections",
  mobile: "/settings/mobile",
  server: "/settings/server",
  mcp: "/settings/mcp",
  notifications: "/settings/notifications",
} as const satisfies Record<SettingsPageId, string>;

export function isSettingsPage(value: string): value is SettingsPageId {
  return SETTINGS_PAGES.some((page) => page === value);
}

export type SettingsLinkTarget =
  | { kind: "page"; page: SettingsPageId; rowId?: string }
  | { kind: "project"; connectionId: string; projectId: string }
  | { kind: "connection"; connectionId: string };

export type SettingsLinkProps = SettingsLinkRowRenderProps & {
  "aria-label"?: string;
  "aria-current"?: "page";
  "data-variant"?: string;
};

export type RenderSettingsLink = (
  target: SettingsLinkTarget,
  props: SettingsLinkProps,
) => ReactNode;

export type WorkspaceView = "one" | "none" | "all";

export function settingsHref(target: SettingsLinkTarget, ws: string | undefined): string {
  const search = ws === undefined ? "" : `?${new URLSearchParams({ ws }).toString()}`;
  switch (target.kind) {
    case "project":
      return `/settings/projects/${encodeURIComponent(target.connectionId)}/${encodeURIComponent(target.projectId)}${search}`;
    case "connection":
      return `/settings/connections/${encodeURIComponent(target.connectionId)}${search}`;
    case "page":
      return `${SETTINGS_PAGE_PATHS[target.page]}${search}${target.rowId === undefined ? "" : `#${encodeURIComponent(target.rowId)}`}`;
  }
}

export function plainSettingsLink(ws: string | undefined): RenderSettingsLink {
  return (target, props) => <a href={settingsHref(target, ws)} {...props} />;
}

export function projectRowId(connectionId: string, projectId: string): string {
  return `project-${connectionId}-${projectId}`;
}

export const PROJECTS_HEADING_ID = "projects-heading";
export const WEBHOOK_ADDRESS_ROW_ID = "webhook-address";

export type LegacySettingsTarget =
  | { kind: "page"; page: SettingsPageId; rowId?: string }
  | { kind: "connection"; connectionId: string };

const LEGACY_TARGETS = new Map<string, LegacySettingsTarget>([
  ["workspace", { kind: "page", page: "general" }],
  ["projects", { kind: "page", page: "projects" }],
  ["connections", { kind: "page", page: "connections" }],
  ["server", { kind: "page", page: "server" }],
  ["devices", { kind: "page", page: "mobile" }],
  ["logs", { kind: "page", page: "server" }],
  ["advanced", { kind: "page", page: "mcp" }],
  ["mcp-row", { kind: "page", page: "mcp" }],
  ["web-address-row", { kind: "page", page: "mobile" }],
]);

function decodedHash(hash: string): string {
  const raw = hash.replace(/^#/u, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

export function settingsTargetOf(hash: string, workspaceView: WorkspaceView): LegacySettingsTarget {
  const id = decodedHash(hash);
  const known = LEGACY_TARGETS.get(id);
  if (known !== undefined) return known;
  if (id.startsWith("connection-")) {
    return { kind: "connection", connectionId: id.slice("connection-".length) };
  }
  if (id.startsWith("project-")) return { kind: "page", page: "projects", rowId: id };
  return { kind: "page", page: workspaceView === "one" ? "general" : "connections" };
}

export function NoWorkspace({
  view,
  onCreate,
}: {
  view: WorkspaceView;
  onCreate: (focusBack: HTMLElement | null) => void;
}) {
  const t = useTranslations("settings.workspace");
  return (
    <SettingsGroup>
      <SettingsRow
        label={view === "all" ? t("all") : t("none")}
        control={
          view === "all" ? undefined : (
            <Button onClick={(event) => onCreate(event.currentTarget)}>{t("create")}</Button>
          )
        }
      />
    </SettingsGroup>
  );
}

export function ChangeButton({
  edit,
  label,
  action,
}: {
  edit: InlineEdit;
  label: string;
  action?: string;
}) {
  const t = useTranslations("settings");
  const text = action ?? t("change");
  return (
    <Button
      ref={edit.triggerRef}
      aria-label={t("changeLabel", { label, action: text })}
      aria-expanded={false}
      onClick={edit.show}
    >
      {text}
    </Button>
  );
}

export function TextEditor({
  label,
  initial,
  validate,
  save,
  saved,
  onClose,
  mono = false,
  type = "text",
  placeholder,
}: {
  label: string;
  initial: string;
  validate: (value: string) => string | null;
  save: (value: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  saved: string;
  onClose: () => void;
  mono?: boolean;
  type?: "text" | "url";
  placeholder?: string;
}) {
  const t = useTranslations("settings");
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useReportUnsaved(value !== initial);
  const submit = useSubmit();
  const focusRef = useFocusFirstField();
  return (
    <div ref={focusRef} tabIndex={-1} {...stylex.props(focusStyles.target)}>
      <CredentialFormFrame
        onClose={onClose}
        footer={null}
        onSubmit={() => {
          const problem = validate(value);
          setInvalid(problem);
          if (problem !== null) {
            inputRef.current?.focus();
            return;
          }
          submit.run(() => save(value), saved, onClose);
        }}
        submit={
          <Button variant="primary" type="submit" disabled={submit.sending}>
            {submit.sending ? t("saving") : t("save")}
          </Button>
        }
      >
        <Field label={label} error={invalid ?? undefined}>
          <Input
            ref={inputRef}
            name="value"
            type={type}
            value={value}
            onValueChange={(next) => {
              setValue(next);
              if (invalid !== null) setInvalid(validate(next));
            }}
            autoComplete="off"
            mono={mono}
            {...(placeholder === undefined ? {} : { placeholder })}
          />
        </Field>
        <SubmitError state={submit.state} />
      </CredentialFormFrame>
    </div>
  );
}

export function autoLabelName(workspace: WorkspaceSettings, connectionId: string): string | null {
  const entry = workspace.labels.find((l) => l.connection.id === connectionId);
  if (entry === undefined || entry.labelId === null) return null;
  const id = entry.labelId;
  return entry.labels.ok ? (entry.labels.items.find((l) => l.id === id)?.name ?? id) : id;
}

export function FocusFirst({ children, onEscape }: { children: ReactNode; onEscape?: () => void }) {
  const ref = useFocusFirstField();
  return (
    <div
      ref={ref}
      tabIndex={-1}
      {...(onEscape === undefined
        ? {}
        : {
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              onEscape();
            },
          })}
      {...stylex.props(focusStyles.target)}
    >
      {children}
    </div>
  );
}

export function useConnectionWebhookDetail(connection: TrackerConnectionView, now: string): string {
  const t = useTranslations("settings.connections");
  const time = useTime();
  const webhook = connection.webhook;
  switch (webhook.kind) {
    case "off":
      return t("rowOff");
    case "waiting":
      return t("rowWaiting");
    case "receiving":
      return t("rowReceiving", {
        time: time.ago(webhook.lastReceivedAt, webhook.lastReceivedAgoMs),
      });
    case "rejected":
      return t("rowRejected", { time: time.stamp(webhook.firstRejectedAt, now) });
  }
}
