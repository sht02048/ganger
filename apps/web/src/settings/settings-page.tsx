import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Field,
  InfoTip,
  Input,
  PageHeader,
  ScreenLayout,
  SectionNav,
  SettingsGroup,
  SettingsLayout,
  BackLink,
  type BackLinkRenderProps,
  SettingsLinkRow,
  SettingsRow,
  SettingsSection,
  Switch,
  Text,
  focusStyles,
  linkStyles,
  type SectionNavItem,
  type SettingsLinkRowRenderProps,
} from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { MAX_RUN_MINUTES } from "@ganger/app/settings/model";
import type {
  AddressesView,
  GitHubAuthView,
  BoundProject,
  ConnectionProjects,
  PowerView,
  SettingsPage,
  TrackerConnectionView,
  TrackerProjectChoice,
  WorkspaceSettings,
} from "@ganger/app/settings/model";
import { useTime } from "../format/time";
import { useAgentName } from "../labels";
import { GITHUB_TOKEN_URL, LINEAR_API_KEY_URL } from "../onboarding/model";
import { CredentialFormFrame, ExternalLink, TrackerKeyForm } from "./credential-forms";
import {
  AutoSaveStatusText,
  EditorProvider,
  RevertedMessage,
  useAutoSave,
  useFocusFirstField,
  useInlineEdit,
  type InlineEdit,
} from "./row-state";
import {
  SubmitError,
  useReason,
  useReportUnsaved,
  useSubmit,
  type SettingsActions,
} from "./settings-screen";
import type { UnsavedGuard } from "./navigation-guard";
import { UpdatesRows } from "./updates-panel";
import { GitHubAuthPanel, useGitHubSourceDetail } from "./github-auth";
import { WorkspaceBriefRow } from "./workspace-brief";

export const SETTINGS_SECTIONS = [
  "workspace",
  "projects",
  "connections",
  "server",
  "devices",
  "logs",
  "advanced",
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

export type SettingsLinkTarget =
  | { kind: "project"; connectionId: string; projectId: string }
  | { kind: "connection"; connectionId: string }
  | { kind: "runners" }
  | { kind: "mcp" }
  | { kind: "settings"; rowId?: string };

export type RenderSettingsLink = (
  target: SettingsLinkTarget,
  props: SettingsLinkRowRenderProps,
) => ReactNode;

export type WorkspaceView = "one" | "none" | "all";

export function settingsHref(target: SettingsLinkTarget, ws: string | undefined): string {
  const search = ws === undefined ? "" : `?${new URLSearchParams({ ws }).toString()}`;
  switch (target.kind) {
    case "project":
      return `/settings/projects/${encodeURIComponent(target.connectionId)}/${encodeURIComponent(target.projectId)}${search}`;
    case "connection":
      return `/settings/connections/${encodeURIComponent(target.connectionId)}${search}`;
    case "runners":
      return `/runners${search}`;
    case "mcp":
      return `/settings/mcp${search}`;
    case "settings":
      return `/settings${search}${target.rowId === undefined ? "" : `#${encodeURIComponent(target.rowId)}`}`;
  }
}

export function plainSettingsLink(ws: string | undefined): RenderSettingsLink {
  return (target, props) => <a href={settingsHref(target, ws)} {...props} />;
}

export function projectRowId(connectionId: string, projectId: string): string {
  return `project-${connectionId}-${projectId}`;
}

export function connectionRowId(connectionId: string): string {
  return `connection-${connectionId}`;
}

export const MCP_ROW_ID = "mcp-row";
export const WEB_ADDRESS_ROW_ID = "web-address-row";

function SettingsBackAnchor({
  renderLink,
  rowId,
  children,
  ...anchor
}: BackLinkRenderProps & {
  renderLink: RenderSettingsLink;
  rowId: string | undefined;
  children?: ReactNode;
}) {
  return renderLink(
    { kind: "settings", ...(rowId === undefined ? {} : { rowId }) },
    { ...anchor, children },
  );
}

export function SettingsBackLink({
  label,
  rowId,
  renderLink,
}: {
  label: string;
  rowId?: string;
  renderLink: RenderSettingsLink;
}) {
  return (
    <BackLink
      label={label}
      render={(anchor) => <SettingsBackAnchor renderLink={renderLink} rowId={rowId} {...anchor} />}
    />
  );
}

export interface SettingsScreenProps {
  page: SettingsPage;
  runnerIssues: number;
  workspaceView: WorkspaceView;
  ws: string | undefined;
  actions: SettingsActions;
  onCreateWorkspace: (focusBack: HTMLElement | null) => void;
  renderLink?: RenderSettingsLink;
  renderGuard?: (guard: UnsavedGuard) => ReactNode;
  devices?: ReactNode;
  logs?: ReactNode;
  github?: GitHubAuthView;
}

export function SettingsScreen({
  page,
  runnerIssues,
  workspaceView,
  ws,
  actions,
  onCreateWorkspace,
  renderLink = plainSettingsLink(ws),
  renderGuard,
  devices,
  logs,
  github,
}: SettingsScreenProps) {
  const t = useTranslations("settings");
  const workspace = page.workspace;
  const problems = sectionProblems(page, runnerIssues);
  const navItems: SectionNavItem[] = SETTINGS_SECTIONS.filter(
    (id) =>
      (workspace !== null || id !== "projects") &&
      (devices !== undefined || id !== "devices") &&
      (logs !== undefined || id !== "logs"),
  ).map((id) => ({
    id,
    label: t(`sections.${id}`),
    problem: problems.has(id),
  }));
  return (
    <ScreenLayout header={<PageHeader title={t("title")} />}>
      <EditorProvider {...(renderGuard === undefined ? {} : { renderGuard })}>
        <SettingsLayout
          nav={
            <SectionNav label={t("nav.label")} items={navItems} problemLabel={t("nav.problem")} />
          }
        >
          <SettingsSection id="workspace" title={t("sections.workspace")}>
            {workspace === null ? (
              <NoWorkspace view={workspaceView} onCreate={onCreateWorkspace} />
            ) : (
              <WorkspaceRows workspace={workspace} actions={actions} />
            )}
          </SettingsSection>
          {workspace === null ? null : (
            <ProjectsSection
              page={page}
              workspace={workspace}
              actions={actions}
              renderLink={renderLink}
            />
          )}
          <ConnectionsSection
            page={page}
            runnerIssues={runnerIssues}
            actions={actions}
            renderLink={renderLink}
            github={github}
          />
          <SettingsSection id="server" title={t("sections.server")}>
            <SettingsGroup>
              <WebAddressRow addresses={page.install.addresses} actions={actions} />
              <AutoAllowedRow hosts={page.install.addresses.autoAllowedHosts} />
              <PowerRow power={page.install.power} actions={actions} />
              <UpdatesRows />
            </SettingsGroup>
          </SettingsSection>
          {devices}
          {logs}
          <SettingsSection id="advanced" title={t("sections.advanced")}>
            <SettingsGroup>
              <SettingsLinkRow
                id={MCP_ROW_ID}
                label={t("mcp.title")}
                detail={page.install.mcp.writeAllowed ? t("mcp.rowWrite") : t("mcp.rowRead")}
                render={(props) => renderLink({ kind: "mcp" }, props)}
              />
            </SettingsGroup>
          </SettingsSection>
        </SettingsLayout>
      </EditorProvider>
    </ScreenLayout>
  );
}

function unreadPrRuns(install: SettingsPage["install"]): number {
  return install.unreadPrRuns["no-access"] + install.unreadPrRuns.other;
}

export function sectionProblems(
  page: SettingsPage,
  runnerIssues: number,
): ReadonlySet<SettingsSectionId> {
  const problems = new Set<SettingsSectionId>();
  const workspace = page.workspace;
  if (
    workspace !== null &&
    (workspace.bound.length === 0 ||
      workspace.bound.some((b) => b.mapping === null) ||
      workspace.trackerProjects.some((group) => group.error !== null))
  ) {
    problems.add("projects");
  }
  const install = page.install;
  if (
    install.connections.length === 0 ||
    install.connections.some((connection) => connection.webhook.kind === "rejected") ||
    !install.githubConnected ||
    unreadPrRuns(install) > 0 ||
    install.runners.length === 0 ||
    runnerIssues > 0
  ) {
    problems.add("connections");
  }
  return problems;
}

export function NoWorkspace({
  view,
  onCreate,
}: {
  view: WorkspaceView;
  onCreate: (focusBack: HTMLElement | null) => void;
}) {
  const t = useTranslations("settings.workspace");
  return (
    <SettingsGroup>
      <SettingsRow
        label={view === "all" ? t("all") : t("none")}
        control={
          view === "all" ? undefined : (
            <Button onClick={(event) => onCreate(event.currentTarget)}>{t("create")}</Button>
          )
        }
      />
    </SettingsGroup>
  );
}

export function ChangeButton({
  edit,
  label,
  action,
}: {
  edit: InlineEdit;
  label: string;
  action?: string;
}) {
  const t = useTranslations("settings");
  const text = action ?? t("change");
  return (
    <Button
      ref={edit.triggerRef}
      aria-label={t("changeLabel", { label, action: text })}
      aria-expanded={false}
      onClick={edit.show}
    >
      {text}
    </Button>
  );
}

function WorkspaceRows({
  workspace,
  actions,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
}) {
  return (
    <SettingsGroup>
      <WorkspaceNameRow workspace={workspace} actions={actions} />
      <MaxRunRow workspace={workspace} actions={actions} />
      <WorkspaceBriefRow
        workspace={workspace}
        actions={actions}
        changeButton={(edit, label) => <ChangeButton edit={edit} label={label} />}
      />
    </SettingsGroup>
  );
}

function WorkspaceNameRow({
  workspace,
  actions,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit("workspace-name");
  const labelId = useId();
  const { general } = workspace;
  return (
    <SettingsRow
      label={t("workspace.name")}
      labelId={labelId}
      value={edit.open ? undefined : general.name}
      control={edit.open ? undefined : <ChangeButton edit={edit} label={t("workspace.name")} />}
      formOnly
      expanded={
        edit.open ? (
          <TextEditor
            label={t("workspace.name")}
            initial={general.name}
            validate={(value) => (value.trim() === "" ? t("workspace.nameInvalid") : null)}
            save={(value) =>
              actions.saveGeneral({
                ws: general.id,
                name: value.trim(),
                maxRunMinutes: general.maxRunMinutes,
              })
            }
            saved={t("workspace.nameSaved")}
            onClose={edit.close}
          />
        ) : null
      }
    />
  );
}

export function TextEditor({
  label,
  initial,
  validate,
  save,
  saved,
  onClose,
  mono = false,
  type = "text",
  placeholder,
}: {
  label: string;
  initial: string;
  validate: (value: string) => string | null;
  save: (value: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  saved: string;
  onClose: () => void;
  mono?: boolean;
  type?: "text" | "url";
  placeholder?: string;
}) {
  const t = useTranslations("settings");
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useReportUnsaved(value !== initial);
  const submit = useSubmit();
  const focusRef = useFocusFirstField();
  return (
    <div ref={focusRef} tabIndex={-1} {...stylex.props(focusStyles.target)}>
      <CredentialFormFrame
        onClose={onClose}
        footer={null}
        onSubmit={() => {
          const problem = validate(value);
          setInvalid(problem);
          if (problem !== null) {
            inputRef.current?.focus();
            return;
          }
          submit.run(() => save(value), saved, onClose);
        }}
        submit={
          <Button variant="primary" type="submit" disabled={submit.sending}>
            {submit.sending ? t("saving") : t("save")}
          </Button>
        }
      >
        <Field label={label} error={invalid ?? undefined}>
          <Input
            ref={inputRef}
            name="value"
            type={type}
            value={value}
            onValueChange={(next) => {
              setValue(next);
              if (invalid !== null) setInvalid(validate(next));
            }}
            autoComplete="off"
            mono={mono}
            {...(placeholder === undefined ? {} : { placeholder })}
          />
        </Field>
        <SubmitError state={submit.state} />
      </CredentialFormFrame>
    </div>
  );
}

function parseMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return minutes >= 1 && minutes <= MAX_RUN_MINUTES ? minutes : null;
}

function MaxRunRow({
  workspace,
  actions,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const { general } = workspace;
  const autoSave = useAutoSave(general.maxRunMinutes, (minutes: number) =>
    actions.saveGeneral({ ws: general.id, name: general.name, maxRunMinutes: minutes }),
  );
  const [draft, setDraft] = useState(String(autoSave.value));
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const maxRunErrorId = useId();
  useEffect(() => {
    if (!editing) setDraft(String(autoSave.value));
  }, [autoSave.value, editing]);
  const commit = () => {
    const minutes = parseMinutes(draft);
    if (minutes === null) {
      setInvalid(true);
      return;
    }
    setEditing(false);
    setInvalid(false);
    if (minutes !== autoSave.value) autoSave.change(minutes);
    else setDraft(String(minutes));
  };
  return (
    <SettingsRow
      label={t("workspace.maxRun")}
      info={
        <InfoTip
          label={t("infoLabel", { label: t("workspace.maxRun") })}
          content={t("workspace.maxRunInfo")}
        />
      }
      status={<AutoSaveStatusText status={autoSave.status} />}
      control={
        <form
          {...stylex.props(styles.number)}
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
          onBlur={() => {
            if (editing) commit();
          }}
        >
          <span {...stylex.props(styles.numberInput)}>
            <Input
              name="maxRunMinutes"
              aria-label={t("workspace.maxRunLabel")}
              {...(invalid ? { "aria-describedby": maxRunErrorId } : {})}
              value={draft}
              onValueChange={(value) => {
                setEditing(true);
                setDraft(value);
                if (invalid) setInvalid(parseMinutes(value) === null);
              }}
              inputMode="numeric"
              autoComplete="off"
              mono
              invalid={invalid}
            />
          </span>
          <Text variant="meta">{t("workspace.maxRunUnit")}</Text>
        </form>
      }
      message={
        invalid ? (
          <Text variant="meta" as="p" tone="problem" role="alert" id={maxRunErrorId}>
            {t("workspace.maxRunInvalid")}
          </Text>
        ) : (
          <RevertedMessage error={autoSave.error} />
        )
      }
    />
  );
}

function ProjectsSection({
  page,
  workspace,
  actions,
  renderLink,
}: {
  page: SettingsPage;
  workspace: WorkspaceSettings;
  actions: SettingsActions;
  renderLink: RenderSettingsLink;
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit("projects-add");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  useEffect(() => {
    if (focusKey === null) return;
    const link = document.getElementById(focusKey)?.querySelector<HTMLElement>("a");
    if (link === null || link === undefined) return;
    link.focus();
    setFocusKey(null);
  }, [focusKey, workspace]);
  const hasConnections = workspace.trackerProjects.length > 0;
  return (
    <SettingsSection
      id="projects"
      title={t("sections.projects")}
      actions={
        hasConnections && !edit.open ? (
          <Button
            ref={edit.triggerRef}
            aria-label={t("projects.openLabel")}
            aria-expanded={false}
            onClick={edit.show}
          >
            {t("projects.open")}
          </Button>
        ) : undefined
      }
    >
      <SettingsGroup>
        {workspace.bound.map((bound) => (
          <ProjectLinkRow
            key={`${bound.connection.id}/${bound.project.id}`}
            bound={bound}
            page={page}
            workspace={workspace}
            renderLink={renderLink}
          />
        ))}
        {workspace.bound.length === 0 && !edit.open ? (
          <SettingsRow
            label={hasConnections ? t("projects.none") : t("projects.needConnection")}
            control={
              hasConnections ? undefined : (
                <a href="#connections" {...stylex.props(linkStyles("action"))}>
                  {t("projects.toConnections")}
                </a>
              )
            }
          />
        ) : null}
        {edit.open ? (
          <SettingsRow
            label={t("projects.candidates")}
            info={
              <InfoTip
                label={t("infoLabel", { label: t("projects.candidates") })}
                content={t("projects.info")}
              />
            }
            expanded={
              <FocusFirst onEscape={edit.close}>
                <ProjectCandidates
                  workspace={workspace}
                  actions={actions}
                  onAdded={(connectionId, projectId) => {
                    edit.close();
                    setFocusKey(projectRowId(connectionId, projectId));
                  }}
                />
                <span {...stylex.props(styles.candidateClose)}>
                  <Button variant="ghost" onClick={edit.close}>
                    {t("close")}
                  </Button>
                </span>
              </FocusFirst>
            }
          />
        ) : null}
      </SettingsGroup>
    </SettingsSection>
  );
}

function ProjectLinkRow({
  bound,
  page,
  workspace,
  renderLink,
}: {
  bound: BoundProject;
  page: SettingsPage;
  workspace: WorkspaceSettings;
  renderLink: RenderSettingsLink;
}) {
  const t = useTranslations("settings.projects");
  const agentName = useAgentName();
  const mapping = bound.mapping;
  const repo = mapping === null ? null : repoSummary(mapping.repos, page, t);
  const label = autoLabelName(workspace, bound.connection.id);
  const prefix = workspace.trackerProjects.length > 1 ? `${bound.connection.name} · ` : "";
  return (
    <SettingsLinkRow
      id={projectRowId(bound.connection.id, bound.project.id)}
      label={bound.project.name}
      detail={
        mapping === null || repo === null
          ? `${prefix}${t("noRepo")}`
          : `${prefix}${t("repoAgent", { repo, agent: agentName(mapping.agent) })}`
      }
      detailTone={mapping === null ? "problem" : "default"}
      value={
        mapping === null ? t("decide") : label === null ? undefined : t("autoLabel", { label })
      }
      render={(props) =>
        renderLink(
          { kind: "project", connectionId: bound.connection.id, projectId: bound.project.id },
          props,
        )
      }
    />
  );
}

function repoSummary(
  repos: ReadonlyArray<{ id: string; isDefault: boolean }>,
  page: SettingsPage,
  t: ReturnType<typeof useTranslations<"settings.projects">>,
): string | null {
  const main = repos.find((r) => r.isDefault) ?? repos[0];
  if (main === undefined) return null;
  const name = page.runnerProjects.find((p) => p.id === main.id)?.name ?? main.id;
  return repos.length > 1 ? t("repoMore", { repo: name, count: repos.length - 1 }) : name;
}

export function autoLabelName(workspace: WorkspaceSettings, connectionId: string): string | null {
  const entry = workspace.labels.find((l) => l.connection.id === connectionId);
  if (entry === undefined || entry.labelId === null) return null;
  const id = entry.labelId;
  return entry.labels.ok ? (entry.labels.items.find((l) => l.id === id)?.name ?? id) : id;
}

export function ProjectCandidates({
  workspace,
  actions,
  onAdded,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
  onAdded: (connectionId: string, projectId: string) => void;
}) {
  const t = useTranslations("settings.projects");
  const reason = useReason();
  const groups = workspace.trackerProjects;
  const candidates = groups.flatMap((group) =>
    group.projects
      .filter((project) => project.owner.kind !== "this")
      .map((project) => ({ group, project })),
  );
  return (
    <div {...stylex.props(styles.candidates)}>
      {groups.map((group) =>
        group.error === null ? null : (
          <Text key={group.connection.id} variant="meta" as="p" tone="problem">
            {t("listFailed", { reason: reason(group.error) })}
          </Text>
        ),
      )}
      {candidates.length === 0 ? (
        <Text variant="meta" as="p">
          {t("noCandidates")}
        </Text>
      ) : (
        <ul {...stylex.props(styles.candidateList)}>
          {candidates.map(({ group, project }) => (
            <CandidateItem
              key={`${group.connection.id}/${project.id}`}
              ws={workspace.general.id}
              group={group}
              project={project}
              showConnection={groups.length > 1}
              actions={actions}
              onAdded={onAdded}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateItem({
  ws,
  group,
  project,
  showConnection,
  actions,
  onAdded,
}: {
  ws: string;
  group: ConnectionProjects;
  project: TrackerProjectChoice;
  showConnection: boolean;
  actions: SettingsActions;
  onAdded: (connectionId: string, projectId: string) => void;
}) {
  const t = useTranslations("settings.projects");
  const submit = useSubmit();
  const nameId = useId();
  const owner = project.owner;
  const meta =
    owner.kind === "other"
      ? t("inOther", { workspace: owner.workspace.name })
      : showConnection
        ? group.connection.name
        : null;
  return (
    <li {...stylex.props(styles.candidate)}>
      <span {...stylex.props(styles.candidateText)}>
        <Text variant="ui" tone={owner.kind === "other" ? "disabled" : "strong"} id={nameId}>
          {project.name}
        </Text>
        {meta === null ? null : <Text variant="meta">{meta}</Text>}
        <SubmitError state={submit.state} />
      </span>
      <Button
        aria-describedby={nameId}
        disabled={owner.kind === "other" || submit.sending}
        onClick={() =>
          submit.run(
            () =>
              actions.addProject({
                ws,
                connectionId: group.connection.id,
                projectId: project.id,
                name: project.name,
              }),
            t("added", { project: project.name }),
            () => onAdded(group.connection.id, project.id),
          )
        }
      >
        {t("add")}
      </Button>
    </li>
  );
}

function ConnectionsSection({
  page,
  runnerIssues,
  actions,
  renderLink,
  github,
}: {
  page: SettingsPage;
  runnerIssues: number;
  actions: SettingsActions;
  renderLink: RenderSettingsLink;
  github: GitHubAuthView | undefined;
}) {
  const t = useTranslations("settings");
  const add = useInlineEdit("connection-add");
  const { connections, runners } = page.install;
  const needCheck = runnerIssues;
  return (
    <SettingsSection
      id="connections"
      title={t("sections.connections")}
      actions={
        add.open ? undefined : (
          <Button
            ref={add.triggerRef}
            aria-label={t("connections.addLabel")}
            aria-expanded={false}
            onClick={add.show}
          >
            {t("connections.add")}
          </Button>
        )
      }
    >
      <SettingsGroup>
        {connections.length === 0 && !add.open ? (
          <SettingsRow label={t("connections.none")} />
        ) : null}
        {connections.map((connection) => (
          <ConnectionRow
            key={connection.id}
            connection={connection}
            now={page.install.mcp.now}
            renderLink={renderLink}
          />
        ))}
        {add.open ? (
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
        ) : null}
        <GitHubRow
          connected={page.install.githubConnected}
          view={github}
          unread={page.install.unreadPrRuns}
          actions={actions}
        />
        <SettingsLinkRow
          label={t("runnersRow.label")}
          detail={
            needCheck > 0
              ? t("runnersRow.problems", { total: runners.length, count: needCheck })
              : t("runnersRow.count", { count: runners.length })
          }
          detailTone={needCheck > 0 || runners.length === 0 ? "problem" : "default"}
          value={t("runnersRow.manage")}
          render={(props) => renderLink({ kind: "runners" }, props)}
        />
      </SettingsGroup>
    </SettingsSection>
  );
}

export function FocusFirst({ children, onEscape }: { children: ReactNode; onEscape?: () => void }) {
  const ref = useFocusFirstField();
  return (
    <div
      ref={ref}
      tabIndex={-1}
      {...(onEscape === undefined
        ? {}
        : {
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              onEscape();
            },
          })}
      {...stylex.props(focusStyles.target)}
    >
      {children}
    </div>
  );
}

function ConnectionRow({
  connection,
  now,
  renderLink,
}: {
  connection: TrackerConnectionView;
  now: string;
  renderLink: RenderSettingsLink;
}) {
  const detail = useConnectionWebhookDetail(connection, now);
  return (
    <SettingsLinkRow
      id={connectionRowId(connection.id)}
      label={connection.name}
      detail={detail}
      detailTone={connection.webhook.kind === "rejected" ? "problem" : "default"}
      render={(props) => renderLink({ kind: "connection", connectionId: connection.id }, props)}
    />
  );
}

export function useConnectionWebhookDetail(connection: TrackerConnectionView, now: string): string {
  const t = useTranslations("settings.connections");
  const time = useTime();
  const webhook = connection.webhook;
  switch (webhook.kind) {
    case "off":
      return t("rowOff");
    case "waiting":
      return t("rowWaiting");
    case "receiving":
      return t("rowReceiving", {
        time: time.ago(webhook.lastReceivedAt, webhook.lastReceivedAgoMs),
      });
    case "rejected":
      return t("rowRejected", { time: time.stamp(webhook.firstRejectedAt, now) });
  }
}

function GitHubRow({
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
  const source = useGitHubSourceDetail(view);
  const edit = useInlineEdit("github");
  const labelId = useId();
  const sourceMissing = view !== undefined && view.source === "none";
  return (
    <SettingsRow
      label={t("github.label")}
      labelId={labelId}
      detail={unreadDetail ?? source}
      detailTone={unreadDetail !== null || !connected || sourceMissing ? "problem" : "default"}
      control={
        edit.open ? undefined : (
          <ChangeButton edit={edit} label={t("github.label")} action={t("github.open")} />
        )
      }
      expanded={
        edit.open ? (
          <FocusFirst onEscape={edit.close}>
            <GitHubAuthPanel
              view={view}
              connected={connected}
              actions={actions}
              onClose={edit.close}
              tokenGuide={
                <span>
                  <ExternalLink href={GITHUB_TOKEN_URL}>{t("github.guideLink")}</ExternalLink>
                </span>
              }
            />
          </FocusFirst>
        ) : null
      }
    />
  );
}

function WebAddressRow({
  addresses,
  actions,
}: {
  addresses: AddressesView;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit("address-webAddress");
  const labelId = useId();
  const current = addresses.webAddress;
  const label = t("addresses.web");
  return (
    <SettingsRow
      id={WEB_ADDRESS_ROW_ID}
      label={label}
      labelId={labelId}
      info={<InfoTip label={t("infoLabel", { label })} content={t("addresses.webInfo")} />}
      detail={current ?? t("addresses.webNone")}
      detailMono={current !== null}
      control={
        edit.open ? undefined : (
          <ChangeButton
            edit={edit}
            label={label}
            action={current === null ? t("addresses.set") : t("change")}
          />
        )
      }
      formOnly
      expanded={
        edit.open ? (
          <TextEditor
            label={label}
            initial={current ?? ""}
            type="url"
            mono
            placeholder={t("addresses.webPlaceholder")}
            validate={() => null}
            save={(value) =>
              actions.saveAddresses({
                webAddress: value.trim(),
                webhookAddress: addresses.webhookAddress ?? "",
              })
            }
            saved={t("saved")}
            onClose={edit.close}
          />
        ) : null
      }
    />
  );
}

function AutoAllowedRow({ hosts }: { hosts: ReadonlyArray<string> }) {
  const t = useTranslations("settings");
  if (hosts.length === 0) return null;
  const label = t("addresses.autoAllowed");
  return (
    <SettingsRow
      label={label}
      info={<InfoTip label={t("infoLabel", { label })} content={t("addresses.autoAllowedInfo")} />}
      detail={hosts.join(", ")}
      detailMono
    />
  );
}

function PowerRow({ power, actions }: { power: PowerView; actions: SettingsActions }) {
  const t = useTranslations("settings");
  const labelId = useId();
  const switchId = useId();
  const autoSave = useAutoSave(power.preventSleep, (preventSleep: boolean) =>
    actions.savePower({ preventSleep }),
  );
  return (
    <SettingsRow
      label={t("power.toggle")}
      labelId={labelId}
      labelFor={switchId}
      disabled={!power.available}
      info={
        <InfoTip label={t("infoLabel", { label: t("power.toggle") })} content={t("power.info")} />
      }
      detail={power.available ? t("power.detail") : t("power.unavailable")}
      status={<AutoSaveStatusText status={autoSave.status} />}
      control={
        <Switch
          id={switchId}
          aria-labelledby={labelId}
          checked={power.available && autoSave.value}
          disabled={!power.available}
          onCheckedChange={autoSave.change}
        />
      }
      message={<RevertedMessage error={autoSave.error} />}
    />
  );
}

const styles = stylex.create({
  number: { display: "flex", alignItems: "center", gap: space.s2 },
  numberInput: { display: "flex", width: size.settingsNumberWidth },
  candidates: { display: "flex", flexDirection: "column", gap: space.s2 },
  candidateClose: { display: "flex", justifyContent: "flex-end", paddingTop: space.s2 },
  candidateList: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  candidate: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    paddingBlock: space.s1,
  },
  candidateText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
});
