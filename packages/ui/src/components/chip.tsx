import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Button } from "./button";
import { CloseIcon } from "./icons";
import { colors, fontSize, fontWeight, radius, space } from "../tokens.stylex";

export interface ChipProps {
  children: ReactNode;
  strong?: boolean;
  tone?: "accent";
  leading?: ReactNode;
  wrapText?: boolean;
}

export function Chip({ children, strong, tone, leading, wrapText }: ChipProps) {
  return (
    <span
      {...stylex.props(
        styles.chip,
        strong === true && styles.strong,
        tone === "accent" && styles.accent,
        leading !== undefined && styles.withLeading,
        wrapText === true && styles.wrapText,
      )}
    >
      {leading}
      {children}
    </span>
  );
}

export interface RemovableChipProps {
  children: ReactNode;
  removeLabel: string;
  onRemove: () => void;
}

export function RemovableChip({ children, removeLabel, onRemove }: RemovableChipProps) {
  return (
    <Button aria-label={removeLabel} onClick={onRemove}>
      {children}
      <CloseIcon />
    </Button>
  );
}

const styles = stylex.create({
  chip: {
    flexShrink: 0,
    paddingInline: space.px6,
    borderRadius: radius.pill,
    backgroundColor: colors.bgControl,
    color: colors.textSecondary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
  },
  strong: { color: colors.textPrimary },
  accent: { backgroundColor: colors.accentSoft, color: colors.accentText },
  withLeading: { display: "inline-flex", alignItems: "center", gap: space.px6 },
  wrapText: { flexShrink: 1, minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" },
});
