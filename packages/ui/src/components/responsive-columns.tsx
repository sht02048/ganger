import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { breakpoints, colors, fontSize, size, space } from "../tokens.stylex";

export interface ResponsiveColumn {
  width: string;
  content: ReactNode;
}

export type ResponsiveColumnsFit = "default" | "roomy";

export interface ResponsiveColumnsProps {
  id?: string;
  lead: ReactNode;
  columns: ReadonlyArray<ResponsiveColumn>;
  fit?: ResponsiveColumnsFit;
}

export function responsiveColumnTemplates(widths: ReadonlyArray<string>): {
  wide: string;
  split: string;
} {
  const fixed = widths.slice(0, -1);
  return {
    wide: ["minmax(0, 1fr)", ...widths].join(" "),
    split: [...fixed, "minmax(0, 1fr)"].join(" "),
  };
}

export function ResponsiveColumns({ id, lead, columns, fit = "default" }: ResponsiveColumnsProps) {
  const templates = responsiveColumnTemplates(columns.map((column) => column.width));
  return (
    <span {...stylex.props(styles.container)}>
      <span
        {...(id === undefined ? {} : { id })}
        data-columns="responsive"
        data-fit={fit}
        {...stylex.props(styles.grid, dynamic[fit](templates.wide, templates.split))}
      >
        <span {...stylex.props(styles.lead, leadFit[fit])}>{lead}</span>
        {columns.map((column, index) => (
          <span key={index} {...stylex.props(styles.cell)}>
            {column.content}
          </span>
        ))}
      </span>
    </span>
  );
}

export interface ResponsiveColumnsHeadProps {
  lead: ReactNode;
  columns: ReadonlyArray<ResponsiveColumn>;
  fit?: ResponsiveColumnsFit;
}

export function ResponsiveColumnsHead({
  lead,
  columns,
  fit = "default",
}: ResponsiveColumnsHeadProps) {
  const templates = responsiveColumnTemplates(columns.map((column) => column.width));
  return (
    <div aria-hidden="true" {...stylex.props(styles.container, styles.headFrame)}>
      <span
        data-columns="head"
        data-fit={fit}
        {...stylex.props(
          styles.grid,
          dynamic[fit](templates.wide, templates.split),
          styles.head,
          headFit[fit],
        )}
      >
        <span>{lead}</span>
        {columns.map((column, index) => (
          <span key={index}>{column.content}</span>
        ))}
      </span>
    </div>
  );
}

const styles = stylex.create({
  container: { display: "block", containerType: "inline-size", minWidth: 0 },
  grid: {
    display: "grid",
    alignItems: "center",
    columnGap: space.s5,
    rowGap: space.s2,
    minWidth: 0,
  },
  headFrame: { paddingInline: space.s3 },
  head: {
    height: size.tableHeadHeight,
    marginBottom: space.s2,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    whiteSpace: "nowrap",
  },
  lead: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    minWidth: 0,
  },
  cell: { display: "grid", justifyItems: "start", minWidth: 0 },
});

const headFit = stylex.create({
  default: {
    display: { default: "grid", [breakpoints.responsiveColumnsStacked]: "none" },
  },
  roomy: {
    display: { default: "grid", [breakpoints.responsiveColumnsRoomyStacked]: "none" },
  },
});

const leadFit = stylex.create({
  default: {
    gridColumn: { default: "auto", [breakpoints.responsiveColumnsStacked]: "1 / -1" },
  },
  roomy: {
    gridColumn: { default: "auto", [breakpoints.responsiveColumnsRoomyStacked]: "1 / -1" },
  },
});

const dynamic = stylex.create({
  default: (wide: string, split: string) => ({
    gridTemplateColumns: {
      default: wide,
      [breakpoints.responsiveColumnsSplit]: split,
      [breakpoints.responsiveColumnsSingle]: "minmax(0, 1fr)",
    },
  }),
  roomy: (wide: string, split: string) => ({
    gridTemplateColumns: {
      default: wide,
      [breakpoints.responsiveColumnsRoomySplit]: split,
      [breakpoints.responsiveColumnsRoomySingle]: "minmax(0, 1fr)",
    },
  }),
});
