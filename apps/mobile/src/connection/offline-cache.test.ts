import type { AppDashboard, AppRunDetail } from "@ganger/api";
import { describe, expect, it } from "vitest";

import { busySnapshot } from "../demo/data";
import { demoRunDetail } from "../runs/run-port";
import {
  CACHED_RUNS_PER_WORKSPACE,
  CACHE_FORMAT_VERSION,
  CACHE_MAX_AGE_MS,
  OfflineCache,
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
  await cache.settled();
  return memory;
}

describe("저장과 읽기", () => {
  it("서버·Workspace별 Dashboard와 런 상세를 다시 읽는다", async () => {
    const { files } = await savedFile();
    const cache = new OfflineCache(files, SERVER, () => NOW);
    const content = await cache.load();
    expect(content.dashboards.get("all")?.fetchedAt).toBe(NOW);
    expect(content.workspaces).toEqual(workspaces);
    expect(cache.cachedRun(detail.id)?.data.id).toBe(detail.id);
  });

  it("다른 서버의 캐시를 읽지 않는다", async () => {
    const { files } = await savedFile();
    const content = await new OfflineCache(files, OTHER_SERVER, () => NOW).load();
    expect(content.dashboards.size).toBe(0);
  });

  it("Workspace마다 최근 런 상세 20개만 남긴다", async () => {
    const memory = memoryFiles();
    const cache = new OfflineCache(memory.files, SERVER, () => NOW);
    for (let index = 0; index <= CACHED_RUNS_PER_WORKSPACE; index += 1) {
      cache.saveRun({ ...detail, id: `run-${index}` }, NOW + index);
    }
    await cache.settled();
    expect(cache.cachedRun("run-0")).toBeNull();
    expect(cache.cachedRun(`run-${CACHED_RUNS_PER_WORKSPACE}`)).not.toBeNull();
  });

  it("읽기 전에 저장해도 파일의 다른 Workspace 내용을 잃지 않는다", async () => {
    const { files, saved } = await savedFile();
    const cache = new OfflineCache(files, SERVER, () => NOW);
    cache.saveDashboard("ws-payments", dashboard, NOW, workspaces);
    await cache.settled();
    const reread = await new OfflineCache(files, SERVER, () => NOW).load();
    expect([...reread.dashboards.keys()].sort()).toEqual(["all", "ws-payments"]);
    expect(saved.size).toBe(1);
  });

  it("모르는 상태 값은 저장한 뒤 다시 읽어도 unknown으로 남는다", async () => {
    const memory = memoryFiles();
    const unknownRun = { ...detail, state: "unknown" as const, nextStep: "unknown" as const };
    const writer = new OfflineCache(memory.files, SERVER, () => NOW);
    writer.saveRun(unknownRun, NOW);
    await writer.settled();
    const reader = new OfflineCache(memory.files, SERVER, () => NOW);
    await reader.load();
    expect(reader.cachedRun(detail.id)?.data.state).toBe("unknown");
  });
});

describe("버리는 캐시", () => {
  it("손상된 파일은 버리고 지운다", async () => {
    const memory = memoryFiles({ [SERVER]: "{broken" });
    const content = await new OfflineCache(memory.files, SERVER, () => NOW).load();
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
    const content = await new OfflineCache(files, SERVER, () => NOW).load();
    expect(content.dashboards.size).toBe(0);
    expect(saved.has(SERVER)).toBe(false);
  });

  it("정확히 7일이면 보이고 7일을 넘으면 버린다", async () => {
    const { files } = await savedFile();
    const atLimit = await new OfflineCache(files, SERVER, () => NOW + CACHE_MAX_AGE_MS).load();
    expect(atLimit.dashboards.size).toBe(1);
    const past = await new OfflineCache(files, SERVER, () => NOW + CACHE_MAX_AGE_MS + 1).load();
    expect(past.dashboards.size).toBe(0);
  });

  it("저장 시각이 미래면 버린다", async () => {
    const { files } = await savedFile();
    const content = await new OfflineCache(files, SERVER, () => NOW - 1).load();
    expect(content.dashboards.size).toBe(0);
  });

  it("계약 검증에 실패한 항목만 버린다", async () => {
    const { saved, files } = await savedFile();
    const file: unknown = JSON.parse(saved.get(SERVER) ?? "null");
    const broken = JSON.stringify(file).replace('"columns":', '"notColumns":');
    saved.set(SERVER, broken);
    const cache = new OfflineCache(files, SERVER, () => NOW);
    const content = await cache.load();
    expect(content.dashboards.size).toBe(0);
    expect(cache.cachedRun(detail.id)?.data.id).toBe(detail.id);
  });
});

describe("메모리에 남은 런 상세", () => {
  it("앱이 7일 넘게 켜져 있으면 보이지 않는다", async () => {
    const { files } = await savedFile();
    let now = NOW;
    const cache = new OfflineCache(files, SERVER, () => now);
    await cache.load();
    now = NOW + CACHE_MAX_AGE_MS + 1;
    expect(cache.cachedRun(detail.id)).toBeNull();
  });
});

describe("지우기", () => {
  it("지운 뒤에는 늦게 온 저장이 파일을 되살리지 않는다", async () => {
    const memory = await savedFile();
    const cache = new OfflineCache(memory.files, SERVER, () => NOW);
    await cache.load();
    cache.saveDashboard("all", dashboard, NOW, workspaces);
    await cache.clear();
    cache.saveRun(detail, NOW);
    await cache.settled();
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
