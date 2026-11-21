import * as stylex from "@stylexjs/stylex";
import {
  Button,
  buttonStyles,
  capacityText,
  CapacityCells,
  CapacityTrack,
  CheckResultIcon,
  CheckResultList,
  CheckResultRow,
  DetailPanel,
  EditIcon,
  ExpandableRow,
  focusStyles,
  InfoTip,
  MascotMessage,
  PageHeader,
  PanelRows,
  PanelSection,
  ResponsiveColumns,
  ResponsiveColumnsHead,
  ProblemCallout,
  Row,
  RowTitle,
  ScreenLayout,
  SplitView,
  StatusDot,
  StatusPill,
  Table,
  TableCell,
  TableRow,
  TableRows,
  Text,
  textStyles,
  Tooltip,
  UsageBar,
  UsageMeter,
} from "@ganger/ui";
import type { CheckResultState, PillStatus } from "@ganger/ui";
import { USAGE_HIGH_PERCENT } from "@ganger/core";
import type { PrerequisiteFailureKind } from "@ganger/core";
import { breakpoints, size, space } from "@ganger/ui/tokens.stylex";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useLocale, useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { usePrerequisiteName, useUsageNames } from "../labels";
import { useCheckingText } from "../push-check";
import type { UnsavedGuard } from "../settings/navigation-guard";
import { useUnsavedHold } from "../settings/row-state";
import { ReportUnsavedContext, useRunnerCheckPolling } from "../settings/settings-screen";
import type { ActionResult } from "../settings/settings-screen";
import { useStatusName } from "../status";
import { failedChecksFirst, problemRunnersFirst, runnerRowStatus } from "@ganger/app/runners/model";
import {
  isPushCheck,
  prerequisiteKind,
  runnerWideChecks,
  summarizePushChecks,
} from "@ganger/app/prerequisites";
import type {
  OccupyingRun,
  ProviderUsageView,
  RunnerCheckItem,
  RunnerUsageView,
  RunnerView,
  RunnersPage,
  UsageWindowView,
} from "@ganger/app/runners/model";

export const ADD_RUNNER_SELECTION = "new";

export function addRunnerHref(ws: string | undefined): string {
  const search = new URLSearchParams(ws === undefined ? {} : { ws });
  search.set("sel", ADD_RUNNER_SELECTION);
  return `/runners?${search.toString()}`;
}

export interface RunnerActions {
  recheck: (input: { id: string }) => Promise<ActionResult>;
  pollChecks: () => Promise<boolean>;
}

export interface RunnerEditControls {
  onDone: () => void;
  onClose: () => void;
}

export type RenderRunnerEdit = (runner: RunnerView, controls: RunnerEditControls) => ReactNode;

export interface RunnersScreenProps {
  page: RunnersPage;
  selectedId: string | undefined;
  ws: string | undefined;
  onSelect: (id: string) => void;
  actions: RunnerActions;
  setup?: ReactNode;
  renderEdit?: RenderRunnerEdit;
  renderGuard?: (guard: UnsavedGuard) => ReactNode;
}

export function RunnersScreen({
  page,
  selectedId,
  ws,
  onSelect,
  actions,
  setup,
  renderEdit,
  renderGuard,
}: RunnersScreenProps) {
  const t = useTranslations("runners");
  const runners = problemRunnersFirst(page.runners);
  const issues = runners.filter((r) => runnerRowStatus(r) !== "online").length;
  const available = runners.filter(
    (r) => runnerRowStatus(r) === "online" && r.occupying.length < r.capacity,
  ).length;
  const adding = selectedId === ADD_RUNNER_SELECTION && setup !== undefined;
  const { blocked, report: reportUnsaved, guard } = useUnsavedHold("[data-runner-editing]");
  const guardLinks = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest("a[href]");
    if (link === null || link.getAttribute("href")?.startsWith("#") === true) return;
    if (!guard.hold()) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const selectUnlessUnsaved = (id: string) => {
    if (guard.hold()) return;
    onSelect(id);
  };
  const selected = adding ? undefined : (runners.find((r) => r.id === selectedId) ?? runners[0]);

  useEffect(() => {
    if (selectedId === undefined || selectedId === ADD_RUNNER_SELECTION) return;
    const option = document.getElementById(rowMarkerId(selectedId))?.closest('[role="option"]');
    if (!(option instanceof HTMLElement) || option.contains(document.activeElement)) return;
    option.scrollIntoView({ block: "nearest" });
    option.focus({ preventScroll: true });
  }, [selectedId]);

  return (
    <div {...stylex.props(styles.guardFrame)} onClickCapture={guardLinks}>
      {renderGuard?.(guard)}
      <ScreenLayout
        header={
          <PageHeader
            title={t("title")}
            subtitle={
              runners.length === 0
                ? undefined
                : t("subtitle", { total: runners.length, available, issues })
            }
            actions={
              <a
                href={addRunnerHref(ws)}
                data-variant="primary"
                {...stylex.props(...buttonStyles("primary"))}
              >
                {t("add")}
              </a>
            }
          />
        }
      >
        <SplitView
          fill={false}
          list={
            <div {...stylex.props(styles.listColumn)}>
              {runners.length === 0 ? (
                <EmptyRunners />
              ) : (
                <Table columns="minmax(0, 1fr)">
                  <ResponsiveColumnsHead
                    lead={t("columns.runner")}
                    columns={[
                      { width: size.capacityCellsColumn, content: t("columns.capacity") },
                      { width: size.usageColumn, content: t("columns.usage") },
                    ]}
                  />
                  <TableRows
                    label={t("listLabel")}
                    value={selected?.id ?? null}
                    onValueChange={selectUnlessUnsaved}
                  >
                    {runners.map((runner) => (
                      <RunnerRow key={runner.id} runner={runner} />
                    ))}
                  </TableRows>
                </Table>
              )}
            </div>
          }
          panel={
            <section aria-label={adding ? t("add") : t("panel.label")}>
              {adding ? (
                <DetailPanel>
                  <div {...stylex.props(styles.setup)}>
                    <Text variant="heading">{t("add")}</Text>
                    {setup}
                  </div>
                </DetailPanel>
              ) : selected === undefined ? (
                <DetailPanel>
                  {runners.length === 0 ? null : <Text variant="meta">{t("panel.empty")}</Text>}
                </DetailPanel>
              ) : (
                <ReportUnsavedContext value={reportUnsaved}>
                  <RunnerPanel
                    key={selected.id}
                    runner={selected}
                    actions={actions}
                    renderEdit={renderEdit}
                    blocked={blocked}
                  />
                </ReportUnsavedContext>
              )}
            </section>
          }
        />
      </ScreenLayout>
    </div>
  );
}

function EmptyRunners() {
  const t = useTranslations("runners.empty");
  return (
    <MascotMessage mood="resting" align="start">
      <Text variant="title">{t("title")}</Text>
      <Text variant="body">{t("body")}</Text>
    </MascotMessage>
  );
}

export function rowMarkerId(runnerId: string): string {
  return `runner-${runnerId}`;
}

function RunnerRow({ runner }: { runner: RunnerView }) {
  const statusName = useStatusName();
  const status = runnerRowStatus(runner);
  return (
    <TableRow value={runner.id} label={runner.name}>
      <TableCell>
        <ResponsiveColumns
          id={rowMarkerId(runner.id)}
          columns={[
            { width: size.capacityCellsColumn, content: <RunnerCapacity runner={runner} /> },
            { width: size.usageColumn, content: <HighestUsage runner={runner} /> },
          ]}
          lead={
            <>
              <span {...stylex.props(styles.rowHead)}>
                <StatusPill status={status}>{statusName(status)}</StatusPill>
                <span {...stylex.props(styles.rowName)}>
                  <RowTitle>{runner.name}</RowTitle>
                </span>
                {runner.sshTarget === null ? null : (
                  <span {...stylex.props(styles.rowHost)}>
                    <Text variant="meta" mono truncate>
                      {runner.sshTarget}
                    </Text>
                  </span>
                )}
              </span>
              <Text variant="ui" {...(status === "online" ? {} : { tone: "problem" })} truncate>
                <RowSentence runner={runner} />
              </Text>
            </>
          }
        />
      </TableCell>
    </TableRow>
  );
}

function RunnerCapacity({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners");
  const used = runner.occupying.length;
  return (
    <CapacityCells
      used={used}
      total={runner.capacity}
      label={t("capacityCellsLabel", { used, total: runner.capacity })}
      tone={runnerRowStatus(runner) === "online" ? "progress" : "problem"}
    />
  );
}

function RowSentence({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.row");
  const { duration } = useTime();
  const free = Math.max(0, runner.capacity - runner.occupying.length);
  if (!runner.online)
    return runner.offlineMs === null
      ? t("offline")
      : t("offlineFor", { duration: duration(runner.offlineMs) });
  if (runner.assignmentBlocked) return t("assignmentBlocked");
  const capacity =
    free > 0
      ? t("free", { free })
      : runner.queued.length === 0
        ? t("full")
        : t("fullWaiting", { count: runner.queued.length });
  const pushBlocked = runner.pushBlockedProjects.length;
  return pushBlocked === 0 ? capacity : t("withPushBlocked", { capacity, count: pushBlocked });
}

function RunnerPanel({
  runner,
  actions,
  renderEdit,
  blocked,
}: {
  runner: RunnerView;
  actions: RunnerActions;
  renderEdit: RenderRunnerEdit | undefined;
  blocked: boolean;
}) {
  const t = useTranslations("runners.panel");
  const statusName = useStatusName();
  const { ago } = useTime();
  const status = runnerRowStatus(runner);
  const recheck = useRecheck(runner.id, actions);
  const edit = useRunnerEdit();
  const checkingText = useCheckingText(recheck.checking ? 0 : null, "elapsed");
  const needsFix = status !== "online" || runner.pushBlockedProjects.length > 0;
  const target = needsFix ? fixTarget(runner) : null;
  return (
    <DetailPanel>
      <div {...stylex.props(styles.panelHead)}>
        <div {...stylex.props(styles.nameLine)}>
          <div {...stylex.props(styles.wrap)}>
            <Text variant="heading">{runner.name}</Text>
            {runner.sshTarget === null ? null : (
              <Text variant="meta" as="p" mono>
                {runner.sshTarget}
              </Text>
            )}
          </div>
          {renderEdit === undefined || edit.open ? null : (
            <Tooltip
              content={t("editLabel", { name: runner.name })}
              labelsTrigger
              action={{
                variant: "ghost",
                onClick: edit.show,
                ref: edit.triggerRef,
                expanded: false,
                label: t("editLabel", { name: runner.name }),
              }}
            >
              <EditIcon />
            </Tooltip>
          )}
        </div>
        <div {...stylex.props(styles.statusLine)}>
          <StatusPill status={status}>{statusName(status)}</StatusPill>
          <span {...stylex.props(styles.statusTime)}>
            <Text variant="meta" numeric>
              {runner.checked === null
                ? t("neverChecked")
                : t("checkedAgo", { time: ago(runner.checked.at, runner.checked.agoMs) })}
            </Text>
          </span>
          {checkingText === null ? null : (
            <Text variant="meta" numeric>
              {checkingText}
            </Text>
          )}
          {needsFix ? null : <RecheckButton recheck={recheck} variant="secondary" />}
        </div>
        <p
          ref={recheck.statusRef}
          role="status"
          tabIndex={-1}
          {...stylex.props(textStyles("meta"))}
        >
          {recheck.message === null ? null : t(`recheckStatus.${recheck.message}`)}
        </p>
        {renderEdit !== undefined && edit.open ? (
          <div
            ref={edit.formRef}
            data-runner-editing=""
            tabIndex={-1}
            {...stylex.props(styles.editForm, focusStyles.target)}
          >
            <Text variant="meta" as="p" tone="problem" role="alert">
              {blocked ? t("unsavedBlocked") : null}
            </Text>
            {renderEdit(runner, { onDone: edit.close, onClose: edit.close })}
          </div>
        ) : null}
      </div>
      {needsFix ? <FixCard runner={runner} target={target} recheck={recheck} /> : null}
      {needsFix ? <CheckList runner={runner} target={target} /> : null}
      <CapacityRuns runner={runner} />
      <ProviderUsage runner={runner} />
      {needsFix ? null : <CheckList runner={runner} target={target} />}
      <LeftWorktrees runner={runner} />
    </DetailPanel>
  );
}

function RecheckButton({
  recheck,
  variant,
}: {
  recheck: Recheck;
  variant: "primary" | "secondary";
}) {
  const t = useTranslations("runners.panel");
  return (
    <Button
      variant={variant}
      busy={{ active: recheck.checking, label: t("checking") }}
      onClick={recheck.request}
    >
      {t("recheck")}
    </Button>
  );
}

function useRunnerEdit() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (open) {
      const form = formRef.current;
      const field = window.matchMedia("(pointer: fine)").matches
        ? form?.querySelector<HTMLElement>("input")
        : null;
      (field ?? form)?.focus();
      return;
    }
    if (!refocus.current) return;
    refocus.current = false;
    triggerRef.current?.focus();
  }, [open]);
  return {
    open,
    triggerRef,
    formRef,
    show: () => setOpen(true),
    close: () => {
      refocus.current = true;
      setOpen(false);
    },
  };
}

type RecheckPhase = "idle" | "sending" | "requested" | "done" | "failed";
type RecheckMessage = "requested" | "done" | "failed" | "silent";

type Recheck = ReturnType<typeof useRecheck>;

function useRecheck(runnerId: string, { recheck, pollChecks }: RunnerActions) {
  const [phase, setPhase] = useState<RecheckPhase>("idle");
  const [pendingKey, setPendingKey] = useState("");
  const statusRef = useRef<HTMLParagraphElement>(null);

  const focusStatusIfLost = useCallback(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) statusRef.current?.focus();
  }, []);

  const poll = useCallback(async () => {
    const still = await pollChecks();
    if (!still) {
      setPhase("done");
      setPendingKey("");
      focusStatusIfLost();
    }
    return still;
  }, [pollChecks, focusStatusIfLost]);
  const silent = useRunnerCheckPolling(pendingKey, poll);

  const request = () => {
    setPhase("sending");
    recheck({ id: runnerId }).then(
      (result) => {
        if (result.ok) {
          setPhase("requested");
          setPendingKey(`${runnerId}:${String(Date.now())}`);
        } else {
          setPhase("failed");
        }
        focusStatusIfLost();
      },
      () => {
        setPhase("failed");
        focusStatusIfLost();
      },
    );
  };

  const checking = phase === "sending" || (phase === "requested" && !silent);
  return {
    statusRef,
    request,
    checking,
    message: recheckMessage(phase, silent),
  };
}

function recheckMessage(phase: RecheckPhase, silent: boolean): RecheckMessage | null {
  switch (phase) {
    case "idle":
    case "sending":
      return null;
    case "requested":
      return silent ? "silent" : "requested";
    case "done":
    case "failed":
      return phase;
  }
}

function orderedChecks(checks: ReadonlyArray<RunnerCheckItem>): RunnerCheckItem[] {
  return failedChecksFirst([
    ...runnerWideChecks(checks),
    ...checks.filter((check) => isPushCheck(check)),
  ]);
}

function fixTarget(runner: RunnerView): RunnerCheckItem | null {
  if (!runner.online) return null;
  const broken = orderedChecks(runner.checks ?? []).filter((check) => check.satisfied === false);
  const cause = runner.assignmentBlocked
    ? (broken.find((check) => check.blocksAssignment) ?? broken[0])
    : broken.find((check) => isPushCheck(check));
  return cause ?? null;
}

function FixCard({
  runner,
  target,
  recheck,
}: {
  runner: RunnerView;
  target: RunnerCheckItem | null;
  recheck: Recheck;
}) {
  const t = useTranslations("runners.panel");
  const tPush = useTranslations("domain.pushCheck");
  const prerequisiteName = usePrerequisiteName();
  const projectList = new Intl.ListFormat(useLocale(), { type: "conjunction", style: "short" });
  const code = (chunks: ReactNode) => (
    <Text variant="meta" as="span" mono wrap="anywhere">
      {chunks}
    </Text>
  );
  const actions = <RecheckButton recheck={recheck} variant="primary" />;
  if (target === null) {
    const cause = runner.online ? "assignmentBlocked" : "offline";
    return (
      <ProblemCallout
        title={t(`fix.${cause}.title`)}
        steps={(["1", "2", "3"] as const).map((step) =>
          t.rich(`fix.${cause}.steps.${step}`, { code }),
        )}
        actions={actions}
      >
        {t(`fix.${cause}.body`)}
      </ProblemCallout>
    );
  }
  const push = summarizePushChecks(runner.checks ?? []);
  const name = isPushCheck(target) ? tPush("name") : prerequisiteName(target);
  const blockedProjects = projectList.format(runner.pushBlockedProjects);
  return (
    <ProblemCallout title={t("fix.brokenTitle", { name })} actions={actions}>
      <div {...stylex.props(styles.fixBody)}>
        <Text variant="body">
          {runner.assignmentBlocked
            ? t("fix.assignmentBlocked.body")
            : t("fix.pushImpact", { projects: blockedProjects })}
        </Text>
        {runner.assignmentBlocked && runner.pushBlockedProjects.length > 0 ? (
          <Text variant="body">{t("fix.pushAlsoBlocked", { projects: blockedProjects })}</Text>
        ) : null}
        {target.hint === null ? null : (
          <Text variant="meta" as="span" mono wrap="anywhere">
            {target.hint}
          </Text>
        )}
        {isPushCheck(target)
          ? push.failedKinds.map((kind) => (
              <Text key={kind} variant="ui" as="p">
                {tPush.rich(`fix.${kind}`, { code })}
              </Text>
            ))
          : null}
      </div>
    </ProblemCallout>
  );
}

function CapacityRuns({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.panel");
  const tRunners = useTranslations("runners");
  const used = runner.occupying.length;
  return (
    <PanelSection title={t("capacity")} count={capacityText(used, runner.capacity)}>
      <CapacityTrack
        used={used}
        total={runner.capacity}
        label={tRunners("capacityCellsLabel", { used, total: runner.capacity })}
      />
      {used === 0 ? (
        <Text variant="ui">{t("noRuns")}</Text>
      ) : (
        <PanelRows ordered>
          {runner.occupying.map((run) => (
            <li key={run.id}>
              <OccupyingRunRow run={run} />
            </li>
          ))}
        </PanelRows>
      )}
      {runner.queued.length === 0 ? null : (
        <Text variant="meta" as="p" numeric>
          {t("queuedWaiting", {
            count: runner.queued.length,
            keys: runner.queued.map((run) => run.ticketKey).join(", "),
          })}
        </Text>
      )}
    </PanelSection>
  );
}

function occupyingStatus(run: OccupyingRun): PillStatus {
  return run.state === "waiting-for-input" ? (run.waitingFor ?? run.state) : run.state;
}

function OccupyingRunRow({ run }: { run: OccupyingRun }) {
  const statusName = useStatusName();
  const { elapsed } = useTime();
  const status = occupyingStatus(run);
  const isTodo = run.state === "waiting-for-input" || run.state === "disconnected";
  return (
    <Row
      href={runHref(run.workspace.id, run.id)}
      leading={<StatusDot status={status}>{statusName(status)}</StatusDot>}
      trailing={isTodo ? statusName(status) : elapsed(run.executionMs)}
    >
      <RunLabel ticketKey={run.ticketKey} text={run.ticketTitle} />
    </Row>
  );
}

function RunLabel({ ticketKey, text }: { ticketKey: string; text: string | null }) {
  return (
    <span {...stylex.props(styles.runLabel)}>
      <span {...stylex.props(styles.runKey)}>
        <Text variant="meta" numeric>
          {ticketKey}
        </Text>
      </span>
      {text === null ? null : (
        <Text variant="ui" tone="strong" truncate>
          {text}
        </Text>
      )}
    </span>
  );
}

function CheckList({ runner, target }: { runner: RunnerView; target: RunnerCheckItem | null }) {
  const t = useTranslations("runners.panel");
  const tPush = useTranslations("domain.pushCheck");
  const prerequisiteName = usePrerequisiteName();
  if (!runner.online) {
    return (
      <PanelSection title={t("checksTitle")}>
        <CheckResultList>
          <CheckResultRow state="broken" stateLabel={t("check.broken")} name={t("unreachable")} />
        </CheckResultList>
      </PanelSection>
    );
  }
  const checks = runner.checks;
  if (checks === null || checks.length === 0) {
    return (
      <PanelSection title={t("checksTitle")}>
        <Text variant="ui">{t("noChecks")}</Text>
      </PanelSection>
    );
  }
  const ordered = orderedChecks(checks);
  const passed = ordered.filter((check) => check.satisfied === true).length;
  const fixesInRows = target !== null && !isPushCheck(target);
  const shownFixKinds = new Set<PrerequisiteFailureKind>();
  const firstRowOfKind = (kind: PrerequisiteFailureKind) => {
    if (shownFixKinds.has(kind)) return null;
    shownFixKinds.add(kind);
    return kind;
  };
  const code = (chunks: ReactNode) => (
    <Text variant="meta" as="span" mono wrap="anywhere">
      {chunks}
    </Text>
  );
  const rows = ordered.map((check) => {
    const state = checkState(check);
    const push = prerequisiteKind(check.id);
    const failureKind = check.failure?.kind ?? (state === "broken" ? "other" : null);
    const showsHint = state === "broken" && check.hint !== null && check.id !== target?.id;
    const rawReason = push.kind === "github-push" ? (check.failure?.reason ?? null) : null;
    const fixKind =
      fixesInRows && push.kind === "github-push" && state === "broken"
        ? firstRowOfKind(failureKind ?? "other")
        : null;
    return (
      <CheckResultRow
        key={check.id}
        state={state}
        stateLabel={t(`check.${state}`)}
        name={
          push.kind === "github-push"
            ? `${tPush("name")} · ${check.project ?? push.projectId}`
            : prerequisiteName(check)
        }
        {...(push.kind === "github-push" && failureKind !== null && state !== "ok"
          ? { reason: tPush(`failure.${failureKind}`) }
          : {})}
      >
        {showsHint || rawReason !== null || fixKind !== null ? (
          <>
            {showsHint ? (
              <Text variant="meta" mono>
                {check.hint}
              </Text>
            ) : null}
            {rawReason === null || state === "ok" ? null : (
              <Text variant="meta" mono wrap="anywhere">
                {rawReason}
              </Text>
            )}
            {fixKind === null ? null : (
              <Text variant="meta" as="p">
                {tPush.rich(`fix.${fixKind}`, { code })}
              </Text>
            )}
          </>
        ) : undefined}
      </CheckResultRow>
    );
  });
  if (passed === ordered.length) {
    return (
      <PanelSection title={t("checksTitle")}>
        <ExpandableRow
          leading={<CheckResultIcon state="ok" />}
          summary={t("checksAllPassed", { count: ordered.length })}
        >
          <CheckResultList>{rows}</CheckResultList>
        </ExpandableRow>
      </PanelSection>
    );
  }
  return (
    <PanelSection
      title={t("checksTitle")}
      count={t("checksCount", { passed, total: ordered.length })}
    >
      <CheckResultList>{rows}</CheckResultList>
    </PanelSection>
  );
}

function checkState(check: Pick<RunnerCheckItem, "satisfied">): CheckResultState {
  if (check.satisfied === null) return "unknown";
  return check.satisfied ? "ok" : "broken";
}

function LeftWorktrees({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.panel");
  if (runner.leftWorktrees.length === 0) return null;
  return (
    <PanelSection title={t("leftWorktrees")} count={runner.leftWorktrees.length}>
      <PanelRows>
        {runner.leftWorktrees.map((run) => (
          <li key={run.id}>
            <Row href={runHref(run.workspace.id, run.id)}>
              <RunLabel ticketKey={run.ticketKey} text={t(`worktree.${run.worktree}`)} />
            </Row>
          </li>
        ))}
      </PanelRows>
    </PanelSection>
  );
}

function usageTone(window: UsageWindowView): "neutral" | "problem" {
  return window.usedPercent >= USAGE_HIGH_PERCENT ? "problem" : "neutral";
}

function HighestUsage({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.usage");
  const names = useUsageNames();
  const usage = runner.usage;
  if (usage === null) return <Text variant="meta">{t("notRead")}</Text>;
  if (usage.kind === "unreadable") return <Text variant="meta">{t("unreadable")}</Text>;
  if (usage.highest === null) return <Text variant="meta">{t("noWindows")}</Text>;
  const provider = names.provider(usage.highest.provider);
  const window = names.window(usage.highest.window.kind);
  return (
    <span {...stylex.props(styles.highestUsage)}>
      <span {...stylex.props(styles.highestQualifier)}>
        <Text variant="meta">{t("highest")}</Text>
      </span>
      <UsageMeter
        name={t("name", { provider, window })}
        percent={usage.highest.window.usedPercent}
        label={t("highestBarLabel", { runner: runner.name, provider, window })}
        tone={usageTone(usage.highest.window)}
      />
    </span>
  );
}

function ProviderUsage({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.panel.usage");
  const { ago } = useTime();
  const usage = runner.usage;
  return (
    <PanelSection
      title={t("title")}
      info={<InfoTip label={t("privacyLabel")} content={t("privacy")} />}
      {...(usage === null ? {} : { meta: t("readAgo", { time: ago(usage.readAt, usage.agoMs) }) })}
    >
      {usage === null ? (
        <Text variant="ui">{t("notRead")}</Text>
      ) : usage.kind === "unreadable" ? (
        <Text variant="ui">{t("unreadable")}</Text>
      ) : (
        <ProviderUsageList runner={runner} usage={usage} />
      )}
    </PanelSection>
  );
}

function ProviderUsageList({
  runner,
  usage,
}: {
  runner: RunnerView;
  usage: Extract<RunnerUsageView, { kind: "read" }>;
}) {
  const t = useTranslations("runners.panel.usage");
  const names = useUsageNames();
  const using = usage.providers.filter((p) => p.status === "ok" || p.status === "error");
  const signedOut = usage.providers.filter((p) => p.status === "signed-out");
  const unavailable = usage.providers.filter((p) => p.status === "unavailable");
  const providerList = new Intl.ListFormat(useLocale(), { type: "conjunction", style: "short" });
  const listOf = (providers: ProviderUsageView[]) =>
    providerList.format(providers.map((p) => names.provider(p.provider)));
  const others = otherProvidersText(t, {
    signedOut: signedOut.length === 0 ? null : listOf(signedOut),
    unavailable: unavailable.length === 0 ? null : listOf(unavailable),
  });
  return (
    <>
      {using.map((provider) => (
        <ProviderWindows
          key={provider.provider}
          runner={runner}
          provider={provider}
          now={usage.now}
        />
      ))}
      {others === null ? null : <Text variant="ui">{others}</Text>}
    </>
  );
}

function ProviderWindows({
  runner,
  provider,
  now,
}: {
  runner: RunnerView;
  provider: ProviderUsageView;
  now: string;
}) {
  const t = useTranslations("runners.panel.usage");
  const tUsage = useTranslations("runners.usage");
  const names = useUsageNames();
  const { stamp } = useTime();
  const name = names.provider(provider.provider);
  return (
    <section aria-label={name} {...stylex.props(styles.provider)}>
      <Text variant="title">{name}</Text>
      {provider.status === "error" ? (
        <Text variant="ui">{t("error")}</Text>
      ) : provider.windows.length === 0 ? (
        <Text variant="ui">{t("noWindows")}</Text>
      ) : (
        <ul {...stylex.props(styles.list, styles.windows)}>
          {provider.windows.map((window) => {
            const windowName = names.window(window.kind);
            const atLimit = isAtLimit(window, now);
            return (
              <li
                key={window.kind}
                data-window={window.kind}
                {...stylex.props(styles.labelGrid, styles.windowGrid)}
              >
                <Text variant="ui">{windowName}</Text>
                <UsageBar
                  percent={window.usedPercent}
                  label={tUsage("barLabel", {
                    runner: runner.name,
                    provider: name,
                    window: windowName,
                  })}
                  tone={usageTone(window)}
                />
                {window.resetsAt === null && !atLimit ? null : (
                  <span {...stylex.props(styles.labelGridRest)}>
                    <Text variant="meta">
                      {window.resetsAt === null
                        ? t("atLimit")
                        : t(atLimit ? "resetsAtLimit" : "resetsAt", {
                            time: stamp(window.resetsAt, now),
                          })}
                    </Text>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function otherProvidersText(
  t: ReturnType<typeof useTranslations<"runners.panel.usage">>,
  { signedOut, unavailable }: { signedOut: string | null; unavailable: string | null },
): string | null {
  if (signedOut !== null && unavailable !== null) return t("others", { signedOut, unavailable });
  if (signedOut !== null) return t("signedOut", { signedOut });
  if (unavailable !== null) return t("unavailable", { unavailable });
  return null;
}

function isAtLimit(window: UsageWindowView, now: string): boolean {
  if (window.usedPercent < 100) return false;
  return window.resetsAt === null || Date.parse(window.resetsAt) > Date.parse(now);
}

function runHref(workspaceId: string, runId: string): string {
  return `/runs/${encodeURIComponent(runId)}?${new URLSearchParams({ ws: workspaceId }).toString()}`;
}

const styles = stylex.create({
  setup: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  listColumn: { minWidth: 0 },
  rowHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s2,
    rowGap: space.px2,
    minWidth: 0,
  },
  rowName: { display: "flex", flexShrink: 0, maxWidth: "100%" },
  rowHost: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  highestUsage: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    justifySelf: "stretch",
    minWidth: 0,
  },
  highestQualifier: {
    display: { default: "none", [breakpoints.responsiveColumnsStacked]: "block" },
  },
  panelHead: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  statusLine: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  statusTime: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
  fixBody: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  runKey: { flexShrink: 0 },
  wrap: { minWidth: 0, overflowWrap: "anywhere" },
  guardFrame: { display: "contents" },
  nameLine: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.s3,
  },
  editForm: { paddingTop: space.s2 },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    listStyle: "none",
    minWidth: 0,
  },
  windows: { gap: space.s3 },
  labelGrid: {
    display: "grid",
    gridTemplateColumns: `${size.panelLabelColumn} minmax(0, 1fr)`,
    alignItems: "baseline",
    columnGap: space.s3,
    rowGap: space.s1,
    minWidth: 0,
  },
  windowGrid: { alignItems: "center" },
  labelGridRest: { gridColumn: "2 / -1", minWidth: 0 },
  runLabel: { display: "flex", alignItems: "baseline", gap: space.s2, minWidth: 0 },
  provider: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
});
