import { toRunId, toTicketKey } from "@ganger/core";
import { addDevice, saveDevicePushSettings, syncNotificationEvents } from "@ganger/db";
import type { NotificationCause } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MAC_RECENT_USE_MS, PUSH_DEFER_MS, PUSH_FIRST_REPORT_WAIT_MS } from "./push-deferral.js";
import { PUSH_REMIND_AFTER_MS, createPushDelivery } from "./push.js";
import { Harness, workspaceId } from "./test-fixtures.js";

const GROUPS = {
  question: true,
  permission: true,
  humanCheckRequest: true,
  failedDisconnected: true,
  runnerIssue: true,
};
const batchSchema = z.array(
  z.object({
    data: z.object({
      eventId: z.number().optional(),
      bundleId: z.string().optional(),
      replaces: z.array(z.string()).optional(),
    }),
  }),
);

function cause(n: number): NotificationCause {
  return {
    kind: "question",
    cause: `question:${n}`,
    target: {
      kind: "run",
      runId: toRunId(`run-${n}`),
      workspaceId,
      ticketKey: toTicketKey(`ACME-${n}`),
    },
    subject: "제목",
    detail: "내용",
  };
}

describe("Mac 앞이면 푸시 미루기(M15, M32, M51)", () => {
  let h: Harness;
  let clock: Date;
  let sent: z.infer<typeof batchSchema>;

  const fakeExpo: typeof fetch = (_input, init) => {
    const batch = batchSchema.parse(JSON.parse(typeof init?.body === "string" ? init.body : "[]"));
    sent.push(...batch);
    return Promise.resolve(
      Response.json({ data: batch.map((_, index) => ({ status: "ok", id: `t-${index}` })) }),
    );
  };
  const delivery = (waitForReportUntil?: number) =>
    createPushDelivery({
      db: h.db,
      now: () => clock,
      logger: h.log,
      transport: { url: "https://push.example.com/v2", fetch: fakeExpo },
      ...(waitForReportUntil === undefined ? {} : { waitForReportUntil }),
    });
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  const sync = (causes: NotificationCause[]) => syncNotificationEvents(h.db, causes, clock);

  beforeEach(() => {
    h = new Harness();
    sent = [];
    clock = new Date("2026-11-23T03:00:00.000Z");
    h.db.$client.exec("PRAGMA foreign_keys = OFF");
    const phone = addDevice(h.db, { name: "폰", tokenHash: "hash-phone" }, clock);
    saveDevicePushSettings(h.db, phone.id, {
      enabled: true,
      groups: GROUPS,
      expoPushToken: "ExponentPushToken[phone]",
    });
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it("최근 사용이 아니면 바로 보낸다", async () => {
    const pushes = delivery();
    pushes.recordDeviceUse("mac", clock.getTime() - MAC_RECENT_USE_MS - 1);
    sync([cause(1)]);
    await pushes.run();
    expect(sent).toHaveLength(1);
  });

  it("최근 사용이면 5분 동안 미루고 5분 뒤 보낸다", async () => {
    const pushes = delivery();
    pushes.recordDeviceUse("mac", clock.getTime());
    sync([cause(1)]);
    await pushes.run();
    advance(PUSH_DEFER_MS - 1);
    await pushes.run();
    expect(sent).toHaveLength(0);
    advance(1);
    await pushes.run();
    expect(sent).toHaveLength(1);
  });

  it("미룬 사이 해결되면 보내지 않는다", async () => {
    const pushes = delivery();
    pushes.recordDeviceUse("mac", clock.getTime());
    sync([cause(1)]);
    await pushes.run();
    advance(60_000);
    sync([]);
    await pushes.run();
    advance(PUSH_DEFER_MS);
    await pushes.run();
    expect(sent).toHaveLength(0);
  });

  it("데스크톱이 여러 대면 하나만 최근 사용이어도 미룬다", async () => {
    const pushes = delivery();
    pushes.recordDeviceUse("mac-idle", clock.getTime() - MAC_RECENT_USE_MS - 1);
    pushes.recordDeviceUse("mac-active", clock.getTime() - 1_000);
    sync([cause(1)]);
    await pushes.run();
    expect(sent).toHaveLength(0);
  });

  it("미루는 동안 Mac을 떠나도 5분을 채운다", async () => {
    const pushes = delivery();
    pushes.recordDeviceUse("mac", clock.getTime());
    sync([cause(1)]);
    await pushes.run();
    advance(MAC_RECENT_USE_MS + 1);
    await pushes.run();
    expect(sent).toHaveLength(0);
  });

  it("미룬 사건이 묶음 기준을 넘으면 5분 뒤 하나로 묶어 보낸다", async () => {
    const pushes = delivery();
    pushes.recordDeviceUse("mac", clock.getTime());
    for (const n of [1, 2, 3, 4]) {
      sync(Array.from({ length: n }, (_, index) => cause(index + 1)));
      await pushes.run();
      advance(1_000);
    }
    advance(PUSH_DEFER_MS);
    await pushes.run();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.data.bundleId).toBeDefined();
  });

  it("미루다 해결된 사건이 다시 열리면 다시 열린 때부터 5분을 미룬다", async () => {
    const pushes = delivery();
    pushes.recordDeviceUse("mac", clock.getTime());
    sync([cause(1)]);
    await pushes.run();
    advance(4 * 60_000);
    sync([]);
    await pushes.run();
    advance(60_000 + 1_000);
    pushes.recordDeviceUse("mac", clock.getTime());
    sync([cause(1)]);
    await pushes.run();
    expect(sent).toHaveLength(0);
    advance(PUSH_DEFER_MS - 1);
    pushes.recordDeviceUse("mac", clock.getTime());
    await pushes.run();
    expect(sent).toHaveLength(0);
    advance(1);
    await pushes.run();
    expect(sent).toHaveLength(1);
  });

  it("다시 열린 사건의 미루기가 같은 때 만든 다른 사건을 붙잡지 않는다", async () => {
    const pushes = delivery();
    pushes.recordDeviceUse("mac", clock.getTime());
    sync([cause(1), cause(2)]);
    await pushes.run();
    advance(60_000);
    sync([cause(2)]);
    await pushes.run();
    advance(60_000);
    pushes.recordDeviceUse("mac", clock.getTime());
    sync([cause(1), cause(2)]);
    await pushes.run();
    advance(3 * 60_000);
    await pushes.run();
    expect(sent).toHaveLength(1);
  });

  describe("10분 뒤 다시 알림(M52)", () => {
    const reminders = () => sent.filter((message) => message.data.replaces !== undefined);
    const sentFirst = async () => {
      const pushes = delivery();
      sync([cause(1)]);
      await pushes.run();
      expect(sent).toHaveLength(1);
      return pushes;
    };

    it("Mac을 쓰지 않으면 10분에 바로 다시 알린다", async () => {
      const pushes = await sentFirst();
      advance(PUSH_REMIND_AFTER_MS);
      await pushes.run();
      expect(reminders()).toHaveLength(1);
    });

    it("Mac을 쓰고 있으면 5분 미뤄 다시 알리고 한 번만 보낸다", async () => {
      const pushes = await sentFirst();
      advance(PUSH_REMIND_AFTER_MS);
      pushes.recordDeviceUse("mac", clock.getTime());
      await pushes.run();
      advance(PUSH_DEFER_MS - 1);
      await pushes.run();
      expect(reminders()).toHaveLength(0);
      advance(1);
      await pushes.run();
      advance(60_000);
      await pushes.run();
      expect(reminders()).toHaveLength(1);
    });

    it("미룬 사이 해결되면 다시 알리지 않는다", async () => {
      const pushes = await sentFirst();
      advance(PUSH_REMIND_AFTER_MS);
      pushes.recordDeviceUse("mac", clock.getTime());
      await pushes.run();
      advance(60_000);
      sync([]);
      await pushes.run();
      advance(PUSH_DEFER_MS);
      await pushes.run();
      expect(reminders()).toHaveLength(0);
    });

    it("미루다 해결된 뒤 다시 열리면 다시 열린 때부터 5분을 미룬다", async () => {
      const pushes = await sentFirst();
      advance(PUSH_REMIND_AFTER_MS);
      pushes.recordDeviceUse("mac", clock.getTime());
      await pushes.run();
      advance(2 * 60_000);
      sync([]);
      await pushes.run();
      advance(4 * 60_000);
      pushes.recordDeviceUse("mac", clock.getTime());
      sync([cause(1)]);
      await pushes.run();
      expect(reminders()).toHaveLength(0);
      advance(PUSH_DEFER_MS - 1);
      await pushes.run();
      expect(reminders()).toHaveLength(0);
      advance(1);
      await pushes.run();
      expect(reminders()).toHaveLength(1);
    });

    it("재시작 직후에는 보고를 기다렸다가 보고가 없으면 다시 알린다", async () => {
      await sentFirst();
      advance(PUSH_REMIND_AFTER_MS);
      const restarted = delivery(clock.getTime() + PUSH_FIRST_REPORT_WAIT_MS);
      await restarted.run();
      expect(reminders()).toHaveLength(0);
      advance(PUSH_FIRST_REPORT_WAIT_MS);
      await restarted.run();
      expect(reminders()).toHaveLength(1);
    });
  });

  it("재시작 직후에는 보고를 기다렸다가 보고가 없으면 보낸다", async () => {
    const pushes = delivery(clock.getTime() + PUSH_FIRST_REPORT_WAIT_MS);
    sync([cause(1)]);
    await pushes.run();
    expect(sent).toHaveLength(0);
    advance(PUSH_FIRST_REPORT_WAIT_MS);
    await pushes.run();
    expect(sent).toHaveLength(1);
  });

  it("재시작 직후 최근 사용 보고가 오면 사건 시각부터 5분을 미룬다", async () => {
    const createdAt = clock.getTime();
    sync([cause(1)]);
    advance(60_000);
    const pushes = delivery(clock.getTime() + PUSH_FIRST_REPORT_WAIT_MS);
    await pushes.run();
    pushes.recordDeviceUse("mac", clock.getTime());
    await pushes.run();
    clock = new Date(createdAt + PUSH_DEFER_MS - 1);
    await pushes.run();
    expect(sent).toHaveLength(0);
    clock = new Date(createdAt + PUSH_DEFER_MS);
    await pushes.run();
    expect(sent).toHaveLength(1);
  });

  it("재시작 전에 이미 보낸 사건은 다시 보내지 않는다", async () => {
    sync([cause(1)]);
    await delivery().run();
    expect(sent).toHaveLength(1);
    const restarted = delivery(clock.getTime());
    advance(1_000);
    await restarted.run();
    expect(sent).toHaveLength(1);
  });
});
