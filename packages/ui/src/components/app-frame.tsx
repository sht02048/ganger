import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { StyleArg } from "../cx";
import {
  colors,
  fonts,
  fontSize,
  fontWeight,
  lineHeight,
  motion,
  radius,
  size,
  space,
} from "../tokens.stylex";
import { windowRegion } from "../window-frame";
import { focusStyles } from "./focus";
import { visuallyHiddenStyles } from "./visually-hidden";
import { useTitleBarHidden } from "./window-chrome";

export interface AppFramePending {
  active: boolean;
  label: string;
}

export interface AppFrameProps {
  rail: ReactNode;
  fill?: boolean;
  pending?: AppFramePending;
  children: ReactNode;
}

export function AppFrame({ rail, fill = true, pending, children }: AppFrameProps) {
  const titleBarHidden = useTitleBarHidden();
  return (
    <div {...stylex.props(styles.app, fill ? styles.fill : styles.contained)}>
      <aside {...stylex.props(styles.rail)}>
        {titleBarHidden ? (
          <div
            aria-hidden="true"
            data-window-controls
            {...windowRegion("drag")}
            {...stylex.props(styles.windowControls)}
          />
        ) : null}
        <div {...stylex.props(styles.railBody, titleBarHidden && styles.railBodyUnderControls)}>
          {rail}
        </div>
      </aside>
      <main
        {...(pending?.active === true ? { "aria-busy": true } : {})}
        {...stylex.props(styles.main, pending !== undefined && styles.mainWithPending)}
      >
        {pending?.active === true ? <PendingBar /> : null}
        {children}
      </main>
      {pending === undefined ? null : (
        <span role="status" {...stylex.props(visuallyHiddenStyles.hidden)}>
          {pending.active ? pending.label : ""}
        </span>
      )}
    </div>
  );
}

function PendingBar() {
  return (
    <span aria-hidden="true" data-pending-bar {...stylex.props(styles.pendingTrack)}>
      <span {...stylex.props(styles.pendingBar)} />
    </span>
  );
}

export function RailBrand({ children }: { children: ReactNode }) {
  return (
    <div data-rail-brand {...stylex.props(styles.brand)}>
      {children}
    </div>
  );
}

export function RailNav({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} {...stylex.props(styles.nav)}>
      {children}
    </nav>
  );
}

export function RailNavList({ children }: { children: ReactNode }) {
  return <ul {...stylex.props(styles.navList)}>{children}</ul>;
}

export function railLinkStyles(current: boolean): ReadonlyArray<StyleArg> {
  return [styles.navLink, focusStyles.ringInset, current && styles.navLinkCurrent];
}

export type RailBadgeKind = "problem" | "todo";

const RAIL_BADGE_MAX = 99;

function railBadgeText(count: number): string {
  return count > RAIL_BADGE_MAX ? `${RAIL_BADGE_MAX}+` : String(count);
}

export interface RailLinkContentProps {
  icon: ReactNode;
  name: ReactNode;
  issues: number;
  badge?: RailBadgeKind;
}

export function RailLinkContent({ icon, name, issues, badge = "problem" }: RailLinkContentProps) {
  return (
    <>
      <span {...stylex.props(styles.iconBox)}>
        {icon}
        {issues > 0 ? (
          <span
            aria-hidden="true"
            data-issues={issues}
            data-badge={badge}
            {...stylex.props(styles.issueDot, badge === "todo" && styles.todoDot)}
          >
            {railBadgeText(issues)}
          </span>
        ) : null}
      </span>
      <span {...stylex.props(styles.ellipsis)}>{name}</span>
    </>
  );
}

export function WorkspaceBadge({ name, initial }: { name: ReactNode; initial: string | null }) {
  return (
    <>
      <span
        aria-hidden="true"
        {...stylex.props(styles.avatar, initial === null && styles.avatarEmpty)}
      >
        {initial}
      </span>
      <span {...stylex.props(styles.ellipsis, styles.workspaceName)}>{name}</span>
    </>
  );
}

export function RailStatic({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.workspace)}>{children}</div>;
}

const sweep = stylex.keyframes({
  from: { transform: "translateX(-100%)" },
  to: { transform: "translateX(250%)" },
});

const styles = stylex.create({
  app: {
    display: "grid",
    gridTemplateColumns: `${size.railWidth} minmax(0, 1fr)`,
  },
  fill: { height: "100dvh" },
  contained: { height: "100%" },
  rail: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    backgroundColor: colors.bgSidebar,
  },
  windowControls: { flexShrink: 0, height: size.titleBar },
  railBody: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    gap: space.s4,
    minHeight: 0,
    paddingBlock: space.s4,
    paddingInline: space.s2,
    overflow: "auto",
  },
  railBodyUnderControls: { paddingTop: space.s2 },
  brand: {
    display: "flex",
    justifyContent: "center",
    paddingBlock: space.s1,
    color: colors.textPrimary,
  },
  workspace: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s1,
    paddingBlock: space.s2,
  },
  avatar: {
    display: "grid",
    placeItems: "center",
    width: size.railAvatar,
    height: size.railAvatar,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
    color: colors.textOnAccent,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  avatarEmpty: { backgroundColor: colors.bgControl },
  ellipsis: {
    maxWidth: "100%",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  workspaceName: {
    color: colors.textSecondary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.regular,
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    flexGrow: 1,
    gap: space.s4,
  },
  navList: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  navLink: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s1,
    paddingBlock: space.s2,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
    fontSize: fontSize.small,
    textDecoration: "none",
    transitionProperty: "background-color, color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
  },
  navLinkCurrent: {
    backgroundColor: { default: colors.bgSelected, ":hover": colors.bgSelected },
    color: { default: colors.accentText, ":hover": colors.accentText },
  },
  iconBox: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: size.railIcon,
    height: size.railIcon,
  },
  issueDot: {
    position: "absolute",
    top: -4,
    insetInlineEnd: -8,
    display: "grid",
    placeItems: "center",
    minWidth: size.issueBadge,
    height: size.issueBadge,
    paddingInline: space.px2,
    borderRadius: radius.full,
    backgroundColor: colors.problem,
    color: colors.textOnProblem,
    fontSize: fontSize.label,
    fontWeight: fontWeight.semibold,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
  },
  todoDot: {
    backgroundColor: colors.accent,
    color: colors.textOnAccent,
  },
  main: { minWidth: 0, minHeight: 0, overflow: "hidden" },
  mainWithPending: { position: "relative" },
  pendingTrack: {
    position: "absolute",
    insetInline: 0,
    top: 0,
    zIndex: 1,
    height: 2,
    overflow: "hidden",
    pointerEvents: "none",
  },
  pendingBar: {
    display: "block",
    width: { default: "40%", "@media (prefers-reduced-motion: reduce)": "100%" },
    height: "100%",
    backgroundColor: colors.accent,
    opacity: { default: 1, "@media (prefers-reduced-motion: reduce)": 0.6 },
    animationName: { default: "none", "@media (prefers-reduced-motion: no-preference)": sweep },
    animationDuration: motion.durationSweep,
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
});

export const documentStyles = stylex.create({
  body: {
    margin: 0,
    backgroundColor: colors.bgCanvas,
    color: colors.textPrimary,
    fontFamily: fonts.sans,
    fontSize: fontSize.ui,
    lineHeight: lineHeight.normal,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    fontSynthesis: "none",
    wordBreak: "keep-all",
    overflowWrap: "break-word",
  },
});
