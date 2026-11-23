import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  checkBuildOnFailure,
  createServerBuildWatch,
  retryOrReload,
  showsServerBuildNotice,
  watchServerBuild,
} from "./server-build";
import type { BuildCheck } from "./server-build";

function watchWith(fetchBuild: () => Promise<unknown>) {
  return createServerBuildWatch({ clientBuildId: "0.4.0+aaa", fetchBuild });
}

describe("서버 빌드 비교(0180)", () => {
  it("빌드가 같으면 옛 화면이 아니다", async () => {
    const watch = watchWith(() => Promise.resolve({ buildId: "0.4.0+aaa" }));
    await expect(watch.check()).resolves.toBe("same");
    expect(watch.isStale()).toBe(false);
  });

  it("버전이 같아도 빌드가 다르면 옛 화면이고, 알린 뒤에는 다시 묻지 않는다", async () => {
    const fetchBuild = vi.fn<() => Promise<unknown>>(() =>
      Promise.resolve({ buildId: "0.4.0+bbb" }),
    );
    const watch = watchWith(fetchBuild);
    const listener = vi.fn<() => void>();
    watch.subscribe(listener);
    await expect(watch.check()).resolves.toBe("different");
    await expect(watch.check()).resolves.toBe("different");
    expect(watch.isStale()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetchBuild).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["연결 실패", () => Promise.reject(new Error("offline"))],
    ["빌드를 알리지 않는 서버", () => Promise.resolve(null)],
    ["모양이 다른 응답", () => Promise.resolve({ buildId: 1 })],
  ])("%s는 옛 화면으로 판단하지 않는다", async (_name, fetchBuild) => {
    const watch = watchWith(fetchBuild);
    await expect(watch.check()).resolves.toBe("unknown");
    expect(watch.isStale()).toBe(false);
  });

  it("동시에 온 확인은 요청 하나로 묶는다", async () => {
    const fetchBuild = vi.fn<() => Promise<unknown>>(() =>
      Promise.resolve({ buildId: "0.4.0+aaa" }),
    );
    const watch = watchWith(fetchBuild);
    await Promise.all([watch.check(), watch.check()]);
    expect(fetchBuild).toHaveBeenCalledTimes(1);
  });
});

describe("다시 읽기(0180)", () => {
  it.each([
    ["different", 1, 0],
    ["same", 0, 1],
    ["unknown", 0, 1],
  ] as const)(
    "빌드 확인이 %s이면 전체 다시 불러오기 %i번, 질의 다시 읽기 %i번",
    async (result, reloads, retries) => {
      const reload = vi.fn<() => void>();
      const retry = vi.fn<() => void>();
      await retryOrReload({
        check: () => Promise.resolve(result),
        stillOnErrorScreen: () => true,
        reload,
        retry,
        abandon: () => undefined,
      });
      expect(reload).toHaveBeenCalledTimes(reloads);
      expect(retry).toHaveBeenCalledTimes(retries);
    },
  );

  it("확인하는 사이 오류 화면을 떠났으면 다시 불러오지 않는다", async () => {
    const reload = vi.fn<() => void>();
    const retry = vi.fn<() => void>();
    const abandon = vi.fn<() => void>();
    await retryOrReload({
      check: () => Promise.resolve("different"),
      stillOnErrorScreen: () => false,
      reload,
      retry,
      abandon,
    });
    expect(reload).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(abandon).toHaveBeenCalledTimes(1);
  });
});

describe("서버 함수 실패(0180)", () => {
  it("실패하면 빌드를 확인하고 오류는 그대로 던진다", async () => {
    const check = vi.fn<() => Promise<BuildCheck>>(() => Promise.resolve("same"));
    const failure = new Error("gone");
    await expect(checkBuildOnFailure(() => Promise.reject(failure), check)).rejects.toBe(failure);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("성공하면 확인하지 않는다", async () => {
    const check = vi.fn<() => Promise<BuildCheck>>(() => Promise.resolve("same"));
    await expect(checkBuildOnFailure(() => Promise.resolve(1), check)).resolves.toBe(1);
    expect(check).not.toHaveBeenCalled();
  });
});

describe("서버 새 버전 알림 조건(0180)", () => {
  it("옛 화면이고 오류 화면이 아닐 때만 보인다", () => {
    expect(showsServerBuildNotice({ stale: true, errorScreen: false })).toBe(true);
    expect(showsServerBuildNotice({ stale: true, errorScreen: true })).toBe(false);
    expect(showsServerBuildNotice({ stale: false, errorScreen: false })).toBe(false);
  });
});

describe("확인 시점(0180)", () => {
  function setup() {
    const target = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const check = vi.fn<() => Promise<BuildCheck>>(() => Promise.resolve("same"));
    const stop = watchServerBuild({ window: target, document: doc, queryClient }, { check });
    return { target, doc, queryClient, check, stop };
  }

  it("창이 다시 보일 때 확인하고, 숨을 때는 확인하지 않는다", () => {
    const { target, doc, check, stop } = setup();
    target.dispatchEvent(new Event("focus"));
    expect(check).toHaveBeenCalledTimes(1);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(check).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    target.dispatchEvent(new Event("focus"));
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("질의가 실패하면 확인하고, 성공하면 확인하지 않는다", async () => {
    const { queryClient, check, stop } = setup();
    await queryClient.fetchQuery({ queryKey: ["ok"], queryFn: () => 1 });
    expect(check).not.toHaveBeenCalled();
    await queryClient
      .fetchQuery({ queryKey: ["bad"], queryFn: () => Promise.reject(new Error("shape")) })
      .catch(() => undefined);
    expect(check).toHaveBeenCalledTimes(1);
    stop();
  });

  it("변경이 실패해도 확인한다", async () => {
    const { queryClient, check, stop } = setup();
    await queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: () => Promise.reject(new Error("gone")) })
      .execute(undefined)
      .catch(() => undefined);
    expect(check).toHaveBeenCalledTimes(1);
    stop();
  });
});
