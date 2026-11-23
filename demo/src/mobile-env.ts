export const DEV_DEVICE_NAME = "Dev iPhone";

export function mobileDevEnv(
  launchEnv: Readonly<Record<string, string | undefined>>,
  server: { url: string; token: string },
): Record<string, string | undefined> {
  return {
    ...launchEnv,
    GANGER_MOBILE_BUILD: "development",
    EXPO_PUBLIC_GANGER_DEV_SERVER: launchEnv["GANGER_MOBILE_DEV_SERVER"] ?? server.url,
    EXPO_PUBLIC_GANGER_DEV_TOKEN: server.token,
  };
}
