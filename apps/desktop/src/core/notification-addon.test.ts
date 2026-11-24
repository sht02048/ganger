import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_ADDON_FILE,
  notificationAddonPath,
  notificationAddonPort,
} from "./notification-addon";

describe("알림 권한 애드온 포트(0211)", () => {
  it("애드온을 읽지 못하거나 모양이 다르면 포트가 없다", () => {
    expect(
      notificationAddonPort(() => {
        throw new Error("missing");
      }),
    ).toBeNull();
    expect(notificationAddonPort(() => ({ status: () => "authorized" }))).toBeNull();
  });

  it("애드온 값을 검증해 모르는 값은 unknown·error 로 바꾼다", async () => {
    const port = notificationAddonPort(() => ({
      status: () => Promise.resolve("ephemeral"),
      request: () => Promise.reject(new Error("no")),
      teamSigned: () => "yes",
      bundleId: () => "",
    }));
    expect(await port?.status()).toBe("unknown");
    expect(await port?.request()).toBe("error");
    expect(port?.teamSigned()).toBe(false);
    expect(port?.bundleId()).toBeNull();
  });

  it("올바른 값은 그대로 넘긴다", async () => {
    const port = notificationAddonPort(() => ({
      status: () => Promise.resolve("not-determined"),
      request: () => Promise.resolve("granted"),
      teamSigned: () => true,
      bundleId: () => "dev.ganger.desktop",
    }));
    expect(await port?.status()).toBe("not-determined");
    expect(await port?.request()).toBe("granted");
    expect(port?.teamSigned()).toBe(true);
    expect(port?.bundleId()).toBe("dev.ganger.desktop");
  });

  it("출시 앱은 Resources 에서, 개발 실행은 dist/native 에서 찾는다", () => {
    expect(notificationAddonPath({ packaged: true, resourcesPath: "/r", appPath: "/a" })).toBe(
      join("/r", NOTIFICATION_ADDON_FILE),
    );
    expect(notificationAddonPath({ packaged: false, resourcesPath: "/r", appPath: "/a" })).toBe(
      join("/a", "dist", "native", NOTIFICATION_ADDON_FILE),
    );
  });
});
