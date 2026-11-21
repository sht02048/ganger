import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, radius, size } from "../tokens.stylex";
import { statusTone, type PillStatus } from "./status-pill";

export function statusDotStyles(status: PillStatus) {
  return [styles.dot, dotTone[statusTone(status)]] as const;
}

export interface StatusDotProps {
  status: PillStatus;
  children?: ReactNode;
}

export function StatusDot({ status, children }: StatusDotProps) {
  return (
    <span data-status={status} data-tone={statusTone(status)} {...stylex.props(styles.frame)}>
      <span aria-hidden="true" {...stylex.props(statusDotStyles(status))} />
      {children === undefined ? null : (
        <span {...stylex.props(styles.screenReaderOnly)}>{children}</span>
      )}
    </span>
  );
}

const styles = stylex.create({
  frame: { position: "relative", display: "inline-flex", flexShrink: 0, alignItems: "center" },
  dot: {
    display: "inline-block",
    flexShrink: 0,
    width: size.dot,
    height: size.dot,
    borderRadius: radius.full,
  },
  screenReaderOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
});

const dotTone = stylex.create({
  answer: { backgroundColor: colors.answer },
  check: { backgroundColor: colors.check },
  problem: { backgroundColor: colors.problem },
  progress: { backgroundColor: colors.progress },
  merged: { backgroundColor: colors.merged },
  idle: { backgroundColor: colors.idle },
});
