import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import appConfig, { buildVariantOf, iosInfoPlist, pushBuildEnv, withPush } from "./app.config";

const configFor = (value: string | undefined) => {
  const before = process.env.GANGER_MOBILE_BUILD;
  if (value === undefined) delete process.env.GANGER_MOBILE_BUILD;
  else process.env.GANGER_MOBILE_BUILD = value;
  try {
    return appConfig({
      config: { name: "Ganger", slug: "ganger", ios: { supportsTablet: false } },
    });
  } finally {
    if (before === undefined) delete process.env.GANGER_MOBILE_BUILD;
    else process.env.GANGER_MOBILE_BUILD = before;
  }
};

describe("ATS 예외(M46)", () => {
  it("개발 빌드에만 NSAllowsLocalNetworking을 둔다", () => {
    expect(configFor("development").ios?.infoPlist).toEqual({
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    });
  });

  it.each([undefined, "", "release", "production", "Development"])(
    "빌드 값이 %j이면 출시 설정이라 ATS 예외가 없다",
    (value) => {
      expect(buildVariantOf(value)).toBe("release");
      expect(configFor(value).ios?.infoPlist).toEqual({
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
      });
    },
  );

  it("출시 설정은 Expo 기본값의 평문 허용을 끄고 정적 설정에도 ATS 예외를 적지 않는다", () => {
    expect(JSON.stringify(iosInfoPlist("development"))).not.toContain("NSAllowsArbitraryLoads");
    expect(JSON.stringify(iosInfoPlist("release"))).not.toContain("NSAllowsLocalNetworking");
    expect(JSON.stringify(iosInfoPlist("release"))).not.toContain("NSExceptionDomains");
    expect(readFileSync(join(import.meta.dirname, "app.json"), "utf8")).not.toContain(
      "NSAppTransportSecurity",
    );
  });
});

describe("푸시 빌드 설정(0109)", () => {
  const base = { name: "Ganger", slug: "ganger", ios: { supportsTablet: false } };
  const pluginNames = (plugins: unknown[] | undefined): unknown[] =>
    (plugins ?? []).map((plugin: unknown): unknown => {
      return Array.isArray(plugin) ? z.array(z.unknown()).parse(plugin)[0] : plugin;
    });

  it("환경 값이 없으면 NSE 없이 만들고 저장소의 설정에 키와 팀 값을 두지 않는다", () => {
    const config = withPush(base, "development", pushBuildEnv({}));
    expect(pluginNames(config.plugins)).toEqual(["expo-notifications"]);
    expect(config.ios).not.toHaveProperty("appleTeamId");
    const stored = readFileSync(join(import.meta.dirname, "app.json"), "utf8");
    expect(stored).not.toContain("projectId");
    expect(stored).not.toContain("appleTeamId");
    expect(stored).not.toContain("bundleIdentifier");
  });

  it("환경 값이 있으면 NSE 타깃과 공유 키체인을 설정에서 만든다", () => {
    const config = withPush(
      base,
      "release",
      pushBuildEnv({
        GANGER_EXPO_PROJECT_ID: "project-1",
        GANGER_IOS_BUNDLE_ID: "com.example.ganger",
        GANGER_APPLE_TEAM_ID: "TEAM123456",
      }),
    );
    expect(pluginNames(config.plugins)).toEqual([
      "expo-notifications",
      "./plugins/with-notification-service.cjs",
    ]);
    expect(config.plugins?.[0]).toEqual([
      "expo-notifications",
      { mode: "production", enableBackgroundRemoteNotifications: true },
    ]);
    expect(config.extra).toMatchObject({
      keychainAccessGroup: "TEAM123456.com.example.ganger.shared",
      eas: { projectId: "project-1" },
    });
    expect(config.ios?.["entitlements"]).toEqual({
      "keychain-access-groups": ["TEAM123456.com.example.ganger.shared"],
      "com.apple.developer.default-data-protection":
        "NSFileProtectionCompleteUntilFirstUserAuthentication",
    });
  });
});

describe("EAS 개발 빌드(0227)", () => {
  const pushKeys = ["GANGER_EXPO_PROJECT_ID", "GANGER_IOS_BUNDLE_ID", "GANGER_APPLE_TEAM_ID"];
  const easJson = z
    .object({
      cli: z.object({ version: z.string(), appVersionSource: z.literal("remote") }),
      build: z.record(
        z.string(),
        z.object({
          developmentClient: z.boolean().optional(),
          distribution: z.string().optional(),
          environment: z.string().optional(),
          node: z.string().optional(),
          pnpm: z.string().optional(),
          env: z.record(z.string(), z.string()).optional(),
        }),
      ),
    })
    .parse(JSON.parse(readFileSync(join(import.meta.dirname, "eas.json"), "utf8")));
  const development = easJson.build["development"];

  const configWith = (env: Record<string, string>) => {
    const keys = ["GANGER_MOBILE_BUILD", ...pushKeys];
    const before = new Map(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, env);
    try {
      return appConfig({
        config: { name: "Ganger", slug: "ganger", ios: { supportsTablet: false } },
      });
    } finally {
      for (const key of keys) delete process.env[key];
      Object.assign(
        process.env,
        Object.fromEntries(
          [...before].filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
      );
    }
  };

  it("development 프로필은 내부 배포용 개발 클라이언트를 development 환경 변수로 만든다", () => {
    expect(Object.keys(easJson.build)).toEqual(["development"]);
    expect(development).toMatchObject({
      developmentClient: true,
      distribution: "internal",
      environment: "development",
      env: { GANGER_MOBILE_BUILD: "development" },
    });
  });

  it("빌드 서버의 Node 와 pnpm 은 저장소가 쓰는 버전과 같다", () => {
    const nvmrc = readFileSync(join(import.meta.dirname, "..", "..", ".nvmrc"), "utf8").trim();
    const rootPackage = z
      .object({ packageManager: z.string() })
      .parse(
        JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8")),
      );
    expect(development?.node?.split(".")[0]).toBe(nvmrc);
    expect(`pnpm@${development?.pnpm ?? ""}`).toBe(rootPackage.packageManager);
  });

  it("eas.json 에 프로젝트 ID·번들 ID·팀 값을 두지 않는다", () => {
    const stored = readFileSync(join(import.meta.dirname, "eas.json"), "utf8");
    for (const key of pushKeys) expect(stored).not.toContain(key);
    expect(stored).not.toContain("projectId");
  });

  it("세 값이 있으면 개발 빌드에 NSE 타깃·공유 키체인·appExtensions 가 들어간다", () => {
    const config = configWith({
      ...development?.env,
      GANGER_EXPO_PROJECT_ID: "00000000-0000-0000-0000-000000000000",
      GANGER_IOS_BUNDLE_ID: "com.example.ganger",
      GANGER_APPLE_TEAM_ID: "ABCDE12345",
    });
    expect(config.ios?.infoPlist).toEqual({
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    });
    expect(config.ios).toMatchObject({
      bundleIdentifier: "com.example.ganger",
      appleTeamId: "ABCDE12345",
      entitlements: { "keychain-access-groups": ["ABCDE12345.com.example.ganger.shared"] },
    });
    expect(config.plugins).toContainEqual([
      "expo-notifications",
      { mode: "development", enableBackgroundRemoteNotifications: true },
    ]);
    expect(config.plugins).toContainEqual([
      "./plugins/with-notification-service.cjs",
      {
        targetName: "GangerNotificationService",
        bundleIdentifier: "com.example.ganger.notification-service",
        teamId: "ABCDE12345",
        keychainAccessGroup: "ABCDE12345.com.example.ganger.shared",
        allowLocalNetworking: true,
      },
    ]);
    expect(config.extra).toEqual({
      keychainAccessGroup: "ABCDE12345.com.example.ganger.shared",
      eas: {
        projectId: "00000000-0000-0000-0000-000000000000",
        build: {
          experimental: {
            ios: {
              appExtensions: [
                {
                  targetName: "GangerNotificationService",
                  bundleIdentifier: "com.example.ganger.notification-service",
                  entitlements: {
                    "keychain-access-groups": ["ABCDE12345.com.example.ganger.shared"],
                  },
                },
              ],
            },
          },
        },
      },
    });
  });

  it("세 값이 없으면 NSE·키체인·appExtensions 없이 만든다", () => {
    const config = configWith({ ...development?.env });
    expect(config.ios).not.toHaveProperty("entitlements");
    expect(config.ios).not.toHaveProperty("bundleIdentifier");
    expect(config.extra).toEqual({ eas: {} });
    expect(JSON.stringify(config.plugins)).not.toContain("with-notification-service");
  });
});
