import * as stylex from "@stylexjs/stylex";
import { GangerMark, PageHeader, Text } from "@ganger/ui";
import {
  colors,
  fontSize,
  fontWeight,
  letterSpacing,
  motion,
  radius,
  size,
  space,
} from "@ganger/ui/tokens.stylex";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { BlockSections, blockSectionIds } from "./block-preview";
import { ComponentSections } from "./component-preview";
import { MotionSection } from "./motion-preview";
import { RoleSections, roleSectionIds } from "./role-preview";
import { TokenSections } from "./token-preview";

const tokenLinks = ["colors", "typography", "space", "size", "radius", "shadow", "motion"] as const;
const componentLinks = [
  "buttons",
  "status",
  "card",
  "tabs",
  "table",
  "definitions",
  "menu",
  "form",
  "tooltip",
  "dialog",
  "dependencyGraph",
  "toast",
  ...roleSectionIds,
  ...blockSectionIds,
  "motionPrimitives",
] as const;

export function DesignSystemPage() {
  const tDs = useTranslations("ds");
  return (
    <div {...stylex.props(styles.app)}>
      <nav aria-label={tDs("nav.label")} {...stylex.props(styles.sidebar)}>
        <div {...stylex.props(styles.brand)}>
          <GangerMark tone="mono" size="small" />
          {tDs("title")}
        </div>
        <NavGroup title={tDs("nav.tokens")}>
          {tokenLinks.map((id) => (
            <NavLink key={id} id={id} label={tDs(`nav.${id}`)} />
          ))}
        </NavGroup>
        <NavGroup title={tDs("nav.components")}>
          {componentLinks.map((id) => (
            <NavLink key={id} id={id} label={tDs(`nav.${id}`)} />
          ))}
        </NavGroup>
      </nav>
      <main {...stylex.props(styles.main)}>
        <PageHeader
          title={tDs("title")}
          subtitle={tDs("subtitle")}
          actions={<Text variant="meta">{tDs("theme")}</Text>}
        />
        <div {...stylex.props(styles.content)}>
          <div {...stylex.props(styles.sections)}>
            <TokenSections />
            <ComponentSections />
            <RoleSections />
            <BlockSections />
            <MotionSection />
          </div>
        </div>
      </main>
    </div>
  );
}

function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.navGroup)}>
      <span {...stylex.props(styles.navLabel)}>{title}</span>
      <ul {...stylex.props(styles.navList)}>{children}</ul>
    </div>
  );
}

function NavLink({ id, label }: { id: string; label: string }) {
  return (
    <li>
      <a href={`#${id}`} {...stylex.props(styles.navLink)}>
        {label}
      </a>
    </li>
  );
}

const styles = stylex.create({
  app: {
    display: "grid",
    gridTemplateColumns: `${size.sidebarWidth} minmax(0, 1fr)`,
    height: "100dvh",
  },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    height: "100dvh",
    paddingBlock: space.s3,
    paddingInline: space.s2,
    overflow: "auto",
    backgroundColor: colors.bgSidebar,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: colors.borderSubtle,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s1,
    paddingInline: space.s2,
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  navGroup: { display: "flex", flexDirection: "column", gap: space.s1 },
  navLabel: {
    paddingInline: space.s2,
    color: colors.textTertiary,
    fontSize: fontSize.label,
    fontWeight: fontWeight.medium,
    letterSpacing: letterSpacing.label,
    textTransform: "uppercase",
  },
  navList: { display: "flex", flexDirection: "column", gap: space.px2 },
  navLink: {
    display: "flex",
    alignItems: "center",
    height: 30,
    paddingInline: space.s2,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    color: { default: colors.textSecondary, ":hover": colors.textPrimary },
    fontWeight: fontWeight.medium,
    textDecoration: "none",
    transitionProperty: "background-color, color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: -2,
  },
  main: { minWidth: 0, height: "100dvh", overflow: "auto", scrollBehavior: "smooth" },
  content: {
    maxWidth: 1120,
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  sections: { display: "flex", flexDirection: "column", gap: space.s10 },
});
