import * as stylex from "@stylexjs/stylex";
import { colors, motion, radius, size } from "../tokens.stylex";

export function Spinner() {
  return <span aria-hidden="true" data-spinner="" {...stylex.props(styles.ring)} />;
}

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });

const styles = stylex.create({
  ring: {
    display: "inline-block",
    flexShrink: 0,
    width: size.icon,
    height: size.icon,
    boxSizing: "border-box",
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: colors.borderStrong,
    borderTopColor: "transparent",
    borderRadius: radius.full,
    animationName: { default: "none", "@media (prefers-reduced-motion: no-preference)": spin },
    animationDuration: motion.durationSpin,
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});
