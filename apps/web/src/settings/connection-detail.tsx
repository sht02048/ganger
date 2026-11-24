import * as stylex from "@stylexjs/stylex";
import { SettingsGroup, SettingsRow, SettingsSection, Text, linkStyles } from "@ganger/ui";
import { useId, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { SettingsPage, TrackerConnectionView } from "@ganger/app/settings/model";
import type { UnsavedGuard } from "./navigation-guard";
import { useInlineEdit } from "./row-state";
import { SettingsFrame, withSettingsEditors } from "./settings-frame";
import { ChangeButton, TextEditor, type RenderSettingsLink } from "./settings-page";
import type { SettingsActions } from "./settings-screen";
import { WebhookSection } from "./webhook-section";

export interface ConnectionDetailScreenProps {
  page: Pick<SettingsPage, "install">;
  connectionId: string;
  actions: SettingsActions;
  renderLink: RenderSettingsLink;
  nav: ReactNode;
  renderGuard?: (guard: UnsavedGuard) => ReactNode;
}

export function findConnection(
  page: Pick<SettingsPage, "install">,
  connectionId: string,
): TrackerConnectionView | null {
  return page.install.connections.find((connection) => connection.id === connectionId) ?? null;
}

function ConnectionDetailPage({
  page,
  connectionId,
  actions,
  renderLink,
  nav,
}: ConnectionDetailScreenProps) {
  const t = useTranslations("settings");
  const connection = findConnection(page, connectionId);
  const toConnections = renderLink(
    { kind: "page", page: "connections" },
    { ...stylex.props(linkStyles("action")), children: t("pages.connections") },
  );
  if (connection === null) {
    return (
      <SettingsFrame title={t("connection.breadcrumb")} nav={nav}>
        <SettingsGroup>
          <SettingsRow label={t("connection.notFound")} control={toConnections} />
        </SettingsGroup>
      </SettingsFrame>
    );
  }
  return (
    <SettingsFrame
      title={connection.name}
      subtitle={<Text variant="meta">{toConnections}</Text>}
      nav={nav}
    >
      <SettingsSection id="connection" title={t("connection.section")}>
        <SettingsGroup>
          <NameRow connection={connection} actions={actions} />
        </SettingsGroup>
      </SettingsSection>
      <WebhookSection
        connection={connection}
        webhookAddress={page.install.addresses.webhookAddress}
        webhookAddressChecked={page.install.addresses.webhookAddressChecked}
        now={page.install.mcp.now}
        actions={actions}
        renderLink={renderLink}
      />
    </SettingsFrame>
  );
}

function NameRow({
  connection,
  actions,
}: {
  connection: TrackerConnectionView;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit("connection-name");
  const labelId = useId();
  const label = t("connection.name");
  return (
    <SettingsRow
      label={label}
      labelId={labelId}
      value={edit.open ? undefined : connection.name}
      control={edit.open ? undefined : <ChangeButton edit={edit} label={label} />}
      formOnly
      expanded={
        edit.open ? (
          <TextEditor
            label={label}
            initial={connection.name}
            validate={(value) => (value.trim() === "" ? t("connections.nameRequired") : null)}
            save={(value) =>
              actions.saveConnection({
                id: connection.id,
                name: value.trim(),
                apiKey: "",
                webhookSecret: "",
              })
            }
            saved={t("saved")}
            onClose={edit.close}
          />
        ) : null
      }
    />
  );
}

export const ConnectionDetailScreen = withSettingsEditors(ConnectionDetailPage);
