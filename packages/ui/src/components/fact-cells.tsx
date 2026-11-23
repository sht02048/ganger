import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, fontSize, space } from "../tokens.stylex";
import { surfaceStyles } from "./card";

export function FactCells({ children }: { children: ReactNode }) {
  return <dl {...stylex.props(styles.list)}>{children}</dl>;
}

export interface FactCellProps {
  label: ReactNode;
  children: ReactNode;
  empty?: boolean;
}

export function FactCell({ label, children, empty }: FactCellProps) {
  return (
    <div {...stylex.props(surfaceStyles("inset"), styles.cell)}>
      <dt {...stylex.props(styles.label)}>{label}</dt>
      <dd {...stylex.props(styles.value, empty === true && styles.empty)}>{children}</dd>
    </div>
  );
}

const styles = stylex.create({
  list: {
    display: "grid",
    gridAutoColumns: "minmax(0, 1fr)",
    gridAutoFlow: "column",
    gap: space.s2,
    margin: 0,
  },
  cell: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    minWidth: 0,
    paddingBlock: space.s2,
    paddingInline: space.s3,
  },
  label: { color: colors.textTertiary, fontSize: fontSize.small },
  value: {
    minWidth: 0,
    margin: 0,
    overflow: "hidden",
    color: colors.textPrimary,
    fontSize: fontSize.ui,
    fontVariantNumeric: "tabular-nums",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: { color: colors.textTertiary },
});
