import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  CodeBlock,
  DividedItem,
  DividedList,
  Field,
  InfoTip,
  Input,
  PanelBlock,
  StatusPill,
  Text,
  showToast,
  textStyles,
} from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import {
  createContext,
  use,
  useEffect,
  useId,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { isPushCheck, prerequisiteHint, summarizePushChecks } from "@ganger/app/prerequisites";
import { usePrerequisiteName } from "../labels";
import { PushProblems } from "../push-check";
import { browserClipboard, copyText } from "./clipboard";
import { DEFAULT_ORCA_PATH } from "@ganger/runner-orca/config";
import { shellQuote } from "../onboarding/model";
import { useStatusName } from "../status";
import { RUNNER_CHECK_POLL_LIMIT_MS, RUNNER_CHECK_POLL_MS } from "@ganger/app/settings/model";
import type {
  PrerequisiteView,
  RunnerCheckView,
  RunnerSettingsView,
} from "@ganger/app/settings/model";

export type ActionResult = { ok: true } | { ok: false; reason: string };

export type CreateLabelResult =
  | { ok: true; labelId: string; name: string; created: boolean }
  | { ok: false; reason: string };

export interface ProjectRef {
  ws: string;
  connectionId: string;
  projectId: string;
}

export interface SettingsActions {
  saveGeneral: (input: {
    ws: string;
    name: string;
    maxRunMinutes: number;
  }) => Promise<ActionResult>;
  saveBrief: (input: { ws: string; before: string; after: string }) => Promise<ActionResult>;
  addProject: (input: ProjectRef & { name: string }) => Promise<ActionResult>;
  removeProject: (input: ProjectRef) => Promise<ActionResult>;
  saveMapping: (
    input: ProjectRef & {
      agentId: string;
      model: string;
      repos: Array<{ runnerProjectId: string; isDefault: boolean; labelId: string | null }>;
    },
  ) => Promise<ActionResult>;
  saveInProgress: (input: ProjectRef & { stateId: string }) => Promise<ActionResult>;
  saveLabel: (input: {
    ws: string;
    connectionId: string;
    labelId: string;
  }) => Promise<ActionResult>;
  createLabel: (input: { ws: string; connectionId: string }) => Promise<CreateLabelResult>;
  reloadFromTracker: () => Promise<void>;
  saveConnection: (input: {
    id?: string;
    name?: string;
    apiKey: string;
    webhookSecret: string;
  }) => Promise<ActionResult>;
  checkConnection: (input: { id: string }) => Promise<ActionResult>;
  saveGitHubToken: (input: { token: string }) => Promise<ActionResult>;
  checkGitHubToken: () => Promise<ActionResult>;
  saveRunner: (input: {
    id?: string;
    name: string;
    sshTarget: string;
    orcaPath: string;
    capacity: number;
  }) => Promise<ActionResult>;
  recheckRunner: (input: { id: string }) => Promise<ActionResult>;
  saveAddresses: (input: { webAddress: string; webhookAddress: string }) => Promise<ActionResult>;
  savePower: (input: { preventSleep: boolean }) => Promise<ActionResult>;
  saveMcpWrite: (input: { allowed: boolean }) => Promise<ActionResult>;
  pollRunnerChecks: () => Promise<boolean>;
  checkWebhookAddress: (input: { address: string }) => Promise<ActionResult>;
  turnOffWebhook: (input: { id: string }) => Promise<ActionResult>;
}

export interface ProjectDetailActions extends SettingsActions {
  saveMergedState: (input: ProjectRef & { stateId: string | null }) => Promise<ActionResult>;
}

export const ReportUnsavedContext = createContext<(formId: string, unsaved: boolean) => void>(
  () => {},
);

export function useReportUnsaved(unsaved: boolean): void {
  const report = use(ReportUnsavedContext);
  const formId = useId();
  useEffect(() => {
    report(formId, unsaved);
  }, [report, formId, unsaved]);
  useEffect(() => () => report(formId, false), [report, formId]);
}

export function useRunnerCheckPolling(pendingKey: string, poll: () => Promise<boolean>): boolean {
  const [silent, setSilent] = useState(false);
  useEffect(() => {
    setSilent(false);
    if (pendingKey === "") return undefined;
    const started = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      timer = setTimeout(() => {
        if (stopped) return;
        if (Date.now() - started > RUNNER_CHECK_POLL_LIMIT_MS) {
          setSilent(true);
          return;
        }
        poll().then(
          (still) => {
            if (still && !stopped) next();
          },
          () => {
            if (!stopped) next();
          },
        );
      }, RUNNER_CHECK_POLL_MS);
    };
    next();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pendingKey, poll]);
  return silent;
}

export type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "failed"; reason: string };

export function useSubmit() {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const run = (action: () => Promise<ActionResult>, success: string, onSuccess?: () => void) => {
    if (state.kind === "sending") return;
    setState({ kind: "sending" });
    action().then(
      (result) => {
        if (result.ok) {
          setState({ kind: "idle" });
          showToast(success);
          onSuccess?.();
        } else {
          setState({ kind: "failed", reason: result.reason });
        }
      },
      () => setState({ kind: "failed", reason: "unknown" }),
    );
  };
  return { state, run, sending: state.kind === "sending" };
}

export function useReason(): (reason: string) => string {
  const t = useTranslations("settings");
  return (reason) => {
    switch (reason) {
      case "unauthorized":
      case "rate-limited":
      case "not-found":
      case "network":
      case "invalid":
      case "missing-key":
      case "taken":
      case "unknown":
        return t(`remoteError.${reason}`);
      case "invalid-web-address":
      case "invalid-webhook-address":
      case "locks-out":
        return t(`addresses.error.${reason}`);
      case "unavailable":
        return t("power.unavailable");
      case "orca-not-found":
      case "ssh-failed":
        return t(`runners.direct.error.${reason}`);
      default:
        return t("failed");
    }
  };
}

export function SubmitError({
  state,
  describe,
}: {
  state: SubmitState;
  describe?: (reason: string) => string | null;
}) {
  const reason = useReason();
  if (state.kind !== "failed") return null;
  return (
    <Text variant="ui" as="p" tone="problem" role="alert">
      {describe?.(state.reason) ?? reason(state.reason)}
    </Text>
  );
}

function useValidateAfterBlur() {
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const touch = (...inputNames: string[]) => {
    setTouched((prev) =>
      inputNames.every((name) => prev.has(name)) ? prev : new Set([...prev, ...inputNames]),
    );
  };
  return {
    isTouched: (inputName: string) => touched.has(inputName),
    touch,
    touchBlurredInput: (event: FocusEvent<HTMLFormElement>) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.name !== "") touch(target.name);
    },
  };
}

export const passwordManagerIgnoredSecretProps = {
  type: "password",
  autoComplete: "off",
  "data-1p-ignore": true,
  "data-lpignore": "true",
} as const;

export function withCurrent(
  options: ReadonlyArray<{ value: string; label: string }>,
  current: string | null | undefined,
): Array<{ value: string; label: string }> {
  if (current === null || current === undefined || options.some((o) => o.value === current)) {
    return [...options];
  }
  return [...options, { value: current, label: current }];
}

export function nameFromSshTarget(sshTarget: string): string {
  const host = sshTarget.trim().split("@").at(-1) ?? "";
  if (host.startsWith("["))
    return host.slice(1, host.indexOf("]") === -1 ? undefined : host.indexOf("]"));
  if ((host.match(/:/gu)?.length ?? 0) > 1) return host;
  const withoutPort = host.split(":")[0] ?? "";
  if (/^\d+(\.\d+){3}$/u.test(withoutPort)) return withoutPort;
  return withoutPort.split(".")[0] ?? "";
}

export function sshCheckCommand(sshTarget: string): string {
  return ["ssh", "-o", "BatchMode=yes", "--", sshTarget, "true"].map(shellQuote).join(" ");
}

export type EditableRunner = Pick<
  RunnerSettingsView,
  "id" | "name" | "sshTarget" | "orcaPath" | "capacity"
>;

export function RunnerForm({
  runner,
  actions,
  primary = runner === null,
  direct = false,
  onDone,
  onClose,
  hints = "description",
}: {
  runner: EditableRunner | null;
  actions: SettingsActions;
  primary?: boolean;
  direct?: boolean;
  onDone?: () => void;
  onClose?: () => void;
  hints?: "description" | "info";
}) {
  const t = useTranslations("settings");
  const hint = (label: string, text: string): { description?: string; info?: ReactNode } =>
    hints === "info"
      ? { info: <InfoTip label={t("infoLabel", { label })} content={text} /> }
      : { description: text };
  const blankOrcaPath = direct ? DEFAULT_ORCA_PATH : "";
  const [name, setName] = useState(runner?.name ?? "");
  const [nameEdited, setNameEdited] = useState(false);
  const [sshTarget, setSshTarget] = useState(runner?.sshTarget ?? "");
  const [orcaPath, setOrcaPath] = useState(runner?.orcaPath ?? blankOrcaPath);
  const [capacity, setCapacity] = useState(String(runner?.capacity ?? 1));
  const submit = useSubmit();
  const isNew = runner === null;
  const capacityValue = parseWholeNumber(capacity);
  const capacityOk = capacityValue !== null && capacityValue >= 1 && capacityValue <= 100;
  const ready =
    name.trim() !== "" &&
    sshTarget.trim() !== "" &&
    (direct || orcaPath.trim() !== "") &&
    capacityOk;
  const validation = useValidateAfterBlur();
  useReportUnsaved(
    name.trim() !== (runner?.name ?? "") ||
      sshTarget.trim() !== (runner?.sshTarget ?? "") ||
      orcaPath.trim() !== (runner?.orcaPath ?? blankOrcaPath) ||
      capacityValue !== (runner?.capacity ?? 1),
  );
  const changeSshTarget = (value: string) => {
    setSshTarget(value);
    if (direct && isNew && !nameEdited) setName(nameFromSshTarget(value));
  };
  const changeName = (value: string) => {
    setName(value);
    setNameEdited(true);
  };
  const required = (inputName: string, value: string) =>
    value.trim() === "" && validation.isTouched(inputName) ? t("runners.required") : undefined;
  const nameField = (
    <Field label={t("runners.name")} error={required("name", name)}>
      <Input
        name="name"
        value={name}
        onValueChange={changeName}
        placeholder={t("runners.namePlaceholder")}
        autoComplete="off"
      />
    </Field>
  );
  const capacityField = (
    <Field
      label={direct ? t("runners.direct.capacity") : t("runners.capacity")}
      {...(direct
        ? hint(t("runners.direct.capacity"), t("runners.direct.capacityDescription"))
        : {})}
      error={
        capacityOk || !validation.isTouched("capacity") ? undefined : t("runners.capacityInvalid")
      }
    >
      <Input
        name="capacity"
        value={capacity}
        onValueChange={setCapacity}
        autoComplete="off"
        inputMode="numeric"
        mono
      />
    </Field>
  );
  const sshTargetField = (
    <Field
      label={t("runners.sshTarget")}
      error={required("sshTarget", sshTarget)}
      {...hint(
        t("runners.sshTarget"),
        direct ? t("runners.direct.sshTargetDescription") : t("runners.sshTargetDescription"),
      )}
    >
      <Input
        name="sshTarget"
        value={sshTarget}
        onValueChange={changeSshTarget}
        placeholder={t("runners.sshTargetPlaceholder")}
        autoComplete="off"
        mono
      />
    </Field>
  );
  const orcaPathField = (
    <Field
      label={t("runners.orcaPath")}
      error={direct ? undefined : required("orcaPath", orcaPath)}
      {...hint(
        t("runners.orcaPath"),
        direct ? t("runners.direct.orcaPathDescription") : t("runners.orcaPathDescription"),
      )}
    >
      <Input name="orcaPath" value={orcaPath} onValueChange={setOrcaPath} autoComplete="off" mono />
    </Field>
  );
  return (
    <form
      {...stylex.props(styles.form)}
      onBlur={validation.touchBlurredInput}
      onKeyDown={(event) => {
        if (event.key === "Escape" && onClose !== undefined) {
          event.preventDefault();
          onClose();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        validation.touch("name", "sshTarget", "orcaPath", "capacity");
        if (!ready || capacityValue === null) return;
        submit.run(
          () =>
            actions.saveRunner({
              ...(runner === null ? {} : { id: runner.id }),
              name: name.trim(),
              sshTarget: sshTarget.trim(),
              orcaPath: orcaPath.trim(),
              capacity: capacityValue,
            }),
          isNew ? t("runners.added") : t("runners.savedAndChecking"),
          () => {
            onDone?.();
            if (!isNew) return;
            setName("");
            setNameEdited(false);
            setSshTarget("");
            setOrcaPath(blankOrcaPath);
            setCapacity("1");
          },
        );
      }}
    >
      {direct ? (
        <>
          {sshTargetField}
          <div {...stylex.props(styles.fieldRow)}>
            {nameField}
            {capacityField}
          </div>
          {orcaPathField}
          <SshCheckCommand sshTarget={sshTarget.trim()} />
        </>
      ) : (
        <>
          <div {...stylex.props(styles.fieldRow)}>
            {nameField}
            {capacityField}
          </div>
          {sshTargetField}
          {orcaPathField}
        </>
      )}
      <SubmitError state={submit.state} />
      <div {...stylex.props(styles.formActions, onClose !== undefined && styles.formActionsEnd)}>
        {onClose === undefined ? null : (
          <Button variant="ghost" onClick={onClose}>
            {t("close")}
          </Button>
        )}
        <Button variant={primary ? "primary" : "secondary"} type="submit" disabled={submit.sending}>
          {submit.sending
            ? t("saving")
            : isNew
              ? direct
                ? t("runners.direct.submit")
                : t("runners.add")
              : t("runners.save")}
        </Button>
      </div>
    </form>
  );
}

function SshCheckCommand({ sshTarget }: { sshTarget: string }) {
  const t = useTranslations("settings.runners.direct");
  const empty = sshTarget === "";
  const command = sshCheckCommand(empty ? t("targetPlaceholder") : sshTarget);
  const copy = () => {
    void copyText(command, browserClipboard()).then((copied) =>
      showToast(copied ? t("copied") : t("copyFailed")),
    );
  };
  return (
    <PanelBlock title={t("tryFirst")}>
      <div {...stylex.props(styles.snippet)}>
        <CodeBlock tone="command" label={t("tryFirst")}>
          {command}
        </CodeBlock>
        <Actions>
          <Button variant="ghost" disabled={empty} onClick={copy}>
            {t("copy")}
          </Button>
        </Actions>
      </div>
    </PanelBlock>
  );
}

export function RunnerCheck({
  runner,
  actions,
  workerSilent,
  primary = false,
}: {
  runner: RunnerSettingsView;
  actions: SettingsActions;
  workerSilent: boolean;
  primary?: boolean;
}) {
  const t = useTranslations("settings.runners");
  const submit = useSubmit();
  const check = runner.check;
  const checking = submit.sending || (check?.status === "pending" && !workerSilent);
  return (
    <div {...stylex.props(styles.form)}>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.rowText)}>
          <Text variant="ui" tone="strong">
            {runner.name}
          </Text>
          <Text variant="meta" mono truncate>
            {runner.sshTarget}
          </Text>
        </span>
        <Button
          variant={primary ? "primary" : "secondary"}
          disabled={checking}
          onClick={() =>
            submit.run(() => actions.recheckRunner({ id: runner.id }), t("checkRequested"))
          }
        >
          {checking ? t("checking") : t("recheck")}
        </Button>
      </div>
      <SubmitError state={submit.state} />
      <PanelBlock title={t("check.title")}>
        <CheckResult check={check} workerSilent={workerSilent} />
      </PanelBlock>
    </div>
  );
}

function CheckResult({
  check,
  workerSilent,
}: {
  check: RunnerCheckView | null;
  workerSilent: boolean;
}) {
  const t = useTranslations("settings.runners.check");
  const runnerError = useRunnerErrorName();
  const statusName = useStatusName();
  const { ago } = useTime();
  if (check === null) return <Text variant="meta">{t("never")}</Text>;
  switch (check.status) {
    case "pending":
      return (
        <Text variant="ui" as="p" role="status">
          {workerSilent ? t("workerSilent") : t("pending")}
        </Text>
      );
    case "failed":
      return (
        <Text variant="ui" as="p" tone="problem">
          {t("failed", { error: check.error })}
        </Text>
      );
    case "unreadable":
      return (
        <Text variant="ui" as="p" tone="problem">
          {t("unreadable")}
        </Text>
      );
    case "done":
      return (
        <div {...stylex.props(styles.form)}>
          <span {...stylex.props(styles.inline)}>
            <StatusPill status={check.online ? "online" : "offline"}>
              {statusName(check.online ? "online" : "offline")}
            </StatusPill>
            {check.online
              ? check.version === null
                ? t("online")
                : t("onlineVersion", { version: check.version })
              : check.error === null
                ? t("offline")
                : t("offlineReason", { reason: runnerError(check.error) })}
          </span>
          {check.prerequisites.length === 0 ? null : (
            <DividedList>
              {check.prerequisites.map((prerequisite) => (
                <Prerequisite key={prerequisite.id} prerequisite={prerequisite} />
              ))}
            </DividedList>
          )}
          <Text variant="meta">
            <time dateTime={check.completedAt}>
              {t("checkedAt", { time: ago(check.completedAt, check.completedAgoMs) })}
            </time>
          </Text>
        </div>
      );
  }
}

export function useRunnerErrorName(): (kind: string) => string {
  const t = useTranslations("settings.runners.check.errorKind");
  return (kind) => {
    switch (kind) {
      case "unreachable":
      case "not-installed":
      case "not-ready":
      case "mailbox-missing":
      case "runner-error":
      case "start-outcome-unknown":
      case "malformed-output":
        return t(kind);
      default:
        return kind;
    }
  };
}

function Prerequisite({ prerequisite }: { prerequisite: PrerequisiteView }) {
  const t = useTranslations("settings.runners.check");
  const prerequisiteName = usePrerequisiteName();
  const broken = prerequisite.satisfied === false;
  const hint = prerequisiteHint(prerequisite);
  const push =
    isPushCheck(prerequisite) && prerequisite.satisfied !== true
      ? summarizePushChecks([prerequisite])
      : null;
  return (
    <DividedItem tight>
      <span {...stylex.props(styles.inline)}>
        <Text variant="ui" tone="strong">
          {prerequisiteName(prerequisite)}
        </Text>
        {broken ? (
          <Text variant="ui" tone="problem">
            {t("unsatisfied")}
          </Text>
        ) : (
          <Text variant="meta">
            {prerequisite.satisfied === null ? t("unknown") : t("satisfied")}
          </Text>
        )}
      </span>
      {broken && hint !== null ? (
        <Text variant="meta" mono>
          {hint}
        </Text>
      ) : null}
      {push === null ? null : <PushProblems summary={push} />}
      {broken && prerequisite.blocksAssignment ? (
        <div {...stylex.props(styles.fix)}>
          <Text variant="ui" as="p" tone="problem">
            {t("blocked")}
          </Text>
          <Text variant="label">{t("fixTitle")}</Text>
          <ul {...stylex.props(textStyles("ui"), styles.bullets)}>
            <li>{t("fixToken")}</li>
            <li>{t("fixSsh")}</li>
          </ul>
        </div>
      ) : null}
    </DividedItem>
  );
}

function parseWholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

const styles = stylex.create({
  formActions: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  formActionsEnd: { justifyContent: "flex-end" },
  titleCell: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  form: { display: "flex", flexDirection: "column", gap: space.s4, maxWidth: size.formWidth },
  fieldRow: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(${size.fieldMinWidth}, 1fr))`,
    gap: space.s3,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    maxWidth: size.formWidth,
  },
  rowText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  inline: { display: "inline-flex", alignItems: "center", gap: space.px6 },
  action: { flexShrink: 0 },
  fix: { display: "flex", flexDirection: "column", gap: space.s1 },
  snippet: { display: "flex", flexDirection: "column", gap: space.s3 },
  bullets: {
    margin: 0,
    paddingInlineStart: space.s5,
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
  },
});
