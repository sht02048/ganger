import { describe, expect, it, vi } from "vitest";
import {
  FOCUS_SETTINGS_URL,
  NotificationAccess,
  SYSTEM_NOTIFICATION_SETTINGS_URL,
  buildSigned,
  notificationCenterReady,
  permissionFromNative,
  shouldRequestOnEnable,
} from "./notification-access";
import type { NativeAuthorization, NativeRequestResult } from "./notification-addon";
import type { NotificationPermissionPort } from "./notification-addon";

function fakePort(
  start: NativeAuthorization,
  options: { onRequest?: NativeAuthorization; requestResult?: NativeRequestResult } = {},
) {
  let status = start;
  const port = {
    status: vi.fn<() => Promise<NativeAuthorization>>(() => Promise.resolve(status)),
    request: vi.fn<() => Promise<NativeRequestResult>>(() => {
      if (options.onRequest !== undefined) status = options.onRequest;
      return Promise.resolve(options.requestResult ?? "granted");
    }),
    teamSigned: () => true,
  } satisfies NotificationPermissionPort;
  return {
    port,
    setStatus: (next: NativeAuthorization) => {
      status = next;
    },
  };
}

function access(port: NotificationPermissionPort | null, signed: boolean | null = true) {
  const changes: string[] = [];
  const value = new NotificationAccess({
    port,
    signed,
    onChange: (permission) => changes.push(permission),
  });
  return { access: value, changes };
}

describe("macOS 알림 권한 읽기(0211)", () => {
  it("UNAuthorizationStatus 를 화면의 네 상태로 바꾼다", () => {
    expect(permissionFromNative("authorized")).toBe("allowed");
    expect(permissionFromNative("provisional")).toBe("allowed");
    expect(permissionFromNative("not-determined")).toBe("not-asked");
    expect(permissionFromNative("denied")).toBe("denied");
    expect(permissionFromNative("unknown")).toBe("unknown");
  });

  it("다시 읽어 상태가 바뀔 때만 알린다", async () => {
    const fake = fakePort("denied");
    const { access: subject, changes } = access(fake.port);
    expect(await subject.refresh()).toBe("denied");
    await subject.refresh();
    fake.setStatus("authorized");
    expect(await subject.refresh()).toBe("allowed");
    expect(changes).toEqual(["denied", "allowed"]);
  });
});

describe("권한 묻는 시점(0211 결정 3)", () => {
  it("권한을 읽기 전과 아직 묻지 않았을 때는 알림 센터를 쓰지 않고, 스스로 묻지 않는다", async () => {
    const fake = fakePort("not-determined");
    const { access: subject } = access(fake.port);
    expect(subject.mayUseNotificationCenter()).toBe(false);
    await subject.refresh();
    expect(subject.mayUseNotificationCenter()).toBe(false);
    subject.observe("failed");
    await subject.refresh();
    expect(fake.port.request).not.toHaveBeenCalled();
  });

  it("시작 경로는 권한을 읽기 전·묻기 전에 Notification.isSupported 를 부르지 않는다", async () => {
    const isSupported = vi.fn<() => boolean>(() => true);
    const { access: subject } = access(fakePort("not-determined").port);
    expect(notificationCenterReady(subject, isSupported)).toBe(false);
    await subject.refresh();
    expect(notificationCenterReady(subject, isSupported)).toBe(false);
    expect(isSupported).not.toHaveBeenCalled();
    const allowed = access(fakePort("authorized").port).access;
    await allowed.refresh();
    expect(notificationCenterReady(allowed, isSupported)).toBe(true);
    expect(isSupported).toHaveBeenCalledTimes(1);
  });

  it("허용했거나 꺼졌으면 알림 센터를 써도 macOS 가 묻지 않으니 쓴다", async () => {
    for (const status of ["authorized", "denied"] as const) {
      const { access: subject } = access(fakePort(status).port);
      await subject.refresh();
      expect(subject.mayUseNotificationCenter()).toBe(true);
    }
  });

  it("권한을 읽을 수 없는 빌드(애드온 없음)는 전처럼 알림 센터를 쓴다", () => {
    expect(access(null).access.mayUseNotificationCenter()).toBe(true);
  });

  it("허용하기를 누르면 macOS 에 묻고 다시 읽은 결과를 돌려준다", async () => {
    const fake = fakePort("not-determined", { onRequest: "authorized" });
    const { access: subject } = access(fake.port);
    await subject.refresh();
    expect(await subject.request()).toBe("allowed");
    expect(fake.port.request).toHaveBeenCalledTimes(1);
    expect(subject.permission).toBe("allowed");
    expect(subject.mayUseNotificationCenter()).toBe(true);
  });

  it("거절하면 꺼짐으로, 서명하지 않은 빌드의 오류는 서명 문제로 돌려준다", async () => {
    const refused = access(
      fakePort("not-determined", { onRequest: "denied", requestResult: "refused" }).port,
    );
    expect(await refused.access.request()).toBe("not-allowed");
    expect(refused.access.permission).toBe("denied");
    const unsigned = access(fakePort("not-determined", { requestResult: "error" }).port, false);
    expect(await unsigned.access.request()).toBe("unsigned");
    expect(unsigned.access.permission).toBe("not-asked");
  });

  it("알림 받기를 처음 켤 때 아직 묻지 않았으면 묻는다", () => {
    expect(shouldRequestOnEnable(false, true, "not-asked")).toBe(true);
    expect(shouldRequestOnEnable(true, true, "not-asked")).toBe(false);
    expect(shouldRequestOnEnable(false, true, "allowed")).toBe(false);
    expect(shouldRequestOnEnable(false, true, "denied")).toBe(false);
    expect(shouldRequestOnEnable(true, false, "not-asked")).toBe(false);
  });
});

describe("시험 알림(0211 결정 2)", () => {
  it("보였으면 sent 다", async () => {
    const { access: subject } = access(fakePort("authorized").port);
    expect(await subject.sendTest(({ onShow }) => onShow())).toBe("sent");
  });

  it("아무 소식이 없으면 기다린 뒤 sent 로 보고 확인 순서를 안내한다", async () => {
    const { access: subject } = access(fakePort("authorized").port);
    expect(await subject.sendTest(() => undefined, 5)).toBe("sent");
  });

  it("서명하지 않은 빌드에서 실패하면 서명 문제다", async () => {
    const { access: subject } = access(fakePort("not-determined").port, false);
    expect(await subject.sendTest(({ onFailed }) => onFailed())).toBe("unsigned");
  });

  it("서명한 빌드에서 실패하고 권한이 꺼졌으면 권한 문제다", async () => {
    const fake = fakePort("authorized");
    const { access: subject } = access(fake.port);
    await subject.refresh();
    expect(
      await subject.sendTest(({ onFailed }) => {
        fake.setStatus("denied");
        onFailed();
      }),
    ).toBe("denied");
    expect(subject.permission).toBe("denied");
  });

  it("서명했고 권한도 켜졌는데 실패하면 그냥 실패다", async () => {
    const { access: subject } = access(fakePort("authorized").port);
    expect(await subject.sendTest(({ onFailed }) => onFailed())).toBe("failed");
    expect(
      await subject.sendTest(() => {
        throw new Error("boom");
      }),
    ).toBe("failed");
  });

  it("애드온이 없는 빌드에서 보이면 허용으로 짐작한다", async () => {
    const { access: subject, changes } = access(null, null);
    await subject.sendTest(({ onShow }) => onShow());
    expect(changes).toEqual(["allowed"]);
  });
});

describe("서명과 시스템 설정 링크(0211 결정 4)", () => {
  it("서명 여부는 애드온이 읽고, 애드온이 없으면 개발 빌드는 서명하지 않은 것으로 본다", () => {
    expect(buildSigned(fakePort("authorized").port, true)).toBe(true);
    expect(buildSigned(null, false)).toBe(false);
    expect(buildSigned(null, true)).toBeNull();
  });

  it("앱을 미리 고르는 ?id= 는 확인하지 못해 쓰지 않고 알림 설정과 집중 모드 설정을 연다", () => {
    expect(SYSTEM_NOTIFICATION_SETTINGS_URL).toBe(
      "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
    );
    expect(FOCUS_SETTINGS_URL).toBe("x-apple.systempreferences:com.apple.Focus-Settings.extension");
  });
});
