import * as stylex from "@stylexjs/stylex";
import { Tabs as SdkTabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { createContext, use, type ReactNode } from "react";
import { cx } from "../cx";
import { colors, fontSize, fontWeight, motion, radius, size, space } from "../tokens.stylex";
import type { StatusTone } from "./status-pill";

export type TabsVariant = "underline" | "chips";

const VariantContext = createContext<TabsVariant>("underline");

export interface TabsProps<T extends string> {
  value: T | null;
  onValueChange: (value: T) => void;
  label: string;
  children: ReactNode;
  panels?: ReactNode;
  variant?: TabsVariant;
}

export function Tabs<T extends string>({
  value,
  onValueChange,
  label,
  children,
  panels,
  variant = "underline",
}: TabsProps<T>) {
  return (
    <SdkTabs<T>
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <VariantContext value={variant}>
        <TabsList
          aria-label={label}
          className={cx(variant === "chips" ? styles.chipList : styles.list)}
        >
          {children}
        </TabsList>
      </VariantContext>
      {panels}
    </SdkTabs>
  );
}

export interface TabDot {
  tone: StatusTone;
  label: string;
}

export interface TabProps {
  value: string;
  children: ReactNode;
  count?: number;
  attention?: boolean;
  note?: string;
  dot?: TabDot;
}

export function Tab({ value, children, count, attention, note, dot }: TabProps) {
  const variant = use(VariantContext);
  return (
    <TabsTab
      value={value}
      className={(s) =>
        variant === "chips"
          ? cx(styles.tab, styles.chip, s.selected && styles.chipSelected)
          : cx(styles.tab, s.selected && styles.selected)
      }
    >
      {children}
      {count === undefined ? null : (
        <span
          {...stylex.props(
            styles.count,
            variant === "chips" && styles.chipCount,
            attention === true &&
              count > 0 &&
              (variant === "chips" ? styles.chipAttention : styles.attention),
          )}
        >
          {count}
        </span>
      )}
      {note === undefined ? null : <span {...stylex.props(styles.note)}>{note}</span>}
      {dot === undefined ? null : (
        <span data-tab-dot={dot.tone} {...stylex.props(styles.dotFrame)}>
          <span aria-hidden="true" {...stylex.props(styles.dot, dotTones[dot.tone])} />
          <span {...stylex.props(styles.screenReaderOnly)}>{dot.label}</span>
        </span>
      )}
    </TabsTab>
  );
}

export interface TabPanelProps {
  value: string;
  children: ReactNode;
  keepMounted?: boolean;
}

export function TabPanel({ value, children, keepMounted }: TabPanelProps) {
  return (
    <TabsPanel
      value={value}
      className={cx(styles.panel)}
      {...(keepMounted === undefined ? {} : { keepMounted })}
    >
      {children}
    </TabsPanel>
  );
}

const styles = stylex.create({
  list: {
    display: "flex",
    overflowX: "auto",
    scrollbarWidth: "none",
    gap: space.s5,
    marginBottom: space.s2,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.borderSubtle,
  },
  tab: {
    position: "relative",
    display: "flex",
    flexShrink: 0,
    whiteSpace: "nowrap",
    alignItems: "baseline",
    gap: space.px6,
    height: 36,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: colors.textTertiary, ":hover": colors.textSecondary },
    font: "inherit",
    fontSize: fontSize.body,
    lineHeight: "36px",
    cursor: "pointer",
    transitionProperty: "color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  selected: {
    color: { default: colors.textPrimary, ":hover": colors.textPrimary },
    boxShadow: `inset 0 -2px 0 ${colors.accent}`,
  },
  chipList: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.px6,
  },
  chip: {
    alignItems: "center",
    height: 28,
    paddingInline: space.s2,
    borderRadius: radius.control,
    backgroundColor: {
      default: colors.bgControl,
      ":hover": { default: null, "@media (hover: hover)": colors.bgControlHover },
    },
    color: {
      default: colors.textSecondary,
      ":hover": { default: null, "@media (hover: hover)": colors.textPrimary },
    },
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
    lineHeight: "28px",
    transitionProperty: "color, background-color",
  },
  chipCount: { fontSize: fontSize.small, opacity: 0.7 },
  chipAttention: { opacity: 1, fontWeight: fontWeight.semibold },
  chipSelected: {
    backgroundColor: { default: colors.textPrimary, ":hover": colors.textPrimary },
    color: { default: colors.bgCanvas, ":hover": colors.bgCanvas },
  },
  count: {
    fontSize: fontSize.ui,
    fontVariantNumeric: "tabular-nums",
  },
  attention: {
    color: colors.textPrimary,
    fontWeight: fontWeight.semibold,
  },
  panel: { outline: "none" },
  note: { color: colors.textTertiary, fontSize: fontSize.ui },
  dotFrame: { position: "relative", display: "inline-flex", alignSelf: "center" },
  dot: { width: size.dot, height: size.dot, borderRadius: radius.full },
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

const dotTones = stylex.create({
  answer: { backgroundColor: colors.answer },
  check: { backgroundColor: colors.check },
  problem: { backgroundColor: colors.problem },
  progress: { backgroundColor: colors.progress },
  merged: { backgroundColor: colors.merged },
  idle: { backgroundColor: colors.idle },
});
