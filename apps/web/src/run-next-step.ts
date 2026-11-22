import type { RunNextStep } from "@ganger/app/run-next-step";
import { useTranslations } from "use-intl";

export type RunNextStepAction = Extract<
  RunNextStep,
  "pr-ci-failed" | "pr-conflict" | "question" | "human-check" | "paused"
>;

export interface RunNextStepText {
  kind: Exclude<RunNextStep, "none">;
  body: string;
  action: string | null;
}

export function nextStepAction(kind: RunNextStep): RunNextStepAction | null {
  switch (kind) {
    case "pr-ci-failed":
    case "pr-conflict":
    case "question":
    case "human-check":
    case "paused":
      return kind;
    case "permission":
    case "waiting-input":
    case "disconnected":
    case "blockers-stuck":
    case "kept-worktree":
    case "failed":
    case "none":
      return null;
  }
}

export function useRunNextStepText(): (kind: RunNextStep) => RunNextStepText | null {
  const t = useTranslations("domain.runNextStep");
  return (kind) => {
    if (kind === "none") return null;
    const action = nextStepAction(kind);
    return {
      kind,
      body: t(`body.${kind}`),
      action: action === null ? null : t(`action.${action}`),
    };
  };
}
