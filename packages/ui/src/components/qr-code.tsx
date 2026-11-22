import * as stylex from "@stylexjs/stylex";
import { encode } from "uqr";
import { colors, radius } from "../tokens.stylex";

const QUIET_ZONE_MODULES = 4;

export interface QrCodeProps {
  value: string;
  label: string;
}

function modulesPath(modules: ReadonlyArray<ReadonlyArray<boolean>>): string {
  return modules
    .flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])))
    .join("");
}

export function QrCode({ value, label }: QrCodeProps) {
  const { data, size } = encode(value, { ecc: "M", border: QUIET_ZONE_MODULES });
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      {...stylex.props(styles.code)}
    >
      <path d={modulesPath(data)} {...stylex.props(styles.modules)} />
    </svg>
  );
}

const styles = stylex.create({
  code: {
    display: "block",
    width: 224,
    height: 224,
    maxWidth: "100%",
    backgroundColor: colors.qrBackground,
    borderRadius: radius.control,
  },
  modules: {
    fill: colors.qrForeground,
  },
});
