import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  BackLink,
  Button,
  CloseIcon,
  Card,
  DependencyGraph,
  Spinner,
  Checkbox,
  DefinitionItem,
  DefinitionList,
  DetailPanel,
  Dialog,
  DialogClose,
  Field,
  FlatViewIcon,
  GroupedViewIcon,
  ISSUE_STATE_KINDS,
  IconToggleGroup,
  Input,
  IssueGroupLabel,
  IssueGroupBody,
  IssueGroupLine,
  IssueList,
  IssueListFrame,
  IssueListHead,
  IssueRow,
  IssueStateIcon,
  Menu,
  MenuItem,
  MenuRadio,
  MenuRadioOption,
  MenuSeparator,
  PanelBlock,
  PanelFooter,
  PanelHeader,
  PILL_STATUSES,
  PinnedToast,
  ProgressRing,
  Row,
  RowActionSlot,
  RowReason,
  RowTitle,
  Section,
  Select,
  SplitView,
  StatusPill,
  Tab,
  TabPanel,
  Table,
  TableCell,
  TableEmpty,
  TableFoldedOnly,
  TableHead,
  TableHeader,
  TableRow,
  TableRows,
  Tabs,
  Text,
  TimeSlot,
  Tooltip,
  linkStyles,
  showToast,
  statusTone,
  type PillStatus,
  useIssueGroupMotion,
} from "@ganger/ui";
import { colors, fontWeight, radius, space } from "@ganger/ui/tokens.stylex";
import { useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useStatusName } from "../status";

type RunId = "r1051" | "r1049" | "r1047" | "r1044";

interface SampleRun {
  id: RunId;
  number: number;
  ticket: string;
  status: PillStatus;
  runner: string;
  agent: string;
  elapsed: string;
  pr: number | null;
  ci: "ciPassed" | "ciRunning" | null;
}

const runs: ReadonlyArray<SampleRun> = [
  {
    id: "r1051",
    number: 1051,
    ticket: "ACME-123",
    status: "succeeded",
    runner: "runner-a",
    agent: "Claude Code",
    elapsed: "42:10",
    pr: 418,
    ci: "ciPassed",
  },
  {
    id: "r1049",
    number: 1049,
    ticket: "ACME-119",
    status: "failed",
    runner: "runner-b",
    agent: "Codex",
    elapsed: "18:02",
    pr: null,
    ci: null,
  },
  {
    id: "r1047",
    number: 1047,
    ticket: "ACME-131",
    status: "running",
    runner: "runner-a",
    agent: "Claude Code",
    elapsed: "07:45",
    pr: null,
    ci: "ciRunning",
  },
  {
    id: "r1044",
    number: 1044,
    ticket: "ACME-108",
    status: "succeeded",
    runner: "runner-c",
    agent: "Codex",
    elapsed: "23:51",
    pr: 412,
    ci: "ciPassed",
  },
];

const runColumns = "minmax(0, 1fr) 96px 80px 96px 56px";
const runFoldedColumns = {
  first: "minmax(0, 1fr) 96px 80px 56px",
  second: "minmax(0, 1fr) 96px 56px",
};

type FilterKey = "all" | "todo" | "running" | "queued";

function Demo({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.demo)}>{children}</div>;
}

export function ComponentSections() {
  const t = useTranslations("ds");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<RunId>("r1051");
  const [workspace, setWorkspace] = useState("commerce");
  const [agent, setAgent] = useState<string | null>(null);
  const [graphFirst, setGraphFirst] = useState(true);
  const [web, setWeb] = useState(true);
  const [api, setApi] = useState(false);

  const statusName = useStatusName();
  const current = runs.find((r) => r.id === selected) ?? runs[0];

  return (
    <>
      <div id="buttons">
        <Section title={t("nav.buttons")} note={t("buttons.note")}>
          <Demo>
            <Actions>
              <Button variant="primary">{t("buttons.primary")}</Button>
              <Button>{t("buttons.secondary")}</Button>
              <Button variant="danger">{t("buttons.danger")}</Button>
              <Button variant="ghost">{t("buttons.ghost")}</Button>
              <Button compact outlined>
                {t("buttons.outlined")}
              </Button>
              <Button disabled>{t("buttons.disabled")}</Button>
              <Button busy={{ active: true, label: t("buttons.busyLabel") }}>
                {t("buttons.busy")}
              </Button>
            </Actions>
          </Demo>
        </Section>
      </div>

      <div id="status">
        <Section title={t("nav.status")} note={t("status.note")}>
          <Demo>
            <div {...stylex.props(styles.pills)}>
              {PILL_STATUSES.map((status) => (
                <span key={status} {...stylex.props(styles.pillSample)}>
                  <StatusPill status={status}>{statusName(status)}</StatusPill>
                  <Text variant="meta">{t(`status.tone.${statusTone(status)}`)}</Text>
                </span>
              ))}
            </div>
          </Demo>
        </Section>
      </div>

      <div id="card">
        <Section title={t("nav.card")} note={t("card.note")}>
          <div {...stylex.props(styles.cards)}>
            <Card label={t("card.label")}>
              <span {...stylex.props(styles.inline)}>
                <StatusPill status="question">{statusName("question")}</StatusPill>
                <Text variant="meta">ACME-1</Text>
                <Text variant="title">{t("card.ticketTitle")}</Text>
              </span>
              <Text variant="body">{t("card.body")}</Text>
              <Actions>
                <Button>{t("card.choiceA")}</Button>
                <Button>{t("card.choiceB")}</Button>
                <Button variant="danger">{t("card.deny")}</Button>
              </Actions>
            </Card>
            <Card padding="compact">
              <Row
                leading={<StatusPill status="running">{statusName("running")}</StatusPill>}
                trailing="10:02"
              >
                <Text variant="ui">{t("card.rowStarted")}</Text>
              </Row>
              <Row
                leading={<StatusPill status="queued">{statusName("queued")}</StatusPill>}
                trailing="10:01"
              >
                <Text variant="ui">{t("card.rowQueued")}</Text>
              </Row>
            </Card>
            <Text variant="meta" as="p">
              {t("card.timeNote")}
            </Text>
            <Card padding="compact" label={t("card.timeLabel")}>
              {(
                [
                  [t("card.timeSeconds"), t("card.answer")],
                  [t("card.timeMinutes"), t("card.deny")],
                  [t("card.timeHours"), t("card.answer")],
                  [t("card.timeDate"), null],
                ] as const
              ).map(([time, action]) => (
                <span key={time} {...stylex.props(styles.timeRow)}>
                  <span {...stylex.props(styles.timeRowBody)}>
                    <Row trailing={<TimeSlot>{time}</TimeSlot>}>
                      <Text variant="ui">{t("card.ticketTitle")}</Text>
                    </Row>
                  </span>
                  <RowActionSlot>
                    {action === null ? null : <Button>{action}</Button>}
                  </RowActionSlot>
                </span>
              ))}
            </Card>
          </div>
        </Section>
      </div>

      <div id="tabs">
        <Section title={t("nav.tabs")}>
          <Tabs<FilterKey>
            value={filter}
            onValueChange={setFilter}
            label={t("tabs.label")}
            panels={
              <>
                <TabPanel value="all">
                  <Text variant="meta">{t("tabs.panelAll")}</Text>
                </TabPanel>
                <TabPanel value="todo">
                  <Text variant="meta">{t("tabs.panelTodo")}</Text>
                </TabPanel>
                <TabPanel value="running">
                  <Text variant="meta">{t("tabs.panelRunning")}</Text>
                </TabPanel>
                <TabPanel value="queued">
                  <TableEmpty>{t("tabs.panelQueued")}</TableEmpty>
                </TabPanel>
              </>
            }
          >
            <Tab value="all" count={42}>
              {t("tabs.all")}
            </Tab>
            <Tab value="todo" count={2} attention>
              {t("tabs.todo")}
            </Tab>
            <Tab value="running" count={1}>
              {t("tabs.running")}
            </Tab>
            <Tab value="queued" count={0}>
              {t("tabs.queued")}
            </Tab>
          </Tabs>
          <Tabs<FilterKey>
            value={filter}
            onValueChange={setFilter}
            label={t("tabs.chipsLabel")}
            variant="chips"
          >
            <Tab value="all" count={42}>
              {t("tabs.all")}
            </Tab>
            <Tab value="todo" count={2} attention>
              {t("tabs.todo")}
            </Tab>
            <Tab value="running" count={1}>
              {t("tabs.running")}
            </Tab>
            <Tab value="queued" count={0}>
              {t("tabs.queued")}
            </Tab>
          </Tabs>
        </Section>
      </div>

      <div id="table">
        <Section title={t("nav.table")} note={t("table.note")}>
          <div {...stylex.props(styles.frame)}>
            <SplitView
              fill={false}
              list={
                <Table columns={runColumns} foldedColumns={runFoldedColumns}>
                  <TableHead>
                    <TableHeader>{t("table.colTicket")}</TableHeader>
                    <TableHeader>{t("table.colState")}</TableHeader>
                    <TableHeader hideWhen="second">{t("table.colRunner")}</TableHeader>
                    <TableHeader hideWhen="first">{t("table.colAgent")}</TableHeader>
                    <TableHeader align="end">{t("table.colElapsed")}</TableHeader>
                  </TableHead>
                  <TableRows
                    label={t("table.listLabel")}
                    value={selected}
                    onValueChange={(v) => {
                      const run = runs.find((r) => r.id === v);
                      if (run !== undefined) setSelected(run.id);
                    }}
                  >
                    {runs.map((run) => {
                      const reason = t(`table.rows.${run.id}.reason`);
                      return (
                        <TableRow
                          key={run.id}
                          value={run.id}
                          label={t(`table.rows.${run.id}.title`)}
                        >
                          <TableCell>
                            <RowTitle fullText={t(`table.rows.${run.id}.title`)}>
                              {t(`table.rows.${run.id}.title`)}
                            </RowTitle>
                            {reason === "" ? null : <RowReason>{reason}</RowReason>}
                            <TableFoldedOnly when="first" block>
                              <Text variant="meta">
                                <TableFoldedOnly when="second">
                                  {run.runner}
                                  {t("table.foldSeparator")}
                                </TableFoldedOnly>
                                {run.agent}
                              </Text>
                            </TableFoldedOnly>
                          </TableCell>
                          <TableCell>
                            <StatusPill status={run.status}>{statusName(run.status)}</StatusPill>
                          </TableCell>
                          <TableCell hideWhen="second">{run.runner}</TableCell>
                          <TableCell hideWhen="first">{run.agent}</TableCell>
                          <TableCell align="end" numeric>
                            {run.elapsed}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableRows>
                </Table>
              }
              panel={
                current === undefined ? null : (
                  <RunPanel run={current} stateLabel={statusName(current.status)} />
                )
              }
            />
          </div>
          <Text variant="meta">{t("table.editorNote")}</Text>
          <div {...stylex.props(styles.frame)}>
            <SplitView
              fill={false}
              variant="editor"
              list={
                <Table columns="minmax(0, 1fr)">
                  <TableRows
                    label={t("table.editorListLabel")}
                    value="general"
                    onValueChange={() => {}}
                  >
                    <TableRow value="general">
                      <TableCell>
                        <RowTitle>{t("table.editorItem")}</RowTitle>
                      </TableCell>
                    </TableRow>
                  </TableRows>
                </Table>
              }
              panel={
                <DetailPanel>
                  <PanelHeader title={t("table.editorItem")} />
                  <Field label={t("table.editorField")}>
                    <Input defaultValue="Acme Commerce" />
                  </Field>
                </DetailPanel>
              }
            />
          </div>
        </Section>
      </div>

      <div id="definitions">
        <Section title={t("nav.definitions")} note={t("definitions.note")}>
          <Demo>
            <DefinitionList>
              <DefinitionItem label={t("definitions.runner")}>runner-a</DefinitionItem>
              <DefinitionItem label={t("definitions.project")}>acme/web</DefinitionItem>
              <DefinitionItem label={t("definitions.pr")} empty>
                {t("definitions.none")}
              </DefinitionItem>
            </DefinitionList>
          </Demo>
        </Section>
      </div>

      <div id="menu">
        <Section title={t("nav.menu")} note={t("menu.note")}>
          <Demo>
            <div {...stylex.props(styles.narrow)}>
              <Menu
                trigger={
                  <>
                    <span {...stylex.props(styles.menuLabel)}>{t("menu.label")}</span>
                    {t(
                      `menu.${workspace === "labs" ? "labs" : workspace === "all" ? "all" : "commerce"}`,
                    )}
                  </>
                }
              >
                <MenuRadio value={workspace} onValueChange={setWorkspace}>
                  <MenuRadioOption value="commerce">{t("menu.commerce")}</MenuRadioOption>
                  <MenuRadioOption value="labs">{t("menu.labs")}</MenuRadioOption>
                  <MenuSeparator />
                  <MenuRadioOption value="all">{t("menu.all")}</MenuRadioOption>
                </MenuRadio>
              </Menu>
            </div>
            <div {...stylex.props(styles.narrow)}>
              <Menu trigger={t("menu.actionsTrigger")}>
                <MenuItem
                  value="retry"
                  onSelect={() => showToast(t("menu.picked", { action: t("menu.retry") }))}
                >
                  {t("menu.retry")}
                </MenuItem>
                <MenuItem
                  value="log"
                  onSelect={() => showToast(t("menu.picked", { action: t("menu.openLog") }))}
                >
                  {t("menu.openLog")}
                </MenuItem>
                <MenuSeparator />
                <MenuItem value="cancel" disabled>
                  {t("menu.cancel")}
                </MenuItem>
              </Menu>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="form">
        <Section title={t("nav.form")} note={t("form.note")}>
          <Demo>
            <div {...stylex.props(styles.form)}>
              <Field label={t("form.hostLabel")} description={t("form.hostHint")}>
                <Input name="host" defaultValue="runner-a" mono />
              </Field>
              <Field label={t("form.pathLabel")} error={t("form.pathError")}>
                <Input name="orca" defaultValue="/opt/orca/bin" mono />
              </Field>
              <Field label={t("form.agentLabel")}>
                <Select
                  value={agent}
                  onValueChange={setAgent}
                  placeholder={t("form.agentPlaceholder")}
                  options={[
                    { value: "claude", label: t("form.agentClaude") },
                    { value: "codex", label: t("form.agentCodex") },
                    { value: "gemini", label: t("form.agentDisabled"), disabled: true },
                  ]}
                />
              </Field>
              <Field label={t("form.webhookLabel")}>
                <Input
                  name="webhook"
                  defaultValue="https://orchestrator.example.com/webhooks/linear"
                  readOnly
                  mono
                />
              </Field>
              <div>
                <Checkbox label={t("form.checkWeb")} checked={web} onCheckedChange={setWeb} />
                <Checkbox label={t("form.checkApi")} checked={api} onCheckedChange={setApi} />
                <Checkbox
                  label={t("form.checkMobile")}
                  description={t("form.checkMobileHint")}
                  checked={false}
                  disabled
                  onCheckedChange={() => {}}
                />
              </div>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="tooltip">
        <Section title={t("nav.tooltip")} note={t("tooltip.note")}>
          <Demo>
            <Text variant="ui">
              <Tooltip content={t("tooltip.content")}>{t("tooltip.trigger")}</Tooltip>
            </Text>
            <Tooltip
              content={t("tooltip.iconAction")}
              labelsTrigger
              action={{ variant: "ghost", onClick: () => showToast(t("tooltip.iconAction")) }}
            >
              <CloseIcon />
            </Tooltip>
            <Tooltip
              content={t("tooltip.linkContent")}
              labelsTrigger
              render={<a href="#tooltip" {...stylex.props(linkStyles())} />}
            >
              {t("tooltip.linkLabel")}
            </Tooltip>
            <BackLink
              label={t("tooltip.backLabel")}
              render={(anchor) => <a href="#tooltip" {...anchor} />}
            />
          </Demo>
        </Section>
      </div>

      <div id="issue-list">
        <Section title={t("nav.issueList")} note={t("issueList.note")}>
          <IssueListPreview />
        </Section>
      </div>

      <div id="dialog">
        <Section title={t("nav.dialog")} note={t("dialog.note")}>
          <Demo>
            <Dialog
              trigger={t("dialog.trigger")}
              title={t("dialog.title")}
              description={t("dialog.description")}
              actions={
                <>
                  <DialogClose>{t("dialog.cancel")}</DialogClose>
                  <DialogClose variant="primary" onClick={() => showToast(t("dialog.done"))}>
                    {t("dialog.confirm")}
                  </DialogClose>
                </>
              }
            />
            <Dialog
              trigger={t("dialog.trigger")}
              triggerBusy={{ active: true, label: t("dialog.busyTrigger") }}
              title={t("dialog.title")}
              actions={<DialogClose>{t("dialog.cancel")}</DialogClose>}
            />
            <TriggerlessDialogPreview />
          </Demo>
        </Section>
      </div>

      <div id="dependencyGraph">
        <Section title={t("nav.dependencyGraph")} note={t("dependencyGraph.note")}>
          <Demo>
            <DependencyGraph
              label={t("dependencyGraph.label")}
              scrollLabel={t("dependencyGraph.label")}
              columns={[
                { number: 1, label: t("dependencyGraph.first") },
                { number: 2, label: t("dependencyGraph.second") },
              ]}
              nodes={[
                {
                  id: "ACME-11",
                  column: 0,
                  row: 0,
                  ticketKey: "ACME-11",
                  title: t("dependencyGraph.firstTicket"),
                  tone: "default",
                  check: {
                    checked: graphFirst,
                    disabled: false,
                    description: t("dependencyGraph.firstNote"),
                    onCheckedChange: setGraphFirst,
                  },
                },
                {
                  id: "ACME-9",
                  column: 0,
                  row: 1,
                  ticketKey: "ACME-9 · In Progress",
                  title: t("dependencyGraph.outsideTicket"),
                  tone: "default",
                },
                {
                  id: "ACME-13",
                  column: 1,
                  row: 0,
                  ticketKey: "ACME-13",
                  title: t("dependencyGraph.secondTicket"),
                  tone: graphFirst ? "default" : "problem",
                  check: {
                    checked: true,
                    disabled: false,
                    description: t("dependencyGraph.secondNote"),
                    onCheckedChange: () => {},
                  },
                },
              ]}
              edges={[
                { from: "ACME-11", to: "ACME-13", tone: graphFirst ? "default" : "problem" },
                { from: "ACME-9", to: "ACME-13", tone: "waiting" },
              ]}
            />
            <Spinner />
          </Demo>
        </Section>
      </div>

      <div id="toast">
        <Section title={t("nav.toast")} note={t("toast.note")}>
          <Demo>
            <Button onClick={() => showToast(t("toast.message"))}>{t("toast.trigger")}</Button>
          </Demo>
          <Text variant="meta">{t("toast.pinnedNote")}</Text>
          <Demo>
            <PinnedToast
              title={t("toast.pinnedTitle")}
              announcement={t("toast.pinnedTitle")}
              actions={
                <>
                  <Button variant="primary">{t("toast.pinnedPrimary")}</Button>
                  <Button>{t("toast.pinnedSecondary")}</Button>
                </>
              }
            >
              {t("toast.pinnedBody")}
            </PinnedToast>
          </Demo>
        </Section>
      </div>
    </>
  );
}

function TriggerlessDialogPreview() {
  const t = useTranslations("ds");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("dialog.triggerless")}</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("dialog.title")}
        description={t("dialog.description")}
        actions={<DialogClose>{t("dialog.cancel")}</DialogClose>}
      />
    </>
  );
}

function IssueListPreview() {
  const t = useTranslations("ds.issueList");
  const [view, setView] = useState<"grouped" | "flat">("grouped");
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState("child");
  const indented = view === "grouped";
  const groupMotion = useIssueGroupMotion(view);
  const phase = groupMotion.phases.get("parent");
  const showChild = expanded || phase === "closing";
  const childRow = (
    <IssueRow
      rowKey="child"
      label={`ACME-11 ${t("childTitle")}`}
      selected={selected === "child"}
      tabbable={selected === "child"}
      onSelect={() => setSelected("child")}
      indent={indented ? "child" : "none"}
      surface={indented ? (phase === undefined ? "last" : "middle") : "none"}
      icon={<IssueStateIcon kind="in-progress" label={t("state.in-progress")} />}
      ticketKey="ACME-11"
      title={t("childTitle")}
      {...(indented ? {} : { below: `↳ ACME-10 ${t("parentTitle")}` })}
      run={t("runChild")}
      action={<Button compact>{t("action")}</Button>}
    />
  );
  return (
    <>
      <Demo>
        {ISSUE_STATE_KINDS.map((kind) => (
          <IssueStateIcon key={kind} kind={kind} label={t(`state.${kind}`)} />
        ))}
        <ProgressRing done={2} total={5} label={t("progress")} />
        <IconToggleGroup
          label={t("viewLabel")}
          value={view}
          onValueChange={setView}
          items={[
            { value: "grouped", label: t("grouped"), icon: <GroupedViewIcon /> },
            { value: "flat", label: t("flat"), icon: <FlatViewIcon /> },
          ]}
        />
      </Demo>
      <IssueListFrame>
        <IssueListHead
          keyLabel={t("key")}
          titleLabel={t("title")}
          runLabel={t("run")}
          indented={indented}
        />
        <IssueList label={t("listLabel")} onMove={() => {}}>
          <IssueRow
            rowKey="parent"
            label={`ACME-10 ${t("parentTitle")}`}
            selected={selected === "parent"}
            tabbable={selected === "parent"}
            onSelect={() => setSelected("parent")}
            indent={indented ? "top" : "none"}
            surface={indented ? (showChild ? "first" : "only") : "none"}
            {...(indented
              ? {
                  toggle: {
                    expanded,
                    label: t(expanded ? "collapse" : "expand"),
                    moving: phase !== undefined,
                    onToggle: () => {
                      groupMotion.toggle("parent", !expanded, 1);
                      setExpanded(!expanded);
                    },
                  },
                }
              : {})}
            icon={<ProgressRing done={2} total={5} label={t("progress")} />}
            ticketKey="ACME-10"
            title={t("parentTitle")}
            strong
            titleAfter="2/5"
            run={t("runSummary")}
          />
          {!indented ? childRow : null}
          {indented && showChild ? (
            <IssueGroupBody phase={phase} childCount={1}>
              <IssueGroupLine index={0}>{childRow}</IssueGroupLine>
            </IssueGroupBody>
          ) : null}
          <IssueGroupLabel rowKey="loose" name={t("noParent")} count={1} />
        </IssueList>
      </IssueListFrame>
    </>
  );
}

function RunPanel({ run, stateLabel }: { run: SampleRun; stateLabel: string }) {
  const t = useTranslations("ds");
  return (
    <DetailPanel>
      <PanelHeader
        status={
          <>
            <StatusPill status={run.status}>{stateLabel}</StatusPill>
            <Text variant="meta" numeric>
              #{run.number}
            </Text>
          </>
        }
        title={t(`table.rows.${run.id}.title`)}
        subtitle={`${run.ticket} · acme/web`}
        reason={t(`table.rows.${run.id}.detail`)}
      />
      <Actions>
        {run.pr === null ? (
          <Button variant={run.status === "failed" ? "primary" : "secondary"}>
            {t("table.rerun")}
          </Button>
        ) : (
          <>
            <Button variant="primary">{t("table.openPr", { number: run.pr })}</Button>
            <Button>{t("table.rerun")}</Button>
          </>
        )}
      </Actions>
      <PanelBlock>
        <DefinitionList>
          <DefinitionItem label={t("definitions.runner")}>{run.runner}</DefinitionItem>
          <DefinitionItem label={t("definitions.agent")}>{run.agent}</DefinitionItem>
          <DefinitionItem label={t("definitions.elapsed")}>{run.elapsed}</DefinitionItem>
          <DefinitionItem label={t("definitions.pr")} empty={run.pr === null}>
            {run.pr === null ? t("definitions.none") : `#${run.pr}`}
          </DefinitionItem>
          <DefinitionItem label={t("definitions.ci")} empty={run.ci === null}>
            {run.ci === null ? t("definitions.none") : t(`definitions.${run.ci}`)}
          </DefinitionItem>
        </DefinitionList>
      </PanelBlock>
      <PanelFooter>
        <Text variant="meta">{t("table.footer", { number: run.number })}</Text>
      </PanelFooter>
    </DetailPanel>
  );
}

const styles = stylex.create({
  demo: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s4,
    paddingBlock: space.s5,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  pills: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: space.s3,
    width: "100%",
  },
  pillSample: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  cards: { display: "flex", flexDirection: "column", gap: space.s3, maxWidth: 640 },
  inline: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  timeRow: { display: "flex", alignItems: "center", gap: space.s2 },
  timeRowBody: { flexGrow: 1, minWidth: 0 },
  frame: {
    height: 440,
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.borderSubtle,
    borderRadius: radius.card,
  },
  narrow: { width: 216 },
  menuLabel: { color: colors.textTertiary, fontWeight: fontWeight.regular },
  form: { display: "flex", flexDirection: "column", gap: space.s5, width: "100%", maxWidth: 520 },
});
