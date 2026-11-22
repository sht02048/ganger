import * as stylex from "@stylexjs/stylex";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { createContext, use, type ReactNode } from "react";
import { cx } from "../cx";
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

const gridColumns = stylex.create({
  of: (wide: string, first: string, second: string, narrow: string) => ({
    gridTemplateColumns: {
      default: wide,
      [breakpoints.tableFoldFirstRange]: first,
      [breakpoints.tableFoldSecondRange]: second,
      [breakpoints.tableStacked]: narrow,
    },
  }),
  withThird: (wide: string, first: string, second: string, third: string, narrow: string) => ({
    gridTemplateColumns: {
      default: wide,
      [breakpoints.tableFoldFirstRange]: first,
      [breakpoints.tableFoldSecondRange]: second,
      [breakpoints.tableFoldThirdRange]: third,
      [breakpoints.tableStackedBelowThird]: narrow,
    },
  }),
});

const single = "minmax(0, 1fr)";

type HeadHiding = "none" | "stacked" | "belowThird";

const ColumnsContext = createContext<{ columns: stylex.StyleXStyles; headHiding: HeadHiding }>({
  columns: gridColumns.of(single, single, single, single),
  headHiding: "none",
});

export type TableFold = "first" | "second" | "stacked";

export interface TableFoldedColumns {
  first: string;
  second?: string;
  third?: string;
}

export interface TableProps {
  columns: string;
  narrowColumns?: string;
  foldedColumns?: TableFoldedColumns;
  children: ReactNode;
}

export function tableColumnTemplates({
  columns,
  narrowColumns,
  foldedColumns,
}: Omit<TableProps, "children">): {
  wide: string;
  first: string;
  second: string;
  third: string | null;
  narrow: string;
} {
  const first = foldedColumns?.first ?? columns;
  const second = foldedColumns?.second ?? first;
  const third = foldedColumns?.third ?? null;
  return { wide: columns, first, second, third, narrow: narrowColumns ?? third ?? second };
}

export function Table({ columns, narrowColumns, foldedColumns, children }: TableProps) {
  const templates = tableColumnTemplates({
    columns,
    ...(narrowColumns === undefined ? {} : { narrowColumns }),
    ...(foldedColumns === undefined ? {} : { foldedColumns }),
  });
  return (
    <ColumnsContext
      value={{
        columns:
          templates.third === null
            ? gridColumns.of(templates.wide, templates.first, templates.second, templates.narrow)
            : gridColumns.withThird(
                templates.wide,
                templates.first,
                templates.second,
                templates.third,
                templates.narrow,
              ),
        headHiding:
          narrowColumns === undefined
            ? "none"
            : templates.third === null
              ? "stacked"
              : "belowThird",
      }}
    >
      <div {...stylex.props(styles.table)}>{children}</div>
    </ColumnsContext>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  const { columns, headHiding } = use(ColumnsContext);
  return (
    <div
      aria-hidden="true"
      {...stylex.props(
        styles.grid,
        columns,
        styles.head,
        headHiding === "stacked" && styles.headStacked,
        headHiding === "belowThird" && styles.headStackedBelowThird,
      )}
    >
      {children}
    </div>
  );
}

export type CellAlign = "start" | "end";

export function TableHeader({
  align = "start",
  hideWhen,
  children,
}: {
  align?: CellAlign;
  hideWhen?: TableFold;
  children: ReactNode;
}) {
  return (
    <span
      {...stylex.props(
        styles.cell,
        align === "end" && styles.end,
        hideWhen !== undefined && hiddenWhen[hideWhen],
      )}
    >
      {children}
    </span>
  );
}

export interface TableRowsProps {
  label: string;
  value: string | null;
  onValueChange: (value: string) => void;
  motionItems?: boolean;
  children: ReactNode;
}

export function TableRows({
  label,
  value,
  onValueChange,
  motionItems = false,
  children,
}: TableRowsProps) {
  return (
    <Listbox<string>
      aria-label={label}
      value={value}
      activation="automatic"
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      className={cx(styles.rows, motionItems && styles.motionRows)}
    >
      {children}
    </Listbox>
  );
}

export interface TableRowProps {
  value: string;
  label?: string;
  onOpen?: () => void;
  onActivate?: () => void;
  disabled?: boolean;
  children: ReactNode;
}

export function TableRow({
  value,
  label,
  onOpen,
  onActivate,
  disabled = false,
  children,
}: TableRowProps) {
  const { columns } = use(ColumnsContext);
  return (
    <ListboxItem<string>
      value={value}
      disabled={disabled}
      {...(label === undefined ? {} : { label })}
      {...(onOpen === undefined
        ? {}
        : {
            onDoubleClick: onOpen,
            onKeyDown: (event: { key: string }) => {
              if (event.key === "Enter") onOpen();
            },
          })}
      {...(onActivate === undefined
        ? {}
        : {
            onClick: () => {
              if (!disabled) onActivate();
            },
            onKeyDown: (event: { key: string; preventDefault: () => void }) => {
              if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              onActivate();
            },
          })}
      {...columnsStyle(columns)}
      className={(s) =>
        cx(
          styles.grid,
          columns,
          styles.row,
          s.highlighted && styles.rowHighlighted,
          s.selected && styles.rowSelected,
        )
      }
    >
      {children}
    </ListboxItem>
  );
}

function columnsStyle(columns: stylex.StyleXStyles) {
  const style = stylex.props(columns).style;
  return style === undefined ? {} : { style };
}

export interface TableCellProps {
  align?: CellAlign;
  numeric?: boolean;
  hideWhen?: TableFold;
  children: ReactNode;
}

export function TableCell({ align = "start", numeric, hideWhen, children }: TableCellProps) {
  return (
    <span
      {...(hideWhen === undefined ? {} : { "data-hide-when": hideWhen })}
      {...stylex.props(
        styles.cell,
        align === "end" && styles.end,
        numeric === true && styles.numeric,
        hideWhen !== undefined && hiddenWhen[hideWhen],
      )}
    >
      {children}
    </span>
  );
}

export interface TableFoldedOnlyProps {
  when: TableFold;
  block?: boolean;
  children: ReactNode;
}

export function TableFoldedOnly({ when, block, children }: TableFoldedOnlyProps) {
  return (
    <span
      data-folded-only={when}
      {...stylex.props(block === true ? shownWhenBlock[when] : shownWhenInline[when])}
    >
      {children}
    </span>
  );
}

export function RowTitle({ fullText, children }: { fullText?: string; children: ReactNode }) {
  return (
    <span
      {...(fullText === undefined ? {} : { title: fullText })}
      {...stylex.props(styles.rowTitle)}
    >
      {children}
    </span>
  );
}

export function RowReason({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.rowReason)}>{children}</span>;
}

export function TableEmpty({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.empty)}>{children}</div>;
}

const styles = stylex.create({
  table: { display: "flex", flexDirection: "column", minWidth: 0, containerType: "inline-size" },
  grid: {
    display: "grid",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: { default: 0, [breakpoints.tableStacked]: space.s1 },
    paddingInline: space.s3,
  },
  headStacked: { display: { default: "grid", [breakpoints.tableStacked]: "none" } },
  headStackedBelowThird: {
    display: { default: "grid", [breakpoints.tableStackedBelowThird]: "none" },
  },
  head: {
    height: 30,
    marginBottom: space.s2,
    color: colors.textTertiary,
    fontSize: fontSize.small,
  },
  rows: { display: "flex", flexDirection: "column", gap: space.px2, outline: "none" },
  motionRows: {
    display: { default: "flex", ":empty": "none" },
    gap: 0,
    marginBottom: `calc(${space.px2} * -1)`,
  },
  row: {
    position: "relative",
    minHeight: size.rowMinHeight,
    paddingBlock: space.s3,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    color: colors.textTertiary,
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: -2,
  },
  rowHighlighted: {
    backgroundColor: { default: colors.bgHover, ":hover": colors.bgHover },
  },
  rowSelected: {
    backgroundColor: { default: colors.bgSelected, ":hover": colors.bgSelected },
    boxShadow: `inset 0 0 0 1px ${colors.borderSelected}`,
  },
  cell: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  end: { textAlign: "end", justifySelf: "end" },
  numeric: { fontVariantNumeric: "tabular-nums" },
  rowTitle: {
    display: "block",
    overflow: "hidden",
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  rowReason: {
    display: "flex",
    alignItems: "center",
    gap: space.px6,
    marginTop: space.px2,
    overflow: "hidden",
    fontSize: fontSize.ui,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  empty: {
    paddingBlock: space.s6,
    paddingInline: space.s3,
    color: colors.textTertiary,
    fontSize: fontSize.body,
  },
});

const hiddenWhen = stylex.create({
  first: { display: { default: null, [breakpoints.tableFoldedFirst]: "none" } },
  second: { display: { default: null, [breakpoints.tableFoldedSecond]: "none" } },
  stacked: { display: { default: null, [breakpoints.tableStacked]: "none" } },
});

const shownWhenInline = stylex.create({
  first: { display: { default: "none", [breakpoints.tableFoldedFirst]: "inline" } },
  second: { display: { default: "none", [breakpoints.tableFoldedSecond]: "inline" } },
  stacked: { display: { default: "none", [breakpoints.tableStacked]: "inline" } },
});

const shownWhenBlock = stylex.create({
  first: {
    display: { default: "none", [breakpoints.tableFoldedFirst]: "block" },
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  second: {
    display: { default: "none", [breakpoints.tableFoldedSecond]: "block" },
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  stacked: {
    display: { default: "none", [breakpoints.tableStacked]: "block" },
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
});
