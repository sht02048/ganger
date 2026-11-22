import * as stylex from "@stylexjs/stylex";
import { useId } from "react";
import type { ReactNode, Ref } from "react";
import { focusStyles } from "./focus";
import { linkStyles } from "./link";
import { textStyles } from "./text";
import { breakpoints, colors, fontSize, motion, radius, size, space } from "../tokens.stylex";

export interface KanbanColumnProps {
  title: string;
  count: number;
  note?: ReactNode;
  headLink?: KanbanHeadLink;
  children: ReactNode;
}

export interface KanbanHeadLink {
  href: string;
  label: string;
}

export function KanbanColumn({ title, count, note, headLink, children }: KanbanColumnProps) {
  const name = (
    <>
      <h2 {...stylex.props(textStyles("subheading"), styles.columnTitle)}>{title}</h2>
      <span {...stylex.props(styles.count)}>{count}</span>
    </>
  );
  return (
    <section aria-label={title} data-column="" {...stylex.props(styles.column)}>
      <div {...stylex.props(styles.columnHead)}>
        {headLink === undefined ? (
          name
        ) : (
          <a
            href={headLink.href}
            aria-label={headLink.label}
            {...stylex.props(linkStyles("plain"), styles.headLink)}
          >
            {name}
          </a>
        )}
        {note === undefined ? null : <span {...stylex.props(styles.note)}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

export function KanbanCards({
  motionItems = false,
  children,
}: {
  motionItems?: boolean;
  children: ReactNode;
}) {
  return <ul {...stylex.props(styles.cards, motionItems && styles.motionCards)}>{children}</ul>;
}

export function KanbanSubheading({ children }: { children: ReactNode }) {
  return <p {...stylex.props(textStyles("label"), styles.subheading)}>{children}</p>;
}

export interface KanbanCardProps {
  ticketKey?: ReactNode;
  tag?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  detailTone?: "problem";
  blockers?: ReactNode;
  prChips?: ReactNode;
  stuck?: boolean;
  meta?: ReactNode;
  metaTone?: "problem";
  time?: ReactNode;
  action?: ReactNode;
  menu?: ReactNode;
  onOpen: () => void;
  openRef?: Ref<HTMLButtonElement>;
  selected?: boolean;
  titleId?: string;
}

export function KanbanCard({
  ticketKey,
  tag,
  title,
  detail,
  detailTone,
  blockers,
  prChips,
  stuck = false,
  meta,
  metaTone,
  time,
  action,
  menu,
  onOpen,
  openRef,
  selected = false,
  titleId,
}: KanbanCardProps) {
  const ownId = useId();
  const nameId = titleId ?? `${ownId}title`;
  const tagId = `${ownId}tag`;
  const detailId = `${ownId}detail`;
  const chipsId = `${ownId}chips`;
  const footId = `${ownId}foot`;
  const hasFoot = meta !== undefined || time !== undefined || action !== undefined;
  const hasChips = blockers !== undefined || prChips !== undefined;
  const keyed = ticketKey !== undefined;
  const described = [
    tag === undefined ? null : tagId,
    detail === undefined ? null : detailId,
    hasChips ? chipsId : null,
    hasFoot ? footId : null,
  ].filter((id) => id !== null);
  return (
    <div {...stylex.props(styles.card)}>
      <button
        type="button"
        {...(openRef === undefined ? {} : { ref: openRef })}
        aria-haspopup="dialog"
        aria-expanded={selected}
        aria-labelledby={nameId}
        {...(described.length === 0 ? {} : { "aria-describedby": described.join(" ") })}
        onClick={onOpen}
        {...stylex.props(
          styles.open,
          focusStyles.ring,
          styles.openRadius,
          keyed && styles.openKeyed,
          action !== undefined && styles.openWithAction,
          selected && styles.selected,
          stuck && (selected ? styles.stuckSelected : styles.stuck),
        )}
      >
        {keyed ? (
          <span {...stylex.props(styles.identity)}>
            <span id={nameId} {...stylex.props(styles.contents)}>
              <span
                {...stylex.props(
                  textStyles("meta"),
                  styles.keyLine,
                  menu !== undefined && tag === undefined && styles.besideMenu,
                )}
              >
                {ticketKey}
              </span>{" "}
              {title === null ? null : <span {...stylex.props(styles.keyedTitle)}>{title}</span>}
            </span>
            {tag === undefined ? null : (
              <span
                id={tagId}
                {...stylex.props(styles.keyedTag, menu !== undefined && styles.besideMenu)}
              >
                {tag}
              </span>
            )}
          </span>
        ) : (
          <>
            {tag === undefined ? null : (
              <span
                id={tagId}
                {...stylex.props(styles.tag, menu !== undefined && styles.besideMenu)}
              >
                {tag}
              </span>
            )}
            <span
              id={nameId}
              {...stylex.props(
                styles.title,
                menu !== undefined && tag === undefined && styles.besideMenu,
              )}
            >
              {title}
            </span>
          </>
        )}
        <span {...stylex.props(keyed ? styles.statusGroup : styles.contents)}>
          {detail === undefined ? null : (
            <span
              id={detailId}
              {...stylex.props(
                textStyles("ui"),
                styles.detail,
                detailTone === "problem" && styles.detailProblem,
              )}
            >
              {detail}
            </span>
          )}
          {hasChips ? (
            <span id={chipsId} {...stylex.props(styles.chipRow)}>
              {blockers}
              {prChips}
            </span>
          ) : null}
          {hasFoot ? (
            <span
              id={footId}
              {...stylex.props(
                styles.foot,
                keyed && styles.footKeyed,
                action !== undefined && styles.footWithAction,
              )}
            >
              <span
                {...stylex.props(
                  textStyles("meta"),
                  styles.meta,
                  keyed && styles.metaOneLine,
                  metaTone === "problem" && styles.detailProblem,
                )}
              >
                {meta}
              </span>
              {time === undefined ? null : (
                <span {...stylex.props(textStyles("meta"), styles.time)}>{time}</span>
              )}
            </span>
          ) : null}
        </span>
      </button>
      {action === undefined ? null : <span {...stylex.props(styles.action)}>{action}</span>}
      {menu === undefined ? null : <span {...stylex.props(styles.menu)}>{menu}</span>}
    </div>
  );
}

const styles = stylex.create({
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minWidth: 0,
    padding: space.s3,
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
  },
  columnHead: {
    display: "flex",
    alignItems: "baseline",
    gap: space.s2,
    minWidth: 0,
    paddingInline: space.s1,
    paddingTop: space.s1,
  },
  columnTitle: { margin: 0 },
  headLink: { display: "inline-flex", alignItems: "baseline", gap: space.s2, minWidth: 0 },
  count: { color: colors.textTertiary, fontVariantNumeric: "tabular-nums" },
  note: {
    marginInlineStart: "auto",
    color: colors.textTertiary,
    fontSize: fontSize.small,
    textAlign: "end",
  },
  cards: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  motionCards: {
    display: { default: "flex", ":empty": "none" },
    gap: 0,
    marginBottom: `calc(${space.s2} * -1)`,
  },
  subheading: {
    margin: 0,
    paddingInline: space.s1,
    paddingTop: space.s2,
  },
  card: { position: "relative", minWidth: 0, containerType: "inline-size" },
  open: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: space.s1,
    width: "100%",
    minWidth: 0,
    margin: 0,
    padding: space.s3,
    borderWidth: 0,
    backgroundColor: {
      default: colors.bgRaised,
      ":hover": { default: null, "@media (hover: hover)": colors.bgRaisedHover },
    },
    color: colors.textPrimary,
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
  },
  openRadius: { borderRadius: radius.control },
  openKeyed: {
    gap: space.s3,
    boxShadow: {
      default: `inset 0 0 0 1px ${colors.borderDefault}`,
      ":hover": {
        default: null,
        "@media (hover: hover)": `inset 0 0 0 1px ${colors.borderStrong}`,
      },
    },
    transform: {
      default: null,
      ":active": { default: "scale(0.97)", "@media (prefers-reduced-motion: reduce)": null },
    },
    transitionProperty: "background-color, box-shadow, transform",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.textPrimary}` },
  },
  stuck: {
    boxShadow: {
      default: `inset 0 0 0 1px ${colors.problemBorder}`,
      ":hover": { default: null, "@media (hover: hover)": `inset 0 0 0 1px ${colors.problem}` },
    },
  },
  stuckSelected: { boxShadow: `inset 0 0 0 1px ${colors.problem}` },
  contents: { display: "contents" },
  identity: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: space.s2,
    rowGap: space.px2,
    minWidth: 0,
  },
  keyLine: {
    gridColumn: 1,
    gridRow: 1,
    minWidth: 0,
    minHeight: size.pill,
    overflow: "hidden",
    lineHeight: size.pill,
    fontVariantNumeric: "tabular-nums",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  keyedTag: { gridColumn: 2, gridRow: 1, display: "flex" },
  keyedTitle: {
    gridColumn: "1 / -1",
    gridRow: 2,
    display: "-webkit-box",
    minWidth: 0,
    overflow: "hidden",
    overflowWrap: "anywhere",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  statusGroup: { display: "flex", flexDirection: "column", gap: space.px6, minWidth: 0 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: space.px6, minWidth: 0 },
  footKeyed: { paddingTop: 0 },
  metaOneLine: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  openWithAction: {
    paddingBottom: {
      default: space.s3,
      [breakpoints.kanbanCardActionBelow]: `calc(${space.s3} + ${size.control} + ${space.s2})`,
    },
  },
  besideMenu: { paddingInlineEnd: `calc(${size.control} - ${space.s2})` },
  selected: { boxShadow: `inset 0 0 0 1px ${colors.borderSelected}` },
  tag: { display: "flex", paddingBottom: space.s1 },
  title: {
    display: "-webkit-box",
    minWidth: 0,
    overflow: "hidden",
    overflowWrap: "anywhere",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  detailProblem: { color: colors.problem },
  detail: {
    display: "-webkit-box",
    minWidth: 0,
    overflow: "hidden",
    color: colors.textSecondary,
    overflowWrap: "anywhere",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  foot: {
    display: "flex",
    alignItems: "baseline",
    gap: space.s2,
    minWidth: 0,
    paddingTop: space.s1,
  },
  footWithAction: {
    alignItems: { default: "center", [breakpoints.kanbanCardActionBelow]: "baseline" },
    minHeight: { default: size.control, [breakpoints.kanbanCardActionBelow]: 0 },
    paddingInlineEnd: { default: size.rowActionColumn, [breakpoints.kanbanCardActionBelow]: 0 },
  },
  meta: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    overflowWrap: "break-word",
  },
  time: { flexShrink: 0, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  menu: {
    position: "absolute",
    insetInlineEnd: space.s1,
    insetBlockStart: space.s1,
    display: "flex",
  },
  action: {
    position: "absolute",
    insetInlineEnd: space.s3,
    insetBlockEnd: space.s3,
    display: "flex",
    justifyContent: "flex-end",
  },
});
