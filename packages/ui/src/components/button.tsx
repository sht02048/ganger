import * as stylex from "@stylexjs/stylex";
import { Button as SdkButton } from "@ui-sdk/react/button";
import type { ComponentProps, ReactNode, Ref } from "react";
import { cx, type StyleArg } from "../cx";
import { colors, fontSize, fontWeight, motion, radius, size, space } from "../tokens.stylex";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "check";

type SdkButtonProps = ComponentProps<typeof SdkButton>;

export interface ButtonProps {
  variant?: ButtonVariant;
  children: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: SdkButtonProps["onClick"];
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  "aria-pressed"?: boolean;
  "aria-controls"?: string;
  "aria-describedby"?: string;
  "aria-busy"?: boolean;
  "aria-disabled"?: boolean;
  ref?: Ref<HTMLButtonElement>;
  busy?: { active: boolean; label: ReactNode };
  compact?: boolean;
  outlined?: boolean;
  block?: boolean;
}

export function Button({
  variant = "secondary",
  children,
  onClick,
  busy,
  compact,
  outlined,
  block,
  ...props
}: ButtonProps) {
  const busyNow = busy?.active === true;
  const disabled = props["aria-disabled"] === true || busyNow;
  const busyProps =
    busy === undefined
      ? {}
      : { "aria-busy": busyNow || props["aria-busy"] === true, "aria-disabled": disabled };
  const handleClick = busyNow ? undefined : onClick;
  return (
    <SdkButton
      {...props}
      {...busyProps}
      data-variant={variant}
      {...(outlined === true ? { "data-outlined": "" } : {})}
      {...(handleClick === undefined ? {} : { onClick: handleClick })}
      className={(s) =>
        cx(
          ...buttonStyles(variant, s.disabled || disabled),
          outlined === true && !(s.disabled || disabled) && styles.outlined,
          compact === true && styles.compact,
          block === true && styles.block,
        )
      }
    >
      {busy === undefined ? children : <BusyLabels busy={busy}>{children}</BusyLabels>}
    </SdkButton>
  );
}

export function BusyLabels({
  busy,
  children,
}: {
  busy: { active: boolean; label: ReactNode };
  children: ReactNode;
}) {
  return (
    <span {...stylex.props(styles.labels)}>
      <span
        {...(busy.active ? { "aria-hidden": true } : {})}
        {...stylex.props(styles.label, busy.active && styles.labelHidden)}
      >
        {children}
      </span>
      <span
        {...(busy.active ? {} : { "aria-hidden": true })}
        {...stylex.props(styles.label, !busy.active && styles.labelHidden)}
      >
        {busy.label}
      </span>
    </span>
  );
}

export function buttonStyles(variant: ButtonVariant, disabled = false): ReadonlyArray<StyleArg> {
  return [
    styles.base,
    variant === "primary" && styles.primary,
    variant === "danger" && styles.danger,
    variant === "ghost" && styles.ghost,
    variant === "check" && styles.check,
    disabled && (variant === "ghost" ? styles.ghostDisabled : styles.disabled),
  ];
}

const styles = stylex.create({
  compact: { height: size.controlCompact, paddingInline: space.s2, fontSize: fontSize.small },
  block: { width: "100%", height: size.controlLarge },
  labels: { display: "grid" },
  label: { gridArea: "1 / 1" },
  labelHidden: { visibility: "hidden" },
  base: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.px6,
    height: size.control,
    paddingBlock: 0,
    paddingInline: space.s3,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: {
      default: colors.bgControl,
      ":hover": { default: null, "@media (hover: hover)": colors.bgControlHover },
    },
    color: colors.textPrimary,
    font: "inherit",
    fontWeight: fontWeight.medium,
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    transform: {
      default: null,
      ":active": { default: "scale(0.97)", "@media (prefers-reduced-motion: reduce)": null },
    },
    transitionProperty: "background-color, border-color, color, transform",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: null, ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
    "::before": {
      content: { default: null, "@media (pointer: coarse)": "''" },
      position: "absolute",
      top: "50%",
      left: "50%",
      width: "max(100%, 44px)",
      height: "max(100%, 44px)",
      transform: "translate(-50%, -50%)",
    },
  },
  primary: {
    backgroundColor: {
      default: colors.accent,
      ":hover": { default: null, "@media (hover: hover)": colors.accentHover },
    },
    color: colors.textOnAccent,
  },
  outlined: {
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgHover },
    },
    boxShadow: {
      default: `inset 0 0 0 1px ${colors.borderDefault}`,
      ":hover": {
        default: null,
        "@media (hover: hover)": `inset 0 0 0 1px ${colors.borderStrong}`,
      },
    },
  },
  danger: { color: colors.problem },
  check: {
    backgroundColor: {
      default: colors.checkSoft,
      ":hover": { default: null, "@media (hover: hover)": colors.checkSoftHover },
    },
    color: colors.check,
  },
  ghost: {
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgHover },
    },
    color: {
      default: colors.textSecondary,
      ":hover": { default: null, "@media (hover: hover)": colors.textPrimary },
    },
  },
  disabled: {
    backgroundColor: { default: colors.bgControl, ":hover": colors.bgControl },
    boxShadow: `inset 0 0 0 1px ${colors.borderDefault}`,
    color: { default: colors.textDisabled, ":hover": colors.textDisabled },
    cursor: "not-allowed",
    transform: { default: null, ":active": null },
  },
  ghostDisabled: {
    backgroundColor: { default: "transparent", ":hover": "transparent" },
    color: { default: colors.textDisabled, ":hover": colors.textDisabled },
    cursor: "not-allowed",
    transform: { default: null, ":active": null },
  },
});

export const compactButtonStyle: StyleArg = styles.compact;
