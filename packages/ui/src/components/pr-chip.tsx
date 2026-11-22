import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { textStyles } from "./text";
import { VisuallyHidden } from "./visually-hidden";
import { colors, radius, size, space } from "../tokens.stylex";

export type PrChipKind = "ci-failed" | "conflict" | "behind";

const ICON_PATH: Record<PrChipKind, string> = {
  "ci-failed": "M6 6l12 12M18 6 6 18",
  conflict: "M7 7h11l-3-3M17 17H6l3 3",
  behind: "M12 5v14M6 13l6 6 6-6",
};

export interface PrChipProps {
  kind: PrChipKind;
  children: ReactNode;
}

export function PrChip({ kind, children }: PrChipProps) {
  return (
    <span
      data-pr-chip={kind}
      {...stylex.props(
        textStyles("meta"),
        styles.chip,
        kind === "behind" ? styles.neutral : styles.problem,
      )}
    >
      <svg
        aria-hidden="true"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        {...stylex.props(styles.icon)}
      >
        <path d={ICON_PATH[kind]} />
      </svg>
      {children}
    </span>
  );
}

export interface PrChipMoreProps {
  children: ReactNode;
  hiddenLabel: string;
}

export function PrChipMore({ children, hiddenLabel }: PrChipMoreProps) {
  return (
    <span data-pr-chip="more" {...stylex.props(textStyles("meta"), styles.chip, styles.neutral)}>
      <span aria-hidden="true">{children}</span>
      <VisuallyHidden>{hiddenLabel}</VisuallyHidden>
    </span>
  );
}

const styles = stylex.create({
  chip: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: space.px6,
    minHeight: size.pill,
    paddingInline: space.px6,
    borderRadius: radius.pill,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  icon: { flexShrink: 0 },
  problem: { backgroundColor: colors.problemSoft, color: colors.problem },
  neutral: { backgroundColor: colors.bgControl, color: colors.textSecondary },
});
