import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, fontSize, size, space } from "../tokens.stylex";
import { surfaceStyles } from "./card";
import { CheckIcon, CloseIcon } from "./icons";

export type SignalTone = "pass" | "problem" | "warning" | "neutral";

export function SignalList({ children }: { children: ReactNode }) {
  return <dl {...stylex.props(surfaceStyles("inset"), styles.list)}>{children}</dl>;
}

export interface SignalRowProps {
  label: ReactNode;
  tone?: SignalTone;
  action?: ReactNode;
  detail?: ReactNode;
  children: ReactNode;
}

export function SignalRow({ label, tone, action, detail, children }: SignalRowProps) {
  return (
    <div data-signal-tone={tone ?? "none"} {...stylex.props(styles.row)}>
      <dt {...stylex.props(styles.label)}>{label}</dt>
      <dd {...stylex.props(styles.content)}>
        <span
          {...stylex.props(styles.icon, tone === undefined ? styles.iconBlank : iconTones[tone])}
        >
          {tone === undefined ? null : <SignalIcon tone={tone} />}
        </span>
        <span {...stylex.props(styles.value, tone === "problem" && styles.valueProblem)}>
          {children}
        </span>
        {action === undefined ? null : <span {...stylex.props(styles.action)}>{action}</span>}
        {detail === undefined ? null : <span {...stylex.props(styles.detail)}>{detail}</span>}
      </dd>
    </div>
  );
}

function SignalIcon({ tone }: { tone: SignalTone }) {
  switch (tone) {
    case "pass":
      return <CheckIcon />;
    case "problem":
      return <CloseIcon />;
    case "warning":
      return (
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 3.5v5.5M8 12.5v.01"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );
    case "neutral":
      return (
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M4.5 8h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

const iconTones = stylex.create({
  pass: { color: colors.progress },
  problem: { color: colors.problem },
  warning: { color: colors.textPrimary },
  neutral: { color: colors.textTertiary },
});

const styles = stylex.create({
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    paddingBlock: space.s1,
    paddingInline: space.s3,
    fontSize: fontSize.ui,
  },
  row: {
    display: "grid",
    gridTemplateColumns: `${size.panelLabelColumn} minmax(0, 1fr)`,
    alignItems: "baseline",
    columnGap: space.s2,
    paddingBlock: space.s2,
  },
  label: { color: colors.textTertiary },
  content: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s2,
    rowGap: space.px2,
    minWidth: 0,
    margin: 0,
  },
  icon: { display: "inline-flex", flexShrink: 0 },
  iconBlank: { width: size.icon },
  value: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: "min-content",
    color: colors.textPrimary,
    fontVariantNumeric: "tabular-nums",
  },
  valueProblem: { color: colors.problem },
  action: { flexShrink: 0, fontSize: fontSize.small },
  detail: {
    flexBasis: "100%",
    minWidth: 0,
    paddingInlineStart: `calc(${size.icon} + ${space.s2})`,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    overflowWrap: "anywhere",
  },
});
