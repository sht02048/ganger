import * as stylex from "@stylexjs/stylex";
import {
  Button,
  NoticeLayout,
  PageHeader,
  ScreenLayout,
  SettingsGroup,
  SettingsLayout,
  SettingsRow,
  SettingsSection,
  Text,
  linkStyles,
} from "@ganger/ui";
import { useId, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type {
  SettingsPage,
  TrackerConnectionView,
  WebhookSetupView,
} from "@ganger/app/settings/model";
import { LINEAR_API_KEY_URL } from "../onboarding/model";
import { ExternalLink, TrackerKeyForm, useCredentialReason } from "./credential-forms";
import type { UnsavedGuard } from "./navigation-guard";
import { EditorProvider, useInlineEdit } from "./row-state";
import {
  ChangeButton,
  FocusFirst,
  SettingsBackLink,
  TextEditor,
  connectionRowId,
  plainSettingsLink,
  type RenderSettingsLink,
} from "./settings-page";
import { SubmitError, useSubmit, type SettingsActions } from "./settings-screen";
import { WebhookSection } from "./webhook-section";

export interface ConnectionDetailScreenProps {
  page: Pick<SettingsPage, "install">;
  setup: WebhookSetupView;
  connectionId: string;
  ws: string | undefined;
  actions: SettingsActions;
  renderLink?: RenderSettingsLink;
  renderGuard?: (guard: UnsavedGuard) => ReactNode;
}

export function findConnection(
  page: Pick<SettingsPage, "install">,
  connectionId: string,
): TrackerConnectionView | null {
  return page.install.connections.find((connection) => connection.id === connectionId) ?? null;
}

export function ConnectionDetailScreen({
  page,
  setup,
  connectionId,
  ws,
  actions,
  renderLink = plainSettingsLink(ws),
  renderGuard,
}: ConnectionDetailScreenProps) {
  const t = useTranslations("settings.connection");
  const connection = findConnection(page, connectionId);
  const back = (
    <SettingsBackLink
      label={t("back")}
      rowId={connectionRowId(connectionId)}
      renderLink={renderLink}
    />
  );
  if (connection === null) {
    return (
      <ScreenLayout header={<PageHeader lead={back} title={t("breadcrumb")} />}>
        <NoticeLayout>
          <Text variant="body">{t("notFound")}</Text>
          {renderLink(
            { kind: "settings" },
            { ...stylex.props(linkStyles("action")), children: t("back") },
          )}
        </NoticeLayout>
      </ScreenLayout>
    );
  }
  return (
    <ScreenLayout header={<PageHeader lead={back} title={connection.name} />}>
      <EditorProvider {...(renderGuard === undefined ? {} : { renderGuard })}>
        <SettingsLayout>
          <SettingsSection id="connection" title={t("section")}>
            <SettingsGroup>
              <NameRow connection={connection} actions={actions} />
              <ApiKeyRow connection={connection} actions={actions} />
            </SettingsGroup>
          </SettingsSection>
          <WebhookSection
            connection={connection}
            webhookAddress={page.install.addresses.webhookAddress}
            webhookAddressChecked={page.install.addresses.webhookAddressChecked}
            setup={setup}
            now={page.install.mcp.now}
            actions={actions}
          />
        </SettingsLayout>
      </EditorProvider>
    </ScreenLayout>
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

function ApiKeyRow({
  connection,
  actions,
}: {
  connection: TrackerConnectionView;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit("connection-key");
  const labelId = useId();
  const describe = useCredentialReason("tracker");
  const check = useSubmit();
  const label = t("connection.apiKey");
  return (
    <SettingsRow
      label={label}
      labelId={labelId}
      detail={t("connection.apiKeySet")}
      control={edit.open ? undefined : <ChangeButton edit={edit} label={label} />}
      message={edit.open ? undefined : <SubmitError state={check.state} describe={describe} />}
      expanded={
        edit.open ? (
          <FocusFirst>
            <TrackerKeyForm
              connection={connection}
              actions={actions}
              hints="info"
              primary
              onClose={edit.close}
              onDone={edit.close}
              footer={
                <>
                  <ExternalLink href={LINEAR_API_KEY_URL}>
                    {t("credentials.keyGuideLink")}
                  </ExternalLink>
                  <Button
                    variant="ghost"
                    disabled={check.sending}
                    onClick={() =>
                      check.run(
                        () => actions.checkConnection({ id: connection.id }),
                        t("connections.checkOk", { name: connection.name }),
                      )
                    }
                  >
                    {check.sending ? t("connections.checking") : t("connections.check")}
                  </Button>
                </>
              }
            />
            <SubmitError state={check.state} describe={describe} />
          </FocusFirst>
        ) : null
      }
    />
  );
}
