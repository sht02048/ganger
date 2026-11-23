import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Chip,
  CodeBlock,
  Disclosure,
  DividedItem,
  DividedList,
  Text,
  showToast,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useId, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type {
  GhAccountView,
  GhCliView,
  GitHubAuthView,
  RunnerPrReadDiagnosis,
} from "@ganger/app/settings/model";
import { usePrReadDiagnosisText } from "../pr-read-diagnosis";
import { browserClipboard, copyText } from "./clipboard";
import { ExternalLink, GitHubTokenForm, useCredentialReason } from "./credential-forms";
import { SubmitError, useSubmit, type SettingsActions } from "./settings-screen";

export const GH_LOGIN_COMMAND = "gh auth login";
export const GH_INSTALL_URL = "https://cli.github.com/";

export function useGitHubCheckReason(): (reason: string) => string | null {
  const t = useTranslations("settings.githubAuth");
  const credential = useCredentialReason("github");
  return (reason) => {
    if (reason === "no-credentials") return t("noCredentials");
    if (reason === "unauthorized") return t("unauthorized");
    return credential(reason);
  };
}

export function useGitHubSourceDetail(
  view: GitHubAuthView | undefined,
  connected: boolean,
): string {
  const t = useTranslations("settings.github");
  if (view === undefined) return t("sourceLoading");
  if (view.source === "gh" && !connected) return t("sourceGhNotConnected");
  if (view.source === "gh" && view.cli.kind === "logged-in") {
    const [first, ...rest] = usableGhAccounts(view.cli.accounts);
    if (first !== undefined) {
      return rest.length === 0
        ? t("sourceGh", { login: first.login })
        : t("sourceGhMore", { login: first.login, count: rest.length });
    }
  }
  return view.source === "token" ? t("sourceToken") : t("sourceNone");
}

export function GitHubAuthPanel({
  view,
  connected,
  actions,
  connectFirst = false,
  tokenGuide,
  onClose,
}: {
  view: GitHubAuthView | undefined;
  connected: boolean;
  actions: SettingsActions;
  connectFirst?: boolean;
  tokenGuide?: ReactNode;
  onClose?: () => void;
}) {
  const t = useTranslations("settings.githubAuth");
  const check = useSubmit();
  const describe = useGitHubCheckReason();
  if (view === undefined) {
    return (
      <Text variant="ui" as="p" role="status">
        {t("loading")}
      </Text>
    );
  }
  const loggedIn = view.cli.kind === "logged-in" && usableGhAccounts(view.cli.accounts).length > 0;
  const connectNow = connectFirst && loggedIn && !connected;
  return (
    <div {...stylex.props(styles.stack)}>
      <PrReadDiagnoses diagnoses={view.prReadDiagnoses ?? []} />
      <CliState cli={view.cli} />
      <div {...stylex.props(styles.stackTight)}>
        <span {...stylex.props(styles.buttons)}>
          <Button
            variant={connectNow ? "primary" : "secondary"}
            disabled={check.sending}
            onClick={() => check.run(() => actions.checkGitHub(), t("checkOk"))}
          >
            {check.sending ? t("checking") : connectNow ? t("connect") : t("check")}
          </Button>
          {onClose === undefined ? null : (
            <Button variant="ghost" onClick={onClose}>
              {t("close")}
            </Button>
          )}
        </span>
        <SubmitError state={check.state} describe={describe} />
      </div>
      <Disclosure flat defaultOpen={view.cli.kind === "missing"} summary={t("tokenToggle")}>
        <Text variant="ui" as="p">
          {view.tokenSaved ? t("tokenSaved") : t("tokenFallback")}
        </Text>
        <Text variant="ui" as="p">
          {t("tokenPermissions")}
        </Text>
        {tokenGuide}
        <GitHubTokenForm actions={actions} primary={!loggedIn && !connected} />
      </Disclosure>
    </div>
  );
}

export function usableGhAccounts(accounts: ReadonlyArray<GhAccountView>): GhAccountView[] {
  return accounts.filter((account) => account.expired !== true);
}

function PrReadDiagnoses({ diagnoses }: { diagnoses: ReadonlyArray<RunnerPrReadDiagnosis> }) {
  const t = useTranslations("settings.githubAuth");
  const text = usePrReadDiagnosisText();
  const labelId = useId();
  if (diagnoses.length === 0) return null;
  return (
    <div role="group" aria-labelledby={labelId} {...stylex.props(styles.stackTight)}>
      <Text variant="meta" as="p" id={labelId}>
        {t("diagnosesLabel")}
      </Text>
      {diagnoses.map(({ runs, diagnosis }) => (
        <Text key={diagnosis.runner} variant="ui" as="p">
          {t("diagnosisRuns", { count: runs, text: text(diagnosis, "runner") })}
        </Text>
      ))}
    </div>
  );
}

function CliState({ cli }: { cli: GhCliView }) {
  const t = useTranslations("settings.githubAuth");
  switch (cli.kind) {
    case "logged-in":
      if (usableGhAccounts(cli.accounts).length === 0) {
        return (
          <div {...stylex.props(styles.stackTight)}>
            <Text variant="title" as="p">
              {t("expiredTitle")}
            </Text>
            <Text variant="ui" as="p">
              {t("expiredBody")}
            </Text>
            <LoginCommand />
            <AccountList accounts={cli.accounts} />
          </div>
        );
      }
      return (
        <div {...stylex.props(styles.stackTight)}>
          <Text variant="title" as="p">
            {t("connectedTitle")}
          </Text>
          <Text variant="ui" as="p">
            {t("connectedBody")}
          </Text>
          <AccountList accounts={cli.accounts} />
          {cli.multiAccount ? null : (
            <Text variant="meta" as="p">
              {t("singleAccount")}
            </Text>
          )}
        </div>
      );
    case "logged-out":
      return (
        <div {...stylex.props(styles.stackTight)}>
          <Text variant="title" as="p">
            {t("loggedOutTitle")}
          </Text>
          <Text variant="ui" as="p">
            {t("loggedOutBody")}
          </Text>
          <LoginCommand />
        </div>
      );
    case "missing":
      return (
        <div {...stylex.props(styles.stackTight)}>
          <Text variant="title" as="p">
            {t("missingTitle")}
          </Text>
          <Text variant="ui" as="p">
            {t("missingBody")}
          </Text>
          <span>
            <ExternalLink href={GH_INSTALL_URL}>{t("installLink")}</ExternalLink>
          </span>
        </div>
      );
  }
}

function AccountList({ accounts }: { accounts: ReadonlyArray<GhAccountView> }) {
  const t = useTranslations("settings.githubAuth");
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId}>
      <Text variant="meta" as="p" id={labelId}>
        {t("accountsLabel")}
      </Text>
      <DividedList>
        {accounts.map((account) => (
          <DividedItem key={account.login} tight>
            <span {...stylex.props(styles.account)}>
              <Text variant="ui" tone={account.expired === true ? "muted" : "strong"}>
                {account.login}
              </Text>
              {account.active ? <Chip strong>{t("active")}</Chip> : null}
            </span>
            <Text variant="meta" as="p" {...(account.expired === true ? { tone: "muted" } : {})}>
              {account.expired === true
                ? t("expired")
                : account.owners === null
                  ? t("ownersUnknown")
                  : t("owners", { owners: account.owners.join(", ") })}
            </Text>
          </DividedItem>
        ))}
      </DividedList>
    </div>
  );
}

function LoginCommand() {
  const t = useTranslations("settings.githubAuth");
  const copy = () => {
    void copyText(GH_LOGIN_COMMAND, browserClipboard()).then((copied) =>
      showToast(copied ? t("copied") : t("copyFailed")),
    );
  };
  return (
    <div {...stylex.props(styles.command)}>
      <CodeBlock tone="command" label={t("commandLabel")}>
        {GH_LOGIN_COMMAND}
      </CodeBlock>
      <span>
        <Button onClick={copy}>{t("copy")}</Button>
      </span>
    </div>
  );
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  stackTight: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  account: { display: "inline-flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  command: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  buttons: { display: "flex", flexWrap: "wrap", gap: space.s2 },
});
