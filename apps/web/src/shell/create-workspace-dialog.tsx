import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Text,
  linkStyles,
  surfaceStyles,
  textStyles,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { ConnectionProjects } from "@ganger/app/settings/model";
import {
  canCreateWorkspace,
  pickedProjects,
  projectChoiceKey,
  projectChoiceNotice,
} from "./create-workspace-model";
import type { NewWorkspaceProject } from "./create-workspace-model";

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

  const toggle = (key: string, on: boolean) => {
    setPicked((previous) => {
      const next = new Set(previous);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
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
        <Field label={t("name")}>
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
  onToggle: (key: string, on: boolean) => void;
  onRetry: () => void;
  renderSettingsLink: (children: ReactNode) => ReactNode;
}) {
  const t = useTranslations("shell.workspace.create");
  const legendId = useId();
  const notice = choices.kind === "ready" ? projectChoiceNotice(choices.groups) : null;
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
        ? choices.groups.map((group) => (
            <div key={group.connection.id} {...stylex.props(surfaceStyles("inset"), styles.group)}>
              <span {...stylex.props(textStyles("label"), styles.groupTitle)}>
                {group.connection.name}
              </span>
              {group.error === null ? null : (
                <Text variant="ui" as="p" tone="problem">
                  {t("groupFailed")}
                </Text>
              )}
              {group.projects.length === 0 && group.error === null ? (
                <Text variant="meta">{t("groupEmpty")}</Text>
              ) : null}
              {group.projects.map((project) => {
                const key = projectChoiceKey(group.connection.id, project.id);
                const owner = project.owner;
                return owner.kind === "free" ? (
                  <Checkbox
                    key={key}
                    label={project.name}
                    checked={picked.has(key)}
                    onCheckedChange={(on) => onToggle(key, on)}
                  />
                ) : (
                  <Checkbox
                    key={key}
                    label={project.name}
                    {...(owner.kind === "other"
                      ? { description: t("inOther", { workspace: owner.workspace.name }) }
                      : {})}
                    checked={false}
                    disabled
                    onCheckedChange={() => {}}
                  />
                );
              })}
            </div>
          ))
        : null}
    </fieldset>
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
  group: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: space.s2,
    paddingInline: space.s1,
  },
  groupTitle: { paddingTop: space.s1, paddingInline: space.s3 },
});
