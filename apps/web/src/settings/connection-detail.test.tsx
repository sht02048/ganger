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
import { funnelPrefillAddress } from "@ganger/app/funnel-setup";
import type { SettingsPage, WebhookSetupView } from "@ganger/app/settings/model";
import { webhookPingAnswer } from "@ganger/app/webhook-address";
import type { PingFetch } from "@ganger/app/webhook-address";
import settings from "../../messages/ko/settings.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import { ConnectionDetailScreen } from "./connection-detail";
import { ConnectionsScreen } from "./connections-page";
import { settingsMessages } from "./messages";
import { EditorProvider } from "./row-state";
import { pageProblems } from "./settings-frame";
import { WEBHOOK_ADDRESS_ROW_ID, plainSettingsLink } from "./settings-page";
import type { SettingsActions } from "./settings-screen";
import { AddressEditor } from "./webhook-section";

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
  checkGitHub: () => Promise.resolve({ ok: true }),
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

function renderDetail(page: SettingsPage, connectionId: string): string {
  return renderWithMessages(
    <ConnectionDetailScreen
      page={page}
      connectionId={connectionId}
      actions={noopActions}
      renderLink={plainSettingsLink(workspace)}
      nav={null}
    />,
    settingsMessages,
  );
}

function renderConnections(page: SettingsPage, setup: WebhookSetupView = noTailscale): string {
  return renderWithMessages(
    <ConnectionsScreen
      page={page}
      setup={setup}
      github={undefined}
      actions={noopActions}
      renderLink={plainSettingsLink(workspace)}
      nav={null}
    />,
    settingsMessages,
  );
}

function renderAddressEditor(setup: WebhookSetupView, initial = ""): string {
  return renderWithMessages(
    <EditorProvider>
      <AddressEditor
        initial={initial === "" ? (funnelPrefillAddress(setup.funnel) ?? "") : initial}
        setup={setup}
        actions={noopActions}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </EditorProvider>,
    settingsMessages,
  );
}

const ADDRESS_LINK = `href="/settings/connections?ws=${workspace}#${WEBHOOK_ADDRESS_ROW_ID}"`;

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
  it("닿을 주소가 없으면 1단계만 열리고, 주소는 연결 페이지에서 정하라고 그 줄로 잇는다(0214)", async () => {
    const f = fixture();
    const id = await addConnection(f);
    const html = renderDetail(await loadSettingsPage(f.context, workspace, now), id);
    const text = textOf(html);
    expect(text).toContain(settings.webhook.status.off);
    expect(stepOf(html, 1)).toContain('aria-current="step"');
    expect(textOf(stepOf(html, 1))).toContain(settings.webhook.address.shared);
    expect(stepOf(html, 1)).toContain(ADDRESS_LINK);
    expect(stepOf(html, 1)).not.toContain('name="webhookAddress"');
    expect(textOf(stepOf(html, 2))).toContain(settings.webhook.stepState.locked);
    expect(textOf(stepOf(html, 3))).toContain(settings.webhook.stepState.locked);
    expect(textOf(stepOf(html, 2))).not.toContain(settings.webhook.create.urlLabel);
    expect(stepOf(html, 3)).not.toContain('type="password"');
    expect(html).not.toContain(settings.connection.apiKey);
  });

  it("주소 편집기는 Funnel 이 없으면 다른 방법 링크와 역방향 프록시 도움말을 보인다", () => {
    const html = renderAddressEditor(noTailscale);
    expect(textOf(html)).not.toContain(settings.webhook.address.funnelTitle);
    expect(html).toContain(
      'href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/"',
    );
    expect(html).toContain(`${settings.webhook.address.reverseProxy} 도움말`);
  });

  it("Funnel 포트가 다 차면 쓰는 곳을 보이고 고르기 전에는 명령과 주소를 내지 않는다", () => {
    const step = renderAddressEditor(portsFull);
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

  it("포트 상태를 모르면 webhook 경로만 연다고 말하지 않는다", () => {
    const unknownPort: WebhookSetupView = {
      funnel: {
        kind: "ready",
        port: 8443,
        portState: "unknown",
        command: "tailscale funnel --bg --https=8443",
        address: "https://server.example.ts.net:8443",
      },
    };
    const step = textOf(renderAddressEditor(unknownPort));
    expect(step).toContain(settings.webhook.address.funnelRunShared);
    expect(step).not.toContain(settings.webhook.address.funnelRun);
  });

  it("WEB_HOST 가 이 기기의 tailnet 주소면 명령 대신 127.0.0.1 에서도 받게 하라고 안내한다", () => {
    const step = textOf(renderAddressEditor(boundToTailnet));
    expect(step).toContain("100.64.0.10");
    expect(step).toContain("127.0.0.1에서도 받게 해 주세요");
    expect(step).not.toContain("tailscale funnel --bg");
  });

  it("Tailscale 이 있으면 명령과 처음 허용 안내를 보이고 주소를 미리 채운다", () => {
    const step = renderAddressEditor(withTailscale);
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
    expect(stepOf(html, 1)).toContain(ADDRESS_LINK);
  });

  it("2단계는 Linear webhook 폼의 칸별 값을, 3단계는 API 키와 다른 signing secret 이라고 보인다", async () => {
    const f = fixture();
    const id = await addConnection(f);
    saveCheckedWebhookAddress(f.context.db, ADDRESS, now);
    const html = renderDetail(await loadSettingsPage(f.context, workspace, now), id);
    const create = textOf(stepOf(html, 2));
    const c = settings.webhook.create;
    for (const [label, value] of [
      [c.formLabel, c.formLabelValue],
      [c.formUrl, c.formUrlValue],
      [c.formEvents, c.formEventsValue],
      [c.formTeams, c.formTeamsValue],
    ]) {
      expect(create).toContain(`${label} ${value}`);
    }
    expect(stepOf(html, 2)).toContain(`aria-label="${c.formInfoLabel} 도움말"`);
    const secret = stepOf(html, 3);
    expect(textOf(secret)).toContain(settings.webhook.secret.description);
    expect(textOf(secret)).toContain("lin_api_");
    expect(secret).toMatch(/<label[^>]*>webhook signing secret \(lin_wh_…\)/);
  });

  it("확인하지 않고 저장된 예전 주소는 끝난 단계로 보지 않고, 연결 페이지의 주소 줄이 확인하라고 알린다", async () => {
    const f = fixture();
    const id = await addConnection(f);
    saveInstallAddresses(
      f.context.db,
      { webAddress: null, webhookAddress: "http://192.168.0.10:3000" },
      now,
    );
    const page = await loadSettingsPage(f.context, workspace, now);
    const html = renderDetail(page, id);
    expect(stepOf(html, 1)).toContain('aria-current="step"');
    expect(textOf(stepOf(html, 1))).not.toContain(settings.webhook.address.verified);
    expect(textOf(stepOf(html, 2))).toContain(settings.webhook.stepState.locked);
    expect(textOf(renderConnections(page))).toContain(
      "http://192.168.0.10:3000 · 아직 닿는지 확인하지 않았어요",
    );
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

  it("없는 연결이면 연결 페이지로 가는 링크를 보인다", async () => {
    const f = fixture();
    const html = renderDetail(await loadSettingsPage(f.context, workspace, now), "missing");
    expect(textOf(html)).toContain(settings.connection.notFound);
    expect(html).toContain(`href="/settings/connections?ws=${workspace}"`);
  });
});

describe("연결 페이지(0214)", () => {
  it("연결마다 webhook 줄에 지금 상태 문장을 보이고, 설정은 그 연결의 webhook 단계로 간다", async () => {
    const f = fixture();
    const off = await addConnection(f);
    const receiving = await addConnection(f, "whsec_labs", "Labs");
    recordWebhookAccepted(f.context.db, receiving, at(3));
    let page = await loadSettingsPage(f.context, workspace, now);
    let text = textOf(renderConnections(page));
    expect(text).toContain("꺼져 있어요 · 1분마다 읽어요");
    expect(text).toContain("바로 받아요 · 마지막으로 받은 때 3 min ago");
    expect(pageProblems(page).has("connections")).toBe(true);

    recordWebhookBadSignature(f.context.db, receiving, at(18));
    page = await loadSettingsPage(f.context, workspace, now);
    const html = renderConnections(page);
    text = textOf(html);
    expect(text).toContain("서명이 맞지 않아 받지 못해요 · 08:42부터");
    expect(html).toContain(`href="/settings/connections/${off}?ws=${workspace}"`);
    expect(html).toContain('aria-label="Labs webhook 설정"');
  });

  it("API 키 줄은 키 값이나 넣어 둔 상태를 보이지 않고 키 바꾸기만 둔다", async () => {
    const f = fixture();
    await addConnection(f);
    const html = renderConnections(await loadSettingsPage(f.context, workspace, now));
    const text = textOf(html);
    expect(text).toContain(settings.connection.apiKey);
    expect(text).toContain(settings.connections.changeKey);
    expect(text).toContain(settings.connections.check);
    expect(html).not.toContain("lin_api_example");
    expect(text).not.toContain("넣어 뒀어요");
    expect(text).not.toContain("•");
    expect(html).not.toContain('type="password"');
  });

  it("webhook 받을 주소는 맨 위 한 줄에만 있고, 확인한 주소를 보인다", async () => {
    const f = fixture();
    await addConnection(f);
    await addConnection(f, "whsec_labs", "Labs");
    saveCheckedWebhookAddress(f.context.db, ADDRESS, now);
    const html = renderConnections(await loadSettingsPage(f.context, workspace, now));
    expect(html.match(new RegExp(`id="${WEBHOOK_ADDRESS_ROW_ID}"`, "g"))).toHaveLength(1);
    expect(html.match(new RegExp(ADDRESS, "g"))).toHaveLength(1);
    expect(textOf(html)).toContain(settings.connections.webhookAddress);
    expect(html).toContain(`aria-label="${settings.connections.webhookAddress} 도움말"`);
    expect(html.indexOf(WEBHOOK_ADDRESS_ROW_ID)).toBeLessThan(
      html.indexOf(settings.connection.apiKey),
    );
  });

  it("문제 점은 서명 실패에서만 생기고 러너 상태는 보지 않는다", async () => {
    const f = fixture();
    const id = await addConnection(f, "whsec_example");
    const base = await loadSettingsPage(f.context, workspace, now);
    const complete: SettingsPage = {
      ...base,
      install: { ...base.install, githubConnected: true, githubToken: true, runners: [] },
    };
    expect(pageProblems(complete).has("connections")).toBe(false);
    recordWebhookBadSignature(f.context.db, id, at(1));
    const failing = await loadSettingsPage(f.context, workspace, now);
    expect(
      pageProblems({
        ...complete,
        install: { ...complete.install, connections: failing.install.connections },
      }).has("connections"),
    ).toBe(true);
  });

  it("러너 줄은 없다(레일 Runners와 겹침)", async () => {
    const f = fixture();
    await addConnection(f);
    const html = renderConnections(await loadSettingsPage(f.context, workspace, now));
    expect(html).not.toContain('href="/runners');
  });
});
