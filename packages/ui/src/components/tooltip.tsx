import * as stylex from "@stylexjs/stylex";
import {
  Tooltip as SdkTooltip,
  TooltipContent,
  TooltipShortcut,
  TooltipTrigger,
} from "@ui-sdk/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { buttonStyles, type ButtonVariant } from "./button";
import { cx } from "../cx";
import { ExternalIcon, InfoIcon } from "./icons";
import {
  colors,
  fontSize,
  lineHeight,
  motion,
  radius,
  shadow,
  size,
  space,
} from "../tokens.stylex";

export interface TooltipAction {
  variant?: ButtonVariant;
  busy?: boolean;
  onClick: () => void;
}

export interface TooltipProps {
  content: string;
  children: ReactNode;
  labelsTrigger?: boolean;
  side?: "top" | "bottom" | "left" | "right";
  action?: TooltipAction;
  shortcut?: string;
  render?: ReactElement<Record<string, unknown>>;
  disabled?: boolean;
}

export function Tooltip({
  content,
  children,
  labelsTrigger,
  side = "top",
  action,
  shortcut,
  render,
  disabled,
}: TooltipProps) {
  return (
    <SdkTooltip
      type={labelsTrigger === true ? "label" : "description"}
      {...(shortcut === undefined ? {} : { shortcut })}
      {...(disabled === undefined ? {} : { disabled })}
    >
      {action !== undefined ? (
        <ActionTrigger action={action}>{children}</ActionTrigger>
      ) : render !== undefined ? (
        <TooltipTrigger render={render}>{children}</TooltipTrigger>
      ) : (
        <TooltipTrigger className={cx(styles.trigger)}>{children}</TooltipTrigger>
      )}
      <TooltipContent side={side} sideOffset={6} className={cx(styles.content)}>
        {content}
        {shortcut === undefined ? null : <TooltipShortcut className={cx(styles.shortcut)} />}
      </TooltipContent>
    </SdkTooltip>
  );
}

export interface InfoTipProps {
  label: string;
  content: string;
  side?: "top" | "bottom" | "left" | "right";
}

export function InfoTip({ label, content, side = "top" }: InfoTipProps) {
  return (
    <SdkTooltip type="description" toggleable>
      <TooltipTrigger aria-label={label} className={cx(styles.info)}>
        <InfoIcon />
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={6} className={cx(styles.content, styles.infoContent)}>
        {content}
      </TooltipContent>
    </SdkTooltip>
  );
}

export interface ExternalIconLinkProps {
  href: string;
  label: string;
}

export function ExternalIconLink({ href, label }: ExternalIconLinkProps) {
  return (
    <Tooltip
      content={label}
      labelsTrigger
      render={
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={label}
          data-variant="ghost"
          className={cx(...buttonStyles("ghost"), styles.iconAction)}
        />
      }
    >
      <ExternalIcon />
    </Tooltip>
  );
}

function ActionTrigger({ action, children }: { action: TooltipAction; children: ReactNode }) {
  const variant = action.variant ?? "secondary";
  const busy = action.busy === true;
  return (
    <TooltipTrigger
      data-variant={variant}
      {...(busy ? { "aria-disabled": true } : {})}
      onClick={() => {
        if (!busy) action.onClick();
      }}
      className={cx(...buttonStyles(variant, busy), styles.iconAction)}
    >
      {children}
    </TooltipTrigger>
  );
}

const popIn = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.97)" },
  to: { opacity: 1, transform: "none" },
});

const styles = stylex.create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationColor: colors.textTertiary,
    textUnderlineOffset: 3,
    cursor: "help",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
    borderRadius: radius.pill,
  },
  iconAction: {
    flexShrink: 0,
    width: size.iconButton,
    height: size.iconButton,
    paddingInline: 0,
  },
  content: {
    zIndex: 100,
    maxWidth: 260,
    margin: 0,
    borderWidth: 0,
    paddingBlock: space.s1,
    paddingInline: space.s2,
    borderRadius: radius.pill,
    backgroundColor: colors.bgRaised,
    boxShadow: shadow.popover,
    color: colors.textPrimary,
    fontSize: fontSize.small,
    lineHeight: lineHeight.snug,
    transformOrigin: "var(--transform-origin)",
    animationName: {
      default: popIn,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: motion.durationFast,
    animationTimingFunction: motion.easeOut,
  },
  info: {
    position: "relative",
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: size.infoTip,
    height: size.infoTip,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.full,
    backgroundColor: "transparent",
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
    cursor: "help",
    verticalAlign: "middle",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 0,
    "::before": {
      content: "''",
      position: "absolute",
      insetBlock: `calc(-1 * ${space.s2})`,
      insetInline: `calc(-1 * ${space.s2})`,
    },
  },
  infoContent: {
    maxWidth: size.infoTipWidth,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    lineHeight: lineHeight.normal,
    textWrap: "pretty",
  },
  shortcut: {
    marginInlineStart: space.s2,
    color: colors.textSecondary,
  },
});
