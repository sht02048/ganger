import * as stylex from "@stylexjs/stylex";
import { Meter, MeterIndicator, MeterTrack } from "@ui-sdk/react/meter";
import { cx } from "../cx";
import { colors, fontSize, radius, space } from "../tokens.stylex";

export type UsageTone = "neutral" | "problem";

export interface UsageBarProps {
  percent: number;
  label: string;
  tone?: UsageTone;
  density?: "regular" | "compact";
}

export function usageText(percent: number): string {
  return `${Math.round(percent)}%`;
}

export function UsageBar({ percent, label, tone = "neutral", density = "regular" }: UsageBarProps) {
  const text = usageText(percent);
  const compact = density === "compact";
  return (
    <Meter
      value={Math.min(Math.max(percent, 0), 100)}
      min={0}
      max={100}
      aria-label={label}
      getValueLabel={() => text}
      data-tone={tone}
      className={cx(styles.root)}
    >
      <MeterTrack className={compact ? cx(styles.track, compactStyles.track) : cx(styles.track)}>
        <MeterIndicator className={cx(styles.indicator, indicatorTone[tone])} />
      </MeterTrack>
      <span
        aria-hidden="true"
        {...stylex.props(styles.text, compact && compactStyles.text, textTone[tone])}
      >
        {text}
      </span>
    </Meter>
  );
}

const styles = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
  },
  track: {
    position: "relative",
    flexGrow: 1,
    minWidth: 48,
    height: 6,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: colors.meterTrack,
  },
  indicator: {
    height: "100%",
    borderRadius: radius.full,
  },
  text: {
    flexShrink: 0,
    minWidth: 36,
    textAlign: "end",
    fontSize: fontSize.ui,
    fontVariantNumeric: "tabular-nums",
  },
});

const compactStyles = stylex.create({
  track: { minWidth: 0, height: 4 },
  text: { fontSize: fontSize.small },
});

const indicatorTone = stylex.create({
  neutral: { backgroundColor: colors.meterFill },
  problem: { backgroundColor: colors.problem },
});

const textTone = stylex.create({
  neutral: { color: colors.textSecondary },
  problem: { color: colors.problem },
});
