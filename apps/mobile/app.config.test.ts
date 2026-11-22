import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import appConfig, { buildVariantOf, iosInfoPlist } from "./app.config";

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
    expect(configFor("development").ios.infoPlist).toEqual({
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    });
  });

  it.each([undefined, "", "release", "production", "Development"])(
    "빌드 값이 %j이면 출시 설정이라 ATS 예외가 없다",
    (value) => {
      expect(buildVariantOf(value)).toBe("release");
      expect(configFor(value).ios.infoPlist).toEqual({
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
