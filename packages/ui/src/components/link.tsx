import * as stylex from "@stylexjs/stylex";
import type { KeyboardEvent, MouseEventHandler, ReactNode, Ref, SyntheticEvent } from "react";
import type { StyleArg } from "../cx";
import { colors, fontWeight, space } from "../tokens.stylex";
import { focusStyles } from "./focus";

export type LinkTone = "accent" | "quiet" | "action" | "plain" | "row";

export function linkStyles(tone: LinkTone = "accent"): ReadonlyArray<StyleArg> {
  return [styles.base, styles[tone], tone === "row" ? focusStyles.ringInset : focusStyles.ring];
}

export interface TextLinkProps {
  href: string;
  tone?: LinkTone;
  external?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  ref?: Ref<HTMLAnchorElement>;
  children: ReactNode;
}

export function TextLink({ href, tone, external, onClick, ref, children }: TextLinkProps) {
  return (
    <a
      {...(ref === undefined ? {} : { ref })}
      href={href}
      {...(external === true ? { target: "_blank", rel: "noreferrer" } : {})}
      {...(onClick === undefined ? {} : { onClick })}
      {...stylex.props(linkStyles(tone))}
    >
      {children}
    </a>
  );
}

function keepFromRow(event: SyntheticEvent) {
  event.stopPropagation();
}

function keepKeyFromRow(event: KeyboardEvent<HTMLAnchorElement>) {
  const activatesRow = event.key === "Enter" || event.key === " ";
  const leavesLink = event.key === "Tab" || event.key === "Escape";
  const isShortcut = event.metaKey || event.ctrlKey || event.altKey;
  if (activatesRow || !(leavesLink || isShortcut)) event.stopPropagation();
}

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={keepFromRow}
      onDoubleClick={keepFromRow}
      onKeyDown={keepKeyFromRow}
      {...stylex.props(linkStyles("row"))}
    >
      {children}
    </a>
  );
}

const styles = stylex.create({
  base: { textUnderlineOffset: 3 },
  accent: { color: colors.accentText },
  quiet: {
    color: { default: colors.textTertiary, ":hover": colors.textSecondary },
    textDecoration: "none",
  },
  plain: {
    color: "inherit",
    textDecoration: { default: "none", ":hover": "underline", ":focus-visible": "underline" },
  },
  row: {
    position: "relative",
    zIndex: 1,
    color: colors.textSecondary,
    textDecorationLine: "underline",
    textDecorationColor: { default: colors.borderStrong, ":hover": colors.textTertiary },
  },
  action: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.px6,
    color: colors.accentText,
    fontWeight: fontWeight.medium,
    textDecoration: { default: "none", ":hover": "underline" },
  },
});
