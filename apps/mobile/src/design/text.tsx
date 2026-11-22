import type { ReactNode } from "react";
import { StyleSheet, Text as NativeText } from "react-native";

import { colors, fontFamily, fontSize, lineHeight } from "./tokens";

export type TextVariant = "page" | "panel" | "title" | "body" | "meta" | "small";
export type TextTone =
  | "primary"
  | "secondary"
  | "tertiary"
  | "disabled"
  | "accent"
  | "onAccent"
  | "onProblem"
  | "problem";

const toneColor: Record<TextTone, string> = {
  primary: colors.textPrimary,
  secondary: colors.textSecondary,
  tertiary: colors.textTertiary,
  disabled: colors.textDisabled,
  accent: colors.accentText,
  onAccent: colors.textOnAccent,
  onProblem: colors.textOnProblem,
  problem: colors.problem,
};

const variantTone: Record<TextVariant, TextTone> = {
  page: "primary",
  panel: "primary",
  title: "primary",
  body: "secondary",
  meta: "tertiary",
  small: "tertiary",
};

export function Text({
  variant = "body",
  tone,
  numberOfLines,
  heading = false,
  accessibilityRole,
  children,
}: {
  variant?: TextVariant;
  tone?: TextTone;
  numberOfLines?: number;
  heading?: boolean;
  accessibilityRole?: "alert";
  children: ReactNode;
}) {
  return (
    <NativeText
      {...(numberOfLines === undefined ? {} : { numberOfLines })}
      {...(heading ? { accessibilityRole: "header" as const } : {})}
      {...(accessibilityRole === undefined ? {} : { accessibilityRole })}
      style={[styles[variant], { color: toneColor[tone ?? variantTone[variant]] }]}
    >
      {children}
    </NativeText>
  );
}

const styles = StyleSheet.create({
  page: { fontFamily: fontFamily.semibold, fontSize: fontSize.page, lineHeight: lineHeight.page },
  panel: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.panel,
    lineHeight: lineHeight.panel,
  },
  title: { fontFamily: fontFamily.medium, fontSize: fontSize.body, lineHeight: lineHeight.body },
  body: { fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: lineHeight.body },
  meta: { fontFamily: fontFamily.regular, fontSize: fontSize.ui, lineHeight: lineHeight.ui },
  small: { fontFamily: fontFamily.medium, fontSize: fontSize.small, lineHeight: lineHeight.small },
});
