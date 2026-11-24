import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { focusStyles } from "./focus";
import { textStyles } from "./text";
import { useTitleBarHidden } from "./window-chrome";
import { windowRegion } from "../window-frame";
import {
  colors,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  radius,
  size,
  space,
  breakpoints,
} from "../tokens.stylex";

const FIRST_LINE = `calc(${size.titleBar} - 2 * ${space.s2})`;

export interface SplitViewProps {
  list: ReactNode;
  panel: ReactNode;
  fill?: boolean;
  variant?: "list" | "editor";
  stackedListShare?: "half" | "larger";
}

export function SplitView({
  list,
  panel,
  fill = true,
  variant = "list",
  stackedListShare = "half",
}: SplitViewProps) {
  const editor = variant === "editor";
  return (
    <div {...stylex.props(styles.frame, fill ? styles.fill : styles.contained)}>
      <div
        {...stylex.props(
          styles.split,
          !editor && stackedListShare === "larger" && styles.splitListLarger,
          editor && styles.splitEditor,
        )}
      >
        <div {...stylex.props(styles.list)}>{list}</div>
        <aside {...stylex.props(styles.panel, editor && styles.panelEditor)}>{panel}</aside>
      </div>
    </div>
  );
}

export function NoticeLayout({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.notice)}>{children}</div>;
}

export interface ScreenLayoutProps {
  header: ReactNode;
  fill?: boolean;
  children: ReactNode;
}

export function ScreenLayout({ header, fill = true, children }: ScreenLayoutProps) {
  return (
    <div {...stylex.props(styles.screen, fill ? styles.fill : styles.contained)}>
      {header}
      <div {...stylex.props(styles.screenBody)}>{children}</div>
    </div>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  titleId?: string;
  subtitle?: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, titleId, subtitle, lead, actions }: PageHeaderProps) {
  const titleBarHidden = useTitleBarHidden();
  return (
    <header {...(titleBarHidden ? windowRegion("drag") : {})} {...stylex.props(styles.pageHead)}>
      {lead === undefined ? null : (
        <div {...windowRegion("no-drag")} {...stylex.props(styles.pageLead)}>
          {lead}
        </div>
      )}
      <div {...stylex.props(styles.pageHeading)}>
        <h1
          {...(titleId === undefined ? {} : { id: titleId, tabIndex: -1 })}
          {...stylex.props(styles.pageTitle, titleId !== undefined && focusStyles.ring)}
        >
          {title}
        </h1>
        {subtitle === undefined ? null : (
          <p {...windowRegion("no-drag")} {...stylex.props(styles.pageSub)}>
            {subtitle}
          </p>
        )}
      </div>
      {actions === undefined ? null : (
        <div {...windowRegion("no-drag")} {...stylex.props(styles.pageActions)}>
          {actions}
        </div>
      )}
    </header>
  );
}

export type SectionTitleRole = "heading" | "subheading";

export interface SectionProps {
  title: ReactNode;
  titleRole?: SectionTitleRole;
  count?: number;
  note?: ReactNode;
  link?: SectionLink;
  headingLevel?: "h2" | "h3";
  children: ReactNode;
}

export interface SectionLink {
  href: string;
  label: ReactNode;
}

export function Section({
  title,
  titleRole = "subheading",
  count,
  note,
  link,
  headingLevel,
  children,
}: SectionProps) {
  const Heading = headingLevel ?? (titleRole === "subheading" ? "h3" : "h2");
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionHead)}>
        <Heading {...stylex.props(textStyles(titleRole))}>{title}</Heading>
        {count === undefined ? null : <span {...stylex.props(styles.count)}>{count}</span>}
        {note === undefined ? null : <span {...stylex.props(styles.note)}>{note}</span>}
        {link === undefined ? null : (
          <a
            href={link.href}
            {...stylex.props(styles.sectionLink, note === undefined && styles.pushEnd)}
          >
            {link.label}
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

export function DetailPanel({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.panelInner)}>{children}</div>;
}

export interface PanelHeaderProps {
  eyebrow?: ReactNode;
  status?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  reason?: ReactNode;
}

export function PanelHeader({ eyebrow, status, title, subtitle, reason }: PanelHeaderProps) {
  const statusLine =
    status === undefined ? null : <div {...stylex.props(styles.panelState)}>{status}</div>;
  return (
    <div {...stylex.props(styles.panelHead)}>
      {eyebrow === undefined ? statusLine : <p {...stylex.props(styles.panelSub)}>{eyebrow}</p>}
      <h2 {...stylex.props(styles.panelTitle)}>{title}</h2>
      {eyebrow === undefined ? null : statusLine}
      {subtitle === undefined ? null : <p {...stylex.props(styles.panelSub)}>{subtitle}</p>}
      {reason === undefined ? null : <p {...stylex.props(styles.panelReason)}>{reason}</p>}
    </div>
  );
}

export function PanelBlock({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {title === undefined ? null : <h3 {...stylex.props(styles.blockTitle)}>{title}</h3>}
      {children}
    </div>
  );
}

export function PanelFooter({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.panelFoot)}>{children}</div>;
}

export function Actions({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.actions)}>{children}</div>;
}

const LIST_STACKED = "@container (max-width: 959px)";
const EDITOR_STACKED = "@container (max-width: 679px)";

const styles = stylex.create({
  notice: {
    maxWidth: size.noticeWidth,
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: `max(${space.s10}, var(--pinned-toast-space, 0px) + ${space.s10})`,
  },
  frame: { containerType: "inline-size", minHeight: 0 },
  split: {
    display: "grid",
    gridTemplateColumns: {
      default: `minmax(0, 1fr) ${size.panelWidth}`,
      [LIST_STACKED]: "minmax(0, 1fr)",
    },
    gridTemplateRows: { default: null, [LIST_STACKED]: "minmax(0, 1fr) minmax(0, 1fr)" },
    height: "100%",
    minHeight: 0,
  },
  splitListLarger: {
    gridTemplateRows: { default: null, [LIST_STACKED]: "minmax(0, 3fr) minmax(0, 2fr)" },
  },
  splitEditor: {
    gridTemplateColumns: {
      default: `${size.editorListWidth} minmax(0, 1fr)`,
      [LIST_STACKED]: null,
      [EDITOR_STACKED]: "minmax(0, 1fr)",
    },
    gridTemplateRows: {
      default: null,
      [LIST_STACKED]: null,
      [EDITOR_STACKED]: "minmax(0, 2fr) minmax(0, 3fr)",
    },
  },
  fill: { height: "100dvh" },
  contained: { height: "100%" },
  list: {
    minWidth: 0,
    overflow: "auto",
    paddingTop: space.s8,
    paddingInline: { default: space.s8, [breakpoints.narrowScreen]: space.s4 },
    paddingBottom: `max(${space.s10}, var(--pinned-toast-space, 0px) + ${space.s10})`,
  },
  panelEditor: { backgroundColor: colors.bgCanvas },
  panel: {
    minWidth: 0,
    overflow: "auto",
    backgroundColor: colors.bgPanel,
    scrollPaddingBlockEnd: "var(--pinned-toast-space, 0px)",
  },
  screen: {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    minWidth: 0,
  },
  screenBody: { minWidth: 0, minHeight: 0, overflow: "auto" },
  pageHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-start",
    columnGap: space.s4,
    rowGap: space.s2,
    minHeight: size.titleBar,
    paddingTop: space.s2,
    paddingBottom: `calc(${space.s2} - 1px)`,
    paddingInline: { default: space.s8, [breakpoints.narrowScreen]: space.s4 },
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.borderSubtle,
  },
  pageLead: { display: "flex", alignItems: "center", flexShrink: 0, minHeight: FIRST_LINE },
  pageHeading: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: space.s3,
    rowGap: space.px2,
    flexGrow: 1,
    flexBasis: size.pageHeadingMinWidth,
    minWidth: 0,
  },
  pageTitle: {
    display: "flex",
    alignItems: "center",
    minHeight: FIRST_LINE,
    flexShrink: 0,
    maxWidth: "100%",
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSize.page,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.page,
    textWrap: "balance",
  },
  pageSub: {
    minWidth: 0,
    margin: 0,
    color: colors.textTertiary,
    fontSize: fontSize.ui,
    textWrap: "pretty",
  },
  pageActions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    minHeight: FIRST_LINE,
    gap: space.s2,
    marginInlineStart: "auto",
  },
  section: {
    marginTop: { default: 0, ":not(:first-child)": space.s10 },
  },
  sectionHead: {
    display: "flex",
    alignItems: "baseline",
    gap: space.s2,
    marginBottom: space.s3,
  },
  count: { color: colors.textTertiary, fontVariantNumeric: "tabular-nums" },
  sectionLink: {
    flexShrink: 0,
    borderRadius: radius.pill,
    color: { default: colors.accentText, ":hover": colors.textPrimary },
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
    textDecoration: "none",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  pushEnd: { marginInlineStart: "auto" },
  note: {
    marginInlineStart: "auto",
    color: colors.textTertiary,
    fontSize: fontSize.small,
  },
  panelInner: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    paddingTop: space.s8,
    paddingInline: space.s6,
    paddingBottom: space.s10,
  },
  panelHead: { display: "flex", flexDirection: "column", gap: space.s2 },
  panelState: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    fontSize: fontSize.ui,
  },
  panelTitle: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSize.panel,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.panel,
    textWrap: "pretty",
  },
  panelSub: { margin: 0, color: colors.textTertiary },
  panelReason: {
    margin: 0,
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: lineHeight.relaxed,
    textWrap: "pretty",
  },
  blockTitle: {
    margin: 0,
    marginBottom: space.s2,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
  },
  panelFoot: {
    paddingTop: space.s4,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s2 },
});
