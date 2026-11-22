import * as stylex from "@stylexjs/stylex";
import type { KeyboardEvent, ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "./icons";
import { Tooltip } from "./tooltip";
import {
  breakpoints,
  colors,
  fontSize,
  fontWeight,
  motion,
  radius,
  size,
  space,
} from "../tokens.stylex";

export const ISSUE_STATE_KINDS = ["todo", "in-progress", "done", "canceled"] as const;
export type IssueStateKind = (typeof ISSUE_STATE_KINDS)[number];

const RING_RADIUS = 6;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function IssueStateIcon({ kind, label }: { kind: IssueStateKind; label: string }) {
  return (
    <Tooltip
      content={label}
      labelsTrigger
      render={
        <span
          role="img"
          aria-label={label}
          data-issue-state={kind}
          {...stylex.props(styles.stateIcon)}
        />
      }
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r={RING_RADIUS} stroke="currentColor" strokeWidth="1.5" />
        {kind === "in-progress" ? <path d="M8 4.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" /> : null}
        {kind === "done" ? (
          <path
            d="M5.25 8.25l1.9 1.9 3.6-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {kind === "canceled" ? (
          <path
            d="M6 6l4 4M10 6l-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        ) : null}
      </svg>
    </Tooltip>
  );
}

export function ProgressRing({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  const share = total === 0 ? 0 : Math.min(done / total, 1);
  return (
    <Tooltip
      content={label}
      labelsTrigger
      render={
        <span
          role="img"
          aria-label={label}
          data-progress={`${done}/${total}`}
          {...stylex.props(styles.stateIcon)}
        />
      }
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r={RING_RADIUS} strokeWidth="2" {...stylex.props(styles.ringTrack)} />
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${share * RING_LENGTH} ${RING_LENGTH}`}
          transform="rotate(-90 8 8)"
          opacity={share === 0 ? 0 : 1}
          {...stylex.props(styles.ringFill)}
        />
      </svg>
    </Tooltip>
  );
}

export interface IconToggleItem<T extends string> {
  value: T;
  label: string;
  icon: ReactNode;
}

export function IconToggleGroup<T extends string>({
  label,
  value,
  items,
  onValueChange,
}: {
  label: string;
  value: T;
  items: ReadonlyArray<IconToggleItem<T>>;
  onValueChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} {...stylex.props(styles.toggleGroup)}>
      {items.map((item) => (
        <Tooltip
          key={item.value}
          content={item.label}
          labelsTrigger
          render={
            <button
              type="button"
              aria-label={item.label}
              aria-pressed={item.value === value}
              onClick={() => onValueChange(item.value)}
              {...stylex.props(styles.toggle, item.value === value && styles.togglePressed)}
            />
          }
        >
          {item.icon}
        </Tooltip>
      ))}
    </div>
  );
}

export function GroupedViewIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M2.5 3.5h11M5.5 8h8M5.5 12.5h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function FlatViewIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export type IssueListMove = "previous" | "next" | "first" | "last";

const MOVE_KEYS: Readonly<Record<string, IssueListMove>> = {
  ArrowUp: "previous",
  ArrowDown: "next",
  Home: "first",
  End: "last",
};

export function IssueList({
  label,
  onMove,
  children,
}: {
  label: string;
  onMove: (move: IssueListMove, fromRowKey: string | null) => void;
  children: ReactNode;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = MOVE_KEYS[event.key];
    if (move === undefined) return;
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-issue-select"))
      return;
    event.preventDefault();
    const row = event.target.closest<HTMLElement>("[data-row-key]");
    onMove(move, row?.dataset["rowKey"] ?? null);
  };
  return (
    <div role="list" aria-label={label} onKeyDown={handleKeyDown} {...stylex.props(styles.list)}>
      {children}
    </div>
  );
}

export function IssueListFrame({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.frame)}>{children}</div>;
}

export function IssueListHead({
  keyLabel,
  titleLabel,
  runLabel,
  indented,
}: {
  keyLabel: string;
  titleLabel: string;
  runLabel: string;
  indented: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      {...stylex.props(styles.grid, indented ? styles.gridIndented : styles.gridFlat, styles.head)}
    >
      <span />
      <span>{keyLabel}</span>
      <span>{titleLabel}</span>
      <span {...stylex.props(styles.runCell)}>{runLabel}</span>
      <span />
    </div>
  );
}

export type IssueRowIndent = "none" | "top" | "child";
export type IssueRowSurface = "none" | "first" | "middle" | "last" | "only";

export interface IssueRowProps {
  rowKey: string;
  label: string;
  selected: boolean;
  tabbable: boolean;
  onSelect: () => void;
  indent: IssueRowIndent;
  surface?: IssueRowSurface;
  toggle?: { expanded: boolean; label: string; onToggle: () => void };
  icon: ReactNode;
  ticketKey: string;
  title: string;
  strong?: boolean;
  titleAfter?: ReactNode;
  below?: ReactNode;
  run: ReactNode;
  action?: ReactNode;
}

export function IssueRow({
  rowKey,
  label,
  selected,
  tabbable,
  onSelect,
  indent,
  surface = "none",
  toggle,
  icon,
  ticketKey,
  title,
  strong = false,
  titleAfter,
  below,
  run,
  action,
}: IssueRowProps) {
  return (
    <div
      role="listitem"
      data-row-key={rowKey}
      {...stylex.props(styles.rowSlot, surfaceSlot[surface])}
    >
      <div
        {...stylex.props(
          styles.grid,
          indent === "none" ? styles.gridFlat : styles.gridIndented,
          styles.row,
          surface !== "none" && styles.rowInCard,
          selected && styles.rowSelected,
        )}
      >
        <span {...stylex.props(styles.lead)}>
          {toggle === undefined ? null : (
            <Tooltip
              content={toggle.label}
              labelsTrigger
              render={
                <button
                  type="button"
                  aria-label={toggle.label}
                  aria-expanded={toggle.expanded}
                  onClick={toggle.onToggle}
                  {...stylex.props(styles.disclosure)}
                />
              }
            >
              {toggle.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </Tooltip>
          )}
          <span
            {...stylex.props(
              styles.iconSlot,
              iconIndent[indent],
              indent === "top" && toggle === undefined && styles.iconPastToggle,
            )}
          >
            {icon}
          </span>
        </span>
        <span {...stylex.props(styles.keyCell)}>{ticketKey}</span>
        <span {...stylex.props(styles.titleCell)}>
          <span {...stylex.props(styles.titleLine)}>
            <button
              type="button"
              data-issue-select=""
              aria-label={label}
              aria-current={selected ? "true" : undefined}
              tabIndex={tabbable ? 0 : -1}
              title={title}
              onClick={onSelect}
              {...stylex.props(styles.select, strong && styles.selectStrong)}
            >
              {title}
            </button>
            {titleAfter === undefined ? null : (
              <span {...stylex.props(styles.titleAfter)}>{titleAfter}</span>
            )}
          </span>
          {below === undefined ? null : <span {...stylex.props(styles.below)}>{below}</span>}
          <span data-run-below="" {...stylex.props(styles.runBelow)}>
            {run}
          </span>
        </span>
        <span data-run-cell="" {...stylex.props(styles.runCell)}>
          {run}
        </span>
        <span {...stylex.props(styles.actionCell)}>{action}</span>
      </div>
    </div>
  );
}

export function IssueGroupLabel({
  rowKey,
  name,
  count,
}: {
  rowKey: string;
  name: string;
  count: number;
}) {
  return (
    <div role="presentation" data-row-key={rowKey} {...stylex.props(styles.groupLabel)}>
      <span>{name}</span>
      <span {...stylex.props(styles.groupCount)}>{count}</span>
    </div>
  );
}

const overlayed = { position: "relative", zIndex: 1 } as const;

const styles = stylex.create({
  frame: { display: "flex", flexDirection: "column", minWidth: 0, containerType: "inline-size" },
  list: { display: "flex", flexDirection: "column", minWidth: 0 },
  grid: {
    display: "grid",
    alignItems: "center",
    columnGap: space.s3,
    paddingInline: space.s3,
  },
  gridIndented: {
    gridTemplateColumns: {
      default: `${size.issueLeadColumn} ${size.ticketKeyColumn} minmax(0, 1fr) ${size.lastRunColumn} ${size.rowActionColumn}`,
      [breakpoints.issueRowFolded]: `${size.issueLeadColumn} ${size.issueKeyNarrowColumn} minmax(0, 1fr) auto`,
    },
  },
  gridFlat: {
    gridTemplateColumns: {
      default: `${size.issueStateIcon} ${size.ticketKeyColumn} minmax(0, 1fr) ${size.lastRunColumn} ${size.rowActionColumn}`,
      [breakpoints.issueRowFolded]: `${size.issueStateIcon} ${size.issueKeyNarrowColumn} minmax(0, 1fr) auto`,
    },
  },
  head: {
    height: size.tableHeadHeight,
    marginBottom: space.s2,
    marginInline: space.s1,
    color: colors.textTertiary,
    fontSize: fontSize.small,
  },
  rowSlot: { display: "flow-root", paddingInline: space.s1 },
  row: {
    position: "relative",
    minHeight: size.rowMinHeight,
    paddingBlock: space.s2,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    color: colors.textTertiary,
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
  },
  rowInCard: { backgroundColor: { default: "transparent", ":hover": colors.bgCardHover } },
  rowSelected: {
    backgroundColor: { default: colors.bgSelected, ":hover": colors.bgSelected },
    boxShadow: `inset 0 0 0 1px ${colors.borderSelected}`,
  },
  lead: { ...overlayed, display: "flex", alignItems: "center", minWidth: 0 },
  iconSlot: { display: "inline-flex", flexShrink: 0 },
  iconPastToggle: { marginInlineStart: `calc(${size.issueToggle} + ${space.s1})` },
  stateIcon: { display: "inline-flex", flexShrink: 0, color: colors.textSecondary },
  ringTrack: { stroke: colors.meterTrack },
  ringFill: { stroke: colors.meterFill },
  disclosure: {
    ...overlayed,
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: size.issueToggle,
    height: size.issueToggle,
    marginInlineEnd: space.s1,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.pill,
    backgroundColor: { default: "transparent", ":hover": colors.bgCardHover },
    color: colors.textSecondary,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
  },
  keyCell: {
    minWidth: 0,
    overflow: "hidden",
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  titleCell: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  titleLine: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  select: {
    flexShrink: 1,
    minWidth: 0,
    padding: 0,
    overflow: "hidden",
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.textPrimary,
    fontFamily: "inherit",
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    textAlign: "start",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    cursor: "pointer",
    outline: "none",
    "::before": {
      content: "''",
      position: "absolute",
      inset: 0,
      borderRadius: radius.control,
      outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
      outlineOffset: -2,
    },
  },
  selectStrong: { fontWeight: fontWeight.semibold },
  titleAfter: {
    ...overlayed,
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    gap: space.s1,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontVariantNumeric: "tabular-nums",
  },
  below: {
    overflow: "hidden",
    color: colors.textTertiary,
    fontSize: fontSize.small,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  runBelow: {
    display: { default: "none", [breakpoints.issueRowFolded]: "block" },
    overflow: "hidden",
    fontSize: fontSize.small,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  runCell: {
    display: { default: "block", [breakpoints.issueRowFolded]: "none" },
    minWidth: 0,
    overflow: "hidden",
    fontSize: fontSize.small,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  actionCell: { ...overlayed, display: "inline-flex", justifyContent: "flex-end", minWidth: 0 },
  toggleGroup: {
    display: "inline-flex",
    flexShrink: 0,
    gap: space.px2,
    marginInlineStart: "auto",
  },
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.iconButton,
    height: size.iconButton,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    color: colors.textTertiary,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
  },
  togglePressed: {
    backgroundColor: { default: colors.bgSelected, ":hover": colors.bgSelected },
    color: colors.textPrimary,
  },
  groupLabel: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingTop: space.s3,
    paddingBottom: space.s2,
    paddingInline: `calc(${space.s1} + ${space.s3})`,
    color: colors.textSecondary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
  },
  groupCount: { color: colors.textTertiary, fontVariantNumeric: "tabular-nums" },
});

const iconIndent = stylex.create({
  none: { marginInlineStart: 0 },
  top: { marginInlineStart: 0 },
  child: { marginInlineStart: `calc(${size.issueToggle} + ${space.s1} + ${space.s3})` },
});

const surfaceSlot = stylex.create({
  none: {},
  first: {
    paddingTop: space.s1,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    backgroundColor: colors.bgCard,
  },
  middle: { backgroundColor: colors.bgCard },
  last: {
    paddingBottom: space.s1,
    borderBottomLeftRadius: radius.card,
    borderBottomRightRadius: radius.card,
    backgroundColor: colors.bgCard,
    marginBottom: space.s2,
  },
  only: {
    paddingBlock: space.s1,
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
    marginBottom: space.s2,
  },
});
