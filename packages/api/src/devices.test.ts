import { describe, expect, it } from "vitest";
import {
  connectRequestSchema,
  connectionQrText,
  isConnectableAddress,
  parseConnectionQr,
} from "./index.js";

describe("기기 연결 QR", () => {
  it("주소와 연결 코드를 그대로 되읽는다", () => {
    const qr = { server: "https://ganger.example.com", code: "abc-_123" };
    expect(parseConnectionQr(connectionQrText(qr))).toEqual(qr);
  });

  it.each([
    "https://ganger.example.com?code=abc",
    "ganger://connect?server=http%3A%2F%2Fganger.example.com&code=abc",
    "ganger://connect?server=https%3A%2F%2Fuser%3Apw%40ganger.example.com&code=abc",
    "ganger://connect?server=https%3A%2F%2Fganger.example.com",
    "ganger://connect?server=https%3A%2F%2Fganger.example.com&code=",
    `ganger://connect?server=https%3A%2F%2Fganger.example.com&code=${"a".repeat(201)}`,
  ])("읽을 수 없는 QR을 거절한다: %s", (text) => {
    expect(parseConnectionQr(text)).toBeNull();
  });

  it.each([null, "", "not a url", "http://ganger.example.com", "https://u:p@example.com"])(
    "https가 아닌 주소로는 연결하지 않는다: %s",
    (address) => {
      expect(isConnectableAddress(address)).toBe(false);
    },
  );
});

describe("연결 요청", () => {
  it("기기 이름의 앞뒤 공백을 지운다", () => {
    expect(connectRequestSchema.parse({ code: "c", name: "  iPhone " }).name).toBe("iPhone");
  });

  it.each(["", "   ", "a".repeat(101), "iPhone\nfake"])("이름을 거절한다: %j", (name) => {
    expect(connectRequestSchema.safeParse({ code: "c", name }).success).toBe(false);
  });
});
