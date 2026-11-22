import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Chip,
  Dialog,
  DialogClose,
  Field,
  RadioGroup,
  RadioOption,
  Select,
  Text,
  showToast,
} from "@ganger/ui";
import type { SelectOption } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";
import { providerOfAgent } from "@ganger/core";
import { useTime } from "../format/time";
import { useAgentName, useUsageNames } from "../labels";
import type { AssignInput, AssignResult } from "@ganger/app/tickets/assign";
import { agentsFor, firstAssignableRepo, repoReach, runnersFor } from "@ganger/app/tickets/model";
import type {
  AssignDefaults,
  RunnerChoice,
  RunnerUsageLimit,
  TicketView,
} from "@ganger/app/tickets/model";

export const AUTO_RUNNER = "\u0000auto";

type Failure = Extract<AssignResult, { ok: false }>["reason"] | "failed";

export interface AssignDialogProps {
  ticket: TicketView;
  defaults: AssignDefaults;
  runners: ReadonlyArray<RunnerChoice>;
  agents: ReadonlyArray<string>;
  triggerLabel: string;
  triggerInRow?: boolean;
  onAssign: (input: AssignInput) => Promise<AssignResult>;
  onAssigned: () => void;
}

export function AssignDialog({
  ticket,
  defaults,
  runners,
  agents,
  triggerLabel,
  triggerInRow = false,
  onAssign,
  onAssigned,
}: AssignDialogProps) {
  const t = useTranslations("tickets.assign");
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState(() => firstAssignableRepo(defaults, runners));
  const [runner, setRunner] = useState(AUTO_RUNNER);
  const [agent, setAgent] = useState(defaults.agent);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const reset = () => {
    setRepo(firstAssignableRepo(defaults, runners));
    setRunner(AUTO_RUNNER);
    setAgent(defaults.agent);
    setFailure(null);
  };

  const submit = () => {
    setPending(true);
    setFailure(null);
    onAssign({
      connection: ticket.connection,
      ticketKey: ticket.key,
      ticketTitle: ticket.title,
      trackerProject: ticket.trackerProject.id,
      runnerProject: repo,
      runnerId: runner === AUTO_RUNNER ? null : runner,
      agent,
    }).then(
      (result) => {
        setPending(false);
        if (result.ok) {
          setOpen(false);
          showToast(t("done", { key: ticket.key }));
          onAssigned();
        } else {
          setFailure(result.reason);
        }
      },
      () => {
        setPending(false);
        setFailure("failed");
      },
    );
  };

  return (
    <Dialog
      trigger={triggerLabel}
      triggerVariant={triggerInRow ? "secondary" : "primary"}
      triggerCompact={triggerInRow}
      title={t("title", { key: ticket.key })}
      description={t("description")}
      open={open}
      scrollBody
      status={
        failure === null ? undefined : (
          <Text variant="ui" as="div" tone="problem" role="alert">
            {t(`error.${failure}`)}
          </Text>
        )
      }
      onOpenChange={(next) => {
        if (!next && pending) return;
        if (next) reset();
        setOpen(next);
      }}
      actions={
        <>
          <DialogClose>{t("cancel")}</DialogClose>
          <Button variant="primary" disabled={pending} onClick={submit}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </>
      }
    >
      <AssignForm
        defaults={defaults}
        runners={runners}
        agents={agents}
        repo={repo}
        runner={runner}
        agent={agent}
        onRepoChange={(next) => {
          setRepo(next);
          const kept = runnersFor(runners, next).find((r) => r.id === runner);
          if (kept === undefined || kept.blockedProjects.includes(next)) setRunner(AUTO_RUNNER);
        }}
        onRunnerChange={setRunner}
        onAgentChange={setAgent}
      />
    </Dialog>
  );
}

export interface AssignFormProps {
  defaults: AssignDefaults;
  runners: ReadonlyArray<RunnerChoice>;
  agents: ReadonlyArray<string>;
  repo: string;
  runner: string;
  agent: string;
  onRepoChange: (repo: string) => void;
  onRunnerChange: (runner: string) => void;
  onAgentChange: (agent: string) => void;
}

export interface RunnerOptionLabels {
  auto: string;
  offline: (name: string) => string;
  blocked: (name: string) => string;
  repoBlocked: (name: string) => string;
  limited: (name: string, limit: RunnerUsageLimit) => string;
}

export function runnerOptionsFor(
  runners: ReadonlyArray<RunnerChoice>,
  runnerProject: string,
  agent: string,
  label: RunnerOptionLabels,
): SelectOption[] {
  const provider = providerOfAgent(agent);
  return [
    { value: AUTO_RUNNER, label: label.auto },
    ...runnersFor(runners, runnerProject).map((r): SelectOption => {
      if (r.assignmentBlocked) return { value: r.id, label: label.blocked(r.name), disabled: true };
      if (r.blockedProjects.includes(runnerProject)) {
        return { value: r.id, label: label.repoBlocked(r.name), disabled: true };
      }
      if (!r.online) return { value: r.id, label: label.offline(r.name) };
      const limit = r.usageLimits.find((l) => l.provider === provider);
      return { value: r.id, label: limit === undefined ? r.name : label.limited(r.name, limit) };
    }),
  ];
}

export function AssignForm({
  defaults,
  runners,
  agents,
  repo,
  runner,
  agent,
  onRepoChange,
  onRunnerChange,
  onAgentChange,
}: AssignFormProps) {
  const t = useTranslations("tickets.assign");
  const usageNames = useUsageNames();
  const { duration } = useTime();
  const repoLabelId = useId();
  const repoName = useId();
  const repoHintId = useId();
  const runnerOptions = runnerOptionsFor(runners, repo, agent, {
    auto: t("runnerAuto"),
    offline: (name) => t("runnerOffline", { name }),
    blocked: (name) => t("runnerBlocked", { name }),
    repoBlocked: (name) => t("runnerRepoBlocked", { name }),
    limited: (name, limit) =>
      t("runnerLimited", {
        name,
        provider: usageNames.provider(limit.provider),
        duration: duration(limit.resetsInMs),
      }),
  });
  const agentName = useAgentName();
  const agentOptions: SelectOption[] = agentsFor(agents, defaults.agent).map((a) => ({
    value: a,
    label: agentName(a),
  }));
  return (
    <div {...stylex.props(styles.form)}>
      <div {...stylex.props(styles.repos)}>
        <Text variant="label" id={repoLabelId}>
          {t("project")}
        </Text>
        <RadioGroup labelledBy={repoLabelId} describedBy={repoHintId}>
          {defaults.repos.map((choice) => {
            const reach = repoReach(runners, choice.id);
            return (
              <RadioOption
                key={choice.id}
                name={repoName}
                value={choice.id}
                checked={repo === choice.id}
                onCheck={() => onRepoChange(choice.id)}
                disabled={reach.pushBlockedEverywhere}
              >
                <span {...stylex.props(styles.repo)}>
                  <span {...stylex.props(styles.repoName)}>
                    <Text
                      variant="ui"
                      tone={reach.pushBlockedEverywhere ? "disabled" : "strong"}
                      mono
                      wrap="anywhere"
                    >
                      {choice.name}
                    </Text>
                    {choice.isDefault ? <Chip strong>{t("repoDefault")}</Chip> : null}
                    {choice.label === null ? null : (
                      <Text variant="meta">{t("repoLabel", { label: choice.label })}</Text>
                    )}
                  </span>
                  <Text variant="meta">
                    {reach.pushBlockedEverywhere
                      ? t("repoBlocked")
                      : t("repoRunners", { count: reach.runners })}
                  </Text>
                </span>
              </RadioOption>
            );
          })}
        </RadioGroup>
        <Text variant="meta" id={repoHintId}>
          {t("projectHint")}
        </Text>
        {repoReach(runners, repo).pushBlockedEverywhere ? (
          <Text variant="ui" as="p" tone="problem">
            {t("repoBlockedChosen")}
          </Text>
        ) : null}
      </div>
      <Field label={t("runner")} description={t("runnerHint")}>
        <Select
          name="runner"
          value={runner}
          onValueChange={onRunnerChange}
          options={runnerOptions}
        />
      </Field>
      <Field label={t("agent")}>
        <Select name="agent" value={agent} onValueChange={onAgentChange} options={agentOptions} />
      </Field>
    </div>
  );
}

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.s4 },
  repos: { display: "flex", flexDirection: "column", gap: space.s1 },
  repo: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  repoName: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s2,
    rowGap: space.px2,
    minWidth: 0,
  },
});
