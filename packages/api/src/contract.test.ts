import { describe, expect, it } from "vitest";

import { contractFit } from "./contract.js";
import { v1MetaSchema } from "./envelope.js";

const app = { contractVersion: 5, minServerContractVersion: 3 };

describe("계약 호환 범위", () => {
  it.each([
    ["서버가 앱의 최소 계약과 같다", 3, 1, "compatible"],
    ["서버가 앱의 최소 계약보다 하나 낮다", 2, 1, "update-server"],
    ["서버의 최소 앱 계약이 앱과 같다", 9, 5, "compatible"],
    ["서버의 최소 앱 계약이 앱보다 하나 높다", 9, 6, "update-app"],
    ["서버가 더하기만 해 앱보다 앞선다", 9, 1, "compatible"],
  ] as const)("%s", (_name, contractVersion, minClientContractVersion, fit) => {
    expect(contractFit({ contractVersion, minClientContractVersion }, app)).toBe(fit);
  });

  it("범위 규칙 전의 서버 응답은 최소 앱 계약을 1로 읽는다", () => {
    expect(v1MetaSchema.parse({ serverVersion: "0.4.0", contractVersion: 1 })).toEqual({
      serverVersion: "0.4.0",
      contractVersion: 1,
      minClientContractVersion: 1,
    });
  });
});
