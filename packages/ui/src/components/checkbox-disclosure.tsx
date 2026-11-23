import * as stylex from "@stylexjs/stylex";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { useId, type ReactNode } from "react";
import { cx } from "../cx";
import { colors, fontSize, radius, size, space } from "../tokens.stylex";
import { surfaceStyles } from "./card";
import { CheckboxControl } from "./checkbox";
import { focusStyles } from "./focus";
import { ChevronDownIcon } from "./icons";

export interface CheckboxDisclosureProps {
  label: ReactNode;
  summary: ReactNode;
  toggleLabel: string;
  checked: boolean;
  indeterminate?: boolean;
  onCheckedChange: (checked: boolean) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  disabled?: boolean;
  note?: ReactNode;
  children?: ReactNode;
}

export function CheckboxDisclosure({
  label,
  summary,
  toggleLabel,
  checked,
  indeterminate = false,
  onCheckedChange,
  expanded,
  onExpandedChange,
  disabled = false,
  note,
  children,
}: CheckboxDisclosureProps) {
  const labelId = useId();
  const bodyId = useId();
  const open = expanded && !disabled;
  return (
    <div {...stylex.props(surfaceStyles("inset"), styles.group)}>
      <div {...stylex.props(styles.head)}>
        <label {...stylex.props(styles.label, disabled && styles.labelDisabled)}>
          <CheckboxControl
            checked={checked}
            indeterminate={indeterminate}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
          />
          <span id={labelId} {...stylex.props(disabled ? styles.nameDisabled : styles.name)}>
            {label}
          </span>
        </label>
        {disabled ? (
          <span {...stylex.props(styles.summary, styles.summaryDisabled)}>{summary}</span>
        ) : (
          <SdkButton
            aria-label={toggleLabel}
            aria-expanded={open}
            {...(open ? { "aria-controls": bodyId } : {})}
            onClick={() => onExpandedChange(!expanded)}
            className={cx(styles.toggle, focusStyles.ring)}
          >
            <span {...stylex.props(styles.summary)}>{summary}</span>
            <span {...stylex.props(styles.chevron, open && styles.chevronOpen)}>
              <ChevronDownIcon />
            </span>
          </SdkButton>
        )}
      </div>
      {note === undefined ? null : <div {...stylex.props(styles.note)}>{note}</div>}
      {open ? (
        <div id={bodyId} role="group" aria-labelledby={labelId} {...stylex.props(styles.body)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

const styles = stylex.create({
  group: { display: "flex", flexDirection: "column", padding: space.s1, minWidth: 0 },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: size.rowMinHeight,
    paddingInlineStart: space.s3,
    minWidth: 0,
  },
  label: {
    display: "flex",
    alignItems: "center",
    flexGrow: 1,
    gap: space.s3,
    minWidth: 0,
    cursor: "pointer",
  },
  labelDisabled: { cursor: "not-allowed" },
  name: { minWidth: 0, color: colors.textPrimary, overflowWrap: "anywhere" },
  nameDisabled: { minWidth: 0, color: colors.textDisabled, overflowWrap: "anywhere" },
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    gap: space.s2,
    maxWidth: "70%",
    minHeight: 40,
    paddingInline: space.s2,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgCardHover },
    },
    color: colors.textTertiary,
    font: "inherit",
    textAlign: "end",
    cursor: "pointer",
  },
  summary: { minWidth: 0, color: colors.textTertiary, fontSize: fontSize.small },
  summaryDisabled: { flexShrink: 0, paddingInlineEnd: space.s2, color: colors.textDisabled },
  chevron: { display: "inline-flex", flexShrink: 0, color: colors.textTertiary },
  chevronOpen: { transform: "rotate(180deg)" },
  note: { paddingInline: space.s3, paddingBottom: space.s2 },
  body: {
    display: "flex",
    flexDirection: "column",
    paddingInlineStart: `calc(18px + ${space.s3})`,
  },
});
