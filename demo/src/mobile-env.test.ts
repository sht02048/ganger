import { describe, expect, it } from "vitest";
import { mobileDevEnv, mobileLaunch } from "./mobile-env.ts";

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

describe("모바일 개발 서버의 실행 대상(0227)", () => {
  it("expo-dev-client 가 있어도 기본은 Expo Go 로 띄운다", () => {
    expect(mobileLaunch(["--reset"])).toEqual({
      serverArgs: ["--reset"],
      expoArgs: ["start", "--go"],
    });
  });

  it("--dev-client 를 주면 개발 빌드로 띄우고 데모 서버에는 넘기지 않는다", () => {
    expect(mobileLaunch(["--dev-client", "--onboarding"])).toEqual({
      serverArgs: ["--onboarding"],
      expoArgs: ["start", "--dev-client"],
    });
  });
});
