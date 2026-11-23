import { describe, expect, it } from "vitest";

import { devConnectionFrom } from "./dev-connection";

const LOCAL = { server: "http://127.0.0.1:3000", token: "dev-token" };

describe("개발 연결(M45, M46)", () => {
  it("개발 빌드는 환경 변수의 dev 서버에 QR 없이 연결한다", () => {
    expect(devConnectionFrom(true, LOCAL)).toEqual(LOCAL);
  });

  it("제품 빌드에서는 환경 변수가 있어도 이 길이 꺼진다", () => {
    expect(devConnectionFrom(false, LOCAL)).toBeNull();
  });

  it("실기기 개발 빌드는 HTTPS 주소로 붙는다", () => {
    expect(
      devConnectionFrom(true, { server: "https://dev.example.com/", token: "t" })?.server,
    ).toBe("https://dev.example.com");
  });

  it.each([
    "http://192.168.0.10:3000",
    "http://dev.example.com",
    "https://user:pw@dev.example.com",
    "ftp://127.0.0.1",
    "not a url",
  ])("LAN IP·평문 원격 같은 주소 %s는 쓰지 않는다", (server) => {
    expect(devConnectionFrom(true, { server, token: "t" })).toBeNull();
  });

  it("주소나 토큰이 비면 연결 화면으로 간다", () => {
    expect(devConnectionFrom(true, { server: undefined, token: "t" })).toBeNull();
    expect(devConnectionFrom(true, { server: LOCAL.server, token: "" })).toBeNull();
  });
});
