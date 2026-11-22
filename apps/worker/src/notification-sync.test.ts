import { syncNotifications } from "@ganger/app/notifications/sync";
import type { RunnerId } from "@ganger/core";
import { listNotificationChanges, listOpenNotificationEvents, recordRunnerCheck } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Harness, projectA } from "./test-fixtures.js";

vi.mock("@ganger/app/notifications/sync", { spy: true });

describe("worker 의 알림 사건 동기화(M43)", () => {
  let h: Harness;
  beforeEach(() => {
    h = new Harness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  function reportAuth(runnerId: RunnerId, assignmentBlocked: boolean): void {
    recordRunnerCheck(h.db, {
      runnerId,
      online: true,
      checkedAt: h.now,
      error: null,
      projects: null,
      assignmentBlocked,
    });
  }

  it("붙은 클라이언트가 없어도 사건을 만들고 해결한다", async () => {
    const id = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const worker = h.worker();

    reportAuth(id, true);
    await worker.tick();
    const [opened] = listOpenNotificationEvents(h.db);
    expect(opened).toMatchObject({ kind: "runner-auth", resolvedAt: null });

    reportAuth(id, false);
    await worker.tick();
    expect(listOpenNotificationEvents(h.db)).toEqual([]);
    expect(listNotificationChanges(h.db, opened?.seq ?? 0)[0]).toMatchObject({
      id: opened?.id,
      resolvedAt: h.now,
    });
  });

  it("동기화가 실패해도 틱을 끝내고 경고를 남긴다", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    vi.mocked(syncNotifications).mockImplementationOnce(() => {
      throw new Error("database is locked");
    });
    const worker = h.worker();

    await expect(worker.tick()).resolves.toBeUndefined();

    expect(h.warnings.map((warning) => warning.event)).toContain("notifications.sync_failed");
  });
});
