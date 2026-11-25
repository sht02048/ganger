import * as stylex from "@stylexjs/stylex";
import {
  Button,
  InfoTip,
  SettingsGroup,
  SettingsLinkRow,
  SettingsRow,
  SettingsSection,
  Text,
  linkStyles,
} from "@ganger/ui";
import { breakpoints, size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type {
  BoundProject,
  Choice,
  ConnectionLabel,
  ConnectionProjects,
  SettingsPage,
  TrackerProjectChoice,
  WorkspaceSettings,
} from "@ganger/app/settings/model";
import { useAgentName } from "../labels";
import { AutoAssignLabelPicker } from "./label-picker";
import type { UnsavedGuard } from "./navigation-guard";
import { useInlineEdit } from "./row-state";
import { SettingsFrame, withSettingsEditors } from "./settings-frame";
import {
  FocusFirst,
  NoWorkspace,
  PROJECTS_HEADING_ID,
  autoLabelName,
  projectRowId,
  type RenderSettingsLink,
  type WorkspaceView,
} from "./settings-page";
import { SubmitError, useReason, useSubmit, type SettingsActions } from "./settings-screen";

export interface ProjectsScreenProps {
  page: SettingsPage;
  workspaceView: WorkspaceView;
  actions: SettingsActions;
  onCreateWorkspace: (focusBack: HTMLElement | null) => void;
  renderLink: RenderSettingsLink;
  nav: ReactNode;
  renderGuard?: (guard: UnsavedGuard) => ReactNode;
}

export interface ConnectionProjectGroup {
  connection: Choice;
  label: ConnectionLabel | null;
  bound: ReadonlyArray<BoundProject>;
}

export function projectGroups(workspace: WorkspaceSettings): ConnectionProjectGroup[] {
  const connections = new Map<string, Choice>();
  for (const bound of workspace.bound) connections.set(bound.connection.id, bound.connection);
  return [...connections.values()].map((connection) => ({
    connection,
    label: workspace.labels.find((entry) => entry.connection.id === connection.id) ?? null,
    bound: workspace.bound.filter((bound) => bound.connection.id === connection.id),
  }));
}

function ProjectsPage({
  page,
  workspaceView,
  actions,
  onCreateWorkspace,
  renderLink,
  nav,
}: ProjectsScreenProps) {
  const t = useTranslations("settings");
  const workspace = page.workspace;
  const add = useInlineEdit("projects-add");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  useEffect(() => {
    if (focusKey === null) return;
    const link = document.getElementById(focusKey)?.querySelector<HTMLElement>("a");
    if (link === null || link === undefined) return;
    link.focus();
    setFocusKey(null);
  }, [focusKey, workspace]);
  const hasConnections = workspace !== null && workspace.trackerProjects.length > 0;
  return (
    <SettingsFrame
      title={t("pages.projects")}
      titleId={PROJECTS_HEADING_ID}
      nav={nav}

      {...(hasConnections && !add.open
        ? {
            actions: (
              <Button ref={add.triggerRef} aria-expanded={false} onClick={add.show}>
                {t("projects.open")}
              </Button>
            ),
          }
        : {})}
    >
      {workspace === null ? (
        <NoWorkspace view={workspaceView} onCreate={onCreateWorkspace} />
      ) : (
        <>
          {add.open ? (
            <SettingsGroup>
              <SettingsRow
                label={t("projects.candidates")}
                info={
                  <InfoTip
                    label={t("infoLabel", { label: t("projects.candidates") })}
                    content={t("projects.info")}
                  />
                }
                expanded={
                  <FocusFirst onEscape={add.close}>
                    <ProjectCandidates
                      workspace={workspace}
                      actions={actions}
                      onAdded={(connectionId, projectId) => {
                        add.close();
                        setFocusKey(projectRowId(connectionId, projectId));
                      }}
                    />
                    <span {...stylex.props(styles.candidateClose)}>
                      <Button variant="ghost" onClick={add.close}>
                        {t("close")}
                      </Button>
                    </span>
                  </FocusFirst>
                }
              />
            </SettingsGroup>
          ) : null}
          {workspace.bound.length === 0 && !add.open ? (
            <SettingsGroup>
              <SettingsRow
                label={hasConnections ? t("projects.none") : t("projects.needConnection")}
                control={
                  hasConnections
                    ? undefined
                    : renderLink(
                        { kind: "page", page: "connections" },
                        {
                          ...stylex.props(linkStyles("action")),
                          children: t("projects.toConnections"),
                        },
                      )
                }
              />
            </SettingsGroup>
          ) : null}
          {projectGroups(workspace).map((group) => (
            <ConnectionGroup
              key={group.connection.id}
              group={group}
              page={page}
              workspace={workspace}
              actions={actions}
              renderLink={renderLink}
            />
          ))}
        </>
      )}
    </SettingsFrame>
  );
}

function ConnectionGroup({
  group,
  page,
  workspace,
  actions,
  renderLink,
}: {
  group: ConnectionProjectGroup;
  page: SettingsPage;
  workspace: WorkspaceSettings;
  actions: SettingsActions;
  renderLink: RenderSettingsLink;
}) {
  const t = useTranslations("settings");
  const id = `projects-${group.connection.id}`;
  return (
    <SettingsSection
      id={id}
      title={t("projects.groupTitle", { connection: group.connection.name })}
    >
      <SettingsGroup>
        {group.label === null ? null : (
          <AutoAssignLabelRow
            ws={workspace.general.id}
            label={group.label}
            workspace={workspace}
            actions={actions}
          />
        )}
        {group.bound.map((bound) => (
          <ProjectLinkRow
            key={`${bound.connection.id}/${bound.project.id}`}
            bound={bound}
            page={page}
            renderLink={renderLink}
          />
        ))}
      </SettingsGroup>
    </SettingsSection>
  );
}

function AutoAssignLabelRow({
  ws,
  label,
  workspace,
  actions,
}: {
  ws: string;
  label: ConnectionLabel;
  workspace: WorkspaceSettings;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const labelId = useId();
  const name = t("projects.autoLabel");
  return (
    <SettingsRow
      label={name}
      labelId={labelId}
      info={
        <InfoTip label={t("infoLabel", { label: name })} content={t("projects.autoLabelInfo")} />
      }
      {...(autoLabelName(workspace, label.connection.id) === null
        ? { detail: t("projects.autoLabelNone") }
        : {})}
      wideControl
      control={
        <span {...stylex.props(styles.select)}>
          <AutoAssignLabelPicker
            ws={ws}
            label={label}
            actions={actions}
            selectLabel={t("projects.autoLabelSelect", { connection: label.connection.name })}
            showReload={false}
          />
        </span>
      }
    />
  );
}

function ProjectLinkRow({
  bound,
  page,
  renderLink,
}: {
  bound: BoundProject;
  page: SettingsPage;
  renderLink: RenderSettingsLink;
}) {
  const t = useTranslations("settings.projects");
  const agentName = useAgentName();
  const mapping = bound.mapping;
  const repo = mapping === null ? null : repoSummary(mapping.repos, page, t);
  return (
    <SettingsLinkRow
      id={projectRowId(bound.connection.id, bound.project.id)}
      label={bound.project.name}
      detail={
        mapping === null || repo === null
          ? t("noRepo")
          : t("repoAgent", { repo, agent: agentName(mapping.agent) })
      }
      detailTone={mapping === null || repo === null ? "problem" : "default"}
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

const styles = stylex.create({
  select: {
    display: "flex",
    width: { default: size.settingsControlWidth, [breakpoints.settingsRowStacked]: "100%" },
    minWidth: 0,
  },
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

export const ProjectsScreen = withSettingsEditors(ProjectsPage);
