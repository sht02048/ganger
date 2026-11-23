import { pushDataSchema } from "@ganger/api";
import { toRunId, toRunnerId, toRunnerKind, toTicketKey } from "@ganger/core";
import {
  addDevice,
  getDevicePushSettings,
  listPushDeliveries,
  removeDevice,
  saveDevicePushSettings,
  saveRunner,
  syncNotificationEvents,
} from "@ganger/db";
import type { NotificationCause, NotificationEventKind } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  PUSH_CLEAR_EVENTS_PER_MESSAGE,
  PUSH_FAILURE_BACKOFF_MS,
  PUSH_RECEIPT_DELAY_MS,
  PUSH_REMIND_AFTER_MS,
  createPushDelivery,
} from "./push.js";
import type { ExpoMessage } from "./push.js";
import { Harness, workspaceId } from "./test-fixtures.js";

const ALL_GROUPS = {
  question: true,
  permission: true,
  humanCheckRequest: true,
  failedDisconnected: true,
  runnerIssue: true,
};
const TOKEN = "ExponentPushToken[device-a]";
const SECRET_SUBJECT = "ACME-142 비밀 티켓 제목";

const expoBatchSchema = z.array(z.custom<ExpoMessage>());

class FakeExpo {
  sent: ExpoMessage[] = [];
  receipts: Record<string, unknown> = {};
  receiptRequests = 0;
  ticketFor: (message: ExpoMessage) => unknown = () => null;
  down = false;
  refusedToken: string | null = null;
  receiptsDown = false;
  private nextId = 0;

  readonly fetch: typeof fetch = (input, init) => {
    if (this.down) return Promise.reject(new TypeError("offline"));
    const body: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "null");
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith("/getReceipts")) {
      this.receiptRequests += 1;
      if (this.receiptsDown) return Promise.reject(new TypeError("offline"));
      return Promise.resolve(Response.json({ data: this.receipts }));
    }
    const batch = expoBatchSchema.parse(body);
    if (batch.some((message) => message.to === this.refusedToken)) {
      return Promise.resolve(Response.json({ errors: [] }, { status: 400 }));
    }
    this.sent.push(...batch);
    return Promise.resolve(
      Response.json({
        data: batch.map((message) => {
          const custom = this.ticketFor(message);
          if (custom !== null) return custom;
          this.nextId += 1;
          return { status: "ok", id: `ticket-${this.nextId}` };
        }),
      }),
    );
  };

  take(): ExpoMessage[] {
    const taken = this.sent;
    this.sent = [];
    return taken;
  }
}

function runCause(n: number, kind: NotificationEventKind = "question"): NotificationCause {
  return {
    kind,
    cause: `${kind}:${n}`,
    target: {
      kind: "run",
      runId: toRunId(`run-${n}`),
      workspaceId,
      ticketKey: toTicketKey(`ACME-${n}`),
    },
    subject: SECRET_SUBJECT,
    detail: "비밀 질문 내용",
  };
}

describe("worker 의 Expo 푸시(M10~M16, M23, M33, M40)", () => {
  let h: Harness;
  let expo: FakeExpo;
  let clock: Date;

  const delivery = () =>
    createPushDelivery({
      db: h.db,
      now: () => clock,
      logger: h.log,
      transport: { url: "https://push.example.com/v2", fetch: expo.fetch },
    });
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  const sync = (causes: NotificationCause[]) => syncNotificationEvents(h.db, causes, clock);
  const addPushDevice = (token = TOKEN, groups = ALL_GROUPS) => {
    const device = addDevice(h.db, { name: "폰", tokenHash: `hash-${token}` }, clock);
    saveDevicePushSettings(h.db, device.id, { enabled: true, groups, expoPushToken: token });
    return device.id;
  };

  beforeEach(() => {
    h = new Harness();
    expo = new FakeExpo();
    clock = new Date("2026-11-23T03:00:00.000Z");
    h.db.$client.exec("PRAGMA foreign_keys = OFF");
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it("허용한 기기에 사건 번호와 고정 문구만 보내고 티켓 내용은 싣지 않는다", async () => {
    addPushDevice();
    sync([runCause(1)]);
    await delivery().run();

    const [message] = expo.take();
    expect(message).toMatchObject({
      to: TOKEN,
      title: "Ganger",
      body: "처리할 일이 생겼어요",
      sound: "default",
      mutableContent: true,
    });
    expect(pushDataSchema.safeParse(message?.data).success).toBe(true);
    expect(Object.keys(message?.data ?? {}).toSorted()).toEqual(["device", "eventId"]);
    const wire = JSON.stringify(message);
    expect(wire).not.toContain("ACME");
    expect(wire).not.toContain("비밀");
    expect(wire).not.toContain("interruptionLevel");
  });

  it("같은 사건은 한 번만 보내고 worker 를 새로 만들어도 다시 보내지 않는다", async () => {
    addPushDevice();
    sync([runCause(1)]);
    await delivery().run();
    await delivery().run();
    expect(expo.take()).toHaveLength(1);
  });

  it("끈 종류와 알림을 끈 기기에는 보내지 않는다", async () => {
    addPushDevice("ExponentPushToken[no-question]", { ...ALL_GROUPS, question: false });
    const off = addPushDevice("ExponentPushToken[off]");
    saveDevicePushSettings(h.db, off, { enabled: false, groups: ALL_GROUPS });
    sync([runCause(1, "question"), runCause(2, "failed")]);
    await delivery().run();

    const sent = expo.take();
    expect(sent.map((message) => message.to)).toEqual(["ExponentPushToken[no-question]"]);
  });

  it("지운 기기로는 보내지 않는다", async () => {
    const id = addPushDevice();
    removeDevice(h.db, id, clock);
    sync([runCause(1)]);
    await delivery().run();
    expect(expo.take()).toEqual([]);
  });

  it("알림을 켤 때 이미 열린 사건은 보내지도, 다시 알리지도, 지우지도 않는다", async () => {
    sync([runCause(1)]);
    addPushDevice();
    await delivery().run();
    advance(PUSH_REMIND_AFTER_MS);
    await delivery().run();
    sync([]);
    await delivery().run();
    expect(expo.take()).toEqual([]);
  });

  it("Question·Permission·Human Check 를 10분 뒤 한 번만 다시 알린다", async () => {
    addPushDevice();
    sync([runCause(1, "question"), runCause(2, "permission"), runCause(3, "human-check")]);
    const push = delivery();
    await push.run();
    expect(expo.take()).toHaveLength(3);

    advance(PUSH_REMIND_AFTER_MS - 1);
    await push.run();
    expect(expo.take()).toEqual([]);

    advance(1);
    await push.run();
    const reminders = expo.take();
    expect(reminders).toHaveLength(3);
    expect(reminders[0]?.sound).toBe("default");

    advance(PUSH_REMIND_AFTER_MS);
    await push.run();
    expect(expo.take()).toEqual([]);
  });

  it("꺼진 동안 기한이 지난 다시 알림은 다시 켜도 보내지 않는다", async () => {
    const id = addPushDevice();
    sync([runCause(1)]);
    const push = delivery();
    await push.run();
    expo.take();
    saveDevicePushSettings(h.db, id, { enabled: false, groups: ALL_GROUPS }, clock);
    advance(PUSH_REMIND_AFTER_MS);
    saveDevicePushSettings(h.db, id, { enabled: true, groups: ALL_GROUPS }, clock);
    await push.run();
    expect(expo.take()).toEqual([]);
  });

  it("영수증 조회가 실패해도 새 알림을 미루지 않는다", async () => {
    addPushDevice();
    sync([runCause(1)]);
    const push = delivery();
    await push.run();
    expo.take();
    expo.receiptsDown = true;
    advance(PUSH_RECEIPT_DELAY_MS);
    await push.run();
    expo.take();
    sync([runCause(1), runCause(2)]);
    await push.run();
    expect(expo.take().map((message) => message.data)).toMatchObject([{ eventId: 2 }]);
  });

  it("Failed 는 다시 알리지 않고, 다시 알리기 전에 해결되면 보내지 않는다", async () => {
    addPushDevice();
    sync([runCause(1, "failed"), runCause(2, "question")]);
    const push = delivery();
    await push.run();
    expo.take();
    sync([runCause(1, "failed")]);
    await push.run();
    expo.take();

    advance(PUSH_REMIND_AFTER_MS);
    await push.run();
    expect(expo.take()).toEqual([]);
  });

  it("5초 안에 처리할 일이 3개를 넘으면 하나로 묶는다", async () => {
    addPushDevice();
    sync([1, 2, 3, 4].map((n) => runCause(n)));
    await delivery().run();

    const sent = expo.take();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toBe("처리할 일이 4개 생겼어요");
    expect(sent[0]?.data).toHaveProperty("bundleId");
  });

  it("먼저 보낸 3개 뒤에 네 번째가 오면 묶음이 앞 알림을 대신한다", async () => {
    addPushDevice();
    const first = [1, 2, 3].map((n) => runCause(n));
    sync(first);
    const push = delivery();
    await push.run();
    expect(expo.take()).toHaveLength(3);

    advance(2_000);
    sync([...first, runCause(4)]);
    await push.run();
    const [bundle] = expo.take();
    expect(bundle?.body).toBe("처리할 일이 4개 생겼어요");
    expect(bundle?.data).toMatchObject({ replaces: ["event-1", "event-2", "event-3"] });
  });

  it("Runner Issue 는 묶지 않는다", async () => {
    addPushDevice();
    const runner = toRunnerId("runner-a");
    saveRunner(h.db, {
      id: runner,
      kind: toRunnerKind("fake"),
      name: "a",
      config: { id: "a" },
      capacity: 1,
    });
    const issues = [1, 2, 3, 4].map((n): NotificationCause => ({
      kind: "runner-offline",
      cause: `runner-offline:${n}`,
      target: { kind: "runner", runnerId: runner },
      subject: "a",
      detail: null,
    }));
    sync(issues);
    await delivery().run();
    const sent = expo.take();
    expect(sent).toHaveLength(4);
    expect(sent.every((message) => "eventId" in message.data)).toBe(true);
  });

  it("해결된 사건은 소리 없는 조용한 푸시로 한 번 지운다", async () => {
    const id = addPushDevice();
    sync([runCause(1)]);
    const push = delivery();
    await push.run();
    expo.take();

    sync([]);
    await push.run();
    const [clear] = expo.take();
    expect(clear).toEqual({
      to: TOKEN,
      contentAvailable: true,
      priority: "normal",
      data: { device: id, clear: ["event-1"] },
    });

    await push.run();
    expect(expo.take()).toEqual([]);
  });

  it("묶음은 사건이 모두 해결돼야 묶음까지 지운다", async () => {
    addPushDevice();
    const causes = [1, 2, 3, 4].map((n) => runCause(n));
    sync(causes);
    const push = delivery();
    await push.run();
    expo.take();

    sync(causes.slice(1));
    await push.run();
    expect(expo.take()[0]?.data).toMatchObject({ clear: ["event-1"] });

    sync([]);
    await push.run();
    expect(expo.take()[0]?.data).toMatchObject({
      clear: ["event-2", "bundle-1", "event-3", "event-4"],
    });
  });

  it("지운 뒤 다시 열린 사건은 10분이 차면 다시 알리고, 또 해결되면 다시 지운다", async () => {
    addPushDevice();
    sync([runCause(1)]);
    const push = delivery();
    await push.run();
    sync([]);
    await push.run();
    expo.take();

    advance(60_000);
    sync([runCause(1)]);
    await push.run();
    expect(expo.take()).toEqual([]);

    advance(PUSH_REMIND_AFTER_MS);
    await push.run();
    expect(expo.take().map((message) => message.data)).toMatchObject([
      { eventId: 1, replaces: ["event-1"] },
    ]);

    sync([]);
    await push.run();
    expect(expo.take().map((message) => message.data)).toMatchObject([{ clear: ["event-1"] }]);
  });

  it("지울 사건이 많으면 4KiB 안의 메시지로 나눈다", async () => {
    addPushDevice();
    const count = PUSH_CLEAR_EVENTS_PER_MESSAGE * 2 + 1;
    sync(Array.from({ length: count }, (_, index) => runCause(index + 1)));
    const push = delivery();
    await push.run();
    expo.take();

    sync([]);
    await push.run();
    const clears = expo.take();
    expect(clears).toHaveLength(3);
    expect(clears.every((message) => JSON.stringify(message).length < 4096)).toBe(true);
    await push.run();
    expect(expo.take()).toEqual([]);
  });

  it("한 기기의 표 오류는 다른 기기의 전송을 미루지 않는다", async () => {
    const broken = "ExponentPushToken[broken]";
    addPushDevice(broken);
    addPushDevice("ExponentPushToken[healthy]");
    expo.ticketFor = (message) =>
      message.to === broken ? { status: "error", details: { error: "MessageTooBig" } } : null;
    sync([runCause(1)]);
    const push = delivery();
    await push.run();
    expo.take();

    sync([runCause(1), runCause(2)]);
    await push.run();
    expect(expo.take().map((message) => message.to)).toEqual(["ExponentPushToken[healthy]"]);
  });

  it("Expo 가 한 기기의 요청을 통째로 거절해도 다른 기기에는 보낸다", async () => {
    const other = "ExponentPushToken[other-project]";
    addPushDevice(other);
    addPushDevice("ExponentPushToken[healthy]");
    expo.refusedToken = other;
    sync([runCause(1)]);
    await delivery().run();
    expect(expo.take().map((message) => message.to)).toEqual(["ExponentPushToken[healthy]"]);
  });

  it("푸시마다 받을 기기를 실어 다른 서버의 같은 번호와 가른다", async () => {
    const id = addPushDevice();
    sync([runCause(1)]);
    await delivery().run();
    expect(expo.take()[0]?.data).toMatchObject({ device: id, eventId: 1 });
  });

  it("모르는 표 상태가 와도 응답 전체를 버리지 않는다", async () => {
    addPushDevice();
    expo.ticketFor = () => ({ status: "later" });
    sync([runCause(1)]);
    await delivery().run();
    expect(h.warnings.map((warning) => warning.event)).toContain("push.ticket_failed");
    expect(h.warnings.map((warning) => warning.event)).not.toContain("push.send_failed");
  });

  it("보내기가 실패하면 기록하지 않고 잠시 뒤 다시 보낸다", async () => {
    addPushDevice();
    sync([runCause(1)]);
    const push = delivery();
    expo.down = true;
    await push.run();
    expect(listPushDeliveries(h.db)).toEqual([]);
    expect(h.warnings.map((warning) => warning.event)).toContain("push.send_failed");

    expo.down = false;
    await push.run();
    expect(expo.take()).toEqual([]);

    advance(PUSH_FAILURE_BACKOFF_MS);
    await push.run();
    expect(expo.take()).toHaveLength(1);
  });

  it("DeviceNotRegistered 표를 받으면 주소를 지우고 알림을 끄되 기기 연결은 남긴다(결정 1)", async () => {
    const id = addPushDevice();
    expo.ticketFor = () => ({ status: "error", details: { error: "DeviceNotRegistered" } });
    sync([runCause(1)]);
    const push = delivery();
    await push.run();

    expect(getDevicePushSettings(h.db, id)).toMatchObject({
      enabled: false,
      hasPushAddress: false,
    });
    expo.take();
    sync([runCause(1), runCause(2)]);
    await push.run();
    expect(expo.take()).toEqual([]);
    expect(JSON.stringify(h.warnings)).not.toContain(TOKEN);
  });

  it("15분 뒤 영수증의 DeviceNotRegistered 도 같은 주소일 때만 지운다", async () => {
    const id = addPushDevice();
    sync([runCause(1)]);
    const push = delivery();
    await push.run();
    expect(expo.receiptRequests).toBe(0);

    saveDevicePushSettings(h.db, id, {
      enabled: true,
      groups: ALL_GROUPS,
      expoPushToken: "ExponentPushToken[renewed]",
    });
    expo.receipts = { "ticket-1": { status: "error", details: { error: "DeviceNotRegistered" } } };
    advance(PUSH_RECEIPT_DELAY_MS);
    await push.run();

    expect(expo.receiptRequests).toBe(1);
    expect(getDevicePushSettings(h.db, id)).toMatchObject({ enabled: true, hasPushAddress: true });
  });

  it("영수증의 DeviceNotRegistered 로 알림을 끈다", async () => {
    const id = addPushDevice();
    sync([runCause(1)]);
    const push = delivery();
    await push.run();
    expo.receipts = { "ticket-1": { status: "error", details: { error: "DeviceNotRegistered" } } };
    advance(PUSH_RECEIPT_DELAY_MS);
    await push.run();
    expect(getDevicePushSettings(h.db, id)).toMatchObject({
      enabled: false,
      hasPushAddress: false,
    });
  });

  it("다시 켜며 새 주소를 넘기면 그 주소로 새 사건을 보낸다", async () => {
    const id = addPushDevice();
    expo.ticketFor = () => ({ status: "error", details: { error: "DeviceNotRegistered" } });
    sync([runCause(1)]);
    const push = delivery();
    await push.run();
    expo.take();
    expo.ticketFor = () => null;

    saveDevicePushSettings(h.db, id, {
      enabled: true,
      groups: ALL_GROUPS,
      expoPushToken: "ExponentPushToken[renewed]",
    });
    await push.run();
    expect(expo.take()).toEqual([]);

    sync([runCause(1), runCause(2)]);
    await push.run();
    expect(expo.take().map((message) => message.to)).toEqual(["ExponentPushToken[renewed]"]);
  });
});
