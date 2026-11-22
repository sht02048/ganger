import * as stylex from "@stylexjs/stylex";
import {
  Menu as SdkMenu,
  MenuContent,
  MenuItem as SdkMenuItem,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as SdkMenuSeparator,
  MenuTrigger,
} from "@ui-sdk/react/menu";
import type { ReactNode, Ref } from "react";
import { cx } from "../cx";
import { colors, fontWeight, motion, radius, size, space } from "../tokens.stylex";
import { CheckIcon, ChevronDownIcon } from "./icons";
import { popupStyles } from "./popup-styles";

export interface MenuProps {
  trigger: ReactNode;
  label?: string;
  describedBy?: string;
  variant?: "default" | "rail" | "icon";
  triggerRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}

export function Menu({
  trigger,
  label,
  describedBy,
  variant = "default",
  triggerRef,
  children,
}: MenuProps) {
  const rail = variant === "rail";
  const icon = variant === "icon";
  return (
    <SdkMenu>
      <MenuTrigger
        {...(triggerRef === undefined ? {} : { ref: triggerRef })}
        {...(label === undefined ? {} : { "aria-label": label })}
        {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
        className={(s) =>
          cx(
            styles.trigger,
            rail && styles.railTrigger,
            icon && styles.iconTrigger,
            s.open && styles.triggerOpen,
            icon && s.open && styles.iconTriggerOpen,
          )
        }
      >
        {rail || icon ? (
          trigger
        ) : (
          <>
            <span {...stylex.props(styles.triggerText)}>{trigger}</span>
            <span {...stylex.props(styles.chevron)}>
              <ChevronDownIcon />
            </span>
          </>
        )}
      </MenuTrigger>
      <MenuContent
        side={rail ? "right" : "bottom"}
        align={icon ? "end" : "start"}
        sideOffset={rail ? 8 : 4}
        className={cx(popupStyles.content)}
      >
        {children}
      </MenuContent>
    </SdkMenu>
  );
}

export interface MenuItemProps {
  value: string;
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}

export function MenuItem({ value, children, onSelect, disabled }: MenuItemProps) {
  return (
    <SdkMenuItem
      value={value}
      {...(onSelect === undefined ? {} : { onSelect })}
      {...(disabled === undefined ? {} : { disabled })}
      className={(s) =>
        cx(
          popupStyles.item,
          s.highlighted && popupStyles.highlighted,
          s.disabled && popupStyles.disabled,
        )
      }
    >
      {children}
    </SdkMenuItem>
  );
}

export interface MenuRadioProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  children: ReactNode;
}

export function MenuRadio<T extends string>({ value, onValueChange, children }: MenuRadioProps<T>) {
  return (
    <MenuRadioGroup<T>
      value={value}
      onValueChange={(next) => {
        onValueChange(next);
      }}
      className={cx(styles.group)}
    >
      {children}
    </MenuRadioGroup>
  );
}

export function MenuRadioOption({ value, children }: { value: string; children: ReactNode }) {
  return (
    <MenuRadioItem
      value={value}
      closeOnSelect
      className={(s) =>
        cx(
          popupStyles.item,
          s.highlighted && popupStyles.highlighted,
          s.checked && popupStyles.selected,
        )
      }
    >
      {children}
      <MenuItemIndicator className={cx(popupStyles.indicator)}>
        <CheckIcon />
      </MenuItemIndicator>
    </MenuRadioItem>
  );
}

export function MenuSeparator({ strong = false }: { strong?: boolean }) {
  return <SdkMenuSeparator className={cx(styles.separator, strong && styles.separatorStrong)} />;
}

const styles = stylex.create({
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    width: "100%",
    height: 34,
    paddingInline: space.s2,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    boxShadow: `inset 0 0 0 1px ${colors.borderSubtle}`,
    color: colors.textPrimary,
    font: "inherit",
    fontWeight: fontWeight.medium,
    textAlign: "start",
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  railTrigger: {
    flexDirection: "column",
    justifyContent: "center",
    gap: space.s1,
    height: "auto",
    paddingBlock: space.s2,
    paddingInline: space.s1,
    boxShadow: "none",
    textAlign: "center",
  },
  iconTrigger: {
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgRaisedHover },
    },
    justifyContent: "center",
    width: size.control,
    height: size.control,
    padding: 0,
    boxShadow: "none",
    color: {
      default: colors.textSecondary,
      ":hover": { default: null, "@media (hover: hover)": colors.textPrimary },
    },
    transitionProperty: "background-color, color",
  },
  triggerOpen: { backgroundColor: colors.bgHover },
  iconTriggerOpen: { backgroundColor: colors.bgRaisedHover },
  triggerText: {
    display: "flex",
    gap: space.px6,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  chevron: {
    display: "inline-flex",
    flexShrink: 0,
    marginInlineStart: "auto",
    color: colors.textTertiary,
  },
  group: { display: "flex", flexDirection: "column", gap: space.px2 },
  separator: {
    height: 1,
    marginBlock: space.px2,
    backgroundColor: colors.borderSubtle,
  },
  separatorStrong: { backgroundColor: colors.borderDefault },
});
