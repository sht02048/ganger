import * as stylex from "@stylexjs/stylex";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { Menu as SdkMenu, MenuContent, MenuTrigger } from "@ui-sdk/react/menu";
import type { ReactNode, Ref } from "react";
import { cx } from "../cx";
import { space } from "../tokens.stylex";
import { BusyLabels, Button, buttonStyles } from "./button";
import { ChevronDownIcon } from "./icons";
import { MenuRadio, MenuRadioOption } from "./menu";
import { popupStyles } from "./popup-styles";

export interface SplitButtonOption<T extends string> {
  value: T;
  label: string;
}

export interface SplitButtonProps<T extends string> {
  children: ReactNode;
  onClick: () => void;
  value: T;
  options: ReadonlyArray<SplitButtonOption<T>>;
  onValueChange: (value: T) => void;
  menuLabel: string;
  disabled?: boolean;
  busy?: { active: boolean; label: ReactNode };
  describedBy?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function SplitButton<T extends string>({
  children,
  onClick,
  value,
  options,
  onValueChange,
  menuLabel,
  disabled = false,
  busy,
  describedBy,
  ref,
}: SplitButtonProps<T>) {
  const busyNow = busy?.active === true;
  const described = describedBy === undefined ? {} : { "aria-describedby": describedBy };
  if (options.length < 2) {
    return (
      <Button
        variant="primary"
        onClick={onClick}
        disabled={disabled}
        {...(busy === undefined ? {} : { busy })}
        {...described}
        {...(ref === undefined ? {} : { ref })}
      >
        {children}
      </Button>
    );
  }
  return (
    <div data-split-button="" {...stylex.props(styles.group)}>
      <SdkButton
        data-variant="primary"
        disabled={disabled}
        {...(busy === undefined ? {} : { "aria-busy": busyNow, "aria-disabled": busyNow })}
        {...described}
        {...(ref === undefined ? {} : { ref })}
        {...(busyNow ? {} : { onClick })}
        className={(s) => cx(...buttonStyles("primary", s.disabled || busyNow), styles.mainPart)}
      >
        {busy === undefined ? children : <BusyLabels busy={busy}>{children}</BusyLabels>}
      </SdkButton>
      <SdkMenu>
        <MenuTrigger
          aria-label={menuLabel}
          disabled={disabled || busyNow}
          className={(s) => cx(...buttonStyles("primary", s.disabled), styles.menuPart)}
        >
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuContent side="bottom" align="end" sideOffset={4} className={cx(popupStyles.content)}>
          <MenuRadio<T> value={value} onValueChange={onValueChange}>
            {options.map((option) => (
              <MenuRadioOption key={option.value} value={option.value}>
                {option.label}
              </MenuRadioOption>
            ))}
          </MenuRadio>
        </MenuContent>
      </SdkMenu>
    </div>
  );
}

const styles = stylex.create({
  group: { display: "inline-flex", alignItems: "stretch", gap: space.px2 },
  mainPart: { borderStartEndRadius: 0, borderEndEndRadius: 0 },
  menuPart: {
    paddingInline: space.s2,
    borderStartStartRadius: 0,
    borderEndStartRadius: 0,
  },
});
