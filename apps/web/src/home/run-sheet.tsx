import * as stylex from "@stylexjs/stylex";
import {
  Button,
  CodeBlock,
  DefinitionItem,
  DefinitionList,
  ExternalIconLink,
  Field,
  Input,
  PanelSection,
  Sheet,
  StatusPill,
  Text,
  TextLink,
  buttonStyles,
  textStyles,
} from "@ganger/ui";
import type { PillStatus } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import type { HomeRun, InputWait } from "@ganger/app/home/model";
import { todoTagOf } from "@ganger/app/home/model";
import { availableRunControl } from "@ganger/app/run-control-view";
import type { RunControl } from "@ganger/core";
import { HumanCheckAnswer } from "../question/human-check-answer";
import { QuestionAnswer } from "../question/question-answer";
import { runTicketHref } from "../run-ticket-href";
import type { SheetMode } from "./run-card";
import { RunKey, cardStatus, runHref, ticketHref, useRunText } from "./run-text";
import type { AnswerInput, DenyInput, HumanCheckInput } from "./home-screen";
import { answerRejection, denyRejection } from "./rejection";
import type { AnswerRejectReason, DenyRejectReason } from "./rejection";

type Permission = Extract<InputWait, { kind: "permission" }>;

type SendState = "idle" | "sending" | "failed";

export interface SheetTarget {
  run: HomeRun;
  tagged: boolean;
  mode: SheetMode;
}

export type SheetSent = "answered" | "confirmed" | "changes-requested" | "denied";

export type SheetSentHandler = (run: HomeRun, sent: SheetSent) => void;

export function RunSheet({
  target,
  open,
  onOpenChange,
  finalFocus,
  all,
  onAnswer,
  onHumanCheck,
  onDeny,
  onSent,
  onControl,
}: {
  target: SheetTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | null;
  all: boolean;
  onAnswer: (input: AnswerInput) => Promise<void>;
  onHumanCheck: (input: HumanCheckInput) => Promise<void>;
  onDeny: (input: DenyInput) => Promise<void>;
  onSent: SheetSentHandler;
  onControl: SheetControl;
}) {
  const t = useTranslations("home.sheet");
  if (target === null) return null;
  const { run, tagged } = target;
  const tag = tagged ? todoTagOf(run) : null;
  const status = cardStatus(run, tag);
  const inputKind = run.state === "waiting-for-input" ? run.input?.kind : undefined;
  const initialFocus =
    target.mode !== "answer"
      ? undefined
      : inputKind === "question"
        ? '[data-question] input[type="radio"], [data-question] textarea'
        : inputKind === "human-check"
          ? "[data-human-check] textarea"
          : undefined;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      status={<SheetStatus run={run} status={status} />}
      title={<RunKey run={run} size="panel" />}
      closeLabel={t("close")}
      {...(initialFocus === undefined ? {} : { initialFocus })}
      finalFocus={finalFocus}
    >
      <div key={run.id} {...stylex.props(styles.body)}>
        <SheetBody
          run={run}
          tagged={tag !== null}
          onAnswer={onAnswer}
          onHumanCheck={onHumanCheck}
          onDeny={onDeny}
          onSent={onSent}
          onControl={onControl}
        />
        <RunFacts run={run} all={all} />
        <div>
          <TextLink href={runHref(run)}>{t("runDetail")}</TextLink>
        </div>
      </div>
    </Sheet>
  );
}

function SheetStatus({ run, status }: { run: HomeRun; status: PillStatus }) {
  const t = useTranslations("home.sheet");
  const { statusName } = useRunText();
  const { ago, elapsed } = useTime();
  const since = ((): string | null => {
    switch (run.state) {
      case "queued":
        return t("since.waiting", { elapsed: elapsed(run.waitMs) });
      case "running":
        return run.executionMs === null
          ? null
          : t("since.running", { elapsed: elapsed(run.executionMs) });
      case "paused":
        return run.pausedMs === null ? null : t("since.paused", { elapsed: elapsed(run.pausedMs) });
      case "waiting-for-input":
        return run.waitingMs === null
          ? null
          : t("since.waiting", { elapsed: elapsed(run.waitingMs) });
      case "disconnected":
        return null;
      case "ended":
        return t("since.ended", { ago: ago(run.endedAt, run.endedAgoMs) });
    }
  })();
  return (
    <>
      <StatusPill status={status}>{statusName(status)}</StatusPill>
      {since === null ? null : <span>{since}</span>}
    </>
  );
}

function SheetBody({
  run,
  tagged,
  onAnswer,
  onHumanCheck,
  onDeny,
  onSent,
  onControl,
}: {
  run: HomeRun;
  tagged: boolean;
  onAnswer: (input: AnswerInput) => Promise<void>;
  onHumanCheck: (input: HumanCheckInput) => Promise<void>;
  onDeny: (input: DenyInput) => Promise<void>;
  onSent: SheetSentHandler;
  onControl: SheetControl;
}) {
  const t = useTranslations("home.sheet");
  const text = useRunText();
  switch (run.state) {
    case "queued":
      return <Text variant="body">{text.queued(run)}</Text>;
    case "running":
      return (
        <ControlBlock run={run} onControl={onControl}>
          {t("running")}
        </ControlBlock>
      );
    case "paused":
      return (
        <ControlBlock run={run} onControl={onControl}>
          {t(`paused.${run.pauseSource}`)}
        </ControlBlock>
      );
    case "disconnected":
      return (
        <Block>
          <Text variant="body">{text.unreachable(run)}</Text>
          <Text variant="ui" tone="muted" as="p">
            {t("disconnected")}
          </Text>
        </Block>
      );
    case "waiting-for-input": {
      const input = run.input;
      if (input === null) return <Text variant="body">{t("inputUnknown")}</Text>;
      switch (input.kind) {
        case "question":
          return <AnswerBlock run={run} question={input} onAnswer={onAnswer} onSent={onSent} />;
        case "human-check":
          return (
            <HumanCheckBlock
              key={input.questionId}
              run={run}
              check={input}
              onHumanCheck={onHumanCheck}
              onSent={onSent}
            />
          );
        case "permission":
          return <DenyBlock run={run} permission={input} onDeny={onDeny} onSent={onSent} />;
      }
      return null;
    }
    case "ended":
      if (tagged && run.summary === "failed") return <FailedBlock run={run} />;
      return <EndedBlock run={run} />;
  }
}

type SheetControl = (
  run: HomeRun,
  control: RunControl,
  focusAfter?: () => void,
) => Promise<boolean>;

function ControlBlock({
  run,
  onControl,
  children,
}: {
  run: HomeRun;
  onControl: SheetControl;
  children: ReactNode;
}) {
  const t = useTranslations("home");
  const domain = useTranslations("domain");
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [sending, setSending] = useState(false);
  const [rejected, setRejected] = useState(false);
  const control = run.control;
  const available = availableRunControl(run.state, run.cancelling, control);
  const pending =
    control?.status === "pending"
      ? t(control.control === "pause" ? "card.pausing" : "card.resuming")
      : null;
  const failure = rejected
    ? t("card.requestFailed")
    : control?.status === "failed"
      ? t(control.control === "pause" ? "card.pauseFailed" : "card.resumeFailed", {
          reason: domain(`runControlFailure.${control.reason}`),
        })
      : null;
  return (
    <Block>
      <Text variant="body">{children}</Text>
      <div {...stylex.props(styles.controlGroup)}>
        <Text
          variant="ui"
          as="p"
          ref={statusRef}
          role="status"
          tabIndex={-1}
          {...(failure === null ? { tone: "muted" as const } : { tone: "problem" as const })}
        >
          {failure ?? pending}
        </Text>
        {available === null ? null : (
          <div {...stylex.props((failure ?? pending) !== null && styles.controlBelowStatus)}>
            <Button
              variant={available === "resume" ? "primary" : "secondary"}
              aria-disabled={sending}
              aria-busy={sending}
              onClick={() => {
                if (sending) return;
                setSending(true);
                setRejected(false);
                void onControl(run, available, () => statusRef.current?.focus())
                  .then((reached) => setRejected(!reached))
                  .finally(() => setSending(false));
              }}
            >
              {t(available === "resume" ? "card.resume" : "card.pause")}
            </Button>
          </div>
        )}
      </div>
    </Block>
  );
}

function Block({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.block)}>{children}</div>;
}

function FailedBlock({ run }: { run: HomeRun & { state: "ended" } }) {
  const t = useTranslations("home.sheet");
  const text = useRunText();
  return (
    <Block>
      <Text variant="body">{t("failed")}</Text>
      <DefinitionList>
        <DefinitionItem label={t("agentResult")}>{text.agentResult(run)}</DefinitionItem>
        <DefinitionItem label={t("prState")}>{text.prState(run)}</DefinitionItem>
      </DefinitionList>
      <div>
        <a
          href={ticketHref(run)}
          data-variant="secondary"
          {...stylex.props(...buttonStyles("secondary"))}
        >
          {t("retry")}
        </a>
      </div>
    </Block>
  );
}

function EndedBlock({ run }: { run: HomeRun & { state: "ended" } }) {
  const t = useTranslations("home.sheet");
  const text = useRunText();
  return (
    <DefinitionList>
      <DefinitionItem label={t("agentResult")}>{text.agentResult(run)}</DefinitionItem>
      <DefinitionItem label={t("prState")}>{text.prState(run)}</DefinitionItem>
    </DefinitionList>
  );
}

function RunFacts({ run, all }: { run: HomeRun; all: boolean }) {
  const t = useTranslations("home.sheet");
  const text = useRunText();
  return (
    <DefinitionList>
      <DefinitionItem label={t("ticket")}>
        <span {...stylex.props(styles.ticketLine)}>
          <span {...stylex.props(styles.ticketText)}>
            {t("ticketValue", { key: run.ticketKey, project: run.trackerProject })}
          </span>
          <span {...stylex.props(styles.ticketLinkSlot)}>
            <ExternalIconLink
              href={runTicketHref(run.id)}
              label={`${t("openInTracker")} (${t("newTab")})`}
            />
          </span>
        </span>
      </DefinitionItem>
      {all ? <DefinitionItem label={t("workspace")}>{run.workspace.name}</DefinitionItem> : null}
      <DefinitionItem label={t("runner")} empty={run.runner === null}>
        {run.runner?.name ?? t("noRunner")}
      </DefinitionItem>
      <DefinitionItem label={t("agent")}>{text.agentName(run.agent)}</DefinitionItem>
    </DefinitionList>
  );
}

function useRejectionFocus(rejected: boolean) {
  const resultRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (rejected) resultRef.current?.focus();
  }, [rejected]);
  return resultRef;
}

function ResultText({
  resultRef,
  children,
}: {
  resultRef: RefObject<HTMLSpanElement | null>;
  children: string;
}) {
  return (
    <span
      ref={resultRef}
      role="status"
      tabIndex={-1}
      {...stylex.props(textStyles("body"), styles.result)}
    >
      {children}
    </span>
  );
}

function AnswerBlock({
  run,
  question,
  onAnswer,
  onSent,
}: {
  run: HomeRun;
  question: Extract<InputWait, { kind: "question" }>;
  onAnswer: (input: AnswerInput) => Promise<void>;
  onSent: SheetSentHandler;
}) {
  const t = useTranslations("home.question");
  const [rejected, setRejected] = useState<AnswerRejectReason | null>(null);
  const resultRef = useRejectionFocus(rejected !== null);
  return (
    <PanelSection title={t("title")}>
      {rejected !== null ? (
        <ResultText resultRef={resultRef}>{t(`rejected.${rejected}`)}</ResultText>
      ) : question.answered ? (
        <ResultText resultRef={resultRef}>{t("answered")}</ResultText>
      ) : (
        <QuestionAnswer
          body={question.body}
          options={question.choices}
          onSend={async (answer) => {
            try {
              await onAnswer({ runId: run.id, questionId: question.questionId, answer });
            } catch (error) {
              const reason = answerRejection(error);
              if (reason === null) throw error;
              setRejected(reason);
              return;
            }
            onSent(run, "answered");
          }}
        />
      )}
    </PanelSection>
  );
}

function HumanCheckBlock({
  run,
  check,
  onHumanCheck,
  onSent,
}: {
  run: HomeRun;
  check: Extract<InputWait, { kind: "human-check" }>;
  onHumanCheck: (input: HumanCheckInput) => Promise<void>;
  onSent: SheetSentHandler;
}) {
  const t = useTranslations("home.humanCheck");
  const [rejected, setRejected] = useState<AnswerRejectReason | null>(null);
  const resultRef = useRejectionFocus(rejected !== null);
  return (
    <PanelSection title={t("title")}>
      {rejected !== null ? (
        <ResultText resultRef={resultRef}>{t(`rejected.${rejected}`)}</ResultText>
      ) : check.answered ? (
        <ResultText resultRef={resultRef}>{t("answered")}</ResultText>
      ) : (
        <HumanCheckAnswer
          body={check.body}
          onSend={async (decision, note) => {
            try {
              await onHumanCheck({ runId: run.id, questionId: check.questionId, decision, note });
            } catch (error) {
              const reason = answerRejection(error);
              if (reason === null) throw error;
              setRejected(reason);
              return;
            }
            onSent(run, decision);
          }}
        />
      )}
    </PanelSection>
  );
}

function DenyBlock({
  run,
  permission,
  onDeny,
  onSent,
}: {
  run: HomeRun;
  permission: Permission;
  onDeny: (input: DenyInput) => Promise<void>;
  onSent: SheetSentHandler;
}) {
  const t = useTranslations("home.permission");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const [rejected, setRejected] = useState<DenyRejectReason | null>(null);
  const resultRef = useRejectionFocus(rejected !== null);
  if (rejected !== null)
    return <ResultText resultRef={resultRef}>{t(`rejected.${rejected}`)}</ResultText>;
  if (permission.denied) return <ResultText resultRef={resultRef}>{t("denied")}</ResultText>;
  const sending = state === "sending";
  return (
    <form
      {...stylex.props(styles.block)}
      onSubmit={(event) => {
        event.preventDefault();
        if (sending) return;
        setState("sending");
        onDeny({ runId: run.id, promptId: permission.promptId, reason: reason.trim() }).then(
          () => {
            setState("idle");
            onSent(run, "denied");
          },
          (error: unknown) => {
            const reason = denyRejection(error);
            if (reason === null) {
              setState("failed");
              return;
            }
            setState("idle");
            setRejected(reason);
          },
        );
      }}
    >
      <CodeBlock>{permission.detail}</CodeBlock>
      <Text variant="body">{t("allowOnRunner")}</Text>
      <Field
        label={t("reasonLabel")}
        description={t("reasonDescription")}
        error={state === "failed" ? t("failed") : undefined}
      >
        <Input name="reason" value={reason} onValueChange={setReason} autoComplete="off" />
      </Field>
      <div {...stylex.props(styles.foot)}>
        <Button variant="danger" type="submit" disabled={sending}>
          {sending ? t("denying") : t("send")}
        </Button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s6, minWidth: 0 },
  block: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  controlGroup: { display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0 },
  controlBelowStatus: { paddingTop: space.s2 },
  foot: { display: "flex", justifyContent: "flex-end", gap: space.s3 },
  result: { outline: "none" },
  ticketLine: { display: "flex", alignItems: "flex-start", gap: space.s2, minWidth: 0 },
  ticketText: { minWidth: 0, overflowWrap: "anywhere" },
  ticketLinkSlot: { display: "flex", alignItems: "center", flexShrink: 0, height: "1lh" },
});
