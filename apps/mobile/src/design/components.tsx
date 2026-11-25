import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch as NativeSwitch,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { Text } from "./text";
import type { TextTone } from "./text";
import { brandArt, colors, fontFamily, fontSize, lineHeight, radius, size, space } from "./tokens";

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
  compact = false,
  issueCount = 0,
  accessibilityLabel,
  disabled = false,
  onPress,
}: {
  label: string;
  variant?: ButtonVariant;
  compact?: boolean;
  issueCount?: number;
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      aria-disabled={disabled}
      disabled={disabled}
      {...(onPress === undefined ? {} : { onPress })}
      style={({ pressed }) => [
        styles.button,
        compact ? styles.buttonCompact : null,
        variant === "primary" ? styles.buttonPrimary : styles.buttonSecondary,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text variant={compact ? "meta" : "title"} tone={buttonTone[variant]} numberOfLines={1}>
        {label}
      </Text>
      <IssueBadge count={issueCount} />
    </Pressable>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  multiline = false,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <View style={styles.field}>
      <Text variant="meta">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={multiline ? "sentences" : "none"}
        autoCorrect={multiline}
        multiline={multiline}
        value={value}
        onChangeText={onChangeText}
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(maxLength === undefined ? {} : { maxLength })}
        placeholderTextColor={colors.textDisabled}
        style={[styles.fieldInput, multiline ? styles.fieldMultiline : null]}
      />
    </View>
  );
}

export function RadioRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={selected}
      onPress={onPress}
      style={[styles.radioRow, selected ? styles.radioRowSelected : null]}
    >
      <View style={[styles.radioMark, selected ? styles.radioMarkSelected : null]} />
      <View style={styles.radioLabel}>
        <Text variant="body" tone="primary">
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export function CameraFrame({ children }: { children: ReactNode }) {
  return (
    <View testID="camera-frame" style={styles.cameraFrame}>
      {children}
    </View>
  );
}

export function NoticeBand({ message }: { message: string }) {
  return (
    <View accessibilityRole="alert" testID="notice-band" style={styles.band}>
      <Text variant="meta" tone="primary">
        {message}
      </Text>
    </View>
  );
}

export function BackButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
    >
      <Svg width={size.backIcon} height={size.backIcon} viewBox="0 0 24 24" aria-hidden>
        <Path
          d="M15 5l-7 7 7 7"
          fill="none"
          stroke={colors.textSecondary}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
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

export type ChipTone = "neutral" | "problem" | "merged" | "progress";

const chipTone: Record<ChipTone, { text: TextTone | null; dot: string | null; surface: string }> = {
  neutral: { text: "secondary", dot: null, surface: colors.bgControl },
  problem: { text: "problem", dot: null, surface: colors.problemSoft },
  merged: { text: null, dot: colors.merged, surface: colors.mergedSoft },
  progress: { text: null, dot: colors.progress, surface: colors.progressSoft },
};

export function Chip({
  label,
  tone = "neutral",
  size: chipSize = "compact",
}: {
  label: string;
  tone?: ChipTone;
  size?: "compact" | "row";
}) {
  const look = chipTone[tone];
  return (
    <View
      testID={`chip-${tone}`}
      style={[
        styles.chip,
        { backgroundColor: look.surface },
        chipSize === "row" ? styles.chipRow : null,
      ]}
    >
      {look.dot === null ? null : <View style={[styles.dot, { backgroundColor: look.dot }]} />}
      <Text variant="small" tone={look.text ?? "primary"} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const LINK_HIT_SLOP = {
  top: (size.touchTarget - lineHeight.body) / 2,
  bottom: (size.touchTarget - lineHeight.body) / 2,
  left: space.s2,
  right: space.s2,
};

export function ExternalLink({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      hitSlop={LINK_HIT_SLOP}
      onPress={onPress}
      style={({ pressed }) => [styles.externalLink, pressed ? styles.pressed : null]}
    >
      <Text variant="title" tone="accent" weight="semibold" numberOfLines={1}>
        {label}
      </Text>
      <Svg width={size.linkIcon} height={size.linkIcon} viewBox="0 0 12 12" aria-hidden>
        <Path
          d="M4 2h6v6M10 2L3 9"
          fill="none"
          stroke={colors.accentText}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}

export function RaisedBox({ children }: { children: ReactNode }) {
  return (
    <View testID="raised-box" style={styles.raisedBox}>
      {children}
    </View>
  );
}

export interface SegmentOption<Value extends string> {
  value: Value;
  label: string;
  todoCount: number;
  todoLabel: string;
  accessibilityLabel: string;
}

export function Meter({ label, percent }: { label: string; percent: number }) {
  const value = Math.min(100, Math.max(0, percent));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      style={styles.meterTrack}
    >
      <View style={[styles.meterFill, { width: `${value}%` }]} />
    </View>
  );
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
            accessibilityLabel={option.accessibilityLabel}
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
  | "canceled"
  | "unknown";

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
  unknown: { dot: colors.textDisabled, surface: colors.bgControl },
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

export function InlineSwitch({
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
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      aria-checked={value}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={styles.inlineSwitch}
    >
      <Text variant="small" tone="primary">
        {label}
      </Text>
      <View testID="inline-switch-track" aria-hidden style={styles.inlineSwitchTrack}>
        <NativeSwitch
          value={value}
          disabled={disabled}
          trackColor={{ false: colors.switchTrack, true: colors.accent }}
          thumbColor={colors.switchThumb}
          ios_backgroundColor={colors.switchTrack}
          {...{ activeThumbColor: colors.switchThumb }}
        />
      </View>
    </Pressable>
  );
}

export function Sheet({
  visible,
  title,
  closeLabel,
  onClose,
  composed = false,
  children,
}: {
  visible: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  composed?: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        {...(Platform.OS === "ios" ? { behavior: "padding" as const } : {})}
        style={styles.sheetRoot}
      >
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
          {composed ? children : <SheetBody>{children}</SheetBody>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SheetBody({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={styles.sheetBody}
      contentContainerStyle={styles.sheetContent}
    >
      {children}
    </ScrollView>
  );
}

export function SheetFooter({ children }: { children: ReactNode }) {
  return (
    <View testID="sheet-footer" style={styles.sheetFooter}>
      {children}
    </View>
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
    flexDirection: "row",
    gap: space.s1,
    alignItems: "center",
    justifyContent: "center",
  },
  field: { gap: space.s1 },
  fieldInput: {
    minHeight: size.touchTarget,
    paddingHorizontal: space.s3,
    borderRadius: radius.button,
    backgroundColor: colors.bgControl,
    color: colors.textPrimary,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.body,
  },
  fieldMultiline: {
    minHeight: size.touchTarget * 2,
    paddingVertical: space.s2,
    textAlignVertical: "top",
  },
  radioRow: {
    minHeight: size.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.button,
    backgroundColor: colors.bgControl,
  },
  radioRowSelected: { backgroundColor: colors.bgSelected },
  radioMark: {
    width: size.radioMark,
    height: size.radioMark,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  radioMarkSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  radioLabel: { flex: 1 },
  sheetFooter: { gap: space.s2 },
  cameraFrame: { aspectRatio: 1, borderRadius: radius.cameraFrame, overflow: "hidden" },
  band: {
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
    backgroundColor: colors.problemSoft,
  },
  buttonCompact: { paddingHorizontal: space.s3 },
  backButton: {
    width: size.touchTarget,
    height: size.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.button,
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
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
    paddingHorizontal: space.s2,
    paddingVertical: space.px2,
    borderRadius: radius.pill,
    backgroundColor: colors.bgControl,
  },
  chipRow: { minHeight: size.chipRow, justifyContent: "center" },
  externalLink: { flexDirection: "row", alignItems: "center", gap: space.s1 },
  raisedBox: {
    backgroundColor: colors.bgRaised,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    padding: space.s3 + space.px2,
    gap: space.s3,
  },
  segment: {
    flexDirection: "row",
    padding: space.s1,
    gap: space.s1,
    borderRadius: radius.segmentOuter,
    backgroundColor: colors.bgCard,
  },
  segmentItem: {
    flex: 1,
    minHeight: size.touchTarget,
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
  inlineSwitch: {
    minHeight: size.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
  },
  inlineSwitchTrack: { pointerEvents: "none" },
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  sheetBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheetBody: { flexShrink: 1 },
  sheetContent: { gap: space.s3 },
  meterTrack: {
    height: size.meterHeight,
    borderRadius: radius.full,
    backgroundColor: colors.meterTrack,
    overflow: "hidden",
  },
  meterFill: { height: size.meterHeight, backgroundColor: colors.meterFill },
  sheet: {
    maxHeight: "85%",
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
