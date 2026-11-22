import * as stylex from "@stylexjs/stylex";
import { Button, Section, Text } from "@ganger/ui";
import {
  colors,
  fonts,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  motion,
  radius,
  shadow,
  size,
  space,
} from "@ganger/ui/tokens.stylex";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";

type ColorKey = Exclude<keyof typeof colors, `__${string}`>;

const colorGroups = [
  {
    id: "background",
    keys: [
      "bgCanvas",
      "bgSidebar",
      "bgPanel",
      "bgRaised",
      "bgRaisedHover",
      "bgHover",
      "bgSelected",
      "bgInset",
      "backdrop",
    ],
  },
  { id: "surface", keys: ["bgCard", "bgCardHover", "bgControl", "bgControlHover"] },
  { id: "border", keys: ["borderSubtle", "borderDefault", "borderStrong", "borderSelected"] },
  {
    id: "text",
    keys: ["textPrimary", "textSecondary", "textTertiary", "textDisabled", "textOnAccent"],
  },
  { id: "accent", keys: ["accent", "accentHover", "accentText", "accentSoft"] },
  {
    id: "status",
    keys: [
      "answer",
      "answerSoft",
      "check",
      "checkSoft",
      "problem",
      "problemSoft",
      "problemBorder",
      "progress",
      "progressSoft",
      "merged",
      "mergedSoft",
      "idle",
      "idleSoft",
    ],
  },
] as const satisfies ReadonlyArray<{
  id: "background" | "surface" | "border" | "text" | "accent" | "status";
  keys: ReadonlyArray<ColorKey>;
}>;

const spaceKeys = ["px2", "s1", "px6", "s2", "s3", "s4", "s5", "s6", "s8", "s10"] as const;
const radiusKeys = ["card", "control", "pill", "full"] as const;
const motionKeys = [
  "easeOut",
  "easeMove",
  "easeSheet",
  "durationFast",
  "durationToast",
  "durationSpin",
  "durationSweep",
  "durationReducedFade",
  "durationItemEnter",
  "durationItemExit",
  "durationLineEnter",
  "durationLineFade",
  "durationArrival",
  "durationPillColor",
  "durationPillPop",
  "durationRowMove",
  "durationCardMove",
  "durationDialogOpen",
  "durationDialogClose",
  "durationSheetOpen",
  "durationSheetClose",
] as const;
const fontSizeKeys = [
  "display",
  "page",
  "heading",
  "panel",
  "subheading",
  "body",
  "ui",
  "small",
  "label",
  "input",
] as const;
const fontWeightKeys = ["regular", "medium", "semibold"] as const;
const lineHeightKeys = ["tight", "snug", "normal", "relaxed"] as const;
const letterSpacingKeys = ["display", "page", "panel", "label"] as const;
const fontKeys = ["sans", "mono"] as const;
const sizeKeys = [
  "sidebarWidth",
  "panelWidth",
  "control",
  "input",
  "rowMinHeight",
  "dot",
  "pill",
  "icon",
] as const;

function PlainTokens({
  title,
  prefix,
  entries,
}: {
  title: string;
  prefix: string;
  entries: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <div>
      <Text variant="label" as="h3">
        {title}
      </Text>
      <div {...stylex.props(styles.tokenList)}>
        {entries.map(([key, token]) => (
          <TokenRow key={key} name={`${prefix}.${key}`} token={token}>
            <span {...stylex.props(styles.swatchSpacer)} />
          </TokenRow>
        ))}
      </div>
    </div>
  );
}

function TokenValue({ token }: { token: string }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    const name = /var\((--[^),]+)/.exec(token)?.[1];
    if (name !== undefined) {
      setValue(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
    }
  }, [token]);
  return <span {...stylex.props(styles.value)}>{value}</span>;
}

function TokenRow({ name, token, children }: { name: string; token: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.tokenRow)}>
      {children}
      <span {...stylex.props(styles.tokenName)}>{name}</span>
      <TokenValue token={token} />
    </div>
  );
}

export function TokenSections() {
  const t = useTranslations("ds");
  const [moved, setMoved] = useState(false);
  return (
    <>
      <div id="colors">
        <Section title={t("nav.colors")} note={t("colors.note")}>
          <div {...stylex.props(styles.colorGroups)}>
            {colorGroups.map((group) => (
              <div key={group.id}>
                <Text variant="label" as="h3">
                  {t(`colors.${group.id}`)}
                </Text>
                <div {...stylex.props(styles.tokenList)}>
                  {group.keys.map((key) => (
                    <TokenRow key={key} name={key} token={colors[key]}>
                      <span {...stylex.props(styles.swatch, styles.swatchColor(colors[key]))} />
                    </TokenRow>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div id="typography">
        <Section title={t("nav.typography")} note={t("typography.note")}>
          <div {...stylex.props(styles.typeLevels)}>
            <TypeLevel title={t("typography.level1")}>
              <TypeSample spec="display">
                <Text variant="display" as="p">
                  {t("typography.sampleDisplay")}
                </Text>
              </TypeSample>
              <TypeSample spec="page">
                <Text variant="page" as="p">
                  {t("typography.samplePage")}
                </Text>
              </TypeSample>
              <TypeSample spec="heading">
                <Text variant="heading" as="p">
                  {t("typography.sampleHeading")}
                </Text>
              </TypeSample>
              <TypeSample spec="panel">
                <Text variant="panel" as="p">
                  {t("typography.samplePanel")}
                </Text>
              </TypeSample>
            </TypeLevel>
            <TypeLevel title={t("typography.level2")}>
              <TypeSample spec="subheading">
                <Text variant="subheading" as="p">
                  {t("typography.sampleSubheading")}
                </Text>
              </TypeSample>
              <TypeSample spec="title">
                <Text variant="title">{t("typography.sampleTitle")}</Text>
              </TypeSample>
              <TypeSample spec="body">
                <Text variant="body">{t("typography.sampleBody")}</Text>
              </TypeSample>
            </TypeLevel>
            <TypeLevel title={t("typography.level3")}>
              <TypeSample spec="ui">
                <Text variant="ui">{t("typography.sampleUi")}</Text>
              </TypeSample>
              <TypeSample spec="meta">
                <Text variant="meta" numeric>
                  {t("typography.sampleMeta")}
                </Text>
              </TypeSample>
              <TypeSample spec="label">
                <Text variant="label">{t("typography.sampleLabel")}</Text>
              </TypeSample>
            </TypeLevel>
          </div>
          <div {...stylex.props(styles.colorGroups, styles.typeTokens)}>
            <PlainTokens
              title={t("typography.fontSize")}
              prefix="fontSize"
              entries={fontSizeKeys.map((k) => [k, fontSize[k]] as const)}
            />
            <PlainTokens
              title={t("typography.fontWeight")}
              prefix="fontWeight"
              entries={fontWeightKeys.map((k) => [k, fontWeight[k]] as const)}
            />
            <PlainTokens
              title={t("typography.lineHeight")}
              prefix="lineHeight"
              entries={lineHeightKeys.map((k) => [k, lineHeight[k]] as const)}
            />
            <PlainTokens
              title={t("typography.letterSpacing")}
              prefix="letterSpacing"
              entries={letterSpacingKeys.map((k) => [k, letterSpacing[k]] as const)}
            />
            <PlainTokens
              title={t("typography.fonts")}
              prefix="fonts"
              entries={fontKeys.map((k) => [k, fonts[k]] as const)}
            />
          </div>
        </Section>
      </div>

      <div id="space">
        <Section title={t("nav.space")} note={t("space.note")}>
          <div {...stylex.props(styles.tokenList)}>
            {spaceKeys.map((key) => (
              <TokenRow key={key} name={key} token={space[key]}>
                <span {...stylex.props(styles.spaceCell)}>
                  <span {...stylex.props(styles.spaceBar, styles.spaceWidth(space[key]))} />
                </span>
              </TokenRow>
            ))}
          </div>
        </Section>
      </div>

      <div id="size">
        <Section title={t("nav.size")} note={t("size.note")}>
          <PlainTokens
            title={t("size.layout")}
            prefix="size"
            entries={sizeKeys.map((k) => [k, size[k]] as const)}
          />
        </Section>
      </div>

      <div id="radius">
        <Section title={t("nav.radius")} note={t("radius.note")}>
          <div {...stylex.props(styles.inlineTokens)}>
            {radiusKeys.map((key) => (
              <TokenRow key={key} name={key} token={radius[key]}>
                <span {...stylex.props(styles.radiusBox, styles.radiusValue(radius[key]))} />
              </TokenRow>
            ))}
          </div>
        </Section>
      </div>

      <div id="shadow">
        <Section title={t("nav.shadow")} note={t("shadow.note")}>
          <TokenRow name="popover" token={shadow.popover}>
            <span {...stylex.props(styles.shadowBox)} />
          </TokenRow>
        </Section>
      </div>

      <div id="motion">
        <Section title={t("nav.motion")} note={t("motion.note")}>
          <div {...stylex.props(styles.motionDemo)}>
            <div {...stylex.props(styles.track)}>
              <span {...stylex.props(styles.puck, moved && styles.puckMoved)} />
            </div>
            <Button variant="ghost" onClick={() => setMoved((m) => !m)}>
              {t("motion.replay")}
            </Button>
          </div>
          <div {...stylex.props(styles.tokenList)}>
            {motionKeys.map((key) => (
              <TokenRow key={key} name={key} token={motion[key]}>
                <span {...stylex.props(styles.swatchSpacer)} />
              </TokenRow>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}

function TypeLevel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.typeLevel)}>
      <Text variant="label" as="h3">
        {title}
      </Text>
      {children}
    </div>
  );
}

function TypeSample({ spec, children }: { spec: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.typeSample)}>
      <span {...stylex.props(styles.tokenName)}>{spec}</span>
      <div {...stylex.props(styles.typeText)}>{children}</div>
    </div>
  );
}

const styles = stylex.create({
  colorGroups: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: space.s6,
  },
  tokenList: {
    display: "flex",
    flexDirection: "column",
    marginTop: space.s2,
  },
  inlineTokens: { display: "flex", flexDirection: "column" },
  tokenRow: {
    display: "grid",
    gridTemplateColumns: "56px minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: space.s3,
    minHeight: 40,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  tokenName: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: fontSize.small,
  },
  value: {
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontVariantNumeric: "tabular-nums",
    maxWidth: 220,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  swatch: {
    width: 40,
    height: 24,
    borderRadius: radius.pill,
    boxShadow: `inset 0 0 0 1px ${colors.borderDefault}`,
  },
  swatchColor: (color: string) => ({ backgroundColor: color }),
  swatchSpacer: { width: 40 },
  spaceCell: { display: "flex", alignItems: "center", height: 24 },
  spaceBar: { height: 12, borderRadius: 2, backgroundColor: colors.accentSoft },
  spaceWidth: (width: string) => ({ width }),
  radiusBox: {
    width: 40,
    height: 24,
    backgroundColor: colors.bgRaised,
    boxShadow: `inset 0 0 0 1px ${colors.borderStrong}`,
  },
  radiusValue: (value: string) => ({ borderRadius: value }),
  shadowBox: {
    width: 40,
    height: 24,
    borderRadius: radius.control,
    backgroundColor: colors.bgRaised,
    boxShadow: shadow.popover,
  },
  typeLevels: { display: "flex", flexDirection: "column", gap: space.s6 },
  typeLevel: { display: "flex", flexDirection: "column", gap: space.s2 },
  typeSample: {
    display: "grid",
    gridTemplateColumns: "160px minmax(0, 1fr)",
    alignItems: "baseline",
    columnGap: space.s4,
    paddingBlock: space.s2,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  typeTokens: { marginTop: space.s6 },
  typeText: { minWidth: 0, fontWeight: fontWeight.regular },
  motionDemo: {
    display: "flex",
    alignItems: "center",
    gap: space.s4,
    marginBottom: space.s2,
  },
  track: {
    position: "relative",
    width: 240,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.bgInset,
    boxShadow: `inset 0 0 0 1px ${colors.borderSubtle}`,
  },
  puck: {
    position: "absolute",
    top: 4,
    left: 4,
    width: 16,
    height: 16,
    borderRadius: radius.full,
    backgroundColor: colors.accentText,
    transitionProperty: "transform",
    transitionDuration: {
      default: motion.durationToast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  puckMoved: { transform: "translateX(216px)" },
});
