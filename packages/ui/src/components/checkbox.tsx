import * as stylex from "@stylexjs/stylex";
import { Checkbox as SdkCheckbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import { useId, type ReactNode } from "react";
import { cx } from "../cx";
import { colors, fontSize, motion, radius, size, space } from "../tokens.stylex";
import { CheckIcon } from "./icons";

export interface CheckboxProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  value?: string;
}

export interface CheckboxControlProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
  name?: string | undefined;
  value?: string | undefined;
  describedBy?: string | undefined;
}

export function CheckboxControl({
  checked,
  onCheckedChange,
  disabled,
  name,
  value,
  describedBy,
}: CheckboxControlProps) {
  return (
    <SdkCheckbox
      checked={checked}
      {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      {...(disabled === undefined ? {} : { disabled })}
      {...(name === undefined ? {} : { name })}
      {...(value === undefined ? {} : { value })}
      className={(s) => cx(styles.box, s.checked && styles.checked, s.disabled && styles.disabled)}
    >
      <CheckboxIndicator className={cx(styles.indicator)}>
        <CheckIcon />
      </CheckboxIndicator>
    </SdkCheckbox>
  );
}

export function Checkbox({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  name,
  value,
}: CheckboxProps) {
  const descriptionId = useId();
  const hasDescription = description !== undefined;
  return (
    <div {...stylex.props(styles.row, disabled === true && styles.rowDisabled)}>
      <label {...stylex.props(styles.label, disabled === true && styles.labelCursorDisabled)}>
        <CheckboxControl
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          name={name}
          value={value}
          describedBy={hasDescription ? descriptionId : undefined}
        />
        <span {...stylex.props(disabled === true ? styles.textDisabled : styles.text)}>
          {label}
        </span>
      </label>
      {hasDescription ? (
        <span id={descriptionId} {...stylex.props(styles.description)}>
          {description}
        </span>
      ) : null}
    </div>
  );
}

const styles = stylex.create({
  row: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: space.px2,
    minHeight: size.rowMinHeight,
    paddingInline: space.s3,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgCardHover },
    },
  },
  rowDisabled: {
    backgroundColor: { default: "transparent", ":hover": "transparent" },
  },
  label: { display: "flex", alignItems: "center", gap: space.s3, cursor: "pointer" },
  labelCursorDisabled: { cursor: "not-allowed" },
  box: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 18,
    height: 18,
    padding: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    backgroundColor: colors.bgInset,
    color: colors.textOnAccent,
    cursor: "inherit",
    transitionProperty: "background-color, border-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  checked: { borderColor: colors.accent, backgroundColor: colors.accent },
  disabled: {
    borderColor: colors.borderDefault,
    backgroundColor: colors.bgCard,
    color: colors.textDisabled,
  },
  indicator: { display: "inline-flex" },
  text: { minWidth: 0, color: colors.textPrimary },
  textDisabled: { minWidth: 0, color: colors.textDisabled },
  description: {
    paddingInlineStart: `calc(18px + ${space.s3})`,
    color: colors.textTertiary,
    fontSize: fontSize.small,
  },
});
