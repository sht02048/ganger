export type BuildVariant = "development" | "release";

export interface AppConfigShape {
  name?: string;
  slug?: string;
  ios?: { infoPlist?: Record<string, unknown>; [key: string]: unknown };
  plugins?: unknown[];
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PushBuildEnv {
  projectId: string | null;
  bundleId: string | null;
  teamId: string | null;
}

export const NOTIFICATION_SERVICE_TARGET = "GangerNotificationService";

function filled(value: string | undefined): string | null {
  return value === undefined || value.trim() === "" ? null : value.trim();
}

export function pushBuildEnv(env: Readonly<Record<string, string | undefined>>): PushBuildEnv {
  return {
    projectId: filled(env["GANGER_EXPO_PROJECT_ID"]),
    bundleId: filled(env["GANGER_IOS_BUNDLE_ID"]),
    teamId: filled(env["GANGER_APPLE_TEAM_ID"]),
  };
}

export function withPush(
  config: AppConfigShape,
  variant: BuildVariant,
  { projectId, bundleId, teamId }: PushBuildEnv,
): AppConfigShape {
  const notifications = [
    "expo-notifications",
    {
      mode: variant === "release" ? "production" : "development",
      enableBackgroundRemoteNotifications: true,
    },
  ];
  const eas = projectId === null ? {} : { projectId };
  if (bundleId === null || teamId === null) {
    return {
      ...config,
      plugins: [...(config.plugins ?? []), notifications],
      extra: { ...config.extra, eas },
    };
  }
  const keychainAccessGroup = `${teamId}.${bundleId}.shared`;
  const extensionBundleId = `${bundleId}.notification-service`;
  return {
    ...config,
    ios: {
      ...config.ios,
      bundleIdentifier: bundleId,
      appleTeamId: teamId,
      entitlements: { "keychain-access-groups": [keychainAccessGroup] },
    },
    plugins: [
      ...(config.plugins ?? []),
      notifications,
      [
        "./plugins/with-notification-service.cjs",
        {
          targetName: NOTIFICATION_SERVICE_TARGET,
          bundleIdentifier: extensionBundleId,
          teamId,
          keychainAccessGroup,
        },
      ],
    ],
    extra: {
      ...config.extra,
      keychainAccessGroup,
      eas: {
        ...eas,
        build: {
          experimental: {
            ios: {
              appExtensions: [
                {
                  targetName: NOTIFICATION_SERVICE_TARGET,
                  bundleIdentifier: extensionBundleId,
                  entitlements: { "keychain-access-groups": [keychainAccessGroup] },
                },
              ],
            },
          },
        },
      },
    },
  };
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
  const variant = buildVariantOf(process.env.GANGER_MOBILE_BUILD);
  return withPush(withBuildVariant(config, variant), variant, pushBuildEnv(process.env));
}
