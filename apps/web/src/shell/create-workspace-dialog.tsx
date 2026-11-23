import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Checkbox,
  CheckboxDisclosure,
  Dialog,
  Field,
  Input,
  Text,
  linkStyles,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { MAX_NAME_LENGTH } from "@ganger/app/settings/model";
import type { ConnectionProjects } from "@ganger/app/settings/model";
import {
  canCreateWorkspace,
  hiddenProjectCount,
  pickedProjects,
  projectChoiceNotice,
  projectGroupChoice,
  startsExpanded,
  withKeysPicked,
  workspaceNameTooLong,
} from "./create-workspace-model";
import type { NewWorkspaceProject, ProjectGroupChoice } from "./create-workspace-model";

export type ProjectChoices =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; groups: ConnectionProjects[] };

export type CreateWorkspaceResult =
  | { ok: true; id: string; name: string }
  | { ok: false; reason: "not-found" | "taken" };

export interface CreateWorkspaceInput {
  name: string;
  projects: NewWorkspaceProject[];
}

export interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | null;
  choices: ProjectChoices;
  onRetry: () => void;
  onCreate: (input: CreateWorkspaceInput) => Promise<CreateWorkspaceResult>;
  renderSettingsLink: (props: { className?: string; children: ReactNode }) => ReactNode;
}

type SubmitProblem = "not-found" | "taken" | "failed";

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  finalFocus,
  choices,
  onRetry,
  onCreate,
  renderSettingsLink,
}: CreateWorkspaceDialogProps) {
  const t = useTranslations("shell.workspace.create");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<SubmitProblem | null>(null);
  const formId = useId();
  const groups = choices.kind === "ready" ? choices.groups : [];
  const projects = pickedProjects(groups, picked);
  const ready = canCreateWorkspace(name, projects);

  const submit = () => {
    if (!ready || sending) return;
    setSending(true);
    setProblem(null);
    onCreate({ name: name.trim(), projects }).then(
      (result) => {
        if (result.ok) return;
        setSending(false);
        setProblem(result.reason);
      },
      () => {
        setSending(false);
        setProblem("failed");
      },
    );
  };

  const toggle = (keys: ReadonlyArray<string>, on: boolean) => {
    setPicked((previous) => withKeysPicked(previous, keys, on));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && sending) return;
        onOpenChange(next);
      }}
      finalFocus={finalFocus}
      title={t("title")}
      scrollBody
      status={
        problem === null ? undefined : (
          <Text variant="ui" as="p" tone="problem" role="alert">
            {t(`error.${problem}`)}
          </Text>
        )
      }
      actions={
        <>
          <Button disabled={sending} onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            busy={{ active: sending, label: t("creating") }}
            onClick={submit}
          >
            {t("submit")}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field
          label={t("name")}
          {...(workspaceNameTooLong(name)
            ? { error: t("nameTooLong", { max: MAX_NAME_LENGTH }) }
            : {})}
        >
          <Input
            name="name"
            value={name}
            onValueChange={setName}
            placeholder={t("namePlaceholder")}
            autoComplete="off"
          />
        </Field>
        <ProjectPicker
          choices={choices}
          picked={picked}
          onToggle={toggle}
          onRetry={onRetry}
          renderSettingsLink={(children) =>
            renderSettingsLink({
              ...stylex.props(linkStyles("action")),
              children,
            })
          }
        />
      </form>
    </Dialog>
  );
}

function ProjectPicker({
  choices,
  picked,
  onToggle,
  onRetry,
  renderSettingsLink,
}: {
  choices: ProjectChoices;
  picked: ReadonlySet<string>;
  onToggle: (keys: ReadonlyArray<string>, on: boolean) => void;
  onRetry: () => void;
  renderSettingsLink: (children: ReactNode) => ReactNode;
}) {
  const t = useTranslations("shell.workspace.create");
  const legendId = useId();
  const [expandedGroups, setExpandedGroups] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const notice = choices.kind === "ready" ? projectChoiceNotice(choices.groups) : null;
  const hidden = choices.kind === "ready" ? hiddenProjectCount(choices.groups) : 0;
  const initiallyExpanded = choices.kind === "ready" && startsExpanded(choices.groups.length);
  return (
    <fieldset aria-labelledby={legendId} {...stylex.props(styles.fieldset)}>
      <Text variant="ui" id={legendId}>
        {t("projects")}
      </Text>
      <Text variant="meta">{t("projectsHint")}</Text>
      {choices.kind === "loading" ? (
        <Text variant="meta" role="status">
          {t("loading")}
        </Text>
      ) : null}
      {choices.kind === "failed" ? (
        <div {...stylex.props(styles.failed)}>
          <Text variant="ui" as="p" tone="problem" role="alert">
            {t("loadFailed")}
          </Text>
          <Button onClick={onRetry}>{t("retry")}</Button>
        </div>
      ) : null}
      {notice === null ? null : (
        <Text variant="ui" as="p">
          {t.rich(notice === "all-taken" ? "allTaken" : "noConnections", {
            link: (children) => renderSettingsLink(children),
          })}
        </Text>
      )}
      {choices.kind === "ready"
        ? choices.groups.map((group) => {
            const choice = projectGroupChoice(group, picked);
            return (
              <ProjectGroup
                key={choice.connectionId}
                choice={choice}
                expanded={expandedGroups.get(choice.connectionId) ?? initiallyExpanded}
                onExpandedChange={(next) =>
                  setExpandedGroups((previous) => new Map(previous).set(choice.connectionId, next))
                }
                onToggle={onToggle}
              />
            );
          })
        : null}
      {notice === null && hidden > 0 ? (
        <Text variant="meta">{t("hiddenInOther", { count: hidden })}</Text>
      ) : null}
    </fieldset>
  );
}

function ProjectGroup({
  choice,
  expanded,
  onExpandedChange,
  onToggle,
}: {
  choice: ProjectGroupChoice;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onToggle: (keys: ReadonlyArray<string>, on: boolean) => void;
}) {
  const t = useTranslations("shell.workspace.create");
  const total = choice.options.length;
  const summary = choice.unreadable
    ? t("groupUnreadable")
    : total === 0
      ? t("groupNone")
      : choice.selection === "all"
        ? t("groupAll", { total })
        : t("groupSome", { picked: choice.pickedCount, total });
  return (
    <CheckboxDisclosure
      label={choice.connectionName}
      summary={summary}
      toggleLabel={t("groupToggle", { connection: choice.connectionName, summary })}
      checked={choice.selection === "all"}
      indeterminate={choice.selection === "some"}
      onCheckedChange={(on) =>
        onToggle(
          choice.options.map((option) => option.key),
          on,
        )
      }
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      disabled={total === 0}
      {...(choice.unreadable
        ? {
            note: (
              <Text variant="ui" as="p" tone="problem">
                {t("groupFailed")}
              </Text>
            ),
          }
        : {})}
    >
      {choice.options.map((option) => (
        <Checkbox
          key={option.key}
          label={option.name}
          checked={option.picked}
          onCheckedChange={(on) => onToggle([option.key], on)}
        />
      ))}
    </CheckboxDisclosure>
  );
}

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.s4 },
  fieldset: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    minWidth: 0,
  },
  failed: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s2 },
});
