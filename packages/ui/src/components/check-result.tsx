import * as stylex from "@stylexjs/stylex";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { useId, useState, type ReactNode } from "react";
import { cx } from "../cx";
import { colors, fontSize, fontWeight, radius, space } from "../tokens.stylex";
import { focusStyles } from "./focus";
import { CheckIcon, ChevronDownIcon, CloseIcon, UnknownIcon } from "./icons";
import { VisuallyHidden } from "./visually-hidden";

export type CheckResultState = "ok" | "broken" | "unknown";

export function CheckResultIcon({ state }: { state: CheckResultState }) {
  return (
    <span data-check-icon={state} {...stylex.props(styles.icon, iconTone[state])}>
      {state === "ok" ? <CheckIcon /> : state === "broken" ? <CloseIcon /> : <UnknownIcon />}
    </span>
  );
}

export function CheckResultList({ children }: { children: ReactNode }) {
  return <ul {...stylex.props(styles.list)}>{children}</ul>;
}

export interface CheckResultRowProps {
  state: CheckResultState;
  stateLabel: string;
  name: ReactNode;
  reason?: ReactNode;
  children?: ReactNode;
}

export function CheckResultRow({ state, stateLabel, name, reason, children }: CheckResultRowProps) {
  return (
    <li data-check={state} {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.iconCell)}>
        <CheckResultIcon state={state} />
        <VisuallyHidden>{stateLabel} </VisuallyHidden>
      </span>
      <span {...stylex.props(styles.name, state === "ok" && styles.nameOk)}>{name}</span>
      {reason === undefined ? null : (
        <span {...stylex.props(styles.reason, state === "broken" && styles.reasonBroken)}>
          {reason}
        </span>
      )}
      {children === undefined ? null : <div {...stylex.props(styles.detail)}>{children}</div>}
    </li>
  );
}

export interface ExpandableRowProps {
  leading?: ReactNode;
  summary: ReactNode;
  children: ReactNode;
}

export function ExpandableRow({ leading, summary, children }: ExpandableRowProps) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  return (
    <div {...stylex.props(styles.expandable)}>
      <SdkButton
        aria-expanded={expanded}
        {...(expanded ? { "aria-controls": bodyId } : {})}
        onClick={() => setExpanded((open) => !open)}
        className={cx(styles.summary, focusStyles.ring)}
      >
        {leading}
        <span {...stylex.props(styles.summaryText)}>{summary}</span>
        <span {...stylex.props(styles.chevron, expanded && styles.chevronOpen)}>
          <ChevronDownIcon />
        </span>
      </SdkButton>
      {expanded ? <div id={bodyId}>{children}</div> : null}
    </div>
  );
}

const styles = stylex.create({
  icon: { display: "inline-flex", flexShrink: 0, alignItems: "center" },
  iconCell: { position: "relative", display: "inline-flex", alignSelf: "center" },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    margin: 0,
    paddingBlock: space.s1,
    paddingInline: 0,
    borderRadius: radius.control,
    backgroundColor: colors.bgCard,
    listStyle: "none",
    minWidth: 0,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "baseline",
    columnGap: space.s2,
    rowGap: space.s1,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    fontSize: fontSize.ui,
    minWidth: 0,
  },
  name: { minWidth: 0, color: colors.textPrimary, overflowWrap: "anywhere" },
  nameOk: { color: colors.textSecondary },
  reason: {
    maxWidth: "100%",
    color: colors.textTertiary,
    fontSize: fontSize.small,
    textAlign: "end",
  },
  reasonBroken: { color: colors.problem },
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    gridColumn: "2 / -1",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  expandable: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  summary: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    width: "100%",
    minHeight: 40,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: {
      default: colors.bgCard,
      ":hover": { default: null, "@media (hover: hover)": colors.bgCardHover },
    },
    color: colors.textPrimary,
    font: "inherit",
    fontSize: fontSize.ui,
    fontWeight: fontWeight.regular,
    textAlign: "start",
    cursor: "pointer",
  },
  summaryText: { flexGrow: 1, minWidth: 0 },
  chevron: { display: "inline-flex", flexShrink: 0, color: colors.textTertiary },
  chevronOpen: { transform: "rotate(180deg)" },
});

const iconTone = stylex.create({
  ok: { color: colors.progress },
  broken: { color: colors.problem },
  unknown: { color: colors.textTertiary },
});
