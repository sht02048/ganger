import * as stylex from "@stylexjs/stylex";
import { InfoTip, Input, SettingsGroup, SettingsRow, Text } from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { MAX_RUN_MINUTES } from "@ganger/app/settings/model";
import type { SettingsPage, WorkspaceSettings } from "@ganger/app/settings/model";
import type { UnsavedGuard } from "./navigation-guard";
import { AutoSaveStatusText, RevertedMessage, useAutoSave, useInlineEdit } from "./row-state";
import { SettingsFrame, withSettingsEditors } from "./settings-frame";
import { ChangeButton, NoWorkspace, TextEditor, type WorkspaceView } from "./settings-page";
import type { SettingsActions } from "./settings-screen";
import { WorkspaceBriefRow } from "./workspace-brief";

export interface WorkspacePageProps {
  page: SettingsPage;
  workspaceView: WorkspaceView;
  actions: SettingsActions;
  onCreateWorkspace: (focusBack: HTMLElement | null) => void;
  nav: ReactNode;
  renderGuard?: (guard: UnsavedGuard) => ReactNode;
}

function GeneralPage({ page, workspaceView, actions, onCreateWorkspace, nav }: WorkspacePageProps) {
  const t = useTranslations("settings");
  const workspace = page.workspace;
  return (
    <SettingsFrame title={t("pages.general")} nav={nav}>
      {workspace === null ? (
        <NoWorkspace view={workspaceView} onCreate={onCreateWorkspace} />
      ) : (
        <SettingsGroup>
          <WorkspaceNameRow workspace={workspace} actions={actions} />
          <MaxRunRow workspace={workspace} actions={actions} />
          <WorkspaceBriefRow
            workspace={workspace}
            actions={actions}
            changeButton={(edit, label) => <ChangeButton edit={edit} label={label} />}
          />
        </SettingsGroup>
      )}
    </SettingsFrame>
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

export const GeneralScreen = withSettingsEditors(GeneralPage);

const styles = stylex.create({
  number: { display: "flex", alignItems: "center", gap: space.s2 },
  numberInput: { display: "flex", width: size.settingsNumberWidth },
});
