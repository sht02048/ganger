import * as stylex from "@stylexjs/stylex";
import {
  Dialog as SdkDialog,
  DialogBackdrop,
  DialogClose as SdkDialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import type { MouseEvent, ReactNode } from "react";
import { cx } from "../cx";
import { windowRegion } from "../window-frame";
import { BusyLabels, buttonStyles, compactButtonStyle, type ButtonVariant } from "./button";
import {
  colors,
  fontSize,
  fontWeight,
  lineHeight,
  motion,
  radius,
  shadow,
  size,
  space,
} from "../tokens.stylex";

export interface DialogProps {
  trigger?: ReactNode;
  finalFocus?: () => HTMLElement | null;
  triggerVariant?: ButtonVariant;
  triggerBusy?: { active: boolean; label: ReactNode };
  triggerCompact?: boolean;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  scrollBody?: boolean;
  status?: ReactNode;
  wide?: boolean;
}

export function Dialog({
  trigger,
  triggerVariant = "secondary",
  triggerBusy,
  triggerCompact = false,
  title,
  description,
  children,
  actions,
  open,
  onOpenChange,
  scrollBody = false,
  status,
  finalFocus,
  wide = false,
}: DialogProps) {
  return (
    <SdkDialog
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined
        ? {}
        : { onOpenChange: (next: boolean) => onOpenChange(next) })}
    >
      {trigger === undefined ? null : (
        <DialogTrigger
          {...(triggerBusy === undefined
            ? {}
            : { "aria-busy": triggerBusy.active, "aria-disabled": triggerBusy.active })}
          {...(triggerBusy?.active === true
            ? {
                onClickCapture: (event: MouseEvent) => {
                  event.preventDefault();
                  event.stopPropagation();
                },
              }
            : {})}
          data-variant={triggerVariant}
          className={cx(
            ...buttonStyles(triggerVariant, triggerBusy?.active === true),
            triggerCompact && compactButtonStyle,
          )}
        >
          {triggerBusy === undefined ? (
            trigger
          ) : (
            <BusyLabels busy={triggerBusy}>{trigger}</BusyLabels>
          )}
        </DialogTrigger>
      )}
      <DialogBackdrop {...windowRegion("no-drag")} className={cx(styles.backdrop)} />
      <DialogContent
        {...windowRegion("no-drag")}
        {...(finalFocus === undefined ? {} : { finalFocus })}
        className={cx(styles.content, scrollBody && styles.contentFits, wide && styles.contentWide)}
      >
        <div {...stylex.props(styles.head)}>
          <DialogTitle className={cx(styles.title)}>{title}</DialogTitle>
          {description === undefined ? null : (
            <DialogDescription className={cx(styles.description)}>{description}</DialogDescription>
          )}
        </div>
        {scrollBody ? (
          <div
            onFocus={(event) => event.target.scrollIntoView({ block: "nearest" })}
            {...stylex.props(styles.body)}
          >
            {children}
          </div>
        ) : (
          children
        )}
        {status === undefined ? null : <div {...stylex.props(styles.status)}>{status}</div>}
        <div {...stylex.props(styles.actions)}>{actions}</div>
      </DialogContent>
    </SdkDialog>
  );
}

export interface DialogCloseProps {
  variant?: ButtonVariant;
  children: ReactNode;
  onClick?: () => void;
}

export function DialogClose({ variant = "secondary", children, onClick }: DialogCloseProps) {
  return (
    <SdkDialogClose
      {...(onClick === undefined ? {} : { onClick })}
      data-variant={variant}
      className={cx(...buttonStyles(variant))}
    >
      {children}
    </SdkDialogClose>
  );
}

const REDUCED = "@media (prefers-reduced-motion: reduce)";
const STARTING = ":is([data-starting-style])";
const ENDING = ":is([data-ending-style])";

const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    backgroundColor: colors.backdrop,
    opacity: { default: 1, [STARTING]: 0, [ENDING]: 0 },
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.durationDialogOpen,
      [ENDING]: motion.durationDialogClose,
      [REDUCED]: motion.durationReducedFade,
    },
    transitionTimingFunction: motion.easeOut,
  },
  content: {
    position: "fixed",
    top: "50%",
    left: "50%",
    zIndex: 201,
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    width: "min(440px, calc(100vw - 32px))",
    padding: space.s6,
    borderWidth: 0,
    borderRadius: radius.card,
    backgroundColor: colors.bgRaised,
    boxShadow: shadow.popover,
    color: colors.textPrimary,
    opacity: { default: 1, [STARTING]: 0, [ENDING]: 0 },
    transform: {
      default: "translate(-50%, -50%)",
      [STARTING]: "translate(-50%, -50%) scale(0.96)",
      [ENDING]: "translate(-50%, calc(-50% + 4px)) scale(0.98)",
      [REDUCED]: "translate(-50%, -50%)",
    },
    outline: "none",
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motion.durationDialogOpen,
      [ENDING]: motion.durationDialogClose,
      [REDUCED]: motion.durationReducedFade,
    },
    transitionTimingFunction: motion.easeOut,
  },
  contentFits: { maxHeight: "calc(100dvh - 32px)" },
  contentWide: { width: `min(${size.noticeWidth}, calc(100vw - 32px))` },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    marginInline: `calc(-1 * ${space.s2})`,
    paddingInline: space.s2,
    paddingBlock: space.s3,
    borderBlockWidth: 1,
    borderBlockStyle: "solid",
    borderBlockColor: colors.borderDefault,
    borderInlineWidth: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  head: { display: "flex", flexDirection: "column", gap: space.s2, flexShrink: 0 },
  status: { flexShrink: 0 },
  title: {
    margin: 0,
    fontSize: fontSize.panel,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
  },
  description: {
    margin: 0,
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: lineHeight.relaxed,
    textWrap: "pretty",
  },
  actions: {
    display: "flex",
    flexShrink: 0,
    justifyContent: "flex-end",
    gap: space.s2,
  },
});
