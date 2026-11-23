import { V1_CONTINUE_MESSAGE_MAX_LENGTH, V1_TEXT_MAX_LENGTH } from "@ganger/api";
import type { V1HumanCheckDecision, V1RunDetail, V1RunInput, V1RunRefusal } from "@ganger/api";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Linking, StyleSheet, View } from "react-native";

import type { DashboardRun } from "../dashboard/model";
import {
  Button,
  Card,
  Chip,
  RadioRow,
  Sheet,
  SheetBody,
  SheetFooter,
  TextField,
} from "../design/components";
import { Text, TextLink } from "../design/text";
import type { TextTone } from "../design/text";
import { space } from "../design/tokens";
import { agentName } from "../format";
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

function refusalKey(action: RunWrite["action"], reason: V1RunRefusal): MessageKey {
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
      return `actions.refused.run.${reason}`;
    case "already-answered":
    case "already-denied":
    case "resolved":
    case "state-changed":
      return "actions.refused.run.state-changed";
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
      return t(refusalKey(action, outcome.reason));
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

function useRunWrite(port: RunPort, run: DashboardRun, onSent: () => void) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [messageTone, setMessageTone] = useState<TextTone>("problem");
  const busy = useContext(SendingLock);
  const send = async (write: RunWrite) => {
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    setMessage(null);
    const outcome = await port.write(run, write);
    busy.current = false;
    setSending(false);
    if (outcome.kind === "sent") {
      onSent();
      return;
    }
    setRefused(outcome.kind === "refused");
    setMessageTone(outcome.kind === "demo" ? "secondary" : "problem");
    setMessage(outcomeMessage(write.action, outcome));
  };
  return { sending, message, messageTone, refused, send };
}

function useRunDetail(port: RunPort, run: DashboardRun): RunRead<V1RunDetail> | null {
  const [read, setRead] = useState<RunRead<V1RunDetail> | null>(null);
  useEffect(() => {
    let live = true;
    void port.detail(run).then((next) => {
      if (live) setRead(next);
    });
    return () => {
      live = false;
    };
  }, [port, run]);
  return read;
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
  children,
}: {
  read: RunRead<V1RunDetail> | null;
  children: (detail: V1RunDetail) => ReactNode;
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
      return <>{children(read.value)}</>;
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

type QuestionInput = Extract<V1RunInput, { kind: "question" }>;

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
  const { sending, message, messageTone, refused, send } = useRunWrite(port, run, onClose);
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
          label={sending ? t("actions.sending") : t("actions.answer.send")}
          disabled={disabled || sending || refused || answer === ""}
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

type HumanCheckInput = Extract<V1RunInput, { kind: "human-check" }>;

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
  const { sending, message, messageTone, refused, send } = useRunWrite(port, run, onClose);
  const decide = (decision: V1HumanCheckDecision) =>
    void send({ action: "human-check", questionId: input.questionId, decision, note: note.trim() });
  const off = disabled || sending || refused;
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
          label={t("actions.humanCheck.confirm")}
          disabled={off}
          onPress={() => decide("confirmed")}
        />
        <Button
          label={t("actions.humanCheck.requestChanges")}
          disabled={off}
          onPress={() => decide("changes-requested")}
        />
      </SheetFooter>
    </>
  );
}

type PermissionInput = Extract<V1RunInput, { kind: "permission" }>;

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
  const { sending, message, messageTone, refused, send } = useRunWrite(port, run, onClose);
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
          label={sending ? t("actions.sending") : t("actions.deny.send")}
          disabled={disabled || sending || refused}
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
  const read = useRunDetail(port, sheet.run);
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
      <DetailGate read={read}>
        {({ input }) => {
          if (kind === "answer" && input?.kind === "question" && !input.answered) {
            return (
              <AnswerForm
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
              <DenyForm run={run} input={input} port={port} disabled={disabled} onClose={onClose} />
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
  const { sending, message, messageTone, refused, send } = useRunWrite(port, run, onClose);
  const closeSheet = useCloseUnlessSending(onClose);
  return (
    <>
      <ContextLine run={run} />
      <Text variant="body">{t("actions.cancel.body")}</Text>
      <SheetMessage message={message} tone={messageTone} />
      <Button
        variant="danger"
        label={sending ? t("actions.sending") : t("actions.cancel.confirm")}
        disabled={disabled || sending || refused}
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
  onContinue,
  onClose,
}: {
  run: DashboardRun;
  detail: V1RunDetail;
  port: RunPort;
  disabled: boolean;
  onContinue: () => void;
  onClose: () => void;
}) {
  const { sending, message, messageTone, refused, send } = useRunWrite(port, run, onClose);
  const { retry, continue: continueOffer } = detail.nextActions;
  if (retry === "not-offered") {
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
          label={sending ? t("actions.sending") : t("actions.retry.confirm")}
          disabled={disabled || sending || refused || retry !== "available"}
          onPress={() => void send({ action: "retry" })}
        />
        {continueOffer === "available" ? (
          <Button
            label={t("actions.continue.open")}
            disabled={disabled || sending}
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
  onBack,
  onClose,
}: {
  run: DashboardRun;
  port: RunPort;
  disabled: boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const { sending, message, messageTone, refused, send } = useRunWrite(port, run, onClose);
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
          label={sending ? t("actions.sending") : t("actions.continue.confirm")}
          disabled={disabled || sending || refused || trimmed === ""}
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
  const read = useRunDetail(port, run);
  const [continuing, setContinuing] = useState(false);
  const closeSheet = useCloseUnlessSending(onClose);
  return (
    <Sheet
      visible
      composed
      title={continuing ? t("actions.continue.title") : t("actions.retry.title")}
      closeLabel={t("common.close")}
      onClose={closeSheet}
    >
      <DetailGate read={read}>
        {(detail) =>
          continuing && detail.nextActions.continue === "available" ? (
            <ContinueForm
              run={run}
              port={port}
              disabled={disabled}
              onBack={() => setContinuing(false)}
              onClose={onClose}
            />
          ) : (
            <RetryForm
              run={run}
              detail={detail}
              port={port}
              disabled={disabled}
              onContinue={() => setContinuing(true)}
              onClose={onClose}
            />
          )
        }
      </DetailGate>
    </Sheet>
  );
}

function RunDetailBody({ detail }: { detail: V1RunDetail }) {
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
        {pullRequest === null ? (
          <Text variant="meta">{t("runDetail.noPr")}</Text>
        ) : (
          <>
            <Text variant="body" tone="primary">
              {pullRequest.displayId}
            </Text>
            <Text variant="meta">
              {t("runDetail.ciLabel", { state: t(`runDetail.ci.${pullRequest.ci}`) })}
            </Text>
            <View style={styles.chips}>
              {pullRequest.problems.map((problem) => (
                <Chip
                  key={problem.kind}
                  tone={problem.kind === "behind" ? "neutral" : "problem"}
                  label={
                    problem.kind === "behind"
                      ? t("card.prChip.behind", { count: problem.commits })
                      : problem.kind === "conflict"
                        ? t("card.prChip.conflict")
                        : t("card.prChip.ciFailed")
                  }
                />
              ))}
            </View>
            {isWebLink(pullRequest.url) ? (
              <Button
                label={t("runDetail.openPr")}
                onPress={() => void openWebLink(pullRequest.url)}
              />
            ) : null}
          </>
        )}
      </View>
    </>
  );
}

function DetailSheet({
  run,
  port,
  onClose,
}: {
  run: DashboardRun;
  port: RunPort;
  onClose: () => void;
}) {
  const read = useRunDetail(port, run);
  return (
    <Sheet
      visible
      composed
      title={t("card.detail")}
      closeLabel={t("common.close")}
      onClose={onClose}
    >
      <DetailGate read={read}>
        {(detail) => (
          <SheetBody>
            <ContextLine run={run} />
            <RunDetailBody detail={detail} />
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
      return <DetailSheet key={sheet.run.id} run={sheet.run} port={port} onClose={onClose} />;
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s1 },
});
