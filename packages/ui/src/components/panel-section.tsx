import * as stylex from "@stylexjs/stylex";
import { useId, type ReactNode } from "react";
import { focusStyles } from "./focus";
import { textStyles } from "./text";
import { colors, fontSize, fontWeight, radius, size, space } from "../tokens.stylex";

export interface PanelSectionProps {
  title: ReactNode;
  meta?: ReactNode;
  count?: number;
  info?: ReactNode;
  titleRole?: "subheading";
  children: ReactNode;
}

export function PanelSection({ title, meta, count, info, titleRole, children }: PanelSectionProps) {
  const titleId = useId();
  const heading = (
    <h3
      id={titleId}
      {...stylex.props(titleRole === undefined ? styles.title : textStyles(titleRole))}
    >
      {title}
    </h3>
  );
  return (
    <section aria-labelledby={titleId} {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.head)}>
        {count === undefined && info === undefined ? (
          heading
        ) : (
          <span {...stylex.props(styles.titleGroup)}>
            {heading}
            {count === undefined ? null : <span {...stylex.props(styles.meta)}>{count}</span>}
            {info}
          </span>
        )}
        {meta === undefined ? null : <span {...stylex.props(styles.meta)}>{meta}</span>}
      </div>
      {children}
    </section>
  );
}

export function PanelRows({
  ordered = false,
  children,
}: {
  ordered?: boolean;
  children: ReactNode;
}) {
  const List = ordered ? "ol" : "ul";
  return <List {...stylex.props(styles.rows)}>{children}</List>;
}

export function PanelList({ children }: { children: ReactNode }) {
  return <ul {...stylex.props(styles.list)}>{children}</ul>;
}

export interface PanelListRowProps {
  marker?: ReactNode;
  ticketKey?: string;
  title: string;
  done?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
}

export function PanelListRow({
  marker,
  ticketKey,
  title,
  done,
  trailing,
  onClick,
}: PanelListRowProps) {
  const content = (
    <>
      <span {...stylex.props(styles.marker)}>{marker}</span>
      {ticketKey === undefined ? null : (
        <span {...stylex.props(textStyles("meta"), styles.key)}>{ticketKey}</span>
      )}
      <span
        title={title}
        {...stylex.props(textStyles("ui"), styles.rowTitle, done === true && styles.rowTitleDone)}
      >
        {title}
      </span>
      {trailing === undefined ? null : (
        <span {...stylex.props(textStyles("meta"), styles.trailing)}>{trailing}</span>
      )}
    </>
  );
  return (
    <li {...stylex.props(styles.item)}>
      {onClick === undefined ? (
        <div {...stylex.props(styles.row)}>{content}</div>
      ) : (
        <button
          type="button"
          onClick={onClick}
          {...stylex.props(styles.row, styles.rowButton, focusStyles.ringInset)}
        >
          {content}
        </button>
      )}
    </li>
  );
}

const styles = stylex.create({
  section: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minWidth: 0,
  },
  head: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: space.s3,
    rowGap: space.s1,
    minWidth: 0,
  },
  titleGroup: { display: "inline-flex", alignItems: "center", gap: space.px6, minWidth: 0 },
  title: {
    margin: 0,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    marginBlock: 0,
    marginInline: `calc(${space.s3} * -1)`,
    padding: 0,
    listStyle: "none",
    minWidth: 0,
  },
  meta: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontVariantNumeric: "tabular-nums",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
    minWidth: 0,
  },
  item: { minWidth: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    boxSizing: "border-box",
    width: "100%",
    minHeight: size.panelListRow,
    paddingBlock: 0,
    paddingInline: space.s3,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: colors.bgCard,
    color: "inherit",
    font: "inherit",
    textAlign: "start",
  },
  rowButton: {
    backgroundColor: {
      default: colors.bgCard,
      ":hover": { default: null, "@media (hover: hover)": colors.bgCardHover },
    },
    cursor: "pointer",
  },
  marker: {
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: size.dot,
  },
  key: { flexShrink: 0, fontVariantNumeric: "tabular-nums" },
  rowTitle: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowTitleDone: { color: colors.textTertiary, textDecorationLine: "line-through" },
  trailing: { flexShrink: 0, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
});
