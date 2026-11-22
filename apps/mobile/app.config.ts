export type BuildVariant = "development" | "release";

export interface AppConfigShape {
  name?: string;
  slug?: string;
  ios?: { infoPlist?: Record<string, unknown>; [key: string]: unknown };
  [key: string]: unknown;
}

export function buildVariantOf(value: string | undefined): BuildVariant {
  return value === "development" ? "development" : "release";
}

export function iosInfoPlist(variant: BuildVariant): Record<string, unknown> {
  return {
    NSAppTransportSecurity:
      variant === "development"
        ? { NSAllowsLocalNetworking: true }
        : { NSAllowsArbitraryLoads: false },
  };
}

export function withBuildVariant(config: AppConfigShape, variant: BuildVariant) {
  return {
    ...config,
    name: config.name ?? "Ganger",
    slug: config.slug ?? "ganger",
    ios: {
      ...config.ios,
      infoPlist: { ...config.ios?.infoPlist, ...iosInfoPlist(variant) },
    },
  };
}

export default function appConfig({ config }: { config: AppConfigShape }) {
  return withBuildVariant(config, buildVariantOf(process.env.GANGER_MOBILE_BUILD));
}
