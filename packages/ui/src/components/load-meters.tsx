import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, fontSize, size, space } from "../tokens.stylex";
import { UsageBar, type UsageTone } from "./usage-bar";

export interface LoadMeterItem {
  id: string;
  name: string;
  percent: number | null;
  label: string;
  emptyText: string;
  tone?: UsageTone;
  note?: ReactNode;
}

export interface LoadMetersProps {
  items: ReadonlyArray<LoadMeterItem>;
  density?: "compact" | "regular";
}

export function LoadMeters({ items, density = "regular" }: LoadMetersProps) {
  const compact = density === "compact";
  return (
    <ul {...stylex.props(styles.list, compact ? styles.listCompact : styles.listRegular)}>
      {items.map((item) => {
        const tone = item.tone ?? "neutral";
        return (
          <li
            key={item.id}
            data-load={item.id}
            data-tone={tone}
            {...stylex.props(styles.row, compact ? styles.rowCompact : styles.rowRegular)}
          >
            <span aria-hidden={item.percent !== null} {...stylex.props(styles.name)}>
              {item.name}
            </span>
            {item.percent === null ? (
              <span {...stylex.props(styles.empty)}>{item.emptyText}</span>
            ) : (
              <UsageBar percent={item.percent} label={item.label} tone={tone} density={density} />
            )}
            {item.note === undefined ? null : (
              <span {...stylex.props(styles.note, tone === "problem" && styles.noteProblem)}>
                {item.note}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const styles = stylex.create({
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
    minWidth: 0,
    width: "100%",
  },
  listCompact: { gap: space.px2 },
  listRegular: { gap: space.s3 },
  row: {
    display: "grid",
    alignItems: "center",
    columnGap: space.s2,
    minWidth: 0,
    color: colors.textSecondary,
  },
  rowCompact: {
    gridTemplateColumns: `${size.loadNameCompactColumn} minmax(0, 1fr)`,
    fontSize: fontSize.small,
  },
  rowRegular: {
    gridTemplateColumns: `${size.panelLabelColumn} minmax(0, 1fr)`,
    rowGap: space.s1,
    fontSize: fontSize.ui,
  },
  name: { minWidth: 0, whiteSpace: "nowrap" },
  empty: { textAlign: "end", color: colors.textSecondary },
  note: {
    gridColumn: "2 / -1",
    minWidth: 0,
    fontSize: fontSize.small,
    overflowWrap: "anywhere",
  },
  noteProblem: { color: colors.problem },
});
