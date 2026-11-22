import { describe, expect, it } from "vitest";
import { mobileDevEnv } from "./mobile-env.ts";

const server = { url: "http://127.0.0.1:3000", token: "dev-token" };

describe("모바일 개발 환경 변수", () => {
  it("개발 빌드로 표시하고 dev 서버와 개발용 토큰을 넘긴다", () => {
    expect(mobileDevEnv({ PATH: "/bin" }, server)).toEqual({
      PATH: "/bin",
      GANGER_MOBILE_BUILD: "development",
      EXPO_PUBLIC_GANGER_DEV_SERVER: "http://127.0.0.1:3000",
      EXPO_PUBLIC_GANGER_DEV_TOKEN: "dev-token",
    });
  });

  it("실기기용 HTTPS 주소를 받으면 그 주소로 붙는다", () => {
    const env = mobileDevEnv({ GANGER_MOBILE_DEV_SERVER: "https://dev.example.com" }, server);
    expect(env["EXPO_PUBLIC_GANGER_DEV_SERVER"]).toBe("https://dev.example.com");
  });
});
