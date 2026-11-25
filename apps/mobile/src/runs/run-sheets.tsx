import { V1_CONTINUE_MESSAGE_MAX_LENGTH, V1_TEXT_MAX_LENGTH } from "@ganger/api";
import type {
  AppPrReadDiagnosis,
  AppRunDetail,
  AppRunInput,
  AppRunRefusal,
  AppPrMerge,
  V1HumanCheckDecision,
  V1MergeMethod,
} from "@ganger/api";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { AccessibilityInfo, Linking, StyleSheet, View } from "react-native";

import { staleBandText } from "../connection/stale-band";
import type { DashboardRun } from "../dashboard/model";
import { prProblemLabel, prProblemTone } from "../dashboard/run-card";
import {
  Button,
  Card,
  Chip,
  ExternalLink,
  NoticeBand,
  RadioRow,
  RaisedBox,
  Sheet,
  SheetBody,
  SheetFooter,
  SplitButton,
  TextField,
} from "../design/components";
import type { ChipTone } from "../design/components";
import { Text, TextLink } from "../design/text";
import type { TextTone } from "../design/text";
import { space } from "../design/tokens";
import { agentName, formatAgo } from "../format";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { bodyParts, isWebLink } from "./body-parts";
import type { RunPort, RunRead, RunWrite, RunWriteOutcome } from "./run-port";

export type OpenRunSheet =
  | {
      kind: "answer" | "human-check" | "deny" | "cancel" | "detail" | "menu" | "retry";
      run: DashboardRun;
    }
  | { kind: "notice"; title: string; message: string };

function refusalKey(action: RunWrite["action"], reason: AppRunRefusal): MessageKey {
  if (action === "merge" && reason === "request-reused") {
    return "actions.refused.merge.request-reused";
  }
  if (action === "answer" && (reason === "already-answered" || reason === "not-found")) {
    return `actions.refused.answer.${reason}`;
  }
  if (action === "human-check" && (reason === "already-answered" || reason === "not-found")) {
    return `actions.refused.humanCheck.${reason}`;
  }
  if (action === "deny" && (reason === "already-denied" || reason === "resolved")) {
    return `actions.refused.deny.${reason}`;
  }
  if (action === "deny" && reason === "not-found") return "actions.refused.deny.not-found";
  switch (reason) {
    case "not-found":
    case "already-ended":
    case "not-paused":
    case "cancelling":
    case "request-reused":
    case "active-run":
    case "previous-agent":
    case "cannot-assign":
    case "unknown":
      return `actions.refused.run.${reason}`;
    case "already-answered":
    case "already-denied":
    case "resolved":
    case "state-changed":
      return "actions.refused.run.state-changed";
    case "no-write-access":
    case "blocked":
    case "head-changed":
    case "method-not-allowed":
    case "not-open":
    case "no-pull-request":
    case "pr-not-found":
    case "no-code-host":
    case "unauthorized":
    case "rate-limited":
    case "network":
    case "superseded":
      return `actions.refused.merge.${reason}`;
  }
}

export function outcomeMessage(
  action: RunWrite["action"],
  outcome: RunWriteOutcome,
): string | null {
  switch (outcome.kind) {
    case "sent":
      return null;
    case "demo":
      return t("common.demoAction");
    case "refused":
      return action === "merge" && outcome.reason === "blocked" && outcome.message !== undefined
        ? t("actions.refused.merge.blockedBecause", { message: outcome.message })
        : t(refusalKey(action, outcome.reason));
    case "unconfirmed":
      return t("actions.unconfirmed");
    case "failed":
      return t(`actions.failed.${outcome.cause}`);
  }
}

const SendingLock = createContext<RefObject<boolean>>({ current: false });

function useCloseUnlessSending(onClose: () => void): () => void {
  const sending = useContext(SendingLock);
  return () => {
    if (!sending.current) onClose();
  };
}

type WritePhase = "idle" | "sending" | "confirming";

function busyLabelOf(phase: WritePhase): string | null {
  switch (phase) {
    case "idle":
      return null;
    case "sending":
      return t("actions.sending");
    case "confirming":
      return t("actions.confirming");
  }
}

interface UnconfirmedWrite {
  value: boolean;
  set: (value: boolean) => void;
}

function useRunWrite(
  port: RunPort,
  run: DashboardRun,
  onSent: () => void,
  disabled: boolean,
  sharedUnconfirmed?: UnconfirmedWrite,
) {
  const [phase, setPhase] = useState<WritePhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [ownUnconfirmed, setOwnUnconfirmed] = useState(false);
  const unconfirmed = sharedUnconfirmed?.value ?? ownUnconfirmed;
  const setUnconfirmed = sharedUnconfirmed?.set ?? setOwnUnconfirmed;
  const [messageTone, setMessageTone] = useState<TextTone>("problem");
  const busy = useContext(SendingLock);
  const send = async (write: RunWrite): Promise<RunWriteOutcome | null> => {
    if (busy.current) return null;
    busy.current = true;
    setPhase("sending");
    setMessage(null);
    const outcome = await port.write(run, write, () => {
      setPhase("confirming");
      AccessibilityInfo.announceForAccessibility(t("actions.confirming"));
    });
    busy.current = false;
    setPhase("idle");
    if (outcome.kind === "sent") {
      onSent();
      return outcome;
    }
    setRefused(outcome.kind === "refused");
    if (outcome.kind === "unconfirmed") setUnconfirmed(true);
    setMessageTone(outcome.kind === "demo" ? "secondary" : "problem");
    setMessage(outcomeMessage(write.action, outcome));
    return outcome;
  };
  return {
    sending: phase !== "idle",
    busyLabel: busyLabelOf(phase),
    message: unconfirmed
      ? t(disabled ? "actions.unconfirmed" : "actions.unconfirmedRead")
      : message,
    messageTone: unconfirmed ? "secondary" : messageTone,
    locked: refused || unconfirmed,
    unconfirmed,
    send,
  };
}

interface RunDetailView {
  read: RunRead<AppRunDetail> | null;
  fresh: boolean;
  staleNotice: string | null;
}

function cachedView(port: RunPort, run: DashboardRun, useCache: boolean): RunDetailView {
  const cached = useCache ? (port.cachedDetail?.(run) ?? null) : null;
  return {
    read: cached === null ? null : { kind: "ok", value: cached.data },
    fresh: false,
    staleNotice: null,
  };
}

function useRunDetail(
  port: RunPort,
  run: DashboardRun,
  disabled: boolean,
  useCache = false,
): RunDetailView & { reload: () => void } {
  const [view, setView] = useState<RunDetailView>(() => cachedView(port, run, useCache));
  const [attempt, setAttempt] = useState(0);
  const wasDisabled = useRef(disabled);
  useEffect(() => {
    const reconnected = wasDisabled.current && !disabled;
    wasDisabled.current = disabled;
    if (reconnected && !view.fresh) setAttempt((current) => current + 1);
  }, [disabled, view.fresh]);
  useEffect(() => {
    let live = true;
    const cached = useCache ? (port.cachedDetail?.(run) ?? null) : null;
    void port.detail(run).then((next) => {
      if (!live) return;
      setView(
        next.kind === "unavailable" && cached !== null
          ? {
              read: { kind: "ok", value: cached.data },
              fresh: false,
              staleNotice: staleBandText(cached.fetchedAt, Date.now(), t("actions.cachedDetail")),
            }
          : { read: next, fresh: next.kind === "ok", staleNotice: null },
      );
    });
    return () => {
      live = false;
    };
  }, [port, run, attempt, useCache]);
  return { ...view, reload: () => setAttempt((current) => current + 1) };
}

async function openWebLink(url: string): Promise<boolean> {
  if (!isWebLink(url)) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

function ContextLine({ run }: { run: DashboardRun }) {
  return (
    <Text variant="meta" numberOfLines={1}>
      {run.ticketKey} {run.ticketTitle}
    </Text>
  );
}

function SheetMessage({ message, tone = "problem" }: { message: string | null; tone?: TextTone }) {
  if (message === null) return null;
  return (
    <Text variant="meta" tone={tone} accessibilityRole="alert">
      {message}
    </Text>
  );
}

function DetailGate({
  read,
  staleNotice,
  children,
}: {
  read: RunRead<AppRunDetail> | null;
  staleNotice: string | null;
  children: (detail: AppRunDetail) => ReactNode;
}) {
  if (read === null) {
    return (
      <SheetBody>
        <Text variant="meta">{t("actions.loading")}</Text>
      </SheetBody>
    );
  }
  switch (read.kind) {
    case "ok":
      return (
        <>
          {staleNotice === null ? null : <NoticeBand message={staleNotice} />}
          {children(read.value)}
        </>
      );
    case "not-found":
      return (
        <SheetBody>
          <SheetMessage message={t("actions.notFound")} />
        </SheetBody>
      );
    case "demo":
    case "unavailable":
      return (
        <SheetBody>
          <SheetMessage message={t("actions.loadFailed")} />
        </SheetBody>
      );
  }
}

type QuestionInput = Extract<AppRunInput, { kind: "question" }>;

function AnswerForm({
  run,
  input,
  port,
  disabled,
  onClose,
}: {
  run: DashboardRun;
  input: QuestionInput;
  port: RunPort;
  disabled: boolean;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<number | "other" | null>(
    input.choices.length === 0 ? "other" : null,
  );
  const [other, setOther] = useState("");
  const { sending, busyLabel, message, messageTone, locked, send } = useRunWrite(
    port,
    run,
    onClose,
    disabled,
  );
  const answer =
    picked === "other"
      ? other.trim()
      : picked === null
        ? ""
        : (input.choices[picked]?.answer ?? "");
  return (
    <>
      <SheetBody>
        <ContextLine run={run} />
        {input.lead.map((paragraph, index) => (
          <Text key={`${index}:${paragraph}`} variant="body" tone="primary">
            {paragraph}
          </Text>
        ))}
        {input.choices.length === 0 ? null : (
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t("actions.answer.choices")}
            style={styles.group}
          >
            {input.choices.map((choice, index) => (
              <RadioRow
                key={`${index}:${choice.answer}`}
                label={choice.text}
                selected={picked === index}
                onPress={() => setPicked(index)}
              />
            ))}
            <RadioRow
              label={t("actions.answer.other")}
              selected={picked === "other"}
              onPress={() => setPicked("other")}
            />
          </View>
        )}
        {input.after.map((paragraph, index) => (
          <Text key={`${index}:${paragraph}`} variant="meta">
            {paragraph}
          </Text>
        ))}
        {picked === "other" ? (
          <TextField
            multiline
            label={t("actions.answer.otherLabel")}
            placeholder={t("actions.answer.otherPlaceholder")}
            maxLength={V1_TEXT_MAX_LENGTH}
            value={other}
            onChangeText={setOther}
          />
        ) : null}
      </SheetBody>
      <SheetFooter>
        <SheetMessage message={message} tone={messageTone} />
        <Text variant="small">{t("actions.answer.irreversible")}</Text>
        <Button
          variant="primary"
          label={busyLabel ?? t("actions.answer.send")}
          disabled={disabled || sending || locked || answer === ""}
          onPress={() => void send({ action: "answer", questionId: input.questionId, answer })}
        />
      </SheetFooter>
    </>
  );
}

function RequestBody({ body }: { body: string }) {
  return (
    <Text variant="body" tone="primary">
      {bodyParts(body).map((part, index) =>
        part.kind === "link" ? (
          <TextLink key={index} label={part.value} onPress={() => void openWebLink(part.value)} />
        ) : (
          part.value
        ),
      )}
    </Text>
  );
}

type HumanCheckInput = Extract<AppRunInput, { kind: "human-check" }>;

function HumanCheckForm({
  run,
  input,
  port,
  disabled,
  onClose,
}: {
  run: DashboardRun;
  input: HumanCheckInput;
  port: RunPort;
  disabled: boolean;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const { sending, busyLabel, message, messageTone, locked, send } = useRunWrite(
    port,
    run,
    onClose,
    disabled,
  );
  const [pressed, setPressed] = useState<V1HumanCheckDecision | null>(null);
  const decide = (decision: V1HumanCheckDecision) => {
    setPressed(decision);
    void send({ action: "human-check", questionId: input.questionId, decision, note: note.trim() });
  };
  const labelOf = (decision: V1HumanCheckDecision, idle: string) =>
    pressed === decision ? (busyLabel ?? idle) : idle;
  const off = disabled || sending || locked;
  return (
    <>
      <SheetBody>
        <ContextLine run={run} />
        <RequestBody body={input.body} />
        <TextField
          multiline
          label={t("actions.humanCheck.noteLabel")}
          maxLength={V1_TEXT_MAX_LENGTH}
          value={note}
          onChangeText={setNote}
        />
      </SheetBody>
      <SheetFooter>
        <SheetMessage message={message} tone={messageTone} />
        <Text variant="small">{t("actions.humanCheck.after")}</Text>
        <Button
          variant="primary"
          label={labelOf("confirmed", t("actions.humanCheck.confirm"))}
          disabled={off}
          onPress={() => decide("confirmed")}
        />
        <Button
          label={labelOf("changes-requested", t("actions.humanCheck.requestChanges"))}
          disabled={off}
          onPress={() => decide("changes-requested")}
        />
      </SheetFooter>
    </>
  );
}

type PermissionInput = Extract<AppRunInput, { kind: "permission" }>;

function DenyForm({
  run,
  input,
  port,
  disabled,
  onClose,
}: {
  run: DashboardRun;
  input: PermissionInput;
  port: RunPort;
  disabled: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const { sending, busyLabel, message, messageTone, locked, send } = useRunWrite(
    port,
    run,
    onClose,
    disabled,
  );
  return (
    <>
      <SheetBody>
        <ContextLine run={run} />
        <Text variant="body" tone="primary">
          {input.detail}
        </Text>
        <Text variant="meta">{t("actions.deny.allowOnRunner")}</Text>
        <TextField
          multiline
          label={t("actions.deny.reasonLabel")}
          maxLength={V1_TEXT_MAX_LENGTH}
          value={reason}
          onChangeText={setReason}
        />
      </SheetBody>
      <SheetFooter>
        <SheetMessage message={message} tone={messageTone} />
        <Button
          variant="danger"
          label={busyLabel ?? t("actions.deny.send")}
          disabled={disabled || sending || locked}
          onPress={() =>
            void send({ action: "deny", promptId: input.promptId, reason: reason.trim() })
          }
        />
      </SheetFooter>
    </>
  );
}

function InputSheet({
  sheet,
  port,
  disabled,
  onClose,
}: {
  sheet: { kind: "answer" | "human-check" | "deny"; run: DashboardRun };
  port: RunPort;
  disabled: boolean;
  onClose: () => void;
}) {
  const { read, staleNotice } = useRunDetail(port, sheet.run, disabled);
  const closeSheet = useCloseUnlessSending(onClose);
  const { run, kind } = sheet;
  const title =
    kind === "answer"
      ? t("actions.answer.title")
      : kind === "human-check"
        ? t("actions.humanCheck.title")
        : t("actions.deny.title");
  return (
    <Sheet visible composed title={title} closeLabel={t("common.close")} onClose={closeSheet}>
      <DetailGate read={read} staleNotice={staleNotice}>
        {({ input }) => {
          if (kind === "answer" && input?.kind === "question" && !input.answered) {
            return (
              <AnswerForm
                key={input.questionId}
                run={run}
                input={input}
                port={port}
                disabled={disabled}
                onClose={onClose}
              />
            );
          }
          if (kind === "human-check" && input?.kind === "human-check" && !input.answered) {
            return (
              <HumanCheckForm
                key={input.questionId}
                run={run}
                input={input}
                port={port}
                disabled={disabled}
                onClose={onClose}
              />
            );
          }
          if (kind === "deny" && input?.kind === "permission" && !input.denied) {
            return (
              <DenyForm
                key={input.promptId}
                run={run}
                input={input}
                port={port}
                disabled={disabled}
                onClose={onClose}
              />
            );
          }
          const sameRequest =
            (kind === "answer" && input?.kind === "question") ||
            (kind === "human-check" && input?.kind === "human-check") ||
            (kind === "deny" && input?.kind === "permission");
          const handled: MessageKey = !sameRequest
            ? "actions.refused.run.state-changed"
            : kind === "answer"
              ? "actions.answer.handled"
              : kind === "human-check"
                ? "actions.humanCheck.handled"
                : "actions.deny.handled";
          return (
            <SheetBody>
              <ContextLine run={run} />
              <SheetMessage message={t(handled)} tone="secondary" />
            </SheetBody>
          );
        }}
      </DetailGate>
    </Sheet>
  );
}

function CancelConfirm({
  run,
  port,
  disabled,
  onClose,
}: {
  run: DashboardRun;
  port: RunPort;
  disabled: boolean;
  onClose: () => void;
}) {
  const { sending, busyLabel, message, messageTone, locked, send } = useRunWrite(
    port,
    run,
    onClose,
    disabled,
  );
  const closeSheet = useCloseUnlessSending(onClose);
  return (
    <>
      <ContextLine run={run} />
      <Text variant="body">{t("actions.cancel.body")}</Text>
      <SheetMessage message={message} tone={messageTone} />
      <Button
        variant="danger"
        label={busyLabel ?? t("actions.cancel.confirm")}
        disabled={disabled || sending || locked}
        onPress={() => void send({ action: "cancel" })}
      />
      <Button label={t("common.close")} disabled={sending} onPress={closeSheet} />
    </>
  );
}

function CancelSheet({
  run,
  port,
  disabled,
  onClose,
}: {
  run: DashboardRun;
  port: RunPort;
  disabled: boolean;
  onClose: () => void;
}) {
  const closeSheet = useCloseUnlessSending(onClose);
  return (
    <Sheet
      visible
      title={t("actions.cancel.title")}
      closeLabel={t("common.close")}
      onClose={closeSheet}
    >
      <CancelConfirm run={run} port={port} disabled={disabled} onClose={onClose} />
    </Sheet>
  );
}

function MenuSheet({
  run,
  port,
  disabled,
  onClose,
}: {
  run: DashboardRun;
  port: RunPort;
  disabled: boolean;
  onClose: () => void;
}) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<TextTone>("problem");
  const [opening, setOpening] = useState(false);
  const closeSheet = useCloseUnlessSending(onClose);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const openTicket = async () => {
    setOpening(true);
    setMessage(null);
    const link = await port.ticketLink(run);
    if (!mounted.current) return;
    const opened = link.kind === "ok" && (await openWebLink(link.value));
    if (!mounted.current) return;
    setOpening(false);
    if (opened) {
      onClose();
      return;
    }
    setMessageTone(link.kind === "demo" ? "secondary" : "problem");
    setMessage(link.kind === "demo" ? t("common.demoAction") : t("actions.menu.ticketFailed"));
  };
  return (
    <Sheet
      visible
      title={confirmingCancel ? t("actions.cancel.title") : run.ticketKey}
      closeLabel={t("common.close")}
      onClose={closeSheet}
    >
      {confirmingCancel ? (
        <CancelConfirm run={run} port={port} disabled={disabled} onClose={onClose} />
      ) : (
        <>
          <Button
            label={t("actions.menu.openTicket")}
            disabled={opening}
            onPress={() => void openTicket()}
          />
          {run.cancelling ? null : (
            <Button
              variant="danger"
              label={t("actions.menu.cancel")}
              disabled={disabled}
              onPress={() => setConfirmingCancel(true)}
            />
          )}
          <SheetMessage message={message} tone={messageTone} />
        </>
      )}
    </Sheet>
  );
}

function RetryForm({
  run,
  detail,
  port,
  disabled,
  sharedUnconfirmed,
  onContinue,
  onClose,
}: {
  run: DashboardRun;
  detail: AppRunDetail;
  port: RunPort;
  disabled: boolean;
  sharedUnconfirmed: UnconfirmedWrite;
  onContinue: () => void;
  onClose: () => void;
}) {
  const { sending, busyLabel, message, messageTone, locked, unconfirmed, send } = useRunWrite(
    port,
    run,
    onClose,
    disabled,
    sharedUnconfirmed,
  );
  const { retry, continue: continueOffer } = detail.nextActions;
  if (retry === "not-offered" || retry === "unknown") {
    return (
      <SheetBody>
        <ContextLine run={run} />
        <SheetMessage message={t("actions.refused.run.state-changed")} tone="secondary" />
      </SheetBody>
    );
  }
  return (
    <>
      <SheetBody>
        <ContextLine run={run} />
        {retry === "available" ? (
          <>
            <Text variant="body" tone="primary">
              {t("actions.retry.body")}
            </Text>
            <Text variant="meta">
              {t("actions.retry.same", {
                runner: detail.runner?.name ?? t("card.noRunner"),
                agent: agentName(detail.agent),
              })}
            </Text>
          </>
        ) : (
          <SheetMessage message={t("actions.retry.unavailable")} tone="secondary" />
        )}
        {continueOffer === "agent-running" ? (
          <Text variant="meta">{t("actions.continue.agentRunning")}</Text>
        ) : null}
      </SheetBody>
      <SheetFooter>
        <SheetMessage message={message} tone={messageTone} />
        <Button
          variant="primary"
          label={busyLabel ?? t("actions.retry.confirm")}
          disabled={disabled || sending || locked || retry !== "available"}
          onPress={() => void send({ action: "retry" })}
        />
        {continueOffer === "available" ? (
          <Button
            label={t("actions.continue.open")}
            disabled={disabled || sending || unconfirmed}
            onPress={onContinue}
          />
        ) : null}
      </SheetFooter>
    </>
  );
}

function ContinueForm({
  run,
  port,
  disabled,
  sharedUnconfirmed,
  onBack,
  onClose,
}: {
  run: DashboardRun;
  port: RunPort;
  disabled: boolean;
  sharedUnconfirmed: UnconfirmedWrite;
  onBack: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const { sending, busyLabel, message, messageTone, locked, send } = useRunWrite(
    port,
    run,
    onClose,
    disabled,
    sharedUnconfirmed,
  );
  const trimmed = text.trim();
  return (
    <>
      <SheetBody>
        <ContextLine run={run} />
        <Text variant="body" tone="primary">
          {t("actions.continue.body")}
        </Text>
        <TextField
          multiline
          label={t("actions.continue.messageLabel")}
          placeholder={t("actions.continue.messagePlaceholder")}
          maxLength={V1_CONTINUE_MESSAGE_MAX_LENGTH}
          value={text}
          onChangeText={setText}
        />
      </SheetBody>
      <SheetFooter>
        <SheetMessage message={message} tone={messageTone} />
        <Button
          variant="primary"
          label={busyLabel ?? t("actions.continue.confirm")}
          disabled={disabled || sending || locked || trimmed === ""}
          onPress={() => void send({ action: "continue", message: trimmed })}
        />
        <Button label={t("actions.continue.back")} disabled={sending} onPress={onBack} />
      </SheetFooter>
    </>
  );
}

function RetrySheet({
  run,
  port,
  disabled,
  onClose,
}: {
  run: DashboardRun;
  port: RunPort;
  disabled: boolean;
  onClose: () => void;
}) {
  const { read, staleNotice } = useRunDetail(port, run, disabled);
  const [continuing, setContinuing] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const sharedUnconfirmed = { value: unconfirmed, set: setUnconfirmed };
  const closeSheet = useCloseUnlessSending(onClose);
  return (
    <Sheet
      visible
      composed
      title={continuing ? t("actions.continue.title") : t("actions.retry.title")}
      closeLabel={t("common.close")}
      onClose={closeSheet}
    >
      <DetailGate read={read} staleNotice={staleNotice}>
        {(detail) =>
          continuing && detail.nextActions.continue === "available" ? (
            <ContinueForm
              run={run}
              port={port}
              disabled={disabled}
              sharedUnconfirmed={sharedUnconfirmed}
              onBack={() => setContinuing(false)}
              onClose={onClose}
            />
          ) : (
            <RetryForm
              run={run}
              detail={detail}
              port={port}
              disabled={disabled}
              sharedUnconfirmed={sharedUnconfirmed}
              onContinue={() => setContinuing(true)}
              onClose={onClose}
            />
          )
        }
      </DetailGate>
    </Sheet>
  );
}

function prReadDiagnosisText(diagnosis: AppPrReadDiagnosis): string | null {
  if (diagnosis.kind === "unknown") return null;
  const { server } = diagnosis;
  if (server.kind === "unknown") return null;
  const serverLogins = server.kind === "gh" ? server.logins.join(", ") : "";
  if (diagnosis.kind === "runner-unknown") {
    return server.kind === "gh"
      ? t("runDetail.prReadDiagnosis.runnerUnknownGh", { runner: diagnosis.runner, serverLogins })
      : t("runDetail.prReadDiagnosis.runnerUnknownToken", { runner: diagnosis.runner });
  }
  const values = { runner: diagnosis.runner, runnerLogin: diagnosis.runnerLogin, serverLogins };
  return server.kind === "gh"
    ? t("runDetail.prReadDiagnosis.differentGh", values)
    : t("runDetail.prReadDiagnosis.differentToken", values);
}

type DetailPullRequest = NonNullable<AppRunDetail["pullRequest"]>;

interface PrChipView {
  key: string;
  label: string;
  tone: ChipTone;
}

function prStateChip(pr: DetailPullRequest, unread: boolean): PrChipView | null {
  const { state, stateSince } = pr;
  if (state === null || (state === "unknown" && unread)) return null;
  const name = t(`runDetail.prStateChip.${state}`);
  const label =
    stateSince === null
      ? name
      : t("runDetail.prStateChip.since", {
          state: name,
          time: formatAgo(stateSince.at, stateSince.agoMs),
        });
  return { key: "state", label, tone: state === "merged" ? "merged" : "neutral" };
}

function ciChip(pr: DetailPullRequest): PrChipView | null {
  const label = t("runDetail.ciLabel", { state: t(`runDetail.ci.${pr.ci}`) });
  switch (pr.ci) {
    case "success":
      return { key: "ci", label, tone: "progress" };
    case "failure":
      return pr.problems.some((problem) => problem.kind === "ci-failed")
        ? null
        : { key: "ci", label, tone: "problem" };
    case "pending":
    case "none":
    case "unavailable":
    case "unknown":
      return { key: "ci", label, tone: "neutral" };
  }
}

function prChips(detail: AppRunDetail): PrChipView[] {
  const pr = detail.pullRequest;
  const unread = detail.prReadError !== null;
  const unreadChip: PrChipView[] = unread
    ? [{ key: "unread", label: t("runDetail.prUnreadChip"), tone: "problem" }]
    : [];
  if (pr === null) return unreadChip;
  const problems = pr.problems.map((problem, index): PrChipView => ({
    key: `${problem.kind}:${index}`,
    label: prProblemLabel(problem),
    tone: prProblemTone(problem),
  }));
  return [prStateChip(pr, unread), ...unreadChip, ciChip(pr), ...problems].filter(
    (chip): chip is PrChipView => chip !== null,
  );
}

function prUnreadLine(detail: AppRunDetail): string | null {
  if (detail.prReadError === null) return null;
  const diagnosis =
    detail.prReadDiagnosis === null ? null : prReadDiagnosisText(detail.prReadDiagnosis);
  return diagnosis ?? t(`runDetail.prUnread.${detail.prReadError}`);
}

interface MergeSlot {
  run: DashboardRun;
  port: RunPort;
  disabled: boolean;
  merged: boolean;
  onMerged: () => void;
  reload: () => void;
}

function waitingHumanCheck(detail: AppRunDetail): boolean {
  return detail.input?.kind === "human-check" && !detail.input.answered;
}

function mergeBlockedText(merge: AppPrMerge): string | null {
  if (merge.noPermission) return t("runDetail.merge.noPermission");
  return merge.blocked === null ? null : t(`runDetail.merge.blocked.${merge.blocked}`);
}

function MergeControl({
  merge,
  humanCheck,
  slot,
}: {
  merge: AppPrMerge;
  humanCheck: boolean;
  slot: MergeSlot;
}) {
  const [picked, setPicked] = useState<V1MergeMethod>(merge.defaultMethod);
  const [choosing, setChoosing] = useState(false);
  const method = merge.methods.includes(picked) ? picked : merge.defaultMethod;
  const { sending, busyLabel, message, messageTone, unconfirmed, send } = useRunWrite(
    slot.port,
    slot.run,
    slot.onMerged,
    slot.disabled,
  );
  const blocked = mergeBlockedText(merge);
  const hint = blocked === null && humanCheck ? t("runDetail.merge.humanCheck") : null;
  return (
    <View style={styles.merge}>
      <SplitButton
        label={
          busyLabel === null ? t(`runDetail.merge.button.${method}`) : t("runDetail.merge.busy")
        }
        groupLabel={t("runDetail.merge.group")}
        menuLabel={t("runDetail.merge.menu")}
        disabled={blocked !== null || slot.disabled || sending || unconfirmed}
        onPress={() =>
          void send({ action: "merge", method, expectedHead: merge.headCommit }).then((outcome) => {
            if (outcome?.kind === "refused") slot.reload();
          })
        }
        {...(merge.methods.length > 1 ? { onMenuPress: () => setChoosing(true) } : {})}
      />
      {blocked === null ? null : (
        <Text variant="small" tone="problem">
          {blocked}
        </Text>
      )}
      {hint === null ? null : <Text variant="small">{hint}</Text>}
      <SheetMessage message={message} tone={messageTone} />
      <Sheet
        visible={choosing}
        title={t("runDetail.merge.methodTitle")}
        closeLabel={t("common.close")}
        onClose={() => setChoosing(false)}
      >
        <View accessibilityRole="radiogroup" accessibilityLabel={t("runDetail.merge.methodTitle")}>
          {merge.methods.map((option) => (
            <RadioRow
              key={option}
              label={t(`runDetail.merge.option.${option}`)}
              selected={option === method}
              onPress={() => {
                setPicked(option);
                setChoosing(false);
                AccessibilityInfo.announceForAccessibility(
                  t("runDetail.merge.picked", {
                    method: t(`runDetail.merge.button.${option}`),
                  }),
                );
              }}
            />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

function PrBox({ detail, mergeSlot }: { detail: AppRunDetail; mergeSlot: MergeSlot | null }) {
  const pr = detail.pullRequest;
  const line = prUnreadLine(detail);
  const merge = pr?.state === "open" ? pr.merge : null;
  return (
    <RaisedBox>
      <View style={styles.prHead}>
        {pr === null ? null : isWebLink(pr.url) ? (
          <ExternalLink
            label={t("runDetail.prLink", { pr: pr.displayId })}
            accessibilityLabel={t("runDetail.prLinkLabel", { pr: pr.displayId })}
            onPress={() => void openWebLink(pr.url)}
          />
        ) : (
          <Text variant="title" weight="semibold">
            {t("runDetail.prLink", { pr: pr.displayId })}
          </Text>
        )}
        {prChips(detail).map((chip) => (
          <Chip key={chip.key} label={chip.label} tone={chip.tone} size="row" />
        ))}
      </View>
      {line === null ? null : (
        <Text variant="meta" tone="secondary">
          {line}
        </Text>
      )}
      {merge === null || mergeSlot === null ? null : (
        <MergeControl merge={merge} humanCheck={waitingHumanCheck(detail)} slot={mergeSlot} />
      )}
    </RaisedBox>
  );
}

function RunDetailBody({
  detail,
  mergeSlot = null,
}: {
  detail: AppRunDetail;
  mergeSlot?: MergeSlot | null;
}) {
  const { summary, pullRequest } = detail;
  return (
    <>
      <Card>
        <Text variant="meta" heading>
          {t("runDetail.next")}
        </Text>
        <Text variant="body" tone="primary">
          {t(`runDetail.step.${detail.nextStep}`)}
        </Text>
      </Card>
      <View style={styles.group}>
        <Text variant="title" heading>
          {t("runDetail.summary")}
        </Text>
        {summary.agentResult === null ? null : (
          <Text variant="meta">
            {t("runDetail.agentResult")}: {t(`card.agentResult.${summary.agentResult}`)}
          </Text>
        )}
        {summary.startError === null ? null : (
          <Text variant="meta" tone="problem">
            {t("runDetail.startError")}: {summary.startError}
          </Text>
        )}
        <Text variant="body">{summary.report ?? t("runDetail.noReport")}</Text>
      </View>
      <View style={styles.group}>
        <Text variant="title" heading>
          {t("runDetail.pr")}
        </Text>
        {pullRequest === null && detail.prReadError === null ? (
          <Text variant="meta">{t("runDetail.noPr")}</Text>
        ) : (
          <>
            {mergeSlot?.merged === true ? (
              <Text variant="meta" tone="secondary">
                {t("runDetail.merge.done")}
              </Text>
            ) : null}
            <PrBox detail={detail} mergeSlot={mergeSlot} />
          </>
        )}
      </View>
    </>
  );
}

function DetailSheet({
  run,
  port,
  disabled,
  onClose,
}: {
  run: DashboardRun;
  port: RunPort;
  disabled: boolean;
  onClose: () => void;
}) {
  const { read, staleNotice, reload } = useRunDetail(port, run, disabled, true);
  const [merged, setMerged] = useState(false);
  const onMerged = () => {
    setMerged(true);
    AccessibilityInfo.announceForAccessibility(t("runDetail.merge.done"));
    reload();
  };
  return (
    <Sheet
      visible
      composed
      title={t("card.detail")}
      closeLabel={t("common.close")}
      onClose={onClose}
    >
      <DetailGate read={read} staleNotice={staleNotice}>
        {(detail) => (
          <SheetBody>
            <ContextLine run={run} />
            <RunDetailBody
              detail={detail}
              mergeSlot={{ run, port, disabled, merged, onMerged, reload }}
            />
          </SheetBody>
        )}
      </DetailGate>
    </Sheet>
  );
}

interface RunSheetsProps {
  sheet: OpenRunSheet | null;
  port: RunPort;
  disabled: boolean;
  onClose: () => void;
}

export function RunSheets({ sheet, ...rest }: RunSheetsProps) {
  const sendingLock = useRef(false);
  if (sheet === null) return null;
  return (
    <SendingLock.Provider value={sendingLock}>
      <OpenSheet sheet={sheet} {...rest} />
    </SendingLock.Provider>
  );
}

function OpenSheet({ sheet, port, disabled, onClose }: RunSheetsProps & { sheet: OpenRunSheet }) {
  switch (sheet.kind) {
    case "answer":
    case "human-check":
    case "deny":
      return (
        <InputSheet
          key={`${sheet.kind}:${sheet.run.id}`}
          sheet={{ kind: sheet.kind, run: sheet.run }}
          port={port}
          disabled={disabled}
          onClose={onClose}
        />
      );
    case "cancel":
      return (
        <CancelSheet
          key={sheet.run.id}
          run={sheet.run}
          port={port}
          disabled={disabled}
          onClose={onClose}
        />
      );
    case "menu":
      return (
        <MenuSheet
          key={sheet.run.id}
          run={sheet.run}
          port={port}
          disabled={disabled}
          onClose={onClose}
        />
      );
    case "retry":
      return (
        <RetrySheet
          key={sheet.run.id}
          run={sheet.run}
          port={port}
          disabled={disabled}
          onClose={onClose}
        />
      );
    case "detail":
      return (
        <DetailSheet
          key={sheet.run.id}
          run={sheet.run}
          port={port}
          disabled={disabled}
          onClose={onClose}
        />
      );
    case "notice":
      return (
        <Sheet visible title={sheet.title} closeLabel={t("common.close")} onClose={onClose}>
          <Text variant="body" accessibilityRole="alert">
            {sheet.message}
          </Text>
          <Button label={t("common.close")} onPress={onClose} />
        </Sheet>
      );
  }
}

const styles = StyleSheet.create({
  group: { gap: space.s2 },
  prHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  merge: { gap: space.px6 },
});
