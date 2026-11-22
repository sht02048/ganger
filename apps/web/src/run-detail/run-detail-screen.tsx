import type { PrSignalsView } from "@ganger/app/pr-signals-view";
import * as stylex from "@stylexjs/stylex";
import { isMcpRejectReason, isMcpRunTool } from "@ganger/app/mcp/actions";
import {
  Actions,
  Button,
  Card,
  CodeBlock,
  DefinitionItem,
  DefinitionList,
  Dialog,
  DialogClose,
  Disclosure,
  Field,
  Input,
  MotionList,
  PageHeader,
  ScreenLayout,
  Row,
  StatusPill,
  Text,
  Textarea,
  TextLink,
  focusStyles,
  linkStyles,
  NoticeLayout,
  ProblemCallout,
  SignalList,
  SignalRow,
  buttonStyles,
  showToast,
  textStyles,
} from "@ganger/ui";
import type { PillStatus, SignalTone } from "@ganger/ui";
import { breakpoints, size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { answerRejection } from "../home/rejection";
import type { AnswerRejectReason } from "../home/rejection";
import { HumanCheckAnswer, HumanCheckRequest } from "../question/human-check-answer";
import { QuestionAnswer } from "../question/question-answer";
import { AgentMessageForm, useDeliveryText } from "./agent-message-form";
import type { AgentMessageOutcome, AgentMessageRequest } from "./agent-message-form";
import { allBlockersOf, blockerReasonOf } from "@ganger/app/runs/model";
import type { BlockerReason } from "@ganger/app/runs/model";
import { BlockerRows } from "../blockers";
import { useAgentName, useQueuedReasonText } from "../labels";
import { runStatus, useStatusName } from "../status";
import { canCancel } from "@ganger/app/run-detail/model";
import { nextStepInputOfDetail, runNextStep } from "@ganger/app/run-next-step";
import type { RunNextStep } from "@ganger/app/run-next-step";
import { useRunNextStepText } from "../run-next-step";
import { availableRunControl } from "@ganger/app/run-control-view";
import type { RunControlOutcome, RunControlView } from "@ganger/app/run-control-view";
import { CONTINUE_MESSAGE_MAX_LENGTH } from "@ganger/core";
import type { RunControl, RunnerId } from "@ganger/core";
import type { HumanCheckDecision } from "@ganger/app/home/actions";
import type {
  CiView,
  ContinueOffer,
  LogTailView,
  PendingInput,
  RunDetail,
  RunDetailPage,
  TimelineEvent,
} from "@ganger/app/run-detail/model";

export interface RunDetailActions {
  onAnswer: (questionId: string, body: string) => Promise<void>;
  onHumanCheck: (questionId: string, decision: HumanCheckDecision, note: string) => Promise<void>;
  onDeny: (promptId: string, reason: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onRemoveWorktree: () => Promise<void>;
  onContinue: (message: string) => Promise<void>;
  onStopPreviousAgent: () => Promise<void>;
  onControl: (control: RunControl) => Promise<RunControlOutcome>;
  onStartWithoutWaiting: () => Promise<void>;
  onSendAgentMessage: (input: AgentMessageRequest) => Promise<AgentMessageOutcome>;
  onRefreshLog: () => Promise<void>;
}

export interface RunDetailScreenProps extends RunDetailActions {
  page: RunDetailPage;
  runsHref: string;
  runHref: (runId: string) => string;
  runnerHref: (runnerId: RunnerId) => string;
  logStalled?: boolean;
}

export function RunDetailScreen(props: RunDetailScreenProps) {
  const { page } = props;
  if (page.kind === "not-found") return <NotFound runsHref={props.runsHref} />;
  return <Main {...props} run={page.run} />;
}

function NotFound({ runsHref }: { runsHref: string }) {
  const t = useTranslations("run.notFound");
  return (
    <ScreenLayout header={<PageHeader title={t("title")} />}>
      <NoticeLayout>
        <div {...stylex.props(styles.noticeBody)}>
          <Text variant="body">{t("body")}</Text>
          <a href={runsHref} {...stylex.props(linkStyles())}>
            {t("back")}
          </a>
        </div>
      </NoticeLayout>
    </ScreenLayout>
  );
}

function Main(props: RunDetailScreenProps & { run: RunDetail }) {
  const { run } = props;
  const t = useTranslations("run");
  const statusLine = useStatusLine();
  const statusName = useStatusName();
  const { status, when } = statusLine(run);
  const nextStep = runNextStep(nextStepInputOfDetail(run));
  const cancelable = canCancel(run) && !run.cancelPending;
  const control = availableRunControl(run.status.state, run.cancelPending, run.control);
  const resumeInBand = nextStep === "paused" && control === "resume";
  const headControl = resumeInBand ? null : control;
  const inputRef = useRef<HTMLDivElement>(null);
  const keptWorktree = run.status.state === "ended" ? run.status.keptWorktree : null;
  const removable = keptWorktree !== null && !keptWorktree.removing;
  const headRef = useRef<HTMLDivElement>(null);
  const cancelStatusRef = useRef<HTMLSpanElement>(null);
  const continuationRef = useRef<HTMLElement>(null);
  const continuedById = run.continuedBy?.id ?? null;
  const focusContinuation = useRef(false);
  useEffect(() => {
    if (continuedById === null || !focusContinuation.current) return;
    focusContinuation.current = false;
    focusFirst(continuationRef, headRef);
  }, [continuedById]);
  const pending = [
    run.cancelPending ? t("cancelPending") : null,
    keptWorktree?.removing === true ? t("removeWorktree.pending") : null,
    run.continueOffer?.agentStopRequested === true ? t("continue.stopPending") : null,
    run.control?.status === "pending"
      ? t(run.control.control === "pause" ? "control.pausePending" : "control.resumePending")
      : null,
  ].filter((part) => part !== null);
  const failure = useControlFailure(run.cancelPending ? null : run.control);
  const blockerWait =
    run.status.state === "queued" ? blockerReasonOf(run.status.queuedReason) : null;

  return (
    <ScreenLayout
      header={
        <PageHeader
          lead={
            <nav aria-label={t("crumb.label")} {...stylex.props(textStyles("ui"), styles.crumb)}>
              <a href={props.runsHref} {...stylex.props(linkStyles("quiet"), styles.crumbLink)}>
                <span aria-hidden="true">‹</span>
                {t("crumb.runs")}
              </a>
            </nav>
          }
          title={run.ticketTitle ?? run.ticketKey}
          subtitle={[
            ...(run.ticketTitle === null ? [] : [run.ticketKey]),
            run.trackerProject,
            ...(run.runner === null ? [] : [run.runner.name]),
            ...(run.branch === null ? [] : [run.branch]),
          ].join(t("metaSeparator"))}
        />
      }
    >
      <div {...stylex.props(styles.main)}>
        <div ref={headRef} tabIndex={-1} {...stylex.props(styles.head, focusStyles.target)}>
          <div {...stylex.props(styles.stateRow)}>
            <p {...stylex.props(styles.stateLine)}>
              <StatusPill status={status}>{statusName(status)}</StatusPill>
              <Text variant="meta">{when}</Text>
              <span {...stylex.props(failure !== null && styles.statusOwnLine)}>
                <Text
                  variant="meta"
                  ref={cancelStatusRef}
                  role="status"
                  tabIndex={-1}
                  {...(failure === null ? {} : { tone: "problem" as const })}
                >
                  {[...pending, ...(failure === null ? [] : [failure])].join(t("metaSeparator"))}
                </Text>
              </span>
            </p>
            {!cancelable &&
            headControl === null &&
            !removable &&
            run.continueOffer === null ? null : (
              <Actions>
                {headControl === null ? null : (
                  <ControlRun
                    key={headControl}
                    control={headControl}
                    variant="secondary"
                    onControl={props.onControl}
                    focusAfter={() => focusFirst(cancelStatusRef, headRef)}
                  />
                )}
                {cancelable ? (
                  <ConfirmDanger
                    messages="run.cancel"
                    onConfirm={props.onCancel}
                    focusAfter={() => focusFirst(cancelStatusRef, headRef)}
                  />
                ) : null}
                {run.continueOffer === null ? null : run.continueOffer.agent !== "gone" ? (
                  <Button aria-disabled aria-describedby={CONTINUE_BLOCKED_ID}>
                    {t("continue.trigger")}
                  </Button>
                ) : (
                  <ContinueRun
                    offer={run.continueOffer}
                    onContinue={async (message) => {
                      focusContinuation.current = true;
                      try {
                        await props.onContinue(message);
                      } catch (error) {
                        focusContinuation.current = false;
                        throw error;
                      }
                    }}
                  />
                )}
                {removable ? (
                  <ConfirmDanger
                    messages="run.removeWorktree"
                    onConfirm={props.onRemoveWorktree}
                    focusAfter={() => focusFirst(cancelStatusRef, headRef)}
                  />
                ) : null}
              </Actions>
            )}
          </div>
          {run.continueOffer === null || run.continueOffer.agent === "gone" ? null : (
            <ContinueBlocked
              agent={run.continueOffer.agent}
              stopping={run.continueOffer.agentStopRequested}
              onStop={props.onStopPreviousAgent}
              focusAfter={() => focusFirst(cancelStatusRef, headRef)}
            />
          )}
          <Continuation run={run} runHref={props.runHref} statusRef={continuationRef} />
        </div>

        {nextStep === "none" ? (
          <div {...stylex.props(styles.bandText)}>
            <Text variant="body" as="p">
              <Reason run={run} />
            </Text>
            {keptWorktree === null || keptWorktree.removing ? null : (
              <Text variant="body" as="p">
                {t(`keptWorktree.${keptWorktree.reason}`)}{" "}
                {t(`keptWorktreeNext.${keptWorktree.reason}`)}
              </Text>
            )}
          </div>
        ) : (
          <NextStepBand
            run={run}
            step={nextStep}
            onGoToInput={() => focusInputField(inputRef)}
            resume={
              resumeInBand ? (
                <ControlRun
                  key="resume"
                  control="resume"
                  variant="primary"
                  onControl={props.onControl}
                  focusAfter={() => focusFirst(cancelStatusRef, headRef)}
                />
              ) : null
            }
          />
        )}

        <div {...stylex.props(styles.columns)}>
          <div {...stylex.props(styles.column)}>
            {blockerWait === null ? null : (
              <BlockerWaitBlock
                wait={blockerWait}
                cancelPending={run.cancelPending}
                onStart={props.onStartWithoutWaiting}
                focusAfter={() => focusFirst(cancelStatusRef, headRef)}
              />
            )}

            {run.status.state === "waiting-for-input" && run.status.input.kind !== "unknown" ? (
              <div ref={inputRef} tabIndex={-1} {...stylex.props(focusStyles.target)}>
                <InputBlock
                  input={run.status.input}
                  waitedMs={inputWaitedMs(run)}
                  onAnswer={props.onAnswer}
                  onHumanCheck={props.onHumanCheck}
                  onDeny={props.onDeny}
                  headRef={headRef}
                />
              </div>
            ) : null}

            {run.status.state === "paused" && run.status.lastOutput !== null ? (
              <Block title={t("lastOutput.title")}>
                <Text variant="body">{t("lastOutput.body")}</Text>
                {run.status.lastOutput.length === 0 ? (
                  <Text variant="meta">{t("lastOutput.none")}</Text>
                ) : (
                  <CodeBlock scroll label={t("lastOutput.linesLabel")}>
                    {run.status.lastOutput.join("\n")}
                  </CodeBlock>
                )}
              </Block>
            ) : null}

            {run.startError === null ? null : (
              <Block title={t("startError.title")}>
                <Text variant="body">{t("startError.body")}</Text>
                <CodeBlock>{run.startError}</CodeBlock>
              </Block>
            )}

            <PrSection run={run} />

            <Timeline runId={run.id} events={run.timeline} now={run.now} report={run.report} />

            <AgentMessageForm
              key={run.id}
              view={run.agentMessage}
              hint={agentMessageHint(run)}
              onSend={props.onSendAgentMessage}
            />
          </div>

          <div {...stylex.props(styles.column)}>
            <Properties run={run} runnerHref={props.runnerHref} />
            <LogTail
              log={run.log}
              now={run.now}
              stalled={props.logStalled === true}
              onRefresh={props.onRefreshLog}
            />
            <OtherRuns run={run} runHref={props.runHref} />
          </div>
        </div>
      </div>
    </ScreenLayout>
  );
}

function agentMessageHint(run: RunDetail): "paused" | "waiting" | null {
  if (run.status.state === "paused") return "paused";
  return run.status.state === "waiting-for-input" &&
    (run.status.input.kind === "question" || run.status.input.kind === "human-check")
    ? "waiting"
    : null;
}

function Block({
  title,
  aside,
  compact = false,
  children,
}: {
  title: string;
  aside?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <Card label={title} padding={compact ? "compact" : "normal"}>
      <div {...stylex.props(styles.blockHead, compact && styles.blockHeadCompact)}>
        <Text variant="subheading" as="h2">
          {title}
        </Text>
        {aside === undefined ? null : aside}
      </div>
      {children}
    </Card>
  );
}

function SentBrief({ brief }: { brief: string }) {
  const t = useTranslations("run.brief");
  return (
    <Disclosure flat summary={t("title")}>
      <Text variant="meta" as="p">
        {t("body")}
      </Text>
      <CodeBlock scroll label={t("label")}>
        {brief}
      </CodeBlock>
    </Disclosure>
  );
}

function focusFirst(...targets: ReadonlyArray<RefObject<HTMLElement | null>>): void {
  for (const target of targets) {
    const element = target.current;
    if (element !== null && element.isConnected) {
      element.focus();
      return;
    }
  }
}

function focusInputField(container: RefObject<HTMLElement | null>): void {
  const field = container.current?.querySelector<HTMLElement>(
    "textarea:not([disabled]), input:not([disabled])",
  );
  (field ?? container.current)?.focus();
}

function ActionFailed() {
  const t = useTranslations("run");
  return (
    <Text variant="ui" as="p" tone="problem" role="alert">
      {t("actionFailed")}
    </Text>
  );
}

function inputWaitedMs(run: RunDetail): number | null {
  if (run.status.state !== "waiting-for-input" || run.status.inputSince === null) return null;
  return Math.max(0, Date.parse(run.now) - Date.parse(run.status.inputSince));
}

function Reason({ run }: { run: RunDetail }) {
  const t = useTranslations("run.reason");
  const domain = useTranslations("domain");
  const queuedReasonText = useQueuedReasonText();
  const { clock } = useTime();
  const { status } = run;
  switch (status.state) {
    case "queued":
      return queuedReasonText(status.queuedReason);
    case "running":
      return t("running");
    case "paused":
      return t("paused", { source: domain(`pauseSource.${status.pauseSource}`) });
    case "waiting-for-input":
      return t(inputKey(status.input));
    case "disconnected":
      if (status.paused) {
        return status.unreachableSince === null
          ? t("disconnectedPaused")
          : t("disconnectedPausedSince", { time: clock(status.unreachableSince) });
      }
      return status.unreachableSince === null
        ? t("disconnected")
        : t("disconnectedSince", { time: clock(status.unreachableSince) });
    case "ended":
      return t(status.summary);
  }
}

function inputKey(
  input: PendingInput,
): "question" | "human-check" | "answered" | "permission" | "denied" | "waiting-unknown" {
  switch (input.kind) {
    case "question":
      return input.answered ? "answered" : "question";
    case "human-check":
      return input.answered ? "answered" : "human-check";
    case "permission":
      return input.denied ? "denied" : "permission";
    case "unknown":
      return "waiting-unknown";
  }
}

function isProblemStep(step: Exclude<RunNextStep, "none">): boolean {
  switch (step) {
    case "pr-ci-failed":
    case "pr-conflict":
    case "disconnected":
    case "blockers-stuck":
    case "kept-worktree":
    case "failed":
      return true;
    case "question":
    case "permission":
    case "human-check":
    case "waiting-input":
    case "paused":
      return false;
  }
}

function NextStepBand({
  run,
  step,
  onGoToInput,
  resume,
}: {
  run: RunDetail;
  step: Exclude<RunNextStep, "none">;
  onGoToInput: () => void;
  resume: ReactNode;
}) {
  const t = useTranslations("run");
  const prText = useTranslations("run.pr");
  const nextStepText = useRunNextStepText()(step);
  if (nextStepText === null) return null;
  const pr = run.pullRequest;
  const signals = pr?.signals ?? null;
  const kept =
    run.status.state === "ended" && run.status.keptWorktree?.removing === false
      ? run.status.keptWorktree
      : null;
  const title =
    step === "kept-worktree" && kept !== null
      ? t(`keptWorktree.${kept.reason}`)
      : nextStepText.body;
  const stepDetail: ReactNode =
    step === "pr-ci-failed" ? (
      signals === null || signals.checkTotal === null ? null : (
        <Text variant="body" as="p">
          {checksText(signals, signals.checkTotal, prText)}
        </Text>
      )
    ) : step === "pr-conflict" ? null : step === "kept-worktree" && kept !== null ? (
      <Text variant="body" as="p">
        {t(`keptWorktreeNext.${kept.reason}`)}
      </Text>
    ) : (
      <Text variant="body" as="p">
        <Reason run={run} />
      </Text>
    );
  const details = (
    <>
      {stepDetail}
      {kept === null || step === "kept-worktree" ? null : (
        <Text variant="body" as="p">
          {t(`keptWorktree.${kept.reason}`)} {t(`keptWorktreeNext.${kept.reason}`)}
        </Text>
      )}
    </>
  );
  const action = bandAction(step, nextStepText.action, pr?.url ?? null, onGoToInput, resume);
  if (isProblemStep(step)) {
    return (
      <ProblemCallout title={title} {...(action === null ? {} : { actions: action })}>
        {stepDetail === null && (kept === null || step === "kept-worktree") ? undefined : details}
      </ProblemCallout>
    );
  }
  return (
    <Card label={title}>
      <div {...stylex.props(styles.band)}>
        <div {...stylex.props(styles.bandText)}>
          <Text variant="title" as="p">
            {title}
          </Text>
          {details}
        </div>
        {action}
      </div>
    </Card>
  );
}

function bandAction(
  step: Exclude<RunNextStep, "none">,
  label: string | null,
  prUrl: string | null,
  onGoToInput: () => void,
  resume: ReactNode,
): ReactNode {
  if (step === "paused") return resume;
  if (label === null) return null;
  if (step === "question" || step === "human-check") {
    return <Button onClick={onGoToInput}>{label}</Button>;
  }
  if (prUrl === null) return null;
  return (
    <a
      href={step === "pr-ci-failed" ? prChecksUrl(prUrl) : prUrl}
      target="_blank"
      rel="noreferrer"
      data-variant="primary"
      {...stylex.props(...buttonStyles("primary"))}
    >
      {label}
    </a>
  );
}

function prChecksUrl(url: string): string {
  return `${url.replace(/\/+$/, "")}/checks`;
}

function ciTone(ci: CiView, ciFailed: boolean): SignalTone {
  if (ciFailed) return "problem";
  return ci === "success" ? "pass" : "neutral";
}

function PrSection({ run }: { run: RunDetail }) {
  const t = useTranslations("run.pr");
  const root = useTranslations("run");
  const domain = useTranslations("domain");
  const ci = useTranslations("run.ci");
  const laterPr = useTranslations("run.laterPr");
  const { ago, stamp } = useTime();
  const pr = run.pullRequest;
  const ended = run.status.state === "ended" ? run.status : null;
  const state = ended === null ? null : (ended.laterPrState?.state ?? ended.prState);
  if (pr === null && (state === null || state === "none")) return null;
  const signals = pr?.signals ?? null;
  const ciFailed =
    pr !== null && !run.prHandedOver && (signals === null ? pr.ci === "failure" : signals.ciFailed);
  const title = pr === null ? t("title") : t("titleWithId", { pr: pr.displayId });
  const stateText =
    run.prHandedOver && pr !== null
      ? root("prHandedOver", { pr: pr.displayId })
      : state !== null && state !== "none"
        ? domain(`prState.${state}`)
        : signals !== null
          ? domain("prState.open")
          : null;
  const later = ended?.laterPrState ?? null;
  return (
    <Card label={title}>
      <div {...stylex.props(styles.prHead)}>
        <Text variant="subheading" as="h2">
          {title}
        </Text>
        {stateText === null ? null : <Text variant="ui">{stateText}</Text>}
        <span {...stylex.props(styles.prHeadEnd)}>
          {signals === null ? null : (
            <Text variant="meta">{t("readAt", { time: stamp(signals.checkedAt, run.now) })}</Text>
          )}
          {pr === null ? null : (
            <TextLink href={pr.url} external>
              {t("open")}
            </TextLink>
          )}
        </span>
      </div>
      {later === null ? null : (
        <Text variant="meta" as="p">
          {t("later", {
            state: laterPr(later.state),
            time: ago(later.at, Date.parse(run.now) - Date.parse(later.at)),
          })}
        </Text>
      )}
      {ended?.prReadError == null ? null : (
        <p {...stylex.props(styles.flat)}>
          <Text variant="title" tone="problem">
            {root("prUnread.title")}
          </Text>{" "}
          <Text variant="body" as="span">
            {root(`prUnread.${ended.prReadError}`)}
          </Text>
        </p>
      )}
      {pr === null ? null : (
        <SignalList>
          <SignalRow
            label={t("ci")}
            tone={ciTone(pr.ci, ciFailed)}
            {...(ciFailed
              ? {
                  action: (
                    <TextLink href={prChecksUrl(pr.url)} external>
                      {t("checksLink")}
                    </TextLink>
                  ),
                }
              : {})}
          >
            {signals === null || signals.checkTotal === null
              ? ci(ciFailed ? "failure" : pr.ci)
              : ciFailed
                ? checksText(signals, signals.checkTotal, t)
                : [ci(pr.ci), checksText(signals, signals.checkTotal, t)].join(
                    root("metaSeparator"),
                  )}
          </SignalRow>
          {signals === null || signals.conflict === null ? null : (
            <SignalRow label={t("conflict")} tone={signals.conflict ? "problem" : "pass"}>
              {signals.conflict ? t("hasConflict") : t("noConflict")}
            </SignalRow>
          )}
          {signals === null || signals.behindBy === null ? null : (
            <SignalRow label={t("base")} tone={signals.behindBy > 0 ? "warning" : "pass"}>
              {signals.behindBy > 0 ? t("behindBy", { count: signals.behindBy }) : t("upToDate")}
            </SignalRow>
          )}
        </SignalList>
      )}
    </Card>
  );
}

function InputBlock({
  input,
  waitedMs,
  onAnswer,
  onHumanCheck,
  onDeny,
  headRef,
}: {
  input: PendingInput;
  waitedMs: number | null;
  onAnswer: RunDetailActions["onAnswer"];
  onHumanCheck: RunDetailActions["onHumanCheck"];
  onDeny: RunDetailActions["onDeny"];
  headRef: RefObject<HTMLElement | null>;
}) {
  switch (input.kind) {
    case "human-check":
      return (
        <HumanCheckForm
          key={input.questionId}
          check={input}
          waitedMs={waitedMs}
          onHumanCheck={onHumanCheck}
          headRef={headRef}
        />
      );
    case "question":
      return (
        <QuestionForm
          key={input.questionId}
          question={input}
          waitedMs={waitedMs}
          onAnswer={onAnswer}
          headRef={headRef}
        />
      );
    case "permission":
      return (
        <PermissionWait
          key={input.promptId}
          wait={input}
          waitedMs={waitedMs}
          onDeny={onDeny}
          headRef={headRef}
        />
      );
    case "unknown":
      return null;
  }
}

function useSubmit(headRef: RefObject<HTMLElement | null>) {
  const [submit, setSubmit] = useState<Submit>({ kind: "idle" });
  const resultRef = useRef<HTMLParagraphElement>(null);
  const run = (send: () => Promise<void>): Promise<void> => {
    setSubmit({ kind: "sending" });
    const sent = send();
    sent.then(
      () => {
        setSubmit({ kind: "sent" });
        if (resultRef.current === null || !resultRef.current.isConnected) focusFirst(headRef);
      },
      () => setSubmit({ kind: "failed" }),
    );
    return sent;
  };
  useEffect(() => {
    if (submit.kind === "sent") resultRef.current?.focus();
  }, [submit.kind]);
  return { submit, run, resultRef };
}

type Submit = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed" };

function InputHead({
  kind,
  waitedMs,
}: {
  kind: "question" | "permission" | "human-check";
  waitedMs: number | null;
}) {
  const t = useTranslations("run.input");
  const statusName = useStatusName();
  const { elapsed } = useTime();
  return (
    <p {...stylex.props(styles.stateLine)}>
      <StatusPill status={kind}>{statusName(kind)}</StatusPill>
      {waitedMs === null ? null : (
        <Text variant="meta">{t(kind, { elapsed: elapsed(waitedMs) })}</Text>
      )}
    </p>
  );
}

function QuestionForm({
  question,
  waitedMs,
  onAnswer,
  headRef,
}: {
  question: Extract<PendingInput, { kind: "question" }>;
  waitedMs: number | null;
  onAnswer: RunDetailActions["onAnswer"];
  headRef: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("run");
  const { submit, run, resultRef } = useSubmit(headRef);
  return (
    <Card label={t("question.title")}>
      <InputHead kind="question" waitedMs={waitedMs} />
      {submit.kind === "sent" || question.answered ? (
        <>
          <Text variant="body" as="p" wrap="pre">
            {question.body}
          </Text>
          <Text variant="body" as="p" ref={resultRef} role="status" tabIndex={-1}>
            {t("question.sent")}
          </Text>
        </>
      ) : (
        <QuestionAnswer
          body={question.body}
          options={question.choices}
          onSend={(answer) => run(() => onAnswer(question.questionId, answer))}
        />
      )}
    </Card>
  );
}

function HumanCheckForm({
  check,
  waitedMs,
  onHumanCheck,
  headRef,
}: {
  check: Extract<PendingInput, { kind: "human-check" }>;
  waitedMs: number | null;
  onHumanCheck: RunDetailActions["onHumanCheck"];
  headRef: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("run");
  const { submit, run, resultRef } = useSubmit(headRef);
  const [rejected, setRejected] = useState<AnswerRejectReason | null>(null);
  const sendAnswer = async (decision: HumanCheckDecision, note: string) => {
    try {
      await onHumanCheck(check.questionId, decision, note);
    } catch (error) {
      const reason = answerRejection(error);
      if (reason === null) throw error;
      setRejected(reason);
    }
  };
  return (
    <Card label={t("humanCheck.title")}>
      <InputHead kind="human-check" waitedMs={waitedMs} />
      {submit.kind === "sent" || check.answered ? (
        <>
          <HumanCheckRequest body={check.body} />
          <Text variant="body" as="p" ref={resultRef} role="status" tabIndex={-1}>
            {rejected === null ? t("humanCheck.sent") : t(`humanCheck.rejected.${rejected}`)}
          </Text>
        </>
      ) : (
        <HumanCheckAnswer
          body={check.body}
          onSend={(decision, note) => run(() => sendAnswer(decision, note))}
        />
      )}
    </Card>
  );
}

function PermissionWait({
  wait,
  waitedMs,
  onDeny,
  headRef,
}: {
  wait: Extract<PendingInput, { kind: "permission" }>;
  waitedMs: number | null;
  onDeny: RunDetailActions["onDeny"];
  headRef: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("run");
  const [reason, setReason] = useState("");
  const { submit, run, resultRef } = useSubmit(headRef);
  return (
    <Card label={t("permission.title")}>
      <InputHead kind="permission" waitedMs={waitedMs} />
      <div {...stylex.props(styles.stack)}>
        <Text variant="panel" as="p" wrap="pre">
          {wait.detail}
        </Text>
        {submit.kind === "sent" || wait.denied ? (
          <Text variant="body" as="p" ref={resultRef} role="status" tabIndex={-1}>
            {t("permission.denied")}
          </Text>
        ) : (
          <form
            {...stylex.props(styles.stack)}
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => onDeny(wait.promptId, reason));
            }}
          >
            <Text variant="body">{t("permission.body")}</Text>
            <Field label={t("permission.reasonLabel")} description={t("permission.reasonHelp")}>
              <Input name="reason" value={reason} onValueChange={setReason} autoComplete="off" />
            </Field>
            <Actions>
              <Button type="submit" variant="danger" disabled={submit.kind === "sending"}>
                {submit.kind === "sending" ? t("permission.denying") : t("permission.deny")}
              </Button>
            </Actions>
          </form>
        )}
        {submit.kind === "failed" ? <ActionFailed /> : null}
      </div>
    </Card>
  );
}

function ConfirmDanger({
  messages,
  onConfirm,
  focusAfter,
}: {
  messages: "run.cancel" | "run.removeWorktree";
  onConfirm: () => Promise<void>;
  focusAfter: () => void;
}) {
  const t = useTranslations(messages);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  return (
    <>
      <Dialog
        trigger={t("trigger")}
        triggerVariant="danger"
        triggerBusy={{ active: sending, label: t("sending") }}
        title={t("title")}
        description={t("body")}
        actions={
          <>
            <DialogClose>{t("dismiss")}</DialogClose>
            <DialogClose
              variant="danger"
              onClick={() => {
                if (sending) return;
                setFailed(false);
                setSending(true);
                onConfirm()
                  .then(focusAfter, () => setFailed(true))
                  .finally(() => setSending(false));
              }}
            >
              {t("confirm")}
            </DialogClose>
          </>
        }
      />
      {failed ? <ActionFailed /> : null}
    </>
  );
}

function BlockerWaitBlock({
  wait,
  cancelPending,
  onStart,
  focusAfter,
}: {
  wait: BlockerReason;
  cancelPending: boolean;
  onStart: () => Promise<void>;
  focusAfter: () => void;
}) {
  const t = useTranslations("run.blockerWait");
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const stuck = wait.kind === "blockers-stuck";
  const blockers = allBlockersOf(wait);
  return (
    <Card label={t("title")}>
      <div {...stylex.props(styles.blockerWait)}>
        <Text variant="subheading" as="h2">
          {t("title")}
        </Text>
        <Text variant="body" as="p" {...(stuck ? { tone: "problem" as const } : {})}>
          {stuck ? t(`stuck.${wait.cause}`) : t("waiting")}
        </Text>
        {blockers.length === 0 ? null : <BlockerRows blockers={blockers} />}
        {cancelPending ? null : (
          <Actions>
            <Dialog
              trigger={t("trigger")}
              triggerVariant={stuck ? "primary" : "secondary"}
              triggerBusy={{ active: sending, label: t("sending") }}
              title={t("confirmTitle")}
              description={t("confirmBody")}
              actions={
                <>
                  <DialogClose>{t("dismiss")}</DialogClose>
                  <DialogClose
                    variant="primary"
                    onClick={() => {
                      if (sending) return;
                      setFailed(false);
                      setSending(true);
                      onStart()
                        .then(focusAfter, () => setFailed(true))
                        .finally(() => setSending(false));
                    }}
                  >
                    {t("confirm")}
                  </DialogClose>
                </>
              }
            />
          </Actions>
        )}
        {failed ? <ActionFailed /> : null}
      </div>
    </Card>
  );
}

function Continuation({
  run,
  runHref,
  statusRef,
}: {
  run: RunDetail;
  runHref: (runId: string) => string;
  statusRef: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("run.continuation");
  const { continuedFrom, continuedBy, continuePlace } = run;
  if (continuedFrom === null && continuedBy === null) return null;
  const endedBeforeStart = run.status.state === "ended" && run.startedAt === null;
  const placeKey = endedBeforeStart
    ? "notStarted"
    : run.status.state === "queued"
      ? "pending"
      : (continuePlace ?? "pending");
  return (
    <>
      {continuedFrom === null ? null : (
        <Text variant="body" as="p">
          <TextLink href={runHref(continuedFrom.id)}>
            {t("from", {
              number: continuedFrom.number,
              digit: continuedFrom.number % 10,
            })}
          </TextLink>{" "}
          {t(`place.${placeKey}`)}
        </Text>
      )}
      {continuedBy === null ? null : (
        <Text variant="body" as="p" ref={statusRef} role="status" tabIndex={-1}>
          <TextLink href={runHref(continuedBy.id)}>
            {t("by", { number: continuedBy.number })}
          </TextLink>
        </Text>
      )}
    </>
  );
}

const CONTINUE_BLOCKED_ID = "continue-blocked-reason";

function ContinueBlocked({
  agent,
  stopping,
  onStop,
  focusAfter,
}: {
  agent: "alive" | "unknown" | "checking";
  stopping: boolean;
  onStop: () => Promise<void>;
  focusAfter: () => void;
}) {
  const t = useTranslations("run.continue");
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");
  return (
    <>
      <Text variant="body" as="p" id={CONTINUE_BLOCKED_ID}>
        {t(`blocked.${agent}`)}
      </Text>
      {agent === "alive" && !stopping ? (
        <Actions>
          <Button
            busy={{ active: state === "sending", label: t("stopPending") }}
            onClick={() => {
              setState("sending");
              onStop().then(
                () => {
                  setState("idle");
                  focusAfter();
                },
                () => setState("failed"),
              );
            }}
          >
            {t("stop")}
          </Button>
        </Actions>
      ) : null}
      {state === "failed" ? <ActionFailedText text={t("stopFailed")} /> : null}
    </>
  );
}

function ContinueRun({
  offer,
  onContinue,
}: {
  offer: ContinueOffer;
  onContinue: (message: string) => Promise<void>;
}) {
  const t = useTranslations("run.continue");
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");
  const [invalid, setInvalid] = useState<string | null>(null);
  const sending = state === "sending";
  const submit = (): void => {
    if (sending) return;
    const text = message.trim();
    const length = Array.from(text).length;
    if (length === 0) {
      setInvalid(t("messageRequired"));
      return;
    }
    if (length > CONTINUE_MESSAGE_MAX_LENGTH) {
      setInvalid(t("messageTooLong", { max: CONTINUE_MESSAGE_MAX_LENGTH, count: length }));
      return;
    }
    setInvalid(null);
    setState("sending");
    onContinue(text).then(
      () => {
        setState("idle");
        setMessage("");
        setOpen(false);
      },
      () => setState("failed"),
    );
  };
  const sends = [
    ...(offer.hasReport ? [t("sendsReport", { source: offer.sourceNumber })] : []),
    ...(offer.hasWorkspaceBrief ? [t("sendsBrief")] : []),
    t("sendsProtocol"),
  ];
  return (
    <Dialog
      trigger={t("trigger")}
      triggerVariant="secondary"
      title={t("title")}
      open={open}
      onOpenChange={(next) => {
        if (sending) return;
        setOpen(next);
        if (!next) {
          setInvalid(null);
          setState("idle");
        }
      }}
      scrollBody
      status={state === "failed" ? <ActionFailedText text={t("failed")} /> : undefined}
      actions={
        <>
          <DialogClose>{t("dismiss")}</DialogClose>
          <Button
            variant="primary"
            busy={{ active: sending, label: t("sending") }}
            onClick={submit}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <DefinitionList>
        <DefinitionItem label={t("where")}>
          {t(`place.${offer.place}`, { runner: offer.runnerName ?? t("noRunner") })}
        </DefinitionItem>
        <DefinitionItem label={t("newRun")}>
          {t("newRunValue", {
            next: offer.nextNumber,
            source: offer.sourceNumber,
            digit: offer.sourceNumber % 10,
          })}
        </DefinitionItem>
        <DefinitionItem label={t("sendsLabel")}>{sends.join(" · ")}</DefinitionItem>
      </DefinitionList>
      {offer.place === "recreated" ? (
        <Text variant="meta" as="p">
          {t("branchGoneNote")}
        </Text>
      ) : null}
      <Field label={t("messageLabel")} {...(invalid === null ? {} : { error: invalid })}>
        <Textarea name="continue-message" rows={4} value={message} onValueChange={setMessage} />
      </Field>
    </Dialog>
  );
}

function ActionFailedText({ text }: { text: string }) {
  return (
    <Text variant="ui" as="p" tone="problem" role="alert">
      {text}
    </Text>
  );
}

function ControlRun({
  control,
  variant,
  onControl,
  focusAfter,
}: {
  control: RunControl;
  variant: "primary" | "secondary";
  onControl: RunDetailActions["onControl"];
  focusAfter: () => void;
}) {
  const t = useTranslations("run.control");
  const domain = useTranslations("domain");
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");
  return (
    <>
      <Button
        variant={variant}
        aria-disabled={state === "sending"}
        aria-busy={state === "sending"}
        onClick={() => {
          if (state === "sending") return;
          setState("sending");
          onControl(control).then(
            (outcome) => {
              setState("idle");
              if (outcome === "state-changed") {
                showToast(domain("runControlFailure.state-changed"));
              }
              focusAfter();
            },
            () => setState("failed"),
          );
        }}
      >
        {t(control)}
      </Button>
      {state === "failed" ? <ActionFailed /> : null}
    </>
  );
}

function useControlFailure(control: RunControlView | null): string | null {
  const t = useTranslations("run.control");
  const domain = useTranslations("domain");
  if (control?.status !== "failed") return null;
  return t(control.control === "pause" ? "pauseFailed" : "resumeFailed", {
    reason: domain(`runControlFailure.${control.reason}`),
  });
}

export function timelineRows(
  events: ReadonlyArray<TimelineEvent>,
): ReadonlyArray<{ key: string; event: TimelineEvent }> {
  const seen = new Map<string, number>();
  return events.map((event) => {
    const identity = `${event.kind}:${event.at}`;
    const occurrence = seen.get(identity) ?? 0;
    seen.set(identity, occurrence + 1);
    return { key: `${identity}:${occurrence}`, event };
  });
}

function Timeline({
  runId,
  events,
  now,
  report,
}: {
  runId: string;
  events: ReadonlyArray<TimelineEvent>;
  now: string;
  report: string | null;
}) {
  const t = useTranslations("run.timeline");
  const reportText = useTranslations("run.report");
  const domain = useTranslations("domain");
  const laterPr = useTranslations("run.laterPr");
  const { stamp } = useTime();
  const deliveryText = useDeliveryText();
  const toolName = (tool: string): string => (isMcpRunTool(tool) ? t(`mcpTool.${tool}`) : tool);
  const eventTitle = (event: TimelineEvent): string =>
    event.kind === "mcp"
      ? t("mcp", { client: event.client })
      : event.kind === "continued-from" || event.kind === "continued-by"
        ? t(event.kind, { number: event.runNumber, digit: event.runNumber % 10 })
        : t(event.kind);
  const eventDetail = (event: TimelineEvent): string | null => {
    switch (event.kind) {
      case "mcp":
        if (event.outcome === "done") return toolName(event.tool);
        return isMcpRejectReason(event.reason)
          ? t("mcpRejected", {
              tool: toolName(event.tool),
              reason: t(`mcpReason.${event.reason}`),
            })
          : t("mcpRejectedUnknown", { tool: toolName(event.tool) });
      case "operator-message":
        return event.delivery.status === "sent"
          ? event.body
          : `${event.body}\n${deliveryText(event.delivery)}`;
      case "question":
      case "human-check":
      case "answer":
      case "permission":
        return event.body;
      case "denied":
        return event.body === "" ? null : event.body;
      case "ended":
        return domain(`agentResult.${event.agentResult}`);
      case "later-pr":
        return laterPr(event.state);
      case "assigned":
      case "started":
      case "waiting-for-input":
      case "resumed":
      case "paused":
      case "unpaused":
      case "unreachable":
      case "disconnected":
      case "reconnected":
      case "cancel-requested":
      case "continued-from":
      case "continued-by":
        return null;
    }
  };
  return (
    <Block title={t("title")} compact>
      <ol {...stylex.props(styles.timeline, styles.motionTimeline)}>
        <MotionList
          as="li"
          enter="rise"
          items={timelineRows(events)}
          getKey={(row) => row.key}
          itemGap="row"
          resetKey={runId}
        >
          {({ event }) => {
            const detail = eventDetail(event);
            return (
              <Row
                trailing={
                  <time dateTime={event.at} {...stylex.props(textStyles("meta"))}>
                    {stamp(event.at, now)}
                  </time>
                }
              >
                <span {...stylex.props(styles.eventBody)}>
                  <Text variant="ui" tone="strong">
                    {eventTitle(event)}
                  </Text>
                  {detail === null ? null : (
                    <Text variant="meta" wrap="pre">
                      {detail}
                    </Text>
                  )}
                  {event.kind !== "ended" ? null : report === null ? (
                    <Text variant="meta">{reportText("none")}</Text>
                  ) : (
                    <CodeBlock scroll label={reportText("label")}>
                      {report}
                    </CodeBlock>
                  )}
                </span>
              </Row>
            );
          }}
        </MotionList>
      </ol>
    </Block>
  );
}

function LogTail({
  log,
  now,
  stalled,
  onRefresh,
}: {
  log: LogTailView;
  now: string;
  stalled: boolean;
  onRefresh: RunDetailActions["onRefreshLog"];
}) {
  const t = useTranslations("run.log");
  const [refresh, setRefresh] = useState<"idle" | "refreshing" | "failed">("idle");
  const refreshing = refresh === "refreshing";
  const { ago } = useTime();
  const time = (at: string): string => ago(at, Date.parse(now) - Date.parse(at));
  let note: string | undefined;
  let body: ReactNode;
  switch (log.kind) {
    case "none":
      body = <Text variant="meta">{t("none")}</Text>;
      break;
    case "pending":
      body = (
        <Text variant="meta" role="status">
          {t(stalled ? "stalled" : "pending")}
        </Text>
      );
      break;
    case "failed":
      note = time(log.at);
      body = <Text variant="body">{t("failed", { error: log.error })}</Text>;
      break;
    case "stored":
      note = t("stored", { count: log.lines.length });
      body = <LogLines lines={log.lines} />;
      break;
    case "done":
      note = t("fetched", { time: time(log.at), count: log.lines.length });
      body = <LogLines lines={log.lines} />;
      break;
  }
  const live = log.kind !== "none" && log.kind !== "stored";
  return (
    <Block
      title={t("title")}
      aside={
        live ? (
          <Button
            variant="ghost"
            aria-disabled={refreshing}
            onClick={() => {
              if (refreshing) return;
              setRefresh("refreshing");
              onRefresh().then(
                () => setRefresh("idle"),
                () => setRefresh("failed"),
              );
            }}
          >
            {refreshing ? t("refreshing") : t("refresh")}
          </Button>
        ) : undefined
      }
    >
      {note === undefined ? null : <Text variant="meta">{note}</Text>}
      {body}
      {refresh === "failed" ? (
        <Text variant="ui" as="p" tone="problem" role="alert">
          {t("refreshFailed")}
        </Text>
      ) : null}
    </Block>
  );
}

function LogLines({ lines }: { lines: ReadonlyArray<string> }) {
  const t = useTranslations("run.log");
  const ref = useRef<HTMLPreElement>(null);
  const text = lines.join("\n");
  useEffect(() => {
    const element = ref.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [text]);
  if (lines.length === 0) return <Text variant="meta">{t("empty")}</Text>;
  return (
    <CodeBlock ref={ref} scroll label={t("linesLabel")}>
      {text}
    </CodeBlock>
  );
}

function checksText(
  signals: PrSignalsView,
  total: number,
  t: ReturnType<typeof useTranslations<"run.pr">>,
): string {
  const names = signals.failedChecks.join(", ");
  if (signals.failedCount > 0) {
    return t(signals.checksTruncated ? "failedChecksPartial" : "failedChecks", {
      total,
      failed: signals.failedCount,
      names,
    });
  }
  return signals.ciFailed ? t("someChecksFailed", { total }) : t("checks", { total });
}

function Properties({
  run,
  runnerHref,
}: {
  run: RunDetail;
  runnerHref: (runnerId: RunnerId) => string;
}) {
  const agentName = useAgentName();
  const t = useTranslations("run.props");
  const root = useTranslations("run");
  const { duration } = useTime();
  const separator = root("metaSeparator");

  return (
    <Card label={t("label")}>
      <DefinitionList>
        <DefinitionItem label={t("runner")} empty={run.runner === null}>
          {run.runner === null ? (
            t("noRunner")
          ) : (
            <span {...stylex.props(styles.inline)}>
              <TextLink href={runnerHref(run.runner.id)}>{run.runner.name}</TextLink>
              {run.runner.online ? null : <Text variant="meta">{t("runnerOffline")}</Text>}
            </span>
          )}
        </DefinitionItem>
        <DefinitionItem label={t("agentModel")}>
          {[agentName(run.agent), run.model ?? t("defaultModel")].join(separator)}
        </DefinitionItem>
        <DefinitionItem label={t("waitedExecuted")}>
          {[
            duration(run.waitMs),
            run.executionMs === null ? t("notStarted") : duration(run.executionMs),
          ].join(separator)}
        </DefinitionItem>
        {run.worktree === null ? null : (
          <DefinitionItem label={t("worktree")}>
            <Text variant="ui" tone="strong" mono>
              {run.worktree}
            </Text>
          </DefinitionItem>
        )}
      </DefinitionList>
      {run.brief === null ? null : <SentBrief brief={run.brief} />}
    </Card>
  );
}

function OtherRuns({ run, runHref }: { run: RunDetail; runHref: (runId: string) => string }) {
  const t = useTranslations("run.otherRuns");
  const { ago } = useTime();
  const statusName = useStatusName();
  if (run.otherRuns.length === 0) return null;
  return (
    <Block title={t("title")} compact>
      <ol {...stylex.props(styles.timeline)}>
        {run.otherRuns.map((o) => {
          const status = runStatus(o);
          return (
            <li key={o.id}>
              <Row trailing={<StatusPill status={status}>{statusName(status)}</StatusPill>}>
                <a href={runHref(o.id)} {...stylex.props(linkStyles())}>
                  {ago(o.assignedAt, Date.parse(run.now) - Date.parse(o.assignedAt))}
                </a>
              </Row>
            </li>
          );
        })}
      </ol>
    </Block>
  );
}

function useStatusLine(): (run: RunDetail) => { status: PillStatus; when: string } {
  const t = useTranslations("run.when");
  const root = useTranslations("run");
  const domain = useTranslations("domain");
  const { ago, duration, elapsed } = useTime();
  return (run) => {
    const { status } = run;
    switch (status.state) {
      case "ended": {
        const endedAt = run.endedAt ?? run.now;
        const timing =
          run.startedAt === null
            ? [t("endedBeforeStart", { duration: duration(run.waitMs) })]
            : [
                t("endedAgo", { time: ago(endedAt, Date.parse(run.now) - Date.parse(endedAt)) }),
                t("took", { duration: duration(run.executionMs ?? 0) }),
              ];
        return {
          status: runStatus(status),
          when: [...timing, domain(`agentResult.${status.agentResult}`)].join(
            root("metaSeparator"),
          ),
        };
      }
      case "queued":
        return {
          status: runStatus(status),
          when: t("waitingFor", { duration: duration(run.waitMs) }),
        };
      case "running":
      case "waiting-for-input":
      case "disconnected":
        return { status: runStatus(status), when: elapsed(run.executionMs ?? 0) };
      case "paused":
        return {
          status: runStatus(status),
          when:
            status.pausedSince === null
              ? ""
              : t("pausedFor", {
                  duration: duration(
                    Math.max(0, Date.parse(run.now) - Date.parse(status.pausedSince)),
                  ),
                }),
        };
    }
  };
}

const styles = stylex.create({
  blockerWait: { display: "flex", flexDirection: "column", gap: space.s3 },
  noticeBody: { display: "flex", flexDirection: "column", gap: space.s4 },
  main: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    maxWidth: size.detailPageWidth,
    paddingTop: space.s6,
    paddingInline: { default: space.s8, [breakpoints.narrowScreen]: space.s4 },
    paddingBottom: space.s10,
  },
  crumb: { display: "flex" },
  crumbLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: size.control,
  },
  head: { display: "flex", flexDirection: "column", gap: space.s2 },
  stateRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  stateLine: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s1,
    margin: 0,
  },
  statusOwnLine: { flexBasis: "100%" },
  band: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s4,
  },
  bandText: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0, flexShrink: 1 },
  prHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: space.s3 },
  prHeadEnd: {
    display: "inline-flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: space.s3,
    marginInlineStart: "auto",
  },
  columns: {
    display: "grid",
    gridTemplateColumns: {
      default: `minmax(0, 1fr) ${size.detailAsideWidth}`,
      [breakpoints.detailStacked]: "minmax(0, 1fr)",
    },
    alignItems: "start",
    gap: space.s6,
  },
  column: { display: "flex", flexDirection: "column", gap: space.s6, minWidth: 0 },
  blockHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  blockHeadCompact: { paddingTop: space.s2, paddingInline: space.s3, paddingBottom: space.s1 },
  stack: { display: "flex", flexDirection: "column", gap: space.s3 },
  flat: { margin: 0 },
  inline: { display: "inline-flex", alignItems: "baseline", gap: space.s2 },
  answerRow: { display: "flex", alignItems: "center", gap: space.s2 },
  grow: { flexGrow: 1, minWidth: 0 },
  timeline: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  motionTimeline: { gap: 0, marginBottom: `calc(${space.px2} * -1)` },
  eventBody: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
});
