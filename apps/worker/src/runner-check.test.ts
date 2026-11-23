import { listRunners } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_USAGE_INTERVAL_MS, RUNNER_CHECK_INTERVAL_MS } from "./runner-check.js";
import { Harness, projectA } from "./test-fixtures.js";

const claudeAt = (usedPercent: number) => ({
  kind: "read" as const,
  providers: [
    {
      provider: "claude",
      status: "ok" as const,
      windows: [{ kind: "session" as const, usedPercent, resetsAt: new Date(9_000_000) }],
    },
  ],
});

describe("러너 점검의 공급자 사용량(0086)", () => {
  let h: Harness;
  beforeEach(() => {
    h = new Harness();
  });
  afterEach(() => h.cleanup());

  function storedRunner() {
    const runner = listRunners(h.db)[0];
    if (runner === undefined) throw new Error("no runner");
    return runner;
  }

  it("점검이 사용량을 읽어 읽은 시각과 함께 저장한다", async () => {
    const id = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.runner(id).providerUsage = claudeAt(72);
    const worker = h.worker();
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(storedRunner().providerUsage).toEqual({ readAt: h.now, reading: claudeAt(72) });
  });

  it("부하를 사용량과 같은 주기에 읽고 CPU 가 5분 넘게 높은 시작 시각을 이어 간다", async () => {
    const id = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const reading = {
      kind: "read" as const,
      cpu: { percent: 95, loadAverage: 9.5, cores: 10 },
      memory: null,
      gpu: null,
    };
    h.runner(id).load = reading;
    const combined = vi.spyOn(h.runner(id), "readUsageAndLoad");
    const worker = h.worker();
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    const startedAt = h.now;
    expect(storedRunner().load).toEqual({ readAt: h.now, cpuHighSince: h.now, reading });

    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(combined).toHaveBeenCalledTimes(1);

    h.advance(PROVIDER_USAGE_INTERVAL_MS);
    await worker.tick();
    expect(combined).toHaveBeenCalledTimes(2);
    expect(storedRunner().load).toEqual({ readAt: h.now, cpuHighSince: startedAt, reading });

    h.runner(id).load = { ...reading, cpu: { ...reading.cpu, percent: 40 } };
    h.advance(PROVIDER_USAGE_INTERVAL_MS);
    await worker.tick();
    expect(storedRunner().load?.cpuHighSince).toBeNull();
  });

  it("gh 계정을 사용량과 같은 주기에 읽어 계정 이름만 저장한다", async () => {
    const id = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const reading = {
      kind: "logged-in" as const,
      accounts: [
        { host: "github.com", login: "acme-bot", active: true },
        { host: "github.com", login: "acme-ci", active: false },
      ],
    };
    h.runner(id).ghAccounts = Object.assign({ token: "gho_FAKE" }, reading);
    const worker = h.worker();
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(storedRunner().ghAccounts).toEqual({ readAt: h.now, reading });

    h.runner(id).ghAccounts = { kind: "logged-out" };
    h.advance(PROVIDER_USAGE_INTERVAL_MS);
    await worker.tick();
    expect(storedRunner().ghAccounts).toEqual({ readAt: h.now, reading: { kind: "logged-out" } });
  });

  it("사용량은 몇 분에 한 번만 다시 읽는다", async () => {
    const id = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const read = vi.spyOn(h.runner(id), "readProviderUsage");
    const worker = h.worker();
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    const firstReadAt = h.now;
    expect(read).toHaveBeenCalledTimes(1);

    h.runner(id).providerUsage = claudeAt(95);
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(read).toHaveBeenCalledTimes(1);
    expect(storedRunner().providerUsage?.readAt).toEqual(firstReadAt);

    h.advance(PROVIDER_USAGE_INTERVAL_MS);
    await worker.tick();
    expect(read).toHaveBeenCalledTimes(2);
    expect(storedRunner().providerUsage).toEqual({ readAt: h.now, reading: claudeAt(95) });
  });

  it("사용량을 읽지 못해도 러너 상태와 점검 결과는 바뀌지 않는다", async () => {
    const id = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    vi.spyOn(h.runner(id), "readProviderUsage").mockRejectedValue(new Error("ssh hiccup"));
    const worker = h.worker();
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    const runner = storedRunner();
    expect(runner).toMatchObject({
      online: true,
      assignmentBlocked: false,
      checkedAt: h.now,
      checkError: null,
      providerUsage: null,
    });
    expect(h.warnings.map((w) => w.message)).toContain("could not read runner provider usage");
  });

  it("읽을 수 없었다는 결과는 그대로 저장하고 러너는 Online 이다", async () => {
    const id = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.runner(id).providerUsage = { kind: "unreadable" };
    const worker = h.worker();
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(storedRunner()).toMatchObject({
      online: true,
      providerUsage: { readAt: h.now, reading: { kind: "unreadable" } },
    });
  });

  it("Offline 러너는 사용량을 묻지 않고 전에 읽은 값을 남긴다", async () => {
    const id = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.runner(id).providerUsage = claudeAt(40);
    const worker = h.worker();
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    const readAt = h.now;

    h.runner(id).online = false;
    const read = vi.spyOn(h.runner(id), "readProviderUsage");
    h.advance(PROVIDER_USAGE_INTERVAL_MS);
    await worker.tick();
    expect(read).not.toHaveBeenCalled();
    expect(storedRunner()).toMatchObject({
      online: false,
      providerUsage: { readAt, reading: claudeAt(40) },
    });
  });
});
