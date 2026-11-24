import * as stylex from "@stylexjs/stylex";
import { defaultStringifySearch } from "@tanstack/react-router";
import { Text } from "@ganger/ui";
import type { PillStatus } from "@ganger/ui";
import type { RunId } from "@ganger/core";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { useAgentName, useQueuedReasonText } from "../labels";
import { useStatusName } from "../status";
import type { HomeRun, TodoTag } from "@ganger/app/home/model";
import { subjectParticle } from "./particle";

export function RunKey({ run, size = "card" }: { run: HomeRun; size?: "card" | "panel" }) {
  return (
    <span {...stylex.props(styles.keyLine)}>
      <Text variant="meta" numeric>
        {run.ticketKey}
      </Text>
      {run.ticketTitle === null ? null : (
        <>
          {" "}
          <Text variant={size === "panel" ? "panel" : "title"} as="span">
            {run.ticketTitle}
          </Text>
        </>
      )}
    </span>
  );
}

export function cardStatus(run: HomeRun, tag: TodoTag | null): PillStatus {
  if (tag !== null) return tag;
  return run.state === "ended" ? run.summary : run.state;
}

export function useRunText() {
  const t = useTranslations("home.card");
  const tDomain = useTranslations("domain");
  const queuedReasonText = useQueuedReasonText();
  const agentName = useAgentName();
  const statusName = useStatusName();
  const { duration } = useTime();

  const unreachable = (run: HomeRun & { state: "disconnected" }) => {
    const runner = run.runner?.name ?? t("noRunner");
    return run.unreachableMs === null
      ? t("unreachable", { runner })
      : t("unreachableFor", { runner, duration: duration(run.unreachableMs) });
  };

  const queued = (run: HomeRun & { state: "queued" }) => {
    const reason = run.queuedReason;
    switch (reason.kind) {
      case "behind":
      case "no-capacity":
        return t("queuedFree");
      case "runner-offline":
        return run.runner === null
          ? t("queuedAnyOffline")
          : t("queuedOffline", {
              runner: run.runner.name,
              subject: subjectParticle(run.runner.name),
            });
      case "starting":
      case "project-missing":
      case "assignment-blocked":
        return tDomain(`queuedReason.${reason.kind}`);
      case "usage-limit":
      case "blockers-waiting":
      case "blockers-stuck":
        return queuedReasonText(reason);
    }
  };

  const runnerLine = (run: HomeRun, all: boolean): string =>
    [run.runner?.name ?? t("noRunner"), agentName(run.agent), all ? run.workspace.name : null]
      .filter((part) => part !== null)
      .join(" · ");

  return {
    unreachable,
    queued,
    runnerLine,
    agentName,
    statusName,
    agentResult: (run: HomeRun & { state: "ended" }) => tDomain(`agentResult.${run.agentResult}`),
  };
}

export function runHref(run: { id: RunId; workspace: { id: string } }): string {
  return href(`/runs/${encodeURIComponent(run.id)}`, { ws: run.workspace.id });
}

export function ticketHref(run: HomeRun): string {
  return href("/tickets", { ws: run.workspace.id, sel: run.ticketId });
}

export function href(path: string, search: Record<string, string>): string {
  return `${path}${defaultStringifySearch(search)}`;
}

const styles = stylex.create({
  keyLine: { overflowWrap: "anywhere" },
});
