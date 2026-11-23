import * as stylex from "@stylexjs/stylex";
import {
  Dialog,
  DialogClose,
  InfoTip,
  NoticeLayout,
  PageHeader,
  ScreenLayout,
  Select,
  SettingsGroup,
  SettingsLayout,
  SettingsRow,
  SettingsSection,
  Text,
  VisuallyHidden,
  linkStyles,
} from "@ganger/ui";
import { breakpoints, size } from "@ganger/ui/tokens.stylex";
import { useId, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type {
  BoundProject,
  ConnectionLabel,
  SettingsPage,
  WorkspaceSettings,
} from "@ganger/app/settings/model";
import type { UnsavedGuard } from "./navigation-guard";
import {
  AutoSaveStatusText,
  EditorBlockedNotice,
  EditorProvider,
  RevertedMessage,
  useAutoSave,
} from "./row-state";
import { PROJECT_EDITOR_SELECTOR } from "./blocked-editor";
import { AutoAssignLabelPicker } from "./label-picker";
import { MappingEditor, ReloadFromTracker, autoAssignLabelOf } from "./mapping-editor";
import {
  SubmitError,
  useReason,
  useSubmit,
  withCurrent,
  type ProjectDetailActions,
  type SettingsActions,
} from "./settings-screen";
import {
  SettingsBackLink,
  plainSettingsLink,
  projectRowId,
  type RenderSettingsLink,
} from "./settings-page";

export interface ProjectDetailScreenProps {
  page: SettingsPage;
  connectionId: string;
  projectId: string;
  ws: string | undefined;
  actions: ProjectDetailActions;
  onRemoved: () => void;
  renderLink?: RenderSettingsLink;
  renderGuard?: (guard: UnsavedGuard) => ReactNode;
}

export function findBoundProject<B extends Pick<BoundProject, "connection" | "project">>(
  workspace: { bound: ReadonlyArray<B> } | null,
  connectionId: string,
  projectId: string,
): B | null {
  return (
    workspace?.bound.find(
      (bound) => bound.connection.id === connectionId && bound.project.id === projectId,
    ) ?? null
  );
}

export function ProjectDetailScreen({
  page,
  connectionId,
  projectId,
  ws,
  actions,
  onRemoved,
  renderLink = plainSettingsLink(ws),
  renderGuard,
}: ProjectDetailScreenProps) {
  const t = useTranslations("settings.project");
  const ts = useTranslations("settings");
  const tm = useTranslations("settings.mapping");
  const workspace = page.workspace;
  const bound = findBoundProject(workspace, connectionId, projectId);
  const back = (
    <SettingsBackLink
      label={t("back")}
      rowId={projectRowId(connectionId, projectId)}
      renderLink={renderLink}
    />
  );
  if (workspace === null || bound === null) {
    return (
      <ScreenLayout header={<PageHeader lead={back} title={t("breadcrumb")} />}>
        <NoticeLayout>
          <Text variant="body">{t("notFound")}</Text>
          {renderLink(
            { kind: "settings" },
            { ...stylex.props(linkStyles("action")), children: t("back") },
          )}
        </NoticeLayout>
      </ScreenLayout>
    );
  }
  const label = workspace.labels.find((l) => l.connection.id === connectionId) ?? null;
  const tracker = t("trackerName", { kind: bound.trackerKind ?? "other" });
  return (
    <ScreenLayout
      header={
        <PageHeader
          lead={back}
          title={bound.project.name}
          subtitle={bound.connection.name}
          actions={<ReloadFromTracker onReload={actions.reloadFromTracker} />}
        />
      }
    >
      <EditorProvider
        blockedSelector={PROJECT_EDITOR_SELECTOR}
        {...(renderGuard === undefined ? {} : { renderGuard })}
      >
        <SettingsLayout>
          <MappingEditor
            ws={workspace.general.id}
            bound={bound}
            runnerProjects={page.runnerProjects}
            agents={page.agents}
            actions={actions}
            autoAssignLabelId={autoAssignLabelOf(workspace, bound.connection.id)}
            heading={<VisuallyHidden>{bound.project.name}</VisuallyHidden>}
            renderSections={({ repos, agent }) => (
              <>
                <SettingsSection
                  id="repo"
                  title={t("repo")}
                  info={
                    <InfoTip
                      label={ts("infoLabel", { label: t("repo") })}
                      content={`${tm("routeHint")} ${t("repoInfo")}`}
                    />
                  }
                >
                  <SettingsGroup padded>
                    <EditorBlockedNotice />
                    {repos}
                  </SettingsGroup>
                </SettingsSection>
                <SettingsSection id="agent" title={tm("agent")}>
                  {agent}
                </SettingsSection>
              </>
            )}
          />
          {label === null ? null : (
            <SettingsSection id="assign" title={t("assign")}>
              <SettingsGroup>
                <LabelRow ws={workspace.general.id} label={label} actions={actions} />
              </SettingsGroup>
            </SettingsSection>
          )}
          <SettingsSection
            id="ticket-state"
            title={t("ticketState")}
            detail={t("ticketStateDetail", { tracker })}
          >
            <SettingsGroup>
              <StateRow ws={workspace.general.id} bound={bound} actions={actions} />
              <MergedStateRow
                ws={workspace.general.id}
                bound={bound}
                tracker={tracker}
                actions={actions}
              />
            </SettingsGroup>
          </SettingsSection>
          <SettingsGroup>
            <RemoveRow
              ws={workspace.general.id}
              bound={bound}
              workspace={workspace}
              actions={actions}
              onRemoved={onRemoved}
            />
          </SettingsGroup>
        </SettingsLayout>
      </EditorProvider>
    </ScreenLayout>
  );
}

function LabelRow({
  ws,
  label,
  actions,
}: {
  ws: string;
  label: ConnectionLabel;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  return (
    <SettingsRow
      label={t("project.label")}
      detail={t("project.labelScope", { connection: label.connection.name })}
      wideControl
      control={
        <span {...stylex.props(styles.select)}>
          <AutoAssignLabelPicker
            ws={ws}
            label={label}
            actions={actions}
            selectLabel={t("project.label")}
            showReload={false}
          />
        </span>
      }
    />
  );
}

function StateRow({
  ws,
  bound,
  actions,
}: {
  ws: string;
  bound: BoundProject;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const reason = useReason();
  const autoSave = useAutoSave(bound.inProgressStateId, (stateId: string | null) =>
    stateId === null
      ? Promise.resolve({ ok: true as const })
      : actions.saveInProgress({
          ws,
          connectionId: bound.connection.id,
          projectId: bound.project.id,
          stateId,
        }),
  );
  const options = withCurrent(
    bound.states.ok ? bound.states.items.map((s) => ({ value: s.id, label: s.name })) : [],
    bound.inProgressStateId,
  );
  return (
    <SettingsRow
      label={t("project.state")}
      detail={t("project.stateDetail")}
      status={<AutoSaveStatusText status={autoSave.status} />}
      wideControl
      control={
        <span {...stylex.props(styles.select)}>
          <Select
            aria-label={t("project.state")}
            options={options}
            value={autoSave.value}
            onValueChange={autoSave.change}
            placeholder={t("project.stateChoose")}
          />
        </span>
      }
      message={
        bound.states.ok ? (
          <RevertedMessage error={autoSave.error} />
        ) : (
          <Text variant="meta" as="p" tone="problem">
            {t("project.statesFailed", { reason: reason(bound.states.error) })}
          </Text>
        )
      }
    />
  );
}

const KEEP_TICKET_STATE = "";

function MergedStateRow({
  ws,
  bound,
  tracker,
  actions,
}: {
  ws: string;
  bound: BoundProject;
  tracker: string;
  actions: ProjectDetailActions;
}) {
  const t = useTranslations("settings");
  const reason = useReason();
  const autoSave = useAutoSave(bound.mergedStateId, (stateId: string | null) =>
    actions.saveMergedState({
      ws,
      connectionId: bound.connection.id,
      projectId: bound.project.id,
      stateId,
    }),
  );
  const options = [
    { value: KEEP_TICKET_STATE, label: t("project.mergedStateKeep") },
    ...withCurrent(
      bound.states.ok ? bound.states.items.map((s) => ({ value: s.id, label: s.name })) : [],
      bound.mergedStateId,
    ),
  ];
  return (
    <SettingsRow
      label={t("project.mergedState")}
      detail={t("project.mergedStateDetail", { tracker })}
      info={
        <InfoTip
          label={t("infoLabel", { label: t("project.mergedState") })}
          content={t("project.mergedStateInfo")}
        />
      }
      status={<AutoSaveStatusText status={autoSave.status} />}
      wideControl
      control={
        <span {...stylex.props(styles.select)}>
          <Select
            aria-label={t("project.mergedState")}
            options={options}
            value={autoSave.value ?? KEEP_TICKET_STATE}
            onValueChange={(value) => autoSave.change(value === KEEP_TICKET_STATE ? null : value)}
          />
        </span>
      }
      message={
        bound.states.ok ? (
          <RevertedMessage error={autoSave.error} />
        ) : (
          <Text variant="meta" as="p" tone="problem">
            {t("project.statesFailed", { reason: reason(bound.states.error) })}
          </Text>
        )
      }
    />
  );
}

function RemoveRow({
  ws,
  bound,
  workspace,
  actions,
  onRemoved,
}: {
  ws: string;
  bound: BoundProject;
  workspace: WorkspaceSettings;
  actions: SettingsActions;
  onRemoved: () => void;
}) {
  const t = useTranslations("settings");
  const submit = useSubmit();
  const labelId = useId();
  const choice = workspace.trackerProjects
    .find((group) => group.connection.id === bound.connection.id)
    ?.projects.find((project) => project.id === bound.project.id);
  const mappings = choice?.mappings ?? (bound.mapping === null ? 0 : 1);
  const queued = choice?.queuedRuns ?? 0;
  return (
    <SettingsRow
      label={t("project.remove")}
      labelId={labelId}
      detail={t("project.removeDetail")}
      message={<SubmitError state={submit.state} />}
      control={
        <Dialog
          trigger={
            <>
              <VisuallyHidden>
                {t("project.removeTrigger", { project: bound.project.name })}
              </VisuallyHidden>
              <span aria-hidden="true">{t("projects.remove")}</span>
            </>
          }
          triggerVariant="danger"
          title={t("projects.removeTitle", { project: bound.project.name })}
          description={
            <>
              {t("projects.removeBody", { mappings })}
              {queued === 0 ? null : <> {t("projects.removeQueued", { count: queued })}</>}
            </>
          }
          actions={
            <>
              <DialogClose>{t("projects.cancel")}</DialogClose>
              <DialogClose
                variant="danger"
                onClick={() =>
                  submit.run(
                    () =>
                      actions.removeProject({
                        ws,
                        connectionId: bound.connection.id,
                        projectId: bound.project.id,
                      }),
                    t("projects.removed", { project: bound.project.name }),
                    onRemoved,
                  )
                }
              >
                {t("projects.remove")}
              </DialogClose>
            </>
          }
        />
      }
    />
  );
}

const styles = stylex.create({
  select: {
    display: "flex",
    width: { default: size.settingsControlWidth, [breakpoints.settingsRowStacked]: "100%" },
    minWidth: 0,
  },
});
