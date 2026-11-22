import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, fontWeight, lineHeight, space } from "../tokens.stylex";
import { surfaceStyles } from "./card";
import { focusStyles } from "./focus";

export function Disclosure({
  summary,
  flat = false,
  children,
}: {
  summary: ReactNode;
  flat?: boolean;
  children: ReactNode;
}) {
  return (
    <details {...stylex.props(!flat && surfaceStyles("card"), styles.details, flat && styles.flat)}>
      <summary {...stylex.props(styles.summary, focusStyles.ring)}>{summary}</summary>
      <div {...stylex.props(styles.body)}>{children}</div>
    </details>
  );
}

const styles = stylex.create({
  details: {
    paddingBlock: space.s4,
    color: colors.textSecondary,
    lineHeight: lineHeight.relaxed,
  },
  flat: { paddingBlock: 0 },
  summary: {
    cursor: "pointer",
    color: colors.textPrimary,
    fontWeight: fontWeight.medium,
  },
  body: { display: "flex", flexDirection: "column", gap: space.s3, paddingTop: space.s3 },
});
