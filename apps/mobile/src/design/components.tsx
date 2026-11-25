import { useRef, useState } from "react";
import type { ComponentRef, ReactNode } from "react";
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
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { Text, toneColorOf } from "./text";
import type { TextTone } from "./text";
import {
  brandArt,
  colors,
  fontFamily,
  fontSize,
  lineHeight,
  radius,
  shadow,
  size,
  space,
} from "./tokens";

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

export type ButtonVariant = "primary" | "secondary" | "danger" | "answer" | "check";

const buttonColors: Record<ButtonVariant, { surface: string; tone: TextTone }> = {
  primary: { surface: colors.accent, tone: "onAccent" },
  secondary: { surface: colors.bgControl, tone: "primary" },
  danger: { surface: colors.bgControl, tone: "problem" },
  answer: { surface: colors.answerSoft, tone: "answer" },
  check: { surface: colors.checkSoft, tone: "check" },
};

export function buttonColorsOf(variant: ButtonVariant): { surface: string; tone: TextTone } {
  return buttonColors[variant];
}

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
      testID={`button-${variant}`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      aria-disabled={disabled}
      disabled={disabled}
      {...(onPress === undefined ? {} : { onPress })}
      style={({ pressed }) => [
        styles.button,
        compact ? styles.buttonCompact : null,
        { backgroundColor: buttonColors[variant].surface },
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text
        variant={compact ? "meta" : "title"}
        tone={buttonColors[variant].tone}
        numberOfLines={1}
      >
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

const MORE_BUTTON_HIT_SLOP = (size.touchTarget - size.moreButton) / 2;

const LINK_BUTTON_HIT_SLOP = {
  top: (size.touchTarget - size.linkButton) / 2,
  bottom: (size.touchTarget - size.linkButton) / 2,
  left: 0,
  right: 0,
};

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

export type MenuIcon = "external" | "cancel";

const MENU_ICON_PATHS: Record<MenuIcon, string> = {
  external: "M4 2h6v6M10 2L3 9",
  cancel: "M3 3l6 6M9 3L3 9",
};

function MenuGlyph({ icon, color, iconSize }: { icon: MenuIcon; color: string; iconSize: number }) {
  return (
    <Svg width={iconSize} height={iconSize} viewBox="0 0 12 12" aria-hidden>
      <Path
        d={MENU_ICON_PATHS[icon]}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function LinkButton({
  label,
  accessibilityLabel,
  disabled = false,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID="link-button"
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      aria-disabled={disabled}
      disabled={disabled}
      hitSlop={LINK_BUTTON_HIT_SLOP}
      onPress={onPress}
      style={({ pressed }) => [
        styles.linkButton,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <MenuGlyph icon="external" color={colors.textSecondary} iconSize={size.menuIcon} />
      <Text variant="control" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface MenuItem {
  key: string;
  label: string;
  icon: MenuIcon;
  tone?: "primary" | "problem";
  accessibilityLabel?: string;
  onSelect: () => void;
}

export interface PopoverAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const POPOVER_BORDER = 1;
const POPOVER_EDGE = space.s2;
const POPOVER_GAP = space.s1;
const POPOVER_PADDING = space.s1;
const MENU_DIVIDER_SPACE = space.s1;

export function popoverHeight(groups: ReadonlyArray<ReadonlyArray<MenuItem>>): number {
  const items = groups.reduce((count, group) => count + group.length, 0);
  const dividers = Math.max(0, groups.length - 1);
  return (
    items * size.touchTarget +
    dividers * (StyleSheet.hairlineWidth + MENU_DIVIDER_SPACE * 2) +
    POPOVER_PADDING * 2 +
    POPOVER_BORDER * 2
  );
}

export function popoverPlacement({
  anchor,
  menuHeight,
  screen,
  insets,
}: {
  anchor: PopoverAnchor;
  menuHeight: number;
  screen: { width: number; height: number };
  insets: { top: number; bottom: number };
}): { top: number; left: number } {
  const rightAligned = anchor.x + anchor.width - size.popoverWidth;
  const maxLeft = screen.width - size.popoverWidth - POPOVER_EDGE;
  const left = Math.max(POPOVER_EDGE, Math.min(rightAligned, maxLeft));
  const below = anchor.y + anchor.height + POPOVER_GAP;
  const bottomLimit = screen.height - insets.bottom - POPOVER_EDGE;
  if (below + menuHeight <= bottomLimit) return { top: below, left };
  const above = anchor.y - POPOVER_GAP - menuHeight;
  return { top: Math.max(insets.top + POPOVER_EDGE, above), left };
}

export function PopoverMenu({
  label,
  closeLabel,
  groups,
}: {
  label: string;
  closeLabel: string;
  groups: ReadonlyArray<ReadonlyArray<MenuItem>>;
}) {
  const button = useRef<ComponentRef<typeof View>>(null);
  const afterDismiss = useRef<(() => void) | null>(null);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const filled = groups.filter((group) => group.length > 0);
  if (filled.length === 0) return null;
  const open = () => {
    button.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  };
  const close = () => setAnchor(null);
  const choose = (item: MenuItem) => {
    close();
    if (Platform.OS === "ios") afterDismiss.current = item.onSelect;
    else item.onSelect();
  };
  const dismissed = () => {
    const chosen = afterDismiss.current;
    afterDismiss.current = null;
    chosen?.();
  };
  const placement =
    anchor === null
      ? null
      : popoverPlacement({ anchor, menuHeight: popoverHeight(filled), screen, insets });
  return (
    <>
      <Pressable
        ref={button}
        testID="popover-button"
        accessibilityRole="button"
        accessibilityLabel={label}
        aria-expanded={anchor !== null}
        hitSlop={MORE_BUTTON_HIT_SLOP}
        onPress={open}
        style={({ pressed }) => [
          styles.moreButton,
          anchor === null ? null : styles.moreButtonOpen,
          pressed ? styles.pressed : null,
        ]}
      >
        <Svg width={size.moreIcon} height={size.moreIcon} viewBox="0 0 20 20" aria-hidden>
          <Path
            d="M4.5 10h.01M10 10h.01M15.5 10h.01"
            fill="none"
            stroke={colors.textSecondary}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </Svg>
      </Pressable>
      <Modal
        visible={anchor !== null}
        transparent
        animationType="none"
        onRequestClose={close}
        onDismiss={dismissed}
      >
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={close}
          style={StyleSheet.absoluteFill}
        >
          <Pressable
            testID="popover-backdrop"
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          {placement === null ? null : (
            <View
              testID="popover"
              accessibilityRole="menu"
              accessibilityLabel={label}
              style={[styles.popover, { top: placement.top, left: placement.left }]}
            >
              {filled.map((group, index) => (
                <View key={group.map((item) => item.key).join(":")}>
                  {index === 0 ? null : (
                    <View testID="popover-divider" style={styles.menuDivider} />
                  )}
                  {group.map((item) => (
                    <Pressable
                      key={item.key}
                      accessibilityRole="menuitem"
                      accessibilityLabel={item.accessibilityLabel ?? item.label}
                      onPress={() => choose(item)}
                      style={({ pressed }) => [styles.menuItem, pressed ? styles.pressed : null]}
                    >
                      <MenuGlyph
                        icon={item.icon}
                        color={toneColorOf(item.tone ?? "primary")}
                        iconSize={size.menuIcon}
                      />
                      <Text variant="body" tone={item.tone ?? "primary"} numberOfLines={1}>
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

export function SplitButton({
  label,
  groupLabel,
  menuLabel,
  disabled = false,
  onPress,
  onMenuPress,
}: {
  label: string;
  groupLabel: string;
  menuLabel: string;
  disabled?: boolean;
  onPress: () => void;
  onMenuPress?: () => void;
}) {
  const tone = disabled ? "disabled" : "onAccent";
  return (
    <View
      role="group"
      accessibilityLabel={groupLabel}
      style={[styles.splitButton, disabled ? styles.splitButtonOff : styles.splitButtonOn]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        aria-disabled={disabled}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.splitMain, pressed && !disabled ? styles.pressed : null]}
      >
        <Text variant="title" tone={tone} weight="semibold" numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      {onMenuPress === undefined ? null : (
        <>
          <View
            testID="split-divider"
            style={[styles.splitDivider, disabled ? styles.splitDividerOff : null]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={menuLabel}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={onMenuPress}
            style={({ pressed }) => [
              styles.splitMenu,
              pressed && !disabled ? styles.pressed : null,
            ]}
          >
            <Svg
              width={size.splitMenuIcon}
              height={size.splitMenuIcon}
              viewBox="0 0 12 12"
              aria-hidden
            >
              <Path
                d="M2.5 4.5L6 8l3.5-3.5"
                fill="none"
                stroke={disabled ? colors.textDisabled : colors.textOnAccent}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        </>
      )}
    </View>
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
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  splitButton: {
    height: size.touchTarget,
    borderRadius: radius.button,
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
  },
  splitButtonOn: { backgroundColor: colors.accent },
  splitButtonOff: { backgroundColor: colors.bgControl },
  splitMain: {
    flex: 1,
    paddingHorizontal: space.s4,
    alignItems: "center",
    justifyContent: "center",
  },
  splitDivider: {
    width: StyleSheet.hairlineWidth,
    marginVertical: size.splitDividerInset,
    backgroundColor: colors.textOnAccent,
    opacity: 0.25,
  },
  splitDividerOff: { backgroundColor: colors.textDisabled },
  splitMenu: {
    width: size.touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
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
  linkButton: {
    alignSelf: "flex-start",
    height: size.linkButton,
    paddingHorizontal: space.s3,
    borderRadius: radius.button,
    backgroundColor: colors.bgControl,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
  },
  moreButton: {
    width: size.moreButton,
    height: size.moreButton,
    marginVertical: (lineHeight.small + space.px2 * 2 - size.moreButton) / 2,
    marginRight: -space.s1,
    borderRadius: radius.button,
    alignItems: "center",
    justifyContent: "center",
  },
  moreButtonOpen: { backgroundColor: colors.bgSelected },
  popover: {
    position: "absolute",
    width: size.popoverWidth,
    paddingVertical: space.s1,
    backgroundColor: colors.bgRaised,
    borderRadius: radius.card,
    borderWidth: POPOVER_BORDER,
    borderColor: colors.borderDefault,
    shadowColor: shadow.color,
    shadowOpacity: shadow.opacity,
    shadowRadius: space.s4,
    shadowOffset: { width: 0, height: space.s1 },
  },
  menuItem: {
    height: size.touchTarget,
    paddingHorizontal: space.s3 + space.px2,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: space.s1,
    backgroundColor: colors.borderDefault,
  },
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
