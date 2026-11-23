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
  });
});
