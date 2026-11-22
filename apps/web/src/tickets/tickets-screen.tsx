import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  BlockerChip,
  blockerDotStyles,
  Button,
  Card,
  Chip,
  DefinitionItem,
  DefinitionList,
  DetailPanel,
  ExternalIconLink,
  FlatViewIcon,
  GroupedViewIcon,
  IconToggleGroup,
  InfoTip,
  Input,
  IssueGroupLabel,
  IssueList,
  IssueListFrame,
  IssueListHead,
  IssueRow,
  IssueStateIcon,
  MascotMessage,
  NoticeLayout,
  PageHeader,
  PanelList,
  PanelListRow,
  PanelSection,
  ProgressRing,
  ScreenLayout,
  SegmentedTabs,
  SplitView,
  StatusDot,
  StatusPill,
  TableEmpty,
  Text,
  TimeSlot,
  VisuallyHidden,
  showToast,
} from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { IssueListMove, PillStatus } from "@ganger/ui";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { currentPrState } from "@ganger/app/runs/model";
import type { WorkspaceSummary } from "@ganger/app/shell/model";
import { runStatus, useStatusName } from "../status";
import type { AssignInput, AssignResult } from "@ganger/app/tickets/assign";
import { ticketId } from "@ganger/app/tickets/merge";
import { AssignDialog } from "./assign-dialog";
import { TICKET_FILTERS, countByFilter, lastRun } from "@ganger/app/tickets/model";
import type {
  TicketBlockersResult,
  TicketFilter,
  TicketRun,
  TicketView,
  TicketsPage,
} from "@ganger/app/tickets/model";
import { allBlockersOf } from "@ganger/app/runs/model";
import type { BlockerReason } from "@ganger/app/runs/model";
import { isBlockerFinished } from "@ganger/core";
import { blockerChipState } from "../blockers";
import { useAgentName, useQueuedReasonText } from "../labels";
import { useRowWindow } from "./row-window";
import { groupTickets } from "@ganger/app/tickets/groups";
import type { TicketGroup, TicketListView } from "@ganger/app/tickets/groups";
import { isSelectableRow, issueStateKind, listRows, rowActionOf } from "./ticket-rows";
import type { TicketListRow } from "./ticket-rows";

export interface TicketsScreenProps {
  page: TicketsPage;
  workspaces: ReadonlyArray<WorkspaceSummary>;
  filter: TicketFilter;
  view?: TicketListView;
  onViewChange?: (view: TicketListView) => void;
  selectedId: string | undefined;
  onFilterChange: (filter: TicketFilter) => void;
  onSelect: (ticketId: string) => void;
  onPickWorkspace: (workspaceId: string) => void;
  onOpenRun: (runId: string) => void;
  onOpenRuns: (ticket: TicketView) => void;
  onAssign: (input: AssignInput) => Promise<AssignResult>;
  onAssigned: (ticketId: string) => void;
  onReadBlockers: (ticket: TicketView) => Promise<TicketBlockersResult>;
  onReread: () => Promise<void>;
}

export function TicketsScreen(props: TicketsScreenProps) {
  const { page } = props;
  switch (page.workspace.kind) {
    case "none":
      return <Notice body={<NoWorkspace />} />;
    case "all":
      return (
        <Notice
          body={
            <AllWorkspaces workspaces={props.workspaces} onPickWorkspace={props.onPickWorkspace} />
          }
        />
      );
    case "one":
      return <TicketsList key={page.workspace.workspace.id} {...props} />;
  }
}

function Notice({ body }: { body: ReactNode }) {
  const t = useTranslations("tickets");
  return (
    <ScreenLayout header={<PageHeader title={t("title")} subtitle={t("intro")} />}>
      <NoticeLayout>{body}</NoticeLayout>
    </ScreenLayout>
  );
}

function NoWorkspace() {
  const t = useTranslations("tickets");
  return <Text variant="body">{t("noWorkspace")}</Text>;
}

function AllWorkspaces({
  workspaces,
  onPickWorkspace,
}: {
  workspaces: ReadonlyArray<WorkspaceSummary>;
  onPickWorkspace: (workspaceId: string) => void;
}) {
  const t = useTranslations("tickets.allWorkspaces");
  return (
    <div {...stylex.props(styles.stack)}>
      <Text variant="body">{t("body")}</Text>
      <Actions>
        {workspaces.map((w) => (
          <Button key={w.id} onClick={() => onPickWorkspace(w.id)}>
            {t("pick", { name: w.name })}
          </Button>
        ))}
      </Actions>
    </div>
  );
}

type RereadResult = "idle" | "reading" | "checking" | "failed" | "partial";

function useReread(onReread: () => Promise<void>, page: TicketsPage) {
  const t = useTranslations("tickets.reread");
  const [result, setResult] = useState<RereadResult>("idle");
  const failedProjects = page.errors.length;
  const [failedOn, setFailedOn] = useState<TicketsPage | null>(null);
  const [rereads, setRereads] = useState(0);
  if (result === "failed" && failedOn !== null && failedOn !== page) {
    setResult("idle");
    setFailedOn(null);
  }
  useEffect(() => {
    if (result !== "checking") return;
    if (failedProjects > 0) {
      setResult("partial");
      return;
    }
    setResult("idle");
    showToast(t("done"));
  }, [result, failedProjects, t]);
  const start = () => {
    setResult("reading");
    onReread().then(
      () => {
        setRereads((count) => count + 1);
        setResult("checking");
      },
      () => {
        setFailedOn(page);
        setResult("failed");
      },
    );
  };
  return { result, rereads, start };
}

export const REREAD_ANNOUNCE_MS = 5_000;

function useAnnouncement(result: RereadResult): RereadResult {
  const [announced, setAnnounced] = useState<RereadResult>("idle");
  useEffect(() => {
    setAnnounced(result);
    if (result !== "failed" && result !== "partial") return;
    const timer = setTimeout(() => setAnnounced("idle"), REREAD_ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [result]);
  return announced;
}

function RereadButton({ result, onStart }: { result: RereadResult; onStart: () => void }) {
  const t = useTranslations("tickets.reread");
  const announced = useAnnouncement(result);
  return (
    <>
      <Button busy={{ active: result === "reading", label: t("reading") }} onClick={onStart}>
        {t("action")}
      </Button>
      <VisuallyHidden>
        <span role="status">
          {announced === "failed" ? t("failed") : announced === "partial" ? t("partial") : ""}
        </span>
      </VisuallyHidden>
    </>
  );
}

function TicketsList({
  page,
  filter,
  view = "grouped",
  onViewChange,
  selectedId,
  onFilterChange,
  onSelect,
  onOpenRun,
  onOpenRuns,
  onAssign,
  onAssigned,
  onReadBlockers,
  onReread,
}: TicketsScreenProps) {
  const t = useTranslations("tickets");
  const reread = useReread(onReread, page);
  const [query, setQuery] = useState("");
  const [expansion, setExpansion] = useState<ReadonlyMap<string, boolean>>(new Map());
  const grouping = useMemo(() => groupTickets(page.tickets), [page.tickets]);
  const rows = useMemo(
    () =>
      listRows({
        view,
        tickets: page.tickets,
        grouping,
        filter,
        query,
        overrides: expansion,
        selectedId,
      }),
    [view, page.tickets, grouping, filter, query, expansion, selectedId],
  );
  const selectableRows = useMemo(() => rows.filter(isSelectableRow), [rows]);
  const counts = useMemo(() => countByFilter(page.tickets), [page.tickets]);
  const selectionExists =
    selectedId !== undefined &&
    (page.tickets.some((ticket) => ticket.id === selectedId) ||
      grouping.groups.some((group) => group.id === selectedId));
  const effectiveId = selectionExists ? selectedId : selectableRows[0]?.id;
  const selectedGroup = grouping.groups.find((group) => group.id === effectiveId) ?? null;
  const selectedTicket = page.tickets.find((ticket) => ticket.id === effectiveId);
  const selectedIndex = rows.findIndex((row) => row.id === effectiveId);
  const rowKeys = useMemo(() => rows.map((row) => row.id), [rows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowWindow = useRowWindow(listRef, rowKeys, selectedIndex);
  const moreBelow = useMoreBelow(scrollRef, listRef, rows.length);
  const [assignedId, setAssignedId] = useState<string | null>(null);
  const [relationPickedId, setRelationPickedId] = useState<string | null>(null);
  const pendingRowFocus = useRef<string | null>(null);

  useLayoutEffect(() => {
    const id = pendingRowFocus.current;
    if (id === null) return;
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row-key]") ?? [])].find(
      (candidate) => candidate.dataset["rowKey"] === id,
    );
    const button = row?.querySelector<HTMLElement>("[data-issue-select]");
    if (button === undefined || button === null) return;
    button.focus();
    pendingRowFocus.current = null;
  });

  const moveSelection = (move: IssueListMove) => {
    const index = selectableRows.findIndex((row) => row.id === effectiveId);
    const last = selectableRows.length - 1;
    const nextIndex =
      move === "first"
        ? 0
        : move === "last"
          ? last
          : Math.min(Math.max(index + (move === "next" ? 1 : -1), 0), last);
    const next = selectableRows[nextIndex];
    if (next === undefined) return;
    pendingRowFocus.current = next.id;
    onSelect(next.id);
  };
  const toggleGroup = (id: string, expanded: boolean) => {
    setExpansion((current) => new Map(current).set(id, !expanded));
  };
  const assignedFromList = (id: string) => {
    setAssignedId(id);
    onAssigned(id);
  };

  let empty: string;
  const filtered = counts[filter] > 0;
  if (query.trim() !== "" && filtered) empty = t("noMatch", { query: query.trim() });
  else if (page.tickets.length > 0 || page.errors.length > 0) empty = t("empty");
  else if (page.trackerProjectCount === 0) empty = t("noProjects");
  else empty = t("noTickets");

  return (
    <ScreenLayout
      header={
        <PageHeader
          title={t("title")}
          subtitle={t("summary", { count: counts.assignable })}
          {...(page.trackerProjectCount === 0
            ? {}
            : {
                actions: <RereadButton result={reread.result} onStart={reread.start} />,
              })}
        />
      }
    >
      <SplitView
        fill={false}
        stackedListShare="larger"
        list={
          <div {...stylex.props(styles.listFrame)}>
            <div {...stylex.props(styles.listTop)}>
              {page.errors.length === 0 && reread.result !== "failed" ? null : (
                <Card surface="problem">
                  <div {...stylex.props(styles.lines)}>
                    {reread.result === "failed" ? (
                      <Text variant="body">{t("reread.failed")}</Text>
                    ) : null}
                    {page.errors.map((error) => (
                      <Text key={error.trackerProject} variant="body">
                        {t(`loadError.${error.reason}`, { project: error.trackerProject })}
                      </Text>
                    ))}
                  </div>
                </Card>
              )}
              {page.truncated.length === 0 ? null : (
                <div {...stylex.props(styles.lines)}>
                  {page.truncated.map((cut) => (
                    <Text key={cut.trackerProject} variant="meta">
                      {t("truncated", { project: cut.trackerProject, limit: cut.limit })}
                    </Text>
                  ))}
                </div>
              )}
              <div {...stylex.props(styles.toolbar)}>
                <SegmentedTabs<TicketFilter>
                  value={filter}
                  onValueChange={onFilterChange}
                  label={t("filter.label")}
                  items={TICKET_FILTERS.map((key) => ({
                    value: key,
                    label: t(`filter.${key}`),
                    count: counts[key],
                  }))}
                />
                <div {...stylex.props(styles.search)}>
                  <Input
                    type="search"
                    aria-label={t("search.label")}
                    value={query}
                    onValueChange={setQuery}
                    placeholder={t("search.placeholder")}
                    autoComplete="off"
                  />
                </div>
                <IconToggleGroup<TicketListView>
                  label={t("view.label")}
                  value={view}
                  onValueChange={(next) => onViewChange?.(next)}
                  items={[
                    { value: "grouped", label: t("view.grouped"), icon: <GroupedViewIcon /> },
                    { value: "flat", label: t("view.flat"), icon: <FlatViewIcon /> },
                  ]}
                />
              </div>
            </div>
            <div {...stylex.props(styles.tableFrame)}>
              <IssueListFrame>
                <IssueListHead
                  keyLabel={t("columns.key")}
                  titleLabel={t("columns.title")}
                  runLabel={t("columns.lastRun")}
                  indented={view === "grouped"}
                />
                <div
                  ref={scrollRef}
                  data-more-below={moreBelow}
                  {...stylex.props(styles.scroll, moreBelow && styles.fadeBottom)}
                >
                  <div ref={listRef}>
                    {rows.length === 0 ? (
                      <TableEmpty>
                        {page.tickets.length === 0 && page.errors.length === 0 ? (
                          <MascotMessage mood="resting" size="small">
                            {empty}
                          </MascotMessage>
                        ) : (
                          empty
                        )}
                      </TableEmpty>
                    ) : (
                      <IssueList label={t("listLabel")} onMove={moveSelection}>
                        {rowWindow.spaceBefore > 0 ? (
                          <div aria-hidden="true" style={{ height: rowWindow.spaceBefore }} />
                        ) : null}
                        {rows.slice(rowWindow.start, rowWindow.end).map((row) => (
                          <TicketListRowView
                            key={row.id}
                            row={row}
                            page={page}
                            selected={row.id === effectiveId}
                            tabbable={
                              row.id === (selectedIndex < 0 ? selectableRows[0]?.id : effectiveId)
                            }
                            onSelect={onSelect}
                            onToggle={toggleGroup}
                            onOpenRun={onOpenRun}
                            onAssign={onAssign}
                            onAssigned={assignedFromList}
                          />
                        ))}
                        {rowWindow.spaceAfter > 0 ? (
                          <div aria-hidden="true" style={{ height: rowWindow.spaceAfter }} />
                        ) : null}
                      </IssueList>
                    )}
                  </div>
                </div>
              </IssueListFrame>
            </div>
          </div>
        }
        panel={
          selectedGroup !== null ? (
            <section aria-label={t("panel.label")}>
              <ParentIssuePanel
                key={selectedGroup.id}
                group={selectedGroup}
                onSelectTicket={(id) => {
                  setRelationPickedId(id);
                  onSelect(id);
                }}
                onOpenRun={onOpenRun}
                onOpenRuns={onOpenRuns}
                focusTitle={relationPickedId === selectedGroup.id}
                onFocusedTitle={() => setRelationPickedId(null)}
              />
            </section>
          ) : selectedTicket === undefined ? null : (
            <section aria-label={t("panel.label")}>
              <TicketPanel
                key={selectedTicket.id}
                ticket={selectedTicket}
                page={page}
                onOpenRun={onOpenRun}
                onOpenRuns={onOpenRuns}
                onSelectTicket={(id) => {
                  setRelationPickedId(id);
                  onSelect(id);
                }}
                focusTitle={relationPickedId === selectedTicket.id}
                onFocusedTitle={() => setRelationPickedId(null)}
                onAssign={onAssign}
                onReadBlockers={onReadBlockers}
                rereads={reread.rereads}
                onAssigned={() => {
                  setAssignedId(selectedTicket.id);
                  onAssigned(selectedTicket.id);
                }}
                focusOpenRun={assignedId === selectedTicket.id}
                onFocusedOpenRun={() => setAssignedId(null)}
              />
            </section>
          )
        }
      />
    </ScreenLayout>
  );
}

function useMoreBelow(
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  rowCount: number,
): boolean {
  const [moreBelow, setMoreBelow] = useState(false);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) return;
    const update = () => {
      setMoreBelow(scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    if (contentRef.current !== null) observer.observe(contentRef.current);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scrollRef, contentRef, rowCount]);
  return moreBelow;
}

interface TicketListRowViewProps {
  row: TicketListRow;
  page: TicketsPage;
  selected: boolean;
  tabbable: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, expanded: boolean) => void;
  onOpenRun: (runId: string) => void;
  onAssign: TicketsScreenProps["onAssign"];
  onAssigned: (id: string) => void;
}

function TicketListRowView({ row, ...props }: TicketListRowViewProps) {
  const t = useTranslations("tickets.group");
  switch (row.kind) {
    case "loose-head":
      return <IssueGroupLabel rowKey={row.id} name={t("noParent")} count={row.count} />;
    case "parent":
      return (
        <ParentRow
          rowKey={row.id}
          group={row.group}
          toggle={{
            expanded: row.expanded,
            label: t(row.expanded ? "collapse" : "expand", { key: row.group.root.key }),
            onToggle: () => props.onToggle(row.id, row.expanded),
          }}
          surface={row.surface}
          indent="top"
          {...props}
        />
      );
    case "child":
      return <TicketRow ticket={row.ticket} indent="child" surface={row.surface} {...props} />;
    case "loose":
      return <TicketRow ticket={row.ticket} indent="top" {...props} />;
    case "flat":
      return row.group === null ? (
        <TicketRow ticket={row.ticket} indent="none" showParentLine {...props} />
      ) : (
        <ParentRow rowKey={row.id} group={row.group} indent="none" showParentLine {...props} />
      );
  }
}

type RowCommon = Omit<TicketListRowViewProps, "row" | "onToggle">;

function ParentRow({
  rowKey,
  group,
  toggle,
  surface,
  indent,
  showParentLine = false,
  selected,
  tabbable,
  onSelect,
}: RowCommon & {
  rowKey: string;
  group: TicketGroup;
  toggle?: { expanded: boolean; label: string; onToggle: () => void };
  surface?: "none" | "first" | "middle" | "last" | "only";
  indent: "none" | "top";
  showParentLine?: boolean;
}) {
  const t = useTranslations("tickets.group");
  const { progress, root, rootTicket } = group;
  const parentLine = showParentLine ? rootTicket?.ancestors[0] : undefined;
  return (
    <IssueRow
      rowKey={rowKey}
      label={`${root.key} ${root.title}`}
      selected={selected}
      tabbable={tabbable}
      onSelect={() => onSelect(group.id)}
      indent={indent}
      {...(surface === undefined ? {} : { surface })}
      {...(toggle === undefined ? {} : { toggle })}
      icon={
        <ProgressRing
          done={progress.done}
          total={progress.total}
          label={t("progress", { done: progress.done, total: progress.total })}
        />
      }
      ticketKey={root.key}
      title={root.title}
      strong
      titleAfter={t("count", { done: progress.done, total: progress.total })}
      {...(parentLine === undefined
        ? {}
        : { below: t("parentLine", { key: parentLine.key, title: parentLine.title }) })}
      run={<GroupRunSummary group={group} />}
    />
  );
}

function TicketRow({
  ticket,
  indent,
  surface,
  showParentLine = false,
  page,
  selected,
  tabbable,
  onSelect,
  onOpenRun,
  onAssign,
  onAssigned,
}: RowCommon & {
  ticket: TicketView;
  indent: "none" | "top" | "child";
  surface?: "none" | "first" | "middle" | "last" | "only";
  showParentLine?: boolean;
}) {
  const t = useTranslations("tickets.group");
  const parent = showParentLine ? ticket.ancestors[0] : undefined;
  return (
    <IssueRow
      rowKey={ticket.id}
      label={`${ticket.key} ${ticket.title}`}
      selected={selected}
      tabbable={tabbable}
      onSelect={() => onSelect(ticket.id)}
      indent={indent}
      {...(surface === undefined ? {} : { surface })}
      icon={
        <IssueStateIcon
          kind={issueStateKind(ticket.trackerState.category)}
          label={ticket.trackerState.name}
        />
      }
      ticketKey={ticket.key}
      title={ticket.title}
      {...(ticket.blockerWait === null
        ? {}
        : { titleAfter: <WaitMark wait={ticket.blockerWait} /> })}
      {...(parent === undefined
        ? {}
        : { below: t("parentLine", { key: parent.key, title: parent.title }) })}
      run={<TicketRunCell ticket={ticket} />}
      action={
        <TicketRowActionButton
          ticket={ticket}
          page={page}
          onOpenRun={onOpenRun}
          onAssign={onAssign}
          onAssigned={onAssigned}
        />
      }
    />
  );
}

function runDisplayStatus(run: TicketRun): PillStatus {
  return run.state !== "ended" && run.waitingOn !== null ? run.waitingOn : runStatus(run);
}

function TicketRunCell({ ticket }: { ticket: TicketView }) {
  const t = useTranslations("tickets");
  const statusName = useStatusName();
  const run = lastRun(ticket);
  if (run === undefined) return <Text variant="meta">{t("unassigned")}</Text>;
  if (run.state === "ended" && run.summary === "succeeded" && currentPrState(run) === "merged")
    return (
      <Text variant="meta" tone="muted">
        {run.pullRequest === null
          ? t("row.mergedNoNumber")
          : t("row.merged", { pr: run.pullRequest })}
      </Text>
    );
  const status = runDisplayStatus(run);
  const name = statusName(status);
  return (
    <span {...stylex.props(styles.runLine)}>
      <StatusDot status={status} />
      <Text variant="meta">
        {run.state === "running" && run.runnerName !== null ? `${name} · ${run.runnerName}` : name}
      </Text>
    </span>
  );
}

function GroupRunSummary({ group }: { group: TicketGroup }) {
  const t = useTranslations("tickets.group");
  const statusName = useStatusName();
  const counts = new Map<PillStatus, number>();
  for (const child of group.children) {
    const run = lastRun(child);
    if (run === undefined) continue;
    if (run.state === "ended" && run.summary !== "failed") continue;
    const status = runDisplayStatus(run);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  if (counts.size === 0)
    return (
      <Text variant="meta" tone="muted">
        {t("noActiveRuns")}
      </Text>
    );
  return (
    <Text variant="meta">
      {[...counts].map(([status, count]) => `${statusName(status)} ${count}`).join(" · ")}
    </Text>
  );
}

function TicketRowActionButton({
  ticket,
  page,
  onOpenRun,
  onAssign,
  onAssigned,
}: {
  ticket: TicketView;
  page: TicketsPage;
  onOpenRun: (runId: string) => void;
  onAssign: TicketsScreenProps["onAssign"];
  onAssigned: (id: string) => void;
}) {
  const t = useTranslations("tickets.row");
  const action = rowActionOf(ticket);
  const run = lastRun(ticket);
  if (action === null) return null;
  if (action === "answer" || action === "open-run") {
    if (run === undefined) return null;
    return (
      <Button compact onClick={() => onOpenRun(run.id)}>
        {action === "answer" ? t("answer") : t("openRun")}
      </Button>
    );
  }
  if (ticket.assignability.kind !== "ready") return null;
  return (
    <AssignDialog
      ticket={ticket}
      defaults={ticket.assignability.defaults}
      runners={page.runners}
      agents={page.agents}
      triggerLabel={action === "assign" ? t("assign") : t("newRun")}
      triggerInRow
      onAssign={onAssign}
      onAssigned={() => onAssigned(ticket.id)}
    />
  );
}

function ParentIssuePanel({
  group,
  onSelectTicket,
  onOpenRun,
  onOpenRuns,
  focusTitle,
  onFocusedTitle,
}: {
  group: TicketGroup;
  onSelectTicket: (id: string) => void;
  onOpenRun: (runId: string) => void;
  onOpenRuns: (ticket: TicketView) => void;
  focusTitle: boolean;
  onFocusedTitle: () => void;
}) {
  const t = useTranslations("tickets.panel");
  const tTickets = useTranslations("tickets");
  const statusName = useStatusName();
  const titleRef = useRef<HTMLElement>(null);
  const { root, rootTicket, progress, children } = group;
  useEffect(() => {
    if (!focusTitle) return;
    titleRef.current?.focus();
    onFocusedTitle();
  }, [focusTitle, onFocusedTitle]);
  const meta = [root.key, rootTicket?.trackerProject.name, t("parentIssue")]
    .filter((part) => part !== undefined)
    .join(" · ");
  return (
    <DetailPanel>
      <div {...stylex.props(styles.panelHead)}>
        <div {...stylex.props(styles.panelMeta)}>
          <Text variant="meta" numeric wrap="anywhere">
            {meta}
          </Text>
          {root.url === null ? null : (
            <ExternalIconLink href={root.url} label={`${t("openInLinear")} (${t("newTab")})`} />
          )}
        </div>
        <Text ref={titleRef} tabIndex={-1} variant="heading">
          {root.title}
        </Text>
        <div {...stylex.props(styles.chips)}>
          <Chip wrapText>{root.state.name}</Chip>
        </div>
        {rootTicket === null ? <Text variant="body">{t("outOfScope")}</Text> : null}
      </div>
      <PanelSection title={t("childrenTitle")} titleRole="subheading" count={children.length}>
        <span {...stylex.props(styles.runLine)}>
          <ProgressRing
            done={progress.done}
            total={progress.total}
            label={tTickets("group.progress", { done: progress.done, total: progress.total })}
          />
          <Text variant="meta">
            {t("childrenProgress", {
              total: progress.total,
              done: progress.done,
              inProgress: progress.inProgress,
              remaining: progress.remaining,
            })}
          </Text>
        </span>
        <PanelList>
          {children.map((child) => {
            const run = lastRun(child);
            return (
              <PanelListRow
                key={child.id}
                marker={
                  <IssueStateIcon
                    kind={issueStateKind(child.trackerState.category)}
                    label={child.trackerState.name}
                  />
                }
                ticketKey={child.key}
                title={child.title}
                done={child.trackerState.category === "completed"}
                {...(run === undefined ? {} : { trailing: statusName(runDisplayStatus(run)) })}
                onClick={() => onSelectTicket(child.id)}
              />
            );
          })}
        </PanelList>
      </PanelSection>
      {rootTicket === null ? null : (
        <>
          <PanelSection title={t("ticketInfo")} titleRole="subheading">
            <DefinitionList>
              <DefinitionItem label={t("priority")} empty={rootTicket.priority === "none"}>
                {rootTicket.priority === "none"
                  ? t("none")
                  : tTickets(`priority.${rootTicket.priority}`)}
              </DefinitionItem>
              <DefinitionItem label={t("labels")} empty={rootTicket.labels.length === 0}>
                {rootTicket.labels.length === 0 ? (
                  t("none")
                ) : (
                  <span {...stylex.props(styles.chips)}>
                    {rootTicket.labels.map((label) => (
                      <Chip key={label.name} wrapText>
                        {label.name}
                      </Chip>
                    ))}
                  </span>
                )}
              </DefinitionItem>
            </DefinitionList>
          </PanelSection>
          <TicketRuns ticket={rootTicket} onOpenRun={onOpenRun} onOpenRuns={onOpenRuns} />
        </>
      )}
    </DetailPanel>
  );
}

function WaitMark({ wait }: { wait: BlockerReason }) {
  const t = useTranslations("domain.blocker");
  const unfinished = wait.blockers.filter((blocker) => !isBlockerFinished(blocker.stateCategory));
  if (wait.kind === "blockers-stuck") {
    const shown = wait.blocker ?? unfinished[0];
    const cause = t(`stuckCause.${wait.cause}`);
    return (
      <span {...stylex.props(styles.waitMark)}>
        {shown === undefined ? (
          <Text variant="meta" tone="problem">
            {cause}
          </Text>
        ) : (
          <BlockerChip
            state={wait.cause === "canceled" ? "canceled" : "stuck"}
            ticketKey={shown.key}
            stateName={cause}
          />
        )}
      </span>
    );
  }
  const [first, ...rest] = unfinished;
  if (first === undefined) return null;
  return (
    <span {...stylex.props(styles.waitMark)}>
      <BlockerChip
        state={blockerChipState(first.stateCategory)}
        ticketKey={first.key}
        stateName={t("waiting")}
      />
      {rest.length === 0 ? null : <Text variant="meta">{t("more", { count: rest.length })}</Text>}
    </span>
  );
}

export type BlockerRead =
  | { status: "idle" }
  | { status: "reading" }
  | { status: "done"; result: TicketBlockersResult };

function storedBlockerRead(stored: BlockerReason): BlockerRead {
  const blockers = allBlockersOf(stored);
  const unread =
    stored.kind === "blockers-stuck" && stored.cause === "unreadable" && blockers.length === 0;
  return {
    status: "done",
    result: unread ? { ok: false, reason: "failed" } : { ok: true, blockers },
  };
}

function useTicketBlockers(
  ticket: TicketView,
  onReadBlockers: TicketsScreenProps["onReadBlockers"],
  rereads: number,
) {
  const [read, setRead] = useState<BlockerRead>({ status: "idle" });
  const latestRead = useRef(0);
  const seenRereads = useRef(rereads);
  const start = () => {
    latestRead.current += 1;
    const thisRead = latestRead.current;
    setRead({ status: "reading" });
    onReadBlockers(ticket).then(
      (result) => {
        if (latestRead.current === thisRead) setRead({ status: "done", result });
      },
      () => {
        if (latestRead.current === thisRead)
          setRead({ status: "done", result: { ok: false, reason: "failed" } });
      },
    );
  };
  useEffect(() => {
    if (seenRereads.current === rereads) return;
    seenRereads.current = rereads;
    if (ticket.blockerWait === null && read.status !== "idle") start();
  }, [rereads]);
  return ticket.blockerWait === null
    ? { read, start }
    : { read: storedBlockerRead(ticket.blockerWait), start: null };
}

function RelationGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} {...stylex.props(styles.relationGroup)}>
      <span id={titleId}>
        <Text variant="label">{title}</Text>
        {count === 0 ? null : (
          <>
            {" "}
            <Text variant="label" tone="muted" numeric>
              {count}
            </Text>
          </>
        )}
      </span>
      {children}
    </div>
  );
}

function BlockerReadStatus({ read }: { read: BlockerRead }) {
  const t = useTranslations("tickets.panel");
  if (read.status === "idle") return <Text variant="meta">{t("blockersUnread")}</Text>;
  if (read.status === "reading") return <Text variant="meta">{t("blockersReadingNote")}</Text>;
  if (!read.result.ok)
    return (
      <Text variant="meta" tone="problem">
        {t(`blockersFailed.${read.result.reason}`)}
      </Text>
    );
  if (read.result.blockers.length === 0) return <Text variant="meta">{t("blockersNone")}</Text>;
  return (
    <VisuallyHidden>{t("blockersLoaded", { count: read.result.blockers.length })}</VisuallyHidden>
  );
}

export interface TicketRelationsProps {
  ticket: TicketView;
  tickets: ReadonlyArray<TicketView>;
  read: BlockerRead;
  onRead: (() => void) | null;
  onSelectTicket: (ticketId: string) => void;
}

export function TicketRelations({
  ticket,
  tickets,
  read,
  onRead,
  onSelectTicket,
}: TicketRelationsProps) {
  const t = useTranslations("tickets.panel");
  const statusName = useStatusName();
  const blockers = read.status === "done" && read.result.ok ? read.result.blockers : [];
  const known = new Map(tickets.map((candidate) => [candidate.id, candidate]));
  const pick = (key: string) => {
    const id = ticketId(ticket.connection, key);
    return known.has(id) ? { onClick: () => onSelectTicket(id) } : {};
  };
  return (
    <PanelSection
      title={t("relations")}
      titleRole="subheading"
      info={<InfoTip label={t("relationsInfo")} content={t("relationsNote")} />}
      {...(onRead === null
        ? {}
        : {
            meta: (
              <Button
                compact
                busy={{ active: read.status === "reading", label: t("blockersReading") }}
                onClick={onRead}
              >
                {read.status === "done" ? t("blockersReread") : t("blockersRead")}
              </Button>
            ),
          })}
    >
      <RelationGroup title={t("blockers")} count={blockers.length}>
        <div role="status">
          <BlockerReadStatus read={read} />
        </div>
        {blockers.length === 0 ? null : (
          <PanelList>
            {blockers.map((blocker) => {
              const state = blockerChipState(blocker.stateCategory);
              return (
                <PanelListRow
                  key={blocker.key}
                  marker={<span aria-hidden="true" {...stylex.props(blockerDotStyles(state))} />}
                  ticketKey={blocker.key}
                  title={blocker.title}
                  done={state === "done"}
                  trailing={blocker.stateName}
                  {...pick(blocker.key)}
                />
              );
            })}
          </PanelList>
        )}
      </RelationGroup>
      <RelationGroup title={t("waiting")} count={ticket.waitingTickets.length}>
        {ticket.waitingTickets.length === 0 ? (
          <Text variant="meta">{t("waitingNone")}</Text>
        ) : (
          <PanelList>
            {ticket.waitingTickets.map((waiter) => {
              const found = known.get(ticketId(ticket.connection, waiter.key));
              const run = found === undefined ? undefined : lastRun(found);
              const status = run === undefined ? null : runStatus(run);
              return (
                <PanelListRow
                  key={waiter.key}
                  ticketKey={waiter.key}
                  title={found?.title ?? waiter.title ?? ""}
                  {...(status === null
                    ? {}
                    : {
                        marker: <StatusDot status={status} />,
                        trailing: statusName(status),
                      })}
                  {...pick(waiter.key)}
                />
              );
            })}
          </PanelList>
        )}
      </RelationGroup>
    </PanelSection>
  );
}

export const VISIBLE_RUN_ROWS = 5;

function TicketRuns({
  ticket,
  onOpenRun,
  onOpenRuns,
}: {
  ticket: TicketView;
  onOpenRun: (runId: string) => void;
  onOpenRuns: (ticket: TicketView) => void;
}) {
  const t = useTranslations("tickets.panel");
  const statusName = useStatusName();
  if (ticket.runs.length === 0) return null;
  return (
    <PanelSection title={t("runs")} titleRole="subheading" count={ticket.runs.length}>
      <PanelList>
        {ticket.runs.slice(0, VISIBLE_RUN_ROWS).map((run) => {
          const status = runStatus(run);
          return (
            <PanelListRow
              key={run.id}
              marker={<StatusDot status={status} />}
              title={`${statusName(status)} · ${run.runnerName ?? t("noRunnerName")}`}
              trailing={<RunTime run={run} />}
              onClick={() => onOpenRun(run.id)}
            />
          );
        })}
      </PanelList>
      {ticket.runs.length <= VISIBLE_RUN_ROWS ? null : (
        <div>
          <Button variant="ghost" compact onClick={() => onOpenRuns(ticket)}>
            {t("runsAll")}
          </Button>
        </div>
      )}
    </PanelSection>
  );
}

function readableRepo(repo: { id: string; name: string } | undefined, fallback: string): string {
  const name = repo?.name ?? fallback;
  return name === (repo?.id ?? fallback) ? name.replace(/^[a-z][a-z0-9-]*:/, "") : name;
}

function AssignmentSetup({ ticket }: { ticket: TicketView }) {
  const t = useTranslations("tickets.panel");
  const agentName = useAgentName();
  const { mapping } = ticket;
  const labels = ticket.labels.toSorted((a, b) => Number(b.autoAssign) - Number(a.autoAssign));
  return (
    <PanelSection title={t("setup")} titleRole="subheading">
      <DefinitionList>
        <DefinitionItem label={t("mapping")} empty={mapping === null}>
          {mapping === null
            ? t("noMapping")
            : t("mappingValue", {
                project: readableRepo(
                  mapping.repos.find((repo) => repo.id === mapping.runnerProject),
                  mapping.runnerProject,
                ),
                agent: agentName(mapping.agent),
              })}
        </DefinitionItem>
        <DefinitionItem label={t("labels")} empty={labels.length === 0}>
          {labels.length === 0 ? (
            t("none")
          ) : (
            <span {...stylex.props(styles.chips)}>
              {labels.map((label) =>
                label.autoAssign ? (
                  <Chip key={label.name} tone="accent" wrapText>
                    {`${label.name} · ${t("autoAssign")}`}
                  </Chip>
                ) : (
                  <Chip key={label.name} wrapText>
                    {label.name}
                  </Chip>
                ),
              )}
            </span>
          )}
        </DefinitionItem>
      </DefinitionList>
    </PanelSection>
  );
}

function LastRunStatus({ run }: { run: TicketRun | undefined }) {
  const t = useTranslations("tickets");
  const statusName = useStatusName();
  if (run === undefined) return <Text variant="meta">{t("unassigned")}</Text>;
  const status = runStatus(run);
  return <StatusPill status={status}>{statusName(status)}</StatusPill>;
}

type NextStep =
  | "parent-issue"
  | "unassigned"
  | "no-mapping"
  | "queued"
  | "running"
  | "waiting-for-input"
  | "paused"
  | "disconnected"
  | "succeeded"
  | "failed"
  | "canceled";

function nextStepOf(ticket: TicketView): NextStep {
  const run = lastRun(ticket);
  if (ticket.assignability.kind === "parent-issue") return "parent-issue";
  if (ticket.assignability.kind === "no-mapping") return "no-mapping";
  if (run === undefined) return "unassigned";
  if (run.state !== "ended") return run.state;
  return run.summary;
}

function useNextSentence(ticket: TicketView, read: BlockerRead): string {
  const t = useTranslations("tickets.panel");
  const queuedReasonText = useQueuedReasonText();
  if (ticket.blockerWait !== null) return queuedReasonText(ticket.blockerWait);
  const step = nextStepOf(ticket);
  if (step !== "unassigned" || read.status !== "done" || !read.result.ok) return t(`next.${step}`);
  const unfinished = read.result.blockers.filter(
    (blocker) => !isBlockerFinished(blocker.stateCategory),
  );
  const [first] = unfinished;
  if (first === undefined || unfinished.some((blocker) => blocker.stateCategory === "canceled"))
    return t(`next.${step}`);
  return t("next.unassignedBlocked", { key: first.key, rest: unfinished.length - 1 });
}

function TicketPanel({
  ticket,
  page,
  onOpenRun,
  onOpenRuns,
  onSelectTicket,
  focusTitle,
  onFocusedTitle,
  onAssign,
  onReadBlockers,
  rereads,
  onAssigned,
  focusOpenRun,
  onFocusedOpenRun,
}: {
  ticket: TicketView;
  page: TicketsPage;
  onOpenRun: (runId: string) => void;
  onOpenRuns: (ticket: TicketView) => void;
  onSelectTicket: (ticketId: string) => void;
  focusTitle: boolean;
  onFocusedTitle: () => void;
  onAssign: TicketsScreenProps["onAssign"];
  onReadBlockers: TicketsScreenProps["onReadBlockers"];
  rereads: number;
  onAssigned: () => void;
  focusOpenRun: boolean;
  onFocusedOpenRun: () => void;
}) {
  const t = useTranslations("tickets.panel");
  const tTickets = useTranslations("tickets");
  const { read, start } = useTicketBlockers(ticket, onReadBlockers, rereads);
  const nextSentence = useNextSentence(ticket, read);
  const run = lastRun(ticket);
  const { assignability } = ticket;
  const openRunRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusOpenRun) return;
    const button = openRunRef.current?.querySelector("button");
    if (button === null || button === undefined) return;
    button.focus();
    onFocusedOpenRun();
  }, [focusOpenRun, assignability.kind, onFocusedOpenRun]);
  useEffect(() => {
    if (!focusTitle) return;
    titleRef.current?.focus();
    onFocusedTitle();
  }, [focusTitle, onFocusedTitle]);

  const openRunId = assignability.kind === "active-run" ? assignability.runId : run?.id;
  const parentIssue = ticket.ancestors[0];
  const parentId = parentIssue === undefined ? "" : ticketId(ticket.connection, parentIssue.key);
  const topIssue = ticket.ancestors.at(-1);
  const parentIsKnown =
    page.tickets.some((candidate) => candidate.id === parentId) ||
    (topIssue !== undefined && parentIssue?.key === topIssue.key);
  return (
    <DetailPanel>
      <div {...stylex.props(styles.panelHead)}>
        <div {...stylex.props(styles.panelMeta)}>
          <Text variant="meta" numeric wrap="anywhere">
            {`${ticket.key} · ${ticket.trackerProject.name}`}
          </Text>
          {ticket.url === null ? null : (
            <ExternalIconLink href={ticket.url} label={`${t("openInTracker")} (${t("newTab")})`} />
          )}
        </div>
        <Text ref={titleRef} tabIndex={-1} variant="heading">
          {ticket.title}
        </Text>
        <div {...stylex.props(styles.chips)}>
          <Chip wrapText>{ticket.trackerState.name}</Chip>
          {ticket.priority === "none" ? null : (
            <Chip>{tTickets(`priority.${ticket.priority}`)}</Chip>
          )}
        </div>
        {parentIssue === undefined ? null : (
          <Text variant="meta" wrap="anywhere">
            {`${t("parentLink")} `}
            {parentIsKnown ? (
              <Button variant="ghost" compact onClick={() => onSelectTicket(parentId)}>
                {`${parentIssue.key} ${parentIssue.title}`}
              </Button>
            ) : (
              `${parentIssue.key} ${parentIssue.title}`
            )}
          </Text>
        )}
      </div>
      <Card label={t("lastRun")}>
        <div {...stylex.props(styles.lastRun)}>
          <div {...stylex.props(styles.lastRunState)}>
            {run === undefined ? (
              <Text variant="ui">{t("noRun")}</Text>
            ) : (
              <>
                <LastRunStatus run={run} />
                <span {...stylex.props(styles.lastRunRunner)}>
                  <Text variant="meta" wrap="anywhere">
                    {run.runnerName ?? t("noRunnerName")}
                  </Text>
                  {run.state === "ended" ? <RunPullRequest run={run} /> : null}
                </span>
                <RunTime run={run} />
              </>
            )}
          </div>
          <Text variant="body">{nextSentence}</Text>
          <Actions>
            {assignability.kind === "ready" ? (
              <AssignDialog
                ticket={ticket}
                defaults={assignability.defaults}
                runners={page.runners}
                agents={page.agents}
                triggerLabel={run === undefined ? t("assign") : t("reassign")}
                onAssign={onAssign}
                onAssigned={onAssigned}
              />
            ) : null}
            {openRunId === undefined ? null : (
              <span ref={openRunRef} {...stylex.props(styles.contents)}>
                <Button onClick={() => onOpenRun(openRunId)}>{t("openRun")}</Button>
              </span>
            )}
          </Actions>
        </div>
      </Card>
      <TicketRelations
        ticket={ticket}
        tickets={page.tickets}
        read={read}
        onRead={start}
        onSelectTicket={onSelectTicket}
      />
      <TicketRuns ticket={ticket} onOpenRun={onOpenRun} onOpenRuns={onOpenRuns} />
      <AssignmentSetup ticket={ticket} />
    </DetailPanel>
  );
}

function RunPullRequest({ run }: { run: TicketRun & { state: "ended" } }) {
  const t = useTranslations("tickets.panel");
  const domain = useTranslations("domain");
  const state = currentPrState(run);
  if (state === "none") return null;
  const stateName = domain(`prState.${state}`);
  return (
    <Text variant="meta">
      {run.pullRequest === null
        ? t("prState", { state: stateName })
        : t("pullRequest", { pr: run.pullRequest, state: stateName })}
    </Text>
  );
}

function RunTime({ run }: { run: TicketRun }) {
  const { ago, elapsed } = useTime();
  return run.state === "ended" ? (
    <TimeSlot dateTime={run.endedAt}>{ago(run.endedAt, run.endedAgoMs)}</TimeSlot>
  ) : (
    <TimeSlot>{elapsed(run.elapsedMs)}</TimeSlot>
  );
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
  listFrame: {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    height: "100%",
    minHeight: 0,
  },
  listTop: { display: "flex", flexDirection: "column", gap: space.s4, paddingBottom: space.s4 },
  lines: { display: "flex", flexDirection: "column", gap: space.s1 },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  search: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: size.searchMinWidth,
    maxWidth: size.searchMaxWidth,
  },
  tableFrame: { display: "grid", gridTemplateRows: "minmax(0, 1fr)", minHeight: 0 },
  scroll: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  fadeBottom: {
    maskImage: `linear-gradient(to bottom, currentColor calc(100% - ${space.s10}), transparent)`,
  },
  contents: { display: "contents" },
  panelHead: { display: "flex", flexDirection: "column", gap: space.s2 },
  lastRun: { display: "flex", flexDirection: "column", gap: space.s3 },
  panelMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
    minWidth: 0,
  },
  lastRunState: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  lastRunRunner: {
    display: "flex",
    flexGrow: 1,
    flexShrink: 1,
    flexWrap: "wrap",
    columnGap: space.s2,
    minWidth: 0,
  },
  chips: { display: "flex", flexWrap: "wrap", gap: space.px6, minWidth: 0 },
  relationGroup: { display: "flex", flexDirection: "column", gap: space.px6, minWidth: 0 },
  waitMark: { display: "inline-flex", flexShrink: 0, alignItems: "center", gap: space.s1 },
  runLine: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
});
