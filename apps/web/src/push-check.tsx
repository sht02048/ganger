import * as stylex from "@stylexjs/stylex";
import { Text } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { PushProblem, PushSummary } from "@ganger/app/prerequisites";
import { useTime } from "./format/time";

export function usePushSummaryText(): (summary: PushSummary) => string {
  const t = useTranslations("domain.pushCheck");
  return (summary) => {
    if (summary.total === 0) return t("none");
    if (summary.passed === summary.total) return t("allPassed", { total: summary.total });
    return t("summary", { total: summary.total, passed: summary.passed });
  };
}

export function PushProblems({ summary }: { summary: PushSummary }) {
  const t = useTranslations("domain.pushCheck");
  const problems = [...summary.failed, ...summary.unknown];
  if (problems.length === 0) return null;
  const code = (chunks: ReactNode) => (
    <Text variant="meta" as="span" mono>
      {chunks}
    </Text>
  );
  return (
    <div {...stylex.props(styles.stack)}>
      <ul aria-label={t("problemsLabel")} {...stylex.props(styles.list)}>
        {summary.failed.map((problem) => (
          <ProblemLine key={problem.id} problem={problem} broken />
        ))}
        {summary.unknown.map((problem) => (
          <ProblemLine key={problem.id} problem={problem} broken={false} />
        ))}
      </ul>
      {summary.failedKinds.map((kind) => (
        <Text key={kind} variant="meta" as="p">
          {t.rich(`fix.${kind}`, { code })}
        </Text>
      ))}
      {summary.failed.length === 0 ? null : (
        <Text variant="meta" as="p">
          {t("scope")}
        </Text>
      )}
    </div>
  );
}

function ProblemLine({ problem, broken }: { problem: PushProblem; broken: boolean }) {
  const t = useTranslations("domain.pushCheck");
  const kind = problem.failure === null ? null : t(`failure.${problem.failure.kind}`);
  const reason = problem.failure?.reason ?? null;
  const reasonCode = (chunks: ReactNode) => (
    <Text variant="meta" as="span" mono>
      {chunks}
    </Text>
  );
  let detail: ReactNode;
  if (!broken) detail = kind === null ? t("unknown") : t("unknownReason", { kind });
  else if (kind === null) detail = t("failure.other");
  else if (reason === null) detail = kind;
  else detail = t.rich("failedReason", { kind, reason, code: reasonCode });
  return (
    <li data-push={broken ? "broken" : "unknown"} {...stylex.props(styles.line)}>
      <Text variant="ui" tone={broken ? "problem" : "strong"} as="span" wrap="anywhere">
        {problem.project}
      </Text>
      <Text variant="meta" as="span" wrap="anywhere">
        {detail}
      </Text>
    </li>
  );
}

export function useCheckingText(
  agoMs: number | null,
  form: "sentence" | "elapsed" = "sentence",
): string | null {
  const t = useTranslations("domain.pushCheck");
  const { duration } = useTime();
  const [sinceRender, setSinceRender] = useState(0);
  useEffect(() => {
    setSinceRender(0);
    if (agoMs === null) return;
    const renderedAt = Date.now();
    const timer = setInterval(() => setSinceRender(Date.now() - renderedAt), CHECKING_TEXT_TICK_MS);
    return () => clearInterval(timer);
  }, [agoMs]);
  if (agoMs === null) return null;
  const elapsed = duration(agoMs + sinceRender);
  return form === "sentence" ? t("checking", { duration: elapsed }) : elapsed;
}

const CHECKING_TEXT_TICK_MS = 15_000;

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    listStyle: "none",
    minWidth: 0,
  },
  line: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    minWidth: 0,
  },
});
