import { appDashboardSchema, appRunDetailSchema } from "@ganger/api";
import type { AppDashboard, AppRunDetail } from "@ganger/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import { busySnapshot } from "../demo/data";
import { demoRunDetail } from "../runs/run-port";
import {
  CACHED_RUNS_PER_WORKSPACE,
  CACHE_FORMAT_VERSION,
  CACHE_MAX_AGE_MS,
  CACHE_WRITE_INTERVAL_MS,
  OfflineCache,
  readCacheText,
} from "./offline-cache";
import type { CacheFiles } from "./offline-cache";

const NOW = Date.parse("2026-11-23T03:00:00.000Z");
const SERVER = "https://ganger.example.com";
const OTHER_SERVER = "https://other.example.com";
const snapshot = busySnapshot(new Date(NOW));
const dashboard: AppDashboard = snapshot.dashboardFor("all");
const firstRun = [
  ...dashboard.columns.queued,
  ...dashboard.columns.running.todo,
  ...dashboard.columns.running.rest,
][0];
if (firstRun === undefined) throw new Error("demo data has no run");
const detail: AppRunDetail = demoRunDetail(firstRun);
const workspaces = [{ id: "ws-payments", name: "Payments" }];

function memoryFiles(initial: Record<string, string> = {}) {
  const saved = new Map(Object.entries(initial));
  const files: CacheFiles = {
    read: (server) => Promise.resolve(saved.get(server) ?? null),
    write: (server, text) => {
      saved.set(server, text);
      return Promise.resolve();
    },
    remove: (server) => {
      saved.delete(server);
      return Promise.resolve();
    },
    removeAll: () => {
      saved.clear();
      return Promise.resolve();
    },
  };
  return { files, saved };
}

async function savedFile(fetchedAt = NOW) {
  const memory = memoryFiles();
  const cache = new OfflineCache(memory.files, SERVER, () => fetchedAt);
  cache.saveDashboard("all", dashboard, fetchedAt, workspaces);
  cache.saveRun(detail, fetchedAt);
  await cache.flush();
  return memory;
}

describe("저장과 읽기", () => {
  it("서버·Workspace별 Dashboard와 런 상세를 다시 읽는다", async () => {
    const { files } = await savedFile();
    const cache = new OfflineCache(files, SERVER, () => NOW);
    const content = await cache.load("all");
    expect(content.dashboards.get("all")?.fetchedAt).toBe(NOW);
    expect(content.workspaces).toEqual(workspaces);
    expect(cache.cachedRun(detail.id)?.data.id).toBe(detail.id);
  });

  it("다른 서버의 캐시를 읽지 않는다", async () => {
    const { files } = await savedFile();
    const content = await new OfflineCache(files, OTHER_SERVER, () => NOW).load("all");
    expect(content.dashboards.size).toBe(0);
  });

  it("Workspace마다 최근 런 상세 20개만 남긴다", async () => {
    const memory = memoryFiles();
    const cache = new OfflineCache(memory.files, SERVER, () => NOW);
    for (let index = 0; index <= CACHED_RUNS_PER_WORKSPACE; index += 1) {
      cache.saveRun({ ...detail, id: `run-${index}` }, NOW + index);
    }
    await cache.flush();
    expect(cache.cachedRun("run-0")).toBeNull();
    expect(cache.cachedRun(`run-${CACHED_RUNS_PER_WORKSPACE}`)).not.toBeNull();
  });

  it("읽기 전에 저장해도 파일의 다른 Workspace 내용을 잃지 않는다", async () => {
    const { files, saved } = await savedFile();
    const cache = new OfflineCache(files, SERVER, () => NOW);
    cache.saveDashboard("ws-payments", dashboard, NOW, workspaces);
    await cache.flush();
    const reread = new OfflineCache(files, SERVER, () => NOW);
    expect([...(await reread.load("all")).dashboards.keys()]).toEqual(["all"]);
    expect([...reread.contentFor("ws-payments").dashboards.keys()]).toEqual(["ws-payments"]);
    expect(saved.size).toBe(1);
  });

  it("모르는 상태 값은 저장한 뒤 다시 읽어도 unknown으로 남는다", async () => {
    const memory = memoryFiles();
    const unknownRun = { ...detail, state: "unknown" as const, nextStep: "unknown" as const };
    const writer = new OfflineCache(memory.files, SERVER, () => NOW);
    writer.saveRun(unknownRun, NOW);
    await writer.flush();
    const reader = new OfflineCache(memory.files, SERVER, () => NOW);
    await reader.load("all");
    expect(reader.cachedRun(detail.id)?.data.state).toBe("unknown");
  });
});

describe("버리는 캐시", () => {
  it("손상된 파일은 버리고 지운다", async () => {
    const memory = memoryFiles({ [SERVER]: "{broken" });
    const content = await new OfflineCache(memory.files, SERVER, () => NOW).load("all");
    expect(content.dashboards.size).toBe(0);
    expect(memory.saved.has(SERVER)).toBe(false);
  });

  it("형식 버전이 다르면 버리고 지운다", async () => {
    const { saved, files } = await savedFile();
    const text = saved.get(SERVER) ?? "";
    saved.set(
      SERVER,
      text.replace(`"version":${CACHE_FORMAT_VERSION}`, `"version":${CACHE_FORMAT_VERSION + 1}`),
    );
    const content = await new OfflineCache(files, SERVER, () => NOW).load("all");
    expect(content.dashboards.size).toBe(0);
    expect(saved.has(SERVER)).toBe(false);
  });

  it("정확히 7일이면 보이고 7일을 넘으면 버린다", async () => {
    const { files } = await savedFile();
    const atLimit = await new OfflineCache(files, SERVER, () => NOW + CACHE_MAX_AGE_MS).load("all");
    expect(atLimit.dashboards.size).toBe(1);
    const past = await new OfflineCache(files, SERVER, () => NOW + CACHE_MAX_AGE_MS + 1).load(
      "all",
    );
    expect(past.dashboards.size).toBe(0);
  });

  it("저장 시각이 미래면 버린다", async () => {
    const { files } = await savedFile();
    const content = await new OfflineCache(files, SERVER, () => NOW - 1).load("all");
    expect(content.dashboards.size).toBe(0);
  });

  it("계약 검증에 실패한 항목만 버린다", async () => {
    const { saved, files } = await savedFile();
    const file: unknown = JSON.parse(saved.get(SERVER) ?? "null");
    const broken = JSON.stringify(file).replace('"columns":', '"notColumns":');
    saved.set(SERVER, broken);
    const cache = new OfflineCache(files, SERVER, () => NOW);
    const content = await cache.load("all");
    expect(content.dashboards.size).toBe(0);
    expect(cache.cachedRun(detail.id)?.data.id).toBe(detail.id);
  });
});

describe("글자로 풀 수 없는 파일", () => {
  const undecodable = () => Promise.reject(new Error("invalid UTF-8"));

  it("바이트는 읽히면 손상으로 보고 버린 뒤 다시 저장한다", async () => {
    const memory = memoryFiles({ [SERVER]: "broken" });
    const files: CacheFiles = {
      ...memory.files,
      read: () =>
        readCacheText({ text: undecodable, bytes: () => Promise.resolve(new Uint8Array([255])) }),
    };
    const cache = new OfflineCache(files, SERVER, () => NOW);
    expect((await cache.load("all")).dashboards.size).toBe(0);
    expect(memory.saved.has(SERVER)).toBe(false);
    cache.saveDashboard("all", dashboard, NOW, workspaces);
    await cache.flush();
    expect(memory.saved.has(SERVER)).toBe(true);
  });

  it("바이트도 읽지 못하면 잠긴 파일로 보고 실패를 그대로 알린다", async () => {
    await expect(
      readCacheText({ text: undecodable, bytes: () => Promise.reject(new Error("locked")) }),
    ).rejects.toThrow("locked");
  });
});

describe("파일을 읽지 못했을 때", () => {
  it("저장으로 기존 파일을 덮어쓰지 않는다", async () => {
    const memory = await savedFile();
    const before = memory.saved.get(SERVER);
    const files: CacheFiles = {
      ...memory.files,
      read: () => Promise.reject(new Error("protected data unavailable")),
    };
    const cache = new OfflineCache(files, SERVER, () => NOW);
    cache.saveDashboard("ws-payments", dashboard, NOW, workspaces);
    await cache.flush();
    expect(memory.saved.get(SERVER)).toBe(before);
  });
});

describe("메모리에 남은 런 상세", () => {
  it("앱이 7일 넘게 켜져 있으면 보이지 않는다", async () => {
    const { files } = await savedFile();
    let now = NOW;
    const cache = new OfflineCache(files, SERVER, () => now);
    await cache.load("all");
    now = NOW + CACHE_MAX_AGE_MS + 1;
    expect(cache.cachedRun(detail.id)).toBeNull();
  });
});

describe("지우기", () => {
  it("지운 뒤에는 늦게 온 저장이 파일을 되살리지 않는다", async () => {
    const memory = await savedFile();
    const cache = new OfflineCache(memory.files, SERVER, () => NOW);
    await cache.load("all");
    cache.saveDashboard("all", dashboard, NOW, workspaces);
    await cache.clear();
    cache.saveRun(detail, NOW);
    await cache.flush();
    expect(memory.saved.has(SERVER)).toBe(false);
    expect(cache.cachedRun(detail.id)).toBeNull();
  });

  it("다른 서버의 파일은 남긴다", async () => {
    const memory = await savedFile();
    memory.saved.set(OTHER_SERVER, "kept");
    await new OfflineCache(memory.files, SERVER, () => NOW).clear();
    expect(memory.saved.has(SERVER)).toBe(false);
    expect(memory.saved.get(OTHER_SERVER)).toBe("kept");
  });
});

describe("쓰기 묶기(티켓 0224)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function countingFiles() {
    const memory = memoryFiles();
    let writes = 0;
    const files: CacheFiles = {
      ...memory.files,
      write: (server, text) => {
        writes += 1;
        return memory.files.write(server, text);
      },
    };
    return { files, saved: memory.saved, writes: () => writes };
  }

  it("바뀐 내용은 처음엔 바로 쓰고, 30초 안에 또 바뀌면 30초가 지날 때 한 번만 쓴다", async () => {
    vi.useFakeTimers({ now: NOW });
    const counted = countingFiles();
    const cache = new OfflineCache(counted.files, SERVER, () => Date.now());
    cache.saveDashboard("all", dashboard, Date.now(), workspaces);
    await vi.advanceTimersByTimeAsync(0);
    expect(counted.writes()).toBe(1);

    for (let index = 1; index <= 5; index += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      cache.saveDashboard("all", dashboard, Date.now(), workspaces);
    }
    await vi.advanceTimersByTimeAsync(CACHE_WRITE_INTERVAL_MS - 6_000);
    expect(counted.writes()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(counted.writes()).toBe(2);
    await vi.advanceTimersByTimeAsync(CACHE_WRITE_INTERVAL_MS * 3);
    expect(counted.writes()).toBe(2);
  });

  it("같은 내용을 다시 받은 것은 받은 때만 고쳐 두고, 백그라운드로 갈 때 쓴다", async () => {
    vi.useFakeTimers({ now: NOW });
    const counted = countingFiles();
    const cache = new OfflineCache(counted.files, SERVER, () => Date.now());
    cache.saveDashboard("all", dashboard, NOW, workspaces);
    await vi.advanceTimersByTimeAsync(0);
    cache.confirmDashboard("all", NOW + 90_000);
    await vi.advanceTimersByTimeAsync(CACHE_WRITE_INTERVAL_MS * 4);
    expect(counted.writes()).toBe(1);

    await cache.flush();
    expect(counted.writes()).toBe(2);
    const reread = await new OfflineCache(counted.files, SERVER, () => NOW + 90_000).load("all");
    expect(reread.dashboards.get("all")?.fetchedAt).toBe(NOW + 90_000);
    await cache.flush();
    expect(counted.writes()).toBe(2);
  });

  it("백그라운드로 갈 때는 기다리던 쓰기를 바로 한다", async () => {
    vi.useFakeTimers({ now: NOW });
    const counted = countingFiles();
    const cache = new OfflineCache(counted.files, SERVER, () => Date.now());
    cache.saveDashboard("all", dashboard, NOW, workspaces);
    await vi.advanceTimersByTimeAsync(0);
    cache.saveRun(detail, NOW);
    await cache.flush();
    expect(counted.writes()).toBe(2);
    await vi.advanceTimersByTimeAsync(CACHE_WRITE_INTERVAL_MS);
    expect(counted.writes()).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("지연 파싱(티켓 0226)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function fileWithTwoWorkspaces() {
    const memory = memoryFiles();
    const writer = new OfflineCache(memory.files, SERVER, () => NOW);
    writer.saveDashboard("all", dashboard, NOW, workspaces);
    writer.saveDashboard("ws-payments", dashboard, NOW, workspaces);
    writer.saveRun(detail, NOW);
    writer.saveRun({ ...detail, id: "run-other" }, NOW);
    await writer.flush();
    return memory;
  }

  it("처음 읽을 때는 보는 Workspace 대시보드만 계약으로 파싱한다", async () => {
    const { files } = await fileWithTwoWorkspaces();
    const dashboardParses = vi.spyOn(appDashboardSchema, "safeParse");
    const runParses = vi.spyOn(appRunDetailSchema, "safeParse");
    const cache = new OfflineCache(files, SERVER, () => NOW);
    const content = await cache.load("all");
    expect([...content.dashboards.keys()]).toEqual(["all"]);
    expect(content.workspaces).toEqual(workspaces);
    expect(dashboardParses).toHaveBeenCalledTimes(1);
    expect(runParses).not.toHaveBeenCalled();
  });

  it("다른 Workspace 대시보드는 그 Workspace를 볼 때 한 번만 파싱한다", async () => {
    const { files } = await fileWithTwoWorkspaces();
    const cache = new OfflineCache(files, SERVER, () => NOW);
    await cache.load("all");
    const dashboardParses = vi.spyOn(appDashboardSchema, "safeParse");
    expect(cache.contentFor("ws-payments").dashboards.get("ws-payments")?.fetchedAt).toBe(NOW);
    expect(cache.contentFor("ws-payments").dashboards.size).toBe(1);
    expect(dashboardParses).toHaveBeenCalledTimes(1);
  });

  it("런 상세는 열 때 그 런만 한 번 파싱한다", async () => {
    const { files } = await fileWithTwoWorkspaces();
    const cache = new OfflineCache(files, SERVER, () => NOW);
    await cache.load("all");
    const runParses = vi.spyOn(appRunDetailSchema, "safeParse");
    expect(cache.cachedRun(detail.id)?.data.id).toBe(detail.id);
    expect(cache.cachedRun(detail.id)?.data.id).toBe(detail.id);
    expect(runParses).toHaveBeenCalledTimes(1);
  });

  it("파싱하지 않은 항목도 다시 쓸 때 그대로 남는다", async () => {
    const memory = await fileWithTwoWorkspaces();
    const cache = new OfflineCache(memory.files, SERVER, () => NOW);
    await cache.load("all");
    cache.saveDashboard("all", dashboard, NOW + 1, workspaces);
    await cache.flush();
    const reread = new OfflineCache(memory.files, SERVER, () => NOW + 1);
    await reread.load("all");
    expect(reread.contentFor("ws-payments").dashboards.size).toBe(1);
    expect(reread.cachedRun("run-other")?.data.id).toBe("run-other");
  });

  it("계약에 맞지 않는 런 상세는 열 때 버린다", async () => {
    const { saved, files } = await fileWithTwoWorkspaces();
    saved.set(SERVER, (saved.get(SERVER) ?? "").replaceAll('"workspace":', '"notWorkspace":'));
    const cache = new OfflineCache(files, SERVER, () => NOW);
    await cache.load("all");
    expect(cache.cachedRun(detail.id)).toBeNull();
    expect(cache.cachedRun(detail.id)).toBeNull();
  });
});
