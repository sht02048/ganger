import { AdapterRegistry, toTrackerConnectionId, toTrackerKind } from "@ganger/core";
import type { TrackerConnectionId } from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import {
  NO_WEBHOOK_RECEIPT,
  SecretBox,
  getInstallSettings,
  getTrackerConnection,
  getWebhookReceipt,
  migrate,
  openDatabase,
  recordWebhookAccepted,
  recordWebhookBadSignature,
  saveCheckedWebhookAddress,
  saveInstallAddresses,
  saveWorkspace,
  toWorkspaceId,
} from "@ganger/db";
import { describe, expect, it } from "vitest";
import {
  saveTrackerConnectionSetting,
  turnOffWebhook,
  verifyWebhookAddress,
  webhookStateNow,
} from "@ganger/app/settings/actions";
import { loadSettingsPage, webhookStateOf } from "@ganger/app/settings/load";
import type { SettingsContext } from "@ganger/app/settings/load";
import type { SettingsPage, WebhookSetupView } from "@ganger/app/settings/model";
import { webhookPingAnswer } from "@ganger/app/webhook-address";
import type { PingFetch } from "@ganger/app/webhook-address";
import settings from "../../messages/ko/settings.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import { ConnectionDetailScreen } from "./connection-detail";
import { settingsMessages } from "./messages";
import { SettingsScreen, sectionProblems } from "./settings-page";
import type { SettingsActions } from "./settings-screen";

const now = new Date("2026-11-20T09:00:00Z");
const workspace = toWorkspaceId("ws-acme");
const ADDRESS = "https://hooks.example.com";

const noopActions: SettingsActions = {
  saveGeneral: () => Promise.resolve({ ok: true }),
  saveBrief: () => Promise.resolve({ ok: true }),
  addProject: () => Promise.resolve({ ok: true }),
  removeProject: () => Promise.resolve({ ok: true }),
  saveMapping: () => Promise.resolve({ ok: true }),
  saveInProgress: () => Promise.resolve({ ok: true }),
  saveLabel: () => Promise.resolve({ ok: true }),
  saveConnection: () => Promise.resolve({ ok: true }),
  checkConnection: () => Promise.resolve({ ok: true }),
  saveGitHubToken: () => Promise.resolve({ ok: true }),
  checkGitHubToken: () => Promise.resolve({ ok: true }),
  saveRunner: () => Promise.resolve({ ok: true }),
  recheckRunner: () => Promise.resolve({ ok: true }),
  saveAddresses: () => Promise.resolve({ ok: true }),
  savePower: () => Promise.resolve({ ok: true }),
  saveMcpWrite: () => Promise.resolve({ ok: true }),
  createLabel: () => Promise.resolve({ ok: false, reason: "not-found" }),
  reloadFromTracker: () => Promise.resolve(),
  pollRunnerChecks: () => Promise.resolve(false),
  checkWebhookAddress: () => Promise.resolve({ ok: true }),
  turnOffWebhook: () => Promise.resolve({ ok: true }),
};

interface Fixture {
  context: SettingsContext;
  tracker: FakeTracker;
}

function fixture(): Fixture {
  const db = openDatabase(":memory:");
  migrate(db);
  saveWorkspace(db, { id: workspace, name: "Acme" }, now);
  const tracker = new FakeTracker(toTrackerKind("fake"));
  const registry = new AdapterRegistry().registerTracker({
    kind: tracker.kind,
    create: () => tracker,
  });
  return {
    context: { db, secretBox: new SecretBox(new Uint8Array(32).fill(7)), registry },
    tracker,
  };
}

async function addConnection(
  f: Fixture,
  webhookSecret = "",
  name = "Acme",
): Promise<TrackerConnectionId> {
  const saved = await saveTrackerConnectionSetting(
    f.context,
    { name, apiKey: `lin_api_${name.toLowerCase()}`, webhookSecret },
    now,
  );
  expect(saved).toEqual({ ok: true });
  const page = await loadSettingsPage(f.context, workspace, now);
  const id = page.install.connections.find((connection) => connection.name === name)?.id;
  if (id === undefined) throw new Error("no connection");
  return toTrackerConnectionId(id);
}

const noTailscale: WebhookSetupView = { funnel: null };
const withTailscale: WebhookSetupView = {
  funnel: {
    kind: "ready",
    port: 8443,
    portState: "free",
    command:
      "tailscale funnel --bg --https=8443 --set-path /api/webhooks/ http://127.0.0.1:3000/api/webhooks/",
    address: "https://server.example.ts.net:8443",
  },
};
const portsFull: WebhookSetupView = {
  funnel: {
    kind: "ports-full",
    ports: [
      {
        port: 443,
        uses: ["/ → http://127.0.0.1:3000"],
        isPublic: false,
        unavailable: "serves-this-app",
      },
      {
        port: 8443,
        uses: ["/docs/ → http://127.0.0.1:4000"],
        isPublic: true,
        unavailable: null,
        command:
          "tailscale funnel --bg --https=8443 --set-path /api/webhooks/ http://127.0.0.1:3000/api/webhooks/",
        address: "https://server.example.ts.net:8443",
      },
      { port: 10000, uses: ["TCP → 127.0.0.1:22"], isPublic: false, unavailable: "tcp-forward" },
    ],
  },
};
const boundToTailnet: WebhookSetupView = {
  funnel: { kind: "bind-tailnet", bindHost: "100.64.0.10" },
};

function renderDetail(
  page: SettingsPage,
  connectionId: string,
  setup: WebhookSetupView = noTailscale,
): string {
  return renderWithMessages(
    <ConnectionDetailScreen
      page={page}
      setup={setup}
      connectionId={connectionId}
      ws={workspace}
      actions={noopActions}
    />,
    settingsMessages,
  );
}

function renderSettings(page: SettingsPage): string {
  return renderWithMessages(
    <SettingsScreen
      page={page}
      runnerIssues={0}
      workspaceView="one"
      ws={workspace}
      actions={noopActions}
      onCreateWorkspace={() => {}}
    />,
    settingsMessages,
  );
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ");
}

function stepOf(html: string, number: number): string {
  const steps = html.slice(html.indexOf(`aria-label="${settings.webhook.steps}"`));
  const items = steps.split("<li").slice(1);
  const item = items[number - 1];
  if (item === undefined) throw new Error(`no step ${number}`);
  return item;
}

const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);

describe("webhook 상태", () => {
  it("secret 이 없으면 꺼짐, 받은 적 없으면 기다림, 받았으면 켜짐, 마지막 성공 뒤 서명 실패가 있으면 실패다", () => {
    expect(webhookStateOf(false, { ...NO_WEBHOOK_RECEIPT, rejectedCount: 0 }, now)).toEqual({
      kind: "off",
    });
    expect(webhookStateOf(true, NO_WEBHOOK_RECEIPT, now)).toEqual({ kind: "waiting" });
    expect(
      webhookStateOf(true, { lastReceivedAt: at(3), rejectedCount: 0, firstRejectedAt: null }, now),
    ).toEqual({
      kind: "receiving",
      lastReceivedAt: at(3).toISOString(),
      lastReceivedAgoMs: 3 * 60_000,
    });
    expect(
      webhookStateOf(
        true,
        { lastReceivedAt: at(60), rejectedCount: 4, firstRejectedAt: at(30) },
        now,
      ),
    ).toEqual({
      kind: "rejected",
      rejectedCount: 4,
      firstRejectedAt: at(30).toISOString(),
      lastReceivedAt: at(60).toISOString(),
      lastReceivedAgoMs: 60 * 60_000,
    });
  });
});

describe("webhook 저장 규칙", () => {
  it("새 signing secret 을 넣으면 지난 수신 기록을 지워 다시 기다린다", async () => {
    const f = fixture();
    const id = await addConnection(f, "whsec_old");
    recordWebhookAccepted(f.context.db, id, at(10));
    recordWebhookBadSignature(f.context.db, id, at(5));
    expect(webhookStateNow(f.context, { id }, now)?.kind).toBe("rejected");

    await saveTrackerConnectionSetting(
      f.context,
      { id, apiKey: "", webhookSecret: "whsec_new" },
      now,
    );
    expect(getWebhookReceipt(f.context.db, id)).toEqual(NO_WEBHOOK_RECEIPT);
    expect(webhookStateNow(f.context, { id }, now)).toEqual({ kind: "waiting" });
  });

  it("이름만 바꾸면 signing secret 과 수신 기록을 그대로 둔다", async () => {
    const f = fixture();
    const id = await addConnection(f, "whsec_old");
    recordWebhookAccepted(f.context.db, id, at(10));
    await saveTrackerConnectionSetting(
      f.context,
      { id, name: "Acme Shop", apiKey: "", webhookSecret: "" },
      now,
    );
    expect(webhookStateNow(f.context, { id }, now)?.kind).toBe("receiving");
  });

  it("끄면 signing secret 과 수신 기록을 지우고 API 키는 남긴다", async () => {
    const f = fixture();
    const id = await addConnection(f, "whsec_old");
    recordWebhookAccepted(f.context.db, id, at(10));
    expect(turnOffWebhook(f.context, { id }, now)).toEqual({ ok: true });
    const stored = getTrackerConnection(f.context.db, f.context.secretBox, id);
    expect(stored?.secrets).toEqual({ apiKey: "lin_api_acme", webhookSecret: null });
    expect(getWebhookReceipt(f.context.db, id)).toEqual(NO_WEBHOOK_RECEIPT);
    expect(webhookStateNow(f.context, { id }, now)).toEqual({ kind: "off" });
    expect(turnOffWebhook(f.context, { id: "missing" }, now)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("API 키를 확인할 때 트래커가 알려 준 webhook 설정 주소를 연결에 담는다", async () => {
    const f = fixture();
    f.tracker.connection = {
      ok: true,
      organizationName: "Acme",
      webhookSettingsUrl: "https://linear.app/acme/settings/api",
    };
    const id = await addConnection(f);
    const page = await loadSettingsPage(f.context, workspace, now);
    expect(page.install.connections.find((c) => c.id === id)?.webhookSettingsUrl).toBe(
      "https://linear.app/acme/settings/api",
    );
  });

  it("닿을 주소는 이 서버가 답할 때만 웹 주소를 지키고 저장한다", async () => {
    const f = fixture();
    saveInstallAddresses(
      f.context.db,
      { webAddress: "https://server.example.ts.net", webhookAddress: null },
      now,
    );
    const instance = getInstallSettings(f.context.db).instanceId;
    const thisServer: PingFetch = (url) =>
      Promise.resolve(webhookPingAnswer(instance, decodeURIComponent(url.split("/").pop() ?? "")));
    const otherServer: PingFetch = (url) =>
      Promise.resolve(webhookPingAnswer("other", decodeURIComponent(url.split("/").pop() ?? "")));

    expect(
      await verifyWebhookAddress(
        f.context,
        { address: "https://Hooks.example.com/" },
        now,
        otherServer,
      ),
    ).toEqual({ ok: false, reason: "other-server" });
    expect(getInstallSettings(f.context.db).webhookAddress).toBeNull();

    expect(
      await verifyWebhookAddress(
        f.context,
        { address: "https://Hooks.example.com/" },
        now,
        thisServer,
      ),
    ).toEqual({ ok: true });
    expect(getInstallSettings(f.context.db)).toMatchObject({
      webAddress: "https://server.example.ts.net",
      webhookAddress: ADDRESS,
    });
  });
});

describe("트래커 연결 상세의 Webhook 단계", () => {
  it("닿을 주소가 없으면 1단계만 열리고 2·3단계는 잠긴다", async () => {
    const f = fixture();
    const id = await addConnection(f);
    const html = renderDetail(await loadSettingsPage(f.context, workspace, now), id);
    const text = textOf(html);
    expect(text).toContain(settings.webhook.status.off);
    expect(stepOf(html, 1)).toContain('aria-current="step"');
    expect(textOf(stepOf(html, 1))).toContain(settings.webhook.address.check);
    expect(textOf(stepOf(html, 2))).toContain(settings.webhook.stepState.locked);
    expect(textOf(stepOf(html, 3))).toContain(settings.webhook.stepState.locked);
    expect(textOf(stepOf(html, 2))).not.toContain(settings.webhook.create.urlLabel);
    expect(stepOf(html, 3)).not.toContain('type="password"');
    expect(text).not.toContain(settings.webhook.address.funnelTitle);
    expect(stepOf(html, 1)).toContain(
      'href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/"',
    );
    expect(stepOf(html, 1)).toContain(`${settings.webhook.address.reverseProxy} 도움말`);
  });

  it("Funnel 포트가 다 차면 쓰는 곳을 보이고 고르기 전에는 명령과 주소를 내지 않는다", async () => {
    const f = fixture();
    const id = await addConnection(f);
    const html = renderDetail(await loadSettingsPage(f.context, workspace, now), id, portsFull);
    const step = stepOf(html, 1);
    expect(textOf(step)).toContain(settings.webhook.address.funnelFull);
    expect(textOf(step)).toContain("/ → http://127.0.0.1:3000");
    expect(textOf(step)).toContain(
      settings.webhook.address.funnelPortUnavailable["serves-this-app"],
    );
    expect(textOf(step)).toContain(settings.webhook.address.funnelPortUnavailable["tcp-forward"]);
    expect(step.match(/type="radio"[^>]*disabled/g)).toHaveLength(2);
    expect(textOf(step)).toContain("8443 포트 · 인터넷에 공개 중");
    expect(step.match(/type="radio"/g)).toHaveLength(3);
    expect(textOf(step)).not.toContain("tailscale funnel --bg");
    expect(step).not.toContain('value="https://server.example.ts.net');
  });

  it("포트 상태를 모르면 webhook 경로만 연다고 말하지 않는다", async () => {
    const f = fixture();
    const id = await addConnection(f);
    const unknownPort: WebhookSetupView = {
      funnel: {
        kind: "ready",
        port: 8443,
        portState: "unknown",
        command: "tailscale funnel --bg --https=8443",
        address: "https://server.example.ts.net:8443",
      },
    };
    const html = renderDetail(await loadSettingsPage(f.context, workspace, now), id, unknownPort);
    const step = textOf(stepOf(html, 1));
    expect(step).toContain(settings.webhook.address.funnelRunShared);
    expect(step).not.toContain(settings.webhook.address.funnelRun);
  });

  it("WEB_HOST 가 이 기기의 tailnet 주소면 명령 대신 127.0.0.1 에서도 받게 하라고 안내한다", async () => {
    const f = fixture();
    const id = await addConnection(f);
    const html = renderDetail(
      await loadSettingsPage(f.context, workspace, now),
      id,
      boundToTailnet,
    );
    const step = textOf(stepOf(html, 1));
    expect(step).toContain("100.64.0.10");
    expect(step).toContain("127.0.0.1에서도 받게 해 주세요");
    expect(step).not.toContain("tailscale funnel --bg");
  });

  it("Tailscale 이 있으면 명령과 처음 허용 안내를 보이고 주소를 미리 채운다", async () => {
    const f = fixture();
    const id = await addConnection(f);
    const html = renderDetail(await loadSettingsPage(f.context, workspace, now), id, withTailscale);
    const step = stepOf(html, 1);
    expect(textOf(step)).toContain(settings.webhook.address.funnelTitle);
    expect(textOf(step)).toContain(settings.webhook.address.funnelFirst);
    expect(textOf(step)).toContain("비어 있는 8443 포트를 골랐어요.");
    expect(step).toContain('href="https://tailscale.com/kb/1223/funnel"');
    expect(textOf(step)).toContain("--https=8443 --set-path /api/webhooks/");
    expect(step).toContain('value="https://server.example.ts.net:8443"');
  });

  it("닿을 주소를 확인했으면 1단계는 끝났고, 2단계에 완성한 주소와 연결된 Linear 조직의 설정 링크를 보인다", async () => {
    const f = fixture();
    f.tracker.connection = {
      ok: true,
      organizationName: "Acme",
      webhookSettingsUrl: "https://linear.app/acme/settings/api",
    };
    const id = await addConnection(f);
    saveCheckedWebhookAddress(f.context.db, ADDRESS, now);
    const html = renderDetail(await loadSettingsPage(f.context, workspace, now), id);
    expect(textOf(stepOf(html, 1))).toContain(settings.webhook.address.verified);
    expect(textOf(stepOf(html, 1))).toContain(settings.webhook.stepState.done);
    expect(stepOf(html, 2)).toContain('aria-current="step"');
    expect(textOf(stepOf(html, 2))).toContain(`${ADDRESS}/api/webhooks/tracker/${id}`);
    expect(stepOf(html, 2)).toContain('href="https://linear.app/acme/settings/api"');
    expect(stepOf(html, 3)).toContain('type="password"');
    expect(textOf(stepOf(html, 3))).toContain(settings.webhook.secret.turnOn);
    expect(textOf(stepOf(html, 3))).toContain(settings.webhook.stepState.open);
    expect(textOf(stepOf(html, 2))).toContain(settings.webhook.stepState.current);
  });

  it("확인하지 않고 저장된 예전 주소는 끝난 단계로 보지 않고 확인 칸에 채워 둔다", async () => {
    const f = fixture();
    const id = await addConnection(f);
    saveInstallAddresses(
      f.context.db,
      { webAddress: null, webhookAddress: "http://192.168.0.10:3000" },
      now,
    );
    const html = renderDetail(await loadSettingsPage(f.context, workspace, now), id);
    expect(stepOf(html, 1)).toContain('aria-current="step"');
    expect(textOf(stepOf(html, 1))).not.toContain(settings.webhook.address.verified);
    expect(stepOf(html, 1)).toContain('value="http://192.168.0.10:3000"');
    expect(textOf(stepOf(html, 2))).toContain(settings.webhook.stepState.locked);
  });

  it("켜진 연결도 확인하지 않은 주소면 확인하라고 알린다", async () => {
    const f = fixture();
    const id = await addConnection(f, "whsec_example");
    saveInstallAddresses(f.context.db, { webAddress: null, webhookAddress: ADDRESS }, now);
    const text = textOf(renderDetail(await loadSettingsPage(f.context, workspace, now), id));
    expect(text).toContain(`${ADDRESS} · 아직 닿는지 확인하지 않았어요`);
  });

  it("조직 주소를 모르면 Linear 일반 webhook 설정으로 보낸다", async () => {
    const f = fixture();
    const id = await addConnection(f);
    saveCheckedWebhookAddress(f.context.db, ADDRESS, now);
    const html = renderDetail(await loadSettingsPage(f.context, workspace, now), id);
    expect(stepOf(html, 2)).toContain('href="https://linear.app/settings/api"');
  });

  it("켠 직후에는 첫 webhook 을 기다린다고 알리고, 비밀값 입력칸을 띄우지 않는다", async () => {
    const f = fixture();
    const id = await addConnection(f, "whsec_example");
    saveCheckedWebhookAddress(f.context.db, ADDRESS, now);
    const html = renderDetail(await loadSettingsPage(f.context, workspace, now), id);
    const text = textOf(html);
    expect(text).toContain(settings.webhook.status.waiting);
    expect(html).toMatch(new RegExp(`role="status"[^>]*>${settings.webhook.status.waiting}`));
    expect(text).toContain(settings.webhook.waiting.title);
    expect(text).toContain(`${ADDRESS}/api/webhooks/tracker/${id}`);
    expect(text).toContain(settings.webhook.off.label);
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain(settings.webhook.steps);
  });

  it("받고 있으면 마지막으로 받은 때를 보인다", async () => {
    const f = fixture();
    const id = await addConnection(f, "whsec_example");
    saveCheckedWebhookAddress(f.context.db, ADDRESS, now);
    recordWebhookAccepted(f.context.db, id, at(3));
    const text = textOf(renderDetail(await loadSettingsPage(f.context, workspace, now), id));
    expect(text).toContain(settings.webhook.status.receiving);
    expect(text).toContain(`${settings.webhook.lastReceived} 3 min ago`);
  });

  it("서명이 맞지 않으면 받지 못한 수와 처음 실패 시각, secret 다시 넣기를 보인다", async () => {
    const f = fixture();
    const id = await addConnection(f, "whsec_example");
    saveCheckedWebhookAddress(f.context.db, ADDRESS, now);
    recordWebhookAccepted(f.context.db, id, at(120));
    for (const minutes of [42, 30, 20, 10])
      recordWebhookBadSignature(f.context.db, id, at(minutes));
    const text = textOf(renderDetail(await loadSettingsPage(f.context, workspace, now), id));
    expect(text).toContain("Linear가 보낸 webhook 4개를 받지 못했어요");
    expect(text).toContain("08:18부터 서명이 맞지 않아요");
    expect(text).toContain(settings.webhook.rejected.reenter);
    expect(text).toContain(`${settings.webhook.lastReceived} 2 hr ago`);
  });

  it("켜졌는데 닿을 주소가 없으면 정하라고 알린다", async () => {
    const f = fixture();
    const id = await addConnection(f, "whsec_example");
    const text = textOf(renderDetail(await loadSettingsPage(f.context, workspace, now), id));
    expect(text).toContain(settings.webhook.address.notSet);
    expect(text).toContain(settings.webhook.urlMissing);
  });

  it("없는 연결이면 Settings 로 돌아가는 링크를 보인다", async () => {
    const f = fixture();
    const text = textOf(renderDetail(await loadSettingsPage(f.context, workspace, now), "missing"));
    expect(text).toContain(settings.connection.notFound);
  });
});

describe("Settings 연결 줄의 webhook 상태(0130)", () => {
  it("세 상태를 두 번째 글줄에 보이고, 서명 실패만 문제로 목차에 점을 붙인다", async () => {
    const f = fixture();
    const off = await addConnection(f);
    const receiving = await addConnection(f, "whsec_labs", "Labs");
    recordWebhookAccepted(f.context.db, receiving, at(3));
    let page = await loadSettingsPage(f.context, workspace, now);
    let text = textOf(renderSettings(page));
    expect(text).toContain("1분마다 읽어요 · webhook 켜기");
    expect(text).toContain("webhook으로 바로 받아요 · 마지막으로 받은 때 3 min ago");
    expect(sectionProblems(page, 0).has("connections")).toBe(true);

    recordWebhookBadSignature(f.context.db, receiving, at(18));
    page = await loadSettingsPage(f.context, workspace, now);
    text = textOf(renderSettings(page));
    expect(text).toContain("webhook 서명이 맞지 않아 받지 못해요 · 08:42부터");
    expect(renderSettings(page)).toContain(`href="/settings/connections/${off}?ws=${workspace}"`);
  });

  it("문제 점은 서명 실패에서만 생긴다", async () => {
    const f = fixture();
    const id = await addConnection(f, "whsec_example");
    const base = await loadSettingsPage(f.context, workspace, now);
    const complete: SettingsPage = {
      ...base,
      install: {
        ...base.install,
        githubToken: true,
        runners: [
          {
            id: "runner-a",
            name: "runner-a",
            sshTarget: "runner-a.example.com",
            orcaPath: "orca",
            access: "manual",
            capacity: 1,
            check: null,
          },
        ],
      },
    };
    expect(sectionProblems(complete, 0).has("connections")).toBe(false);
    recordWebhookBadSignature(f.context.db, id, at(1));
    const failing = await loadSettingsPage(f.context, workspace, now);
    expect(
      sectionProblems(
        { ...complete, install: { ...complete.install, connections: failing.install.connections } },
        0,
      ).has("connections"),
    ).toBe(true);
  });

  it("고급에는 webhook 주소 줄이 없다", async () => {
    const f = fixture();
    await addConnection(f);
    saveCheckedWebhookAddress(f.context.db, ADDRESS, now);
    const html = renderSettings(await loadSettingsPage(f.context, workspace, now));
    const advanced = html.slice(html.indexOf('<section id="advanced"'));
    expect(textOf(advanced)).not.toContain(settings.webhook.address.label);
    expect(textOf(advanced)).not.toContain(ADDRESS);
  });
});
