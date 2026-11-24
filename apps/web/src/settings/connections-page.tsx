import * as stylex from "@stylexjs/stylex";
import {
  Button,
  InfoTip,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  Text,
  buttonStyles,
} from "@ganger/ui";
import { useId, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { funnelPrefillAddress } from "@ganger/app/funnel-setup";
import type {
  GitHubAuthView,
  SettingsPage,
  TrackerConnectionView,
  WebhookSetupView,
} from "@ganger/app/settings/model";
import { GITHUB_TOKEN_URL, LINEAR_API_KEY_URL } from "../onboarding/model";
import {
  ExternalLink,
  GitHubTokenForm,
  TrackerKeyForm,
  useCredentialReason,
} from "./credential-forms";
import { GitHubAuthPanel, usableGhAccounts, useGitHubSourceDetail } from "./github-auth";
import type { UnsavedGuard } from "./navigation-guard";
import { useInlineEdit } from "./row-state";
import { SettingsFrame, withSettingsEditors } from "./settings-frame";
import {
  ChangeButton,
  FocusFirst,
  WEBHOOK_ADDRESS_ROW_ID,
  useConnectionWebhookDetail,
  type RenderSettingsLink,
} from "./settings-page";
import { SubmitError, useSubmit, type SettingsActions } from "./settings-screen";
import { AddressEditor } from "./webhook-section";

export interface ConnectionsScreenProps {
  page: Pick<SettingsPage, "install">;
  setup: WebhookSetupView;
  github: GitHubAuthView | undefined;
  actions: SettingsActions;
  renderLink: RenderSettingsLink;
  nav: ReactNode;
  renderGuard?: (guard: UnsavedGuard) => ReactNode;
}

export function connectionBoxId(connectionId: string): string {
  return `connection-${connectionId}`;
}

function ConnectionsPage({
  page,
  setup,
  github,
  actions,
  renderLink,
  nav,
}: ConnectionsScreenProps) {
  const t = useTranslations("settings");
  const add = useInlineEdit("connection-add");
  const { connections, addresses } = page.install;
  return (
    <SettingsFrame title={t("pages.connections")} nav={nav}>
      <SettingsSection
        id="linear"
        title={t("connections.linear")}
        actions={
          add.open ? undefined : (
            <Button ref={add.triggerRef} aria-expanded={false} onClick={add.show}>
              {t("connections.add")}
            </Button>
          )
        }
      >
        {add.open ? (
          <SettingsGroup>
            <SettingsRow
              label={t("connections.addLabel")}
              expanded={
                <FocusFirst>
                  <TrackerKeyForm
                    connection={null}
                    actions={actions}
                    hints="info"
                    primary
                    onClose={add.close}
                    onDone={add.close}
                    footer={
                      <ExternalLink href={LINEAR_API_KEY_URL}>
                        {t("credentials.keyGuideLink")}
                      </ExternalLink>
                    }
                  />
                </FocusFirst>
              }
            />
          </SettingsGroup>
        ) : null}
        <SettingsGroup>
          <WebhookAddressRow
            address={addresses.webhookAddress}
            checked={addresses.webhookAddressChecked}
            setup={setup}
            actions={actions}
          />
        </SettingsGroup>
        {connections.length === 0 && !add.open ? (
          <SettingsGroup>
            <SettingsRow label={t("connections.none")} />
          </SettingsGroup>
        ) : null}
        {connections.map((connection) => (
          <ConnectionBox
            key={connection.id}
            connection={connection}
            now={page.install.mcp.now}
            actions={actions}
            renderLink={renderLink}
          />
        ))}
      </SettingsSection>
      <SettingsSection id="github" title={t("github.label")}>
        <GitHubRows
          connected={page.install.githubConnected}
          view={github}
          unread={page.install.unreadPrRuns}
          actions={actions}
        />
      </SettingsSection>
    </SettingsFrame>
  );
}

function WebhookAddressRow({
  address,
  checked,
  setup,
  actions,
}: {
  address: string | null;
  checked: boolean;
  setup: WebhookSetupView;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit("webhook-address");
  const labelId = useId();
  const label = t("connections.webhookAddress");
  return (
    <SettingsRow
      id={WEBHOOK_ADDRESS_ROW_ID}
      label={label}
      labelId={labelId}
      info={
        <InfoTip label={t("infoLabel", { label })} content={t("connections.webhookAddressInfo")} />
      }
      detail={
        address === null
          ? t("connections.webhookAddressNone")
          : checked
            ? address
            : t("webhook.address.notChecked", { address })
      }
      detailMono={address !== null && checked}
      detailTone={address !== null && !checked ? "problem" : "default"}
      control={
        edit.open ? undefined : (
          <ChangeButton
            edit={edit}
            label={label}
            action={address === null ? t("addresses.set") : t("change")}
          />
        )
      }
      expanded={
        edit.open ? (
          <FocusFirst onEscape={edit.close}>
            <AddressEditor
              initial={address ?? funnelPrefillAddress(setup.funnel) ?? ""}
              setup={setup}
              actions={actions}
              onClose={edit.close}
              onSaved={edit.close}
            />
          </FocusFirst>
        ) : null
      }
    />
  );
}

function ConnectionBox({
  connection,
  now,
  actions,
  renderLink,
}: {
  connection: TrackerConnectionView;
  now: string;
  actions: SettingsActions;
  renderLink: RenderSettingsLink;
}) {
  const t = useTranslations("settings");
  const check = useSubmit();
  const describe = useCredentialReason("tracker");
  const keyEdit = useInlineEdit(`connection-key-${connection.id}`);
  const webhookDetail = useConnectionWebhookDetail(connection, now);
  const keyLabel = t("connection.apiKey");
  return (
    <div id={connectionBoxId(connection.id)}>
      <SettingsGroup label={connection.name}>
        <SettingsRow
          label={connection.name}
          control={
            <Button
              aria-label={t("connections.checkLabel", { name: connection.name })}
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
          }
          message={<SubmitError state={check.state} describe={describe} />}
        />
        <SettingsRow
          label={keyLabel}
          inset
          control={
            keyEdit.open ? undefined : (
              <ChangeButton
                edit={keyEdit}
                label={connection.name}
                action={t("connections.changeKey")}
              />
            )
          }
          expanded={
            keyEdit.open ? (
              <FocusFirst onEscape={keyEdit.close}>
                <TrackerKeyForm
                  connection={connection}
                  actions={actions}
                  hints="info"
                  primary
                  onClose={keyEdit.close}
                  onDone={keyEdit.close}
                  footer={
                    <ExternalLink href={LINEAR_API_KEY_URL}>
                      {t("credentials.keyGuideLink")}
                    </ExternalLink>
                  }
                />
              </FocusFirst>
            ) : null
          }
        />
        <SettingsRow
          label={t("connections.webhook")}
          inset
          detail={webhookDetail}
          detailTone={connection.webhook.kind === "rejected" ? "problem" : "default"}
          control={renderLink(
            { kind: "connection", connectionId: connection.id },
            {
              ...stylex.props(...buttonStyles("secondary")),
              "data-variant": "secondary",
              "aria-label": t("connections.webhookSetupLabel", { name: connection.name }),
              children: t("connections.webhookSetup"),
            },
          )}
        />
      </SettingsGroup>
    </div>
  );
}

function GitHubRows({
  connected,
  view,
  unread,
  actions,
}: {
  connected: boolean;
  view: GitHubAuthView | undefined;
  unread: SettingsPage["install"]["unreadPrRuns"];
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const unreadDetail =
    unread["no-access"] > 0
      ? t("github.unreadNoAccess", { count: unread["no-access"] })
      : unread.other > 0
        ? t("github.unreadOther", { count: unread.other })
        : null;
  const source = useGitHubSourceDetail(view, connected);
  const accountsEdit = useInlineEdit("github");
  const tokenEdit = useInlineEdit("github-token");
  const accounts =
    view !== undefined && view.source === "gh" && view.cli.kind === "logged-in" && connected
      ? usableGhAccounts(view.cli.accounts).map((account) => account.login)
      : [];
  const sourceMissing = view !== undefined && view.source === "none";
  const ghLabel = accounts.length > 0 ? t("github.ghConnected") : t("github.ghRow");
  const tokenLabel = t("github.token");
  return (
    <SettingsGroup>
      <SettingsRow
        label={ghLabel}
        detail={unreadDetail ?? (accounts.length > 0 ? accounts.join(" · ") : source)}
        detailTone={unreadDetail !== null || !connected || sourceMissing ? "problem" : "default"}
        control={
          accountsEdit.open ? undefined : (
            <ChangeButton edit={accountsEdit} label={ghLabel} action={t("github.open")} />
          )
        }
        expanded={
          accountsEdit.open ? (
            <FocusFirst onEscape={accountsEdit.close}>
              <GitHubAuthPanel
                view={view}
                connected={connected}
                actions={actions}
                tokenForm={false}
                onClose={accountsEdit.close}
              />
            </FocusFirst>
          ) : null
        }
      />
      <SettingsRow
        label={tokenLabel}
        info={
          <InfoTip label={t("infoLabel", { label: tokenLabel })} content={t("github.tokenInfo")} />
        }
        {...(view?.tokenSaved === true ? {} : { detail: t("github.tokenNone") })}
        control={
          tokenEdit.open ? undefined : (
            <ChangeButton
              edit={tokenEdit}
              label={t("github.label")}
              action={view?.tokenSaved === true ? t("github.tokenChange") : t("github.tokenAdd")}
            />
          )
        }
        expanded={
          tokenEdit.open ? (
            <FocusFirst onEscape={tokenEdit.close}>
              <Text variant="meta" as="p">
                {t("githubAuth.tokenPermissions")}
              </Text>
              <GitHubTokenForm
                actions={actions}
                primary
                hints="info"
                onClose={tokenEdit.close}
                onDone={tokenEdit.close}
                footer={
                  <ExternalLink href={GITHUB_TOKEN_URL}>{t("github.guideLink")}</ExternalLink>
                }
              />
            </FocusFirst>
          ) : null
        }
      />
    </SettingsGroup>
  );
}

export const ConnectionsScreen = withSettingsEditors(ConnectionsPage);
