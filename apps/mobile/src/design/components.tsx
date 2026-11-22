import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Switch as NativeSwitch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { Text } from "./text";
import type { TextTone } from "./text";
import { brandArt, colors, radius, size, space } from "./tokens";

export function Card({
  emphasis = "none",
  children,
}: {
  emphasis?: "none" | "problem";
  children: ReactNode;
}) {
  return (
    <View
      testID={emphasis === "problem" ? "card-problem" : "card"}
      style={[styles.card, emphasis === "problem" ? styles.cardProblem : null]}
    >
      {children}
    </View>
  );
}

export type ButtonVariant = "primary" | "secondary" | "danger";

const buttonTone: Record<ButtonVariant, TextTone> = {
  primary: "onAccent",
  secondary: "primary",
  danger: "problem",
};

export function Button({
  label,
  variant = "secondary",
  disabled = false,
  onPress,
}: {
  label: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={disabled}
      disabled={disabled}
      {...(onPress === undefined ? {} : { onPress })}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" ? styles.buttonPrimary : styles.buttonSecondary,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text variant="title" tone={buttonTone[variant]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function TodoBadge({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;
  return (
    <View accessibilityLabel={label} testID="todo-badge" style={styles.todoBadge}>
      <Text variant="small" tone="onAccent">
        {count}
      </Text>
    </View>
  );
}

export function IssueBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <View testID="runner-issue-badge" style={styles.issueBadge}>
      <Text variant="small" tone="onProblem">
        {count}
      </Text>
    </View>
  );
}

export function Chip({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "problem" }) {
  return (
    <View style={[styles.chip, tone === "problem" ? styles.chipProblem : null]}>
      <Text variant="small" tone={tone === "problem" ? "problem" : "secondary"} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export interface SegmentOption<Value extends string> {
  value: Value;
  label: string;
  todoCount: number;
  todoLabel: string;
}

export function Segment<Value extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<SegmentOption<Value>>;
  value: Value;
  onChange: (next: Value) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.segment}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={
              option.todoCount > 0 ? `${option.label}, ${option.todoLabel}` : option.label
            }
            aria-selected={selected}
            onPress={() => onChange(option.value)}
            style={[styles.segmentItem, selected ? styles.segmentItemSelected : null]}
          >
            <Text variant="title" tone={selected ? "accent" : "secondary"} numberOfLines={1}>
              {option.label}
            </Text>
            <TodoBadge count={option.todoCount} label={option.todoLabel} />
          </Pressable>
        );
      })}
    </View>
  );
}

export type PillStatus =
  | "question"
  | "permission"
  | "waiting-for-input"
  | "human-check"
  | "failed"
  | "disconnected"
  | "runner-issue"
  | "offline"
  | "running"
  | "online"
  | "succeeded"
  | "queued"
  | "paused"
  | "canceled";

const pillColors: Record<PillStatus, { dot: string; surface: string }> = {
  question: { dot: colors.answer, surface: colors.answerSoft },
  permission: { dot: colors.answer, surface: colors.answerSoft },
  "waiting-for-input": { dot: colors.answer, surface: colors.answerSoft },
  "human-check": { dot: colors.check, surface: colors.checkSoft },
  failed: { dot: colors.problem, surface: colors.problemSoft },
  disconnected: { dot: colors.problem, surface: colors.problemSoft },
  "runner-issue": { dot: colors.problem, surface: colors.problemSoft },
  offline: { dot: colors.problem, surface: colors.problemSoft },
  running: { dot: colors.progress, surface: colors.progressSoft },
  online: { dot: colors.progress, surface: colors.progressSoft },
  succeeded: { dot: colors.merged, surface: colors.mergedSoft },
  queued: { dot: colors.idle, surface: colors.idleSoft },
  paused: { dot: colors.idle, surface: colors.idleSoft },
  canceled: { dot: colors.idle, surface: colors.idleSoft },
};

export function pillColorsOf(status: PillStatus): { dot: string; surface: string } {
  return pillColors[status];
}

export function StatusPill({ status, label }: { status: PillStatus; label: string }) {
  const tone = pillColors[status];
  return (
    <View testID={`pill-${status}`} style={[styles.pill, { backgroundColor: tone.surface }]}>
      <View style={[styles.dot, { backgroundColor: tone.dot }]} />
      <Text variant="small" tone="primary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function SwitchRow({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchLabel}>
        <Text variant="body" tone="primary">
          {label}
        </Text>
      </View>
      <NativeSwitch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.switchTrack, true: colors.accent }}
        thumbColor={colors.switchThumb}
        ios_backgroundColor={colors.switchTrack}
        {...{ activeThumbColor: colors.switchThumb }}
      />
    </View>
  );
}

export function Sheet({
  visible,
  title,
  closeLabel,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={styles.sheetBackdrop}
        />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { paddingBottom: insets.bottom + space.s4 }]}
        >
          <View style={styles.sheetHandle} />
          <Text variant="panel" heading>
            {title}
          </Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export const RESTING_MASCOT_PATHS = {
  body: "M20 58a30 30 0 0 1 60 0v8a14 14 0 0 1-14 14H34a14 14 0 0 1-14-14z",
  brim: "M16 46h56a10 10 0 0 1 10 10H26a10 10 0 0 1-10-10z",
  eyes: "M33 66q5 4 10 0M57 66q5 4 10 0",
  snoreLarge: "M79 30h7l-7 8h7",
  snoreSmall: "M89 17h5l-5 6h5",
} as const;

export function RestingMascot() {
  return (
    <View testID="mascot-resting" aria-hidden>
      <Svg width={size.mascot} height={size.mascot} viewBox="0 0 100 100">
        <Path d={RESTING_MASCOT_PATHS.body} fill={brandArt.body} />
        <Path d={RESTING_MASCOT_PATHS.brim} fill={brandArt.brim} />
        <Path
          d={RESTING_MASCOT_PATHS.eyes}
          fill="none"
          stroke={brandArt.eye}
          strokeWidth={3.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={RESTING_MASCOT_PATHS.snoreLarge}
          fill="none"
          stroke={brandArt.snore}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={RESTING_MASCOT_PATHS.snoreSmall}
          fill="none"
          stroke={brandArt.snore}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgRaised,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.bgRaised,
    padding: space.s3,
    gap: space.s2,
  },
  cardProblem: { borderColor: colors.problemBorder },
  button: {
    minHeight: size.touchTarget,
    paddingHorizontal: space.s4,
    borderRadius: radius.button,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.bgControl },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  todoBadge: {
    minWidth: size.badge,
    height: size.badge,
    paddingHorizontal: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  issueBadge: {
    minWidth: size.badge,
    height: size.badge,
    paddingHorizontal: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.problem,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    paddingHorizontal: space.s2,
    paddingVertical: space.px2,
    borderRadius: radius.pill,
    backgroundColor: colors.bgControl,
  },
  chipProblem: { backgroundColor: colors.problemSoft },
  segment: {
    flexDirection: "row",
    padding: space.s1,
    gap: space.s1,
    borderRadius: radius.segmentOuter,
    backgroundColor: colors.bgCard,
  },
  segmentItem: {
    flex: 1,
    minHeight: size.touchTarget - space.s2,
    flexDirection: "row",
    gap: space.s1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.segmentInner,
  },
  segmentItemSelected: { backgroundColor: colors.bgSelected },
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
    paddingHorizontal: space.s2,
    paddingVertical: space.px2,
    borderRadius: radius.pill,
  },
  dot: { width: size.dot, height: size.dot, borderRadius: radius.full },
  switchRow: {
    minHeight: size.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
  },
  switchLabel: { flex: 1 },
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  sheetBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    backgroundColor: colors.bgRaised,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
    gap: space.s3,
  },
  sheetHandle: {
    alignSelf: "center",
    width: size.sheetHandleWidth,
    height: size.sheetHandleHeight,
    borderRadius: radius.full,
    backgroundColor: colors.borderDefault,
  },
});
