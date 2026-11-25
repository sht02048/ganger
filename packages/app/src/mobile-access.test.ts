import { getInstallSettings, migrate, openDatabase, saveInstallAddresses } from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it } from "vitest";
import {
  MOBILE_FALLBACK_PORTS,
  approvalUrlOf,
  loadMobileAccess,
  serveOffCommand,
  serveOnCommand,
  turnOffMobileAccess,
  turnOnMobileAccess,
} from "./mobile-access.js";
import type { CommandOutcome, MobileAccessContext, MobileAccessDeps } from "./mobile-access.js";
import { FUNNEL_PORTS_BY_PREFERENCE } from "./funnel-setup.js";

const CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const HOST = "studio.example.ts.net";
const TARGET = "http://127.0.0.1:3000";
const NOW = new Date("2026-11-25T00:00:00Z");
const APPROVAL = "https://login.tailscale.com/f/serve?node=abc";

type Backend = "Running" | "NeedsLogin" | "Stopped";

interface ServeJson {
  Web?: Record<string, unknown>;
  TCP?: Record<string, unknown>;
  AllowFunnel?: Record<string, boolean>;
}

interface FakeTailscale {
  installed: boolean;
  backend: Backend;
  serve: ServeJson | null;
  statusFails: boolean;
  commandFails: CommandOutcome | null;
}

function fakeTailscale(over: Partial<FakeTailscale> = {}) {
  const state: FakeTailscale = {
    installed: true,
    backend: "Running",
    serve: {},
    statusFails: false,
    commandFails: null,
    ...over,
  };
  const commands: string[][] = [];
  const deps: MobileAccessDeps = {
    env: {},
    exists: (path) => state.installed && path === CLI,
    run: (_file, args) => {
      if (state.statusFails) return Promise.resolve(undefined);
      if (args[0] === "status") {
        return Promise.resolve(
          JSON.stringify({ BackendState: state.backend, Self: { DNSName: `${HOST}.` }, Peer: {} }),
        );
      }
      return Promise.resolve(state.serve === null ? "not json" : JSON.stringify(state.serve));
    },
    command: (file, args) => {
      commands.push([file, ...args]);
      if (state.commandFails !== null) return Promise.resolve(state.commandFails);
      const port = args.find((arg) => arg.startsWith("--https="))?.slice("--https=".length);
      const target = args.at(-1);
      const key = `${HOST}:${port ?? ""}`;
      const others = Object.entries(state.serve?.Web ?? {}).filter(([site]) => site !== key);
      const opened: Array<[string, unknown]> =
        target === "off" ? [] : [[key, { Handlers: { "/": { Proxy: target } } }]];
      state.serve = { ...state.serve, Web: Object.fromEntries([...others, ...opened]) };
      return Promise.resolve({ ok: true, output: "" });
    },
  };
  return { state, deps, commands };
}

function database(): Database {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

function context(db: Database, deps: MobileAccessDeps): MobileAccessContext {
  return { db, bindHost: "127.0.0.1", webPort: 3000, deps };
}

const LOCAL = { host: "127.0.0.1:3000", bindHost: "127.0.0.1", webPort: 3000 };

const ours = { Web: { [`${HOST}:443`]: { Handlers: { "/": { Proxy: TARGET } } } } };
const webhookFunnelOn443 = {
  Web: {
    [`${HOST}:443`]: {
      Handlers: { "/api/webhooks/": { Proxy: `${TARGET}/api/webhooks/` } },
    },
  },
  AllowFunnel: { [`${HOST}:443`]: true },
};
const operatorMac = {
  TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true }, "10000": { HTTPS: true } },
  Web: {
    [`${HOST}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3131" } } },
    [`${HOST}:8443`]: {
      Handlers: {
        "/": { Proxy: "http://127.0.0.1:4000" },
        "/api/webhooks/": { Proxy: `${TARGET}/api/webhooks/` },
      },
    },
    [`${HOST}:10000`]: {
      Handlers: { "/api/webhooks/": { Proxy: `${TARGET}/api/webhooks/` } },
    },
  },
  AllowFunnel: { [`${HOST}:8443`]: true, [`${HOST}:10000`]: true },
};
const otherServiceOn443 = {
  Web: { [`${HOST}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3131" } } } },
};
const oursOn8444 = {
  ...operatorMac,
  Web: {
    ...operatorMac.Web,
    [`${HOST}:8444`]: { Handlers: { "/": { Proxy: TARGET } } },
  },
};
const everyCandidateTaken = {
  Web: Object.fromEntries(
    [443, ...MOBILE_FALLBACK_PORTS].map((port) => [
      `${HOST}:${String(port)}`,
      { Handlers: { "/": { Proxy: "http://127.0.0.1:3131" } } },
    ]),
  ),
};
const webhookFunnelOn8443 = {
  Web: {
    [`${HOST}:8443`]: {
      Handlers: { "/api/webhooks/": { Proxy: `${TARGET}/api/webhooks/` } },
    },
  },
  AllowFunnel: { [`${HOST}:8443`]: true },
};

describe("휴대폰에서 열기 상태", () => {
  it("Tailscale 이 켜져 있고 443 이 비어 있으면 이 Mac 이름과 함께 꺼짐이다", async () => {
    const { deps } = fakeTailscale();
    await expect(loadMobileAccess(context(database(), deps))).resolves.toEqual({
      kind: "off",
      host: HOST,
      portInUse: null,
    });
  });

  it("Tailscale 이 없거나 로그아웃·꺼짐이거나 읽지 못하면 Tailscale 이 필요하다", async () => {
    for (const over of [
      { installed: false },
      { backend: "NeedsLogin" as const },
      { backend: "Stopped" as const },
      { statusFails: true },
    ]) {
      const { deps } = fakeTailscale(over);
      await expect(loadMobileAccess(context(database(), deps))).resolves.toEqual({
        kind: "needs-tailscale",
      });
    }
  });

  it("443 을 webhook Funnel 이 써도 대체 포트가 있으면 막지 않는다", async () => {
    const { deps } = fakeTailscale({ serve: webhookFunnelOn443 });
    await expect(loadMobileAccess(context(database(), deps))).resolves.toEqual({
      kind: "off",
      host: HOST,
      portInUse: null,
    });
  });

  it("8443 의 webhook Funnel 은 443 과 겹치지 않는다", async () => {
    const { deps } = fakeTailscale({ serve: webhookFunnelOn8443 });
    await expect(loadMobileAccess(context(database(), deps))).resolves.toMatchObject({
      kind: "off",
      portInUse: null,
    });
  });

  it("열 주소가 저장돼 있으면 Tailscale 이 아닌 주소라도 그 주소로 켜짐이다", async () => {
    const db = database();
    saveInstallAddresses(
      db,
      { webAddress: "https://ganger.example.com", webhookAddress: null },
      NOW,
    );
    const { deps } = fakeTailscale({ installed: false });
    await expect(loadMobileAccess(context(db, deps))).resolves.toEqual({
      kind: "on",
      address: "https://ganger.example.com",
      viaTailscale: false,
      fallbackPort: null,
    });
  });

  it("켜서 저장한 MagicDNS 주소는 Tailscale 로 연 주소다", async () => {
    const db = database();
    saveInstallAddresses(db, { webAddress: `https://${HOST}`, webhookAddress: null }, NOW);
    const { deps } = fakeTailscale({ serve: ours });
    await expect(loadMobileAccess(context(db, deps))).resolves.toEqual({
      kind: "on",
      address: `https://${HOST}`,
      viaTailscale: true,
      fallbackPort: null,
    });
  });

  it("포트를 붙여 저장한 MagicDNS 주소는 Tailscale 로 그 포트에 연 주소다", async () => {
    const db = database();
    saveInstallAddresses(db, { webAddress: `https://${HOST}:8444`, webhookAddress: null }, NOW);
    const { deps } = fakeTailscale({ serve: oursOn8444 });
    await expect(loadMobileAccess(context(db, deps))).resolves.toEqual({
      kind: "on",
      address: `https://${HOST}:8444`,
      viaTailscale: true,
      fallbackPort: 8444,
    });
  });

  it("443 을 다른 서비스가 써도 대체 포트가 비어 있으면 켤 수 있다", async () => {
    const { deps } = fakeTailscale({ serve: operatorMac });
    await expect(loadMobileAccess(context(database(), deps))).resolves.toEqual({
      kind: "off",
      host: HOST,
      portInUse: null,
    });
  });

  it("443 과 대체 포트가 모두 차 있으면 443 의 쓰임을 보인다", async () => {
    const { deps } = fakeTailscale({ serve: everyCandidateTaken });
    await expect(loadMobileAccess(context(database(), deps))).resolves.toEqual({
      kind: "off",
      host: HOST,
      portInUse: { uses: ["/ → http://127.0.0.1:3131"], isPublic: false },
    });
  });
});

describe("휴대폰에서 열기 켜기", () => {
  it("tailnet 전용 Serve 를 443 → 이 서버로 켜고 열 주소를 MagicDNS https 주소로 저장한다", async () => {
    const db = database();
    const { deps, commands } = fakeTailscale();
    await expect(turnOnMobileAccess(context(db, deps), NOW)).resolves.toEqual({ ok: true });
    expect(commands).toEqual([[CLI, "serve", "--bg", "--yes", "--https=443", TARGET]]);
    expect(commands.flat()).not.toContain("funnel");
    expect(getInstallSettings(db).webAddress).toBe(`https://${HOST}`);
  });

  it("webhook 받을 주소는 그대로 둔다", async () => {
    const db = database();
    saveInstallAddresses(
      db,
      { webAddress: null, webhookAddress: "https://hooks.example.com" },
      NOW,
    );
    await turnOnMobileAccess(context(db, fakeTailscale().deps), NOW);
    expect(getInstallSettings(db).webhookAddress).toBe("https://hooks.example.com");
  });

  it("모든 주소에서 받게 띄운 서버도 127.0.0.1 로 잇는다", async () => {
    const db = database();
    const { deps, commands } = fakeTailscale();
    await turnOnMobileAccess({ ...context(db, deps), bindHost: "0.0.0.0" }, NOW);
    expect(commands[0]?.at(-1)).toBe(TARGET);
  });

  it("443 이 이미 이 서버로 열려 있으면 명령 없이 주소만 저장한다", async () => {
    const db = database();
    const { deps, commands } = fakeTailscale({ serve: ours });
    await expect(turnOnMobileAccess(context(db, deps), NOW)).resolves.toEqual({ ok: true });
    expect(commands).toEqual([]);
    expect(getInstallSettings(db).webAddress).toBe(`https://${HOST}`);
  });

  it("443 을 다른 서비스가 쓰면 덮어쓰지 않고 8444 로 열어 포트 붙은 주소를 저장한다", async () => {
    const db = database();
    const { deps, commands, state } = fakeTailscale({ serve: otherServiceOn443 });
    await expect(turnOnMobileAccess(context(db, deps), NOW)).resolves.toEqual({ ok: true });
    expect(commands).toEqual([[CLI, "serve", "--bg", "--yes", "--https=8444", TARGET]]);
    expect(getInstallSettings(db).webAddress).toBe(`https://${HOST}:8444`);
    expect(state.serve).toMatchObject(otherServiceOn443);
  });

  it("운영자 Mac 처럼 443·8443·10000 이 모두 쓰이면 Funnel 포트를 피해 8444 로 연다", async () => {
    const db = database();
    const { deps, commands, state } = fakeTailscale({ serve: operatorMac });
    await expect(turnOnMobileAccess(context(db, deps), NOW)).resolves.toEqual({ ok: true });
    expect(commands).toEqual([[CLI, "serve", "--bg", "--yes", "--https=8444", TARGET]]);
    expect(commands.flat()).not.toContain("funnel");
    expect(getInstallSettings(db).webAddress).toBe(`https://${HOST}:8444`);
    expect(state.serve).toMatchObject(operatorMac);
  });

  it("webhook 경로만 쓰는 포트도 피해 다음 빈 포트로 연다", async () => {
    const db = database();
    const webhookOn8444 = {
      Web: {
        ...otherServiceOn443.Web,
        [`${HOST}:8444`]: {
          Handlers: { "/api/webhooks/": { Proxy: `${TARGET}/api/webhooks/` } },
        },
      },
    };
    const { deps, commands } = fakeTailscale({ serve: webhookOn8444 });
    await turnOnMobileAccess(context(db, deps), NOW);
    expect(commands).toEqual([[CLI, "serve", "--bg", "--yes", "--https=8445", TARGET]]);
    expect(getInstallSettings(db).webAddress).toBe(`https://${HOST}:8445`);
  });

  it("이미 이 서버로 열린 대체 포트가 있으면 명령 없이 그 포트 주소를 저장한다", async () => {
    const db = database();
    const { deps, commands } = fakeTailscale({ serve: oursOn8444 });
    await expect(turnOnMobileAccess(context(db, deps), NOW)).resolves.toEqual({ ok: true });
    expect(commands).toEqual([]);
    expect(getInstallSettings(db).webAddress).toBe(`https://${HOST}:8444`);
  });

  it("443 과 대체 포트가 모두 차 있으면 덮어쓰지 않고 443 의 쓰임을 돌려준다", async () => {
    const db = database();
    const { deps, commands } = fakeTailscale({ serve: everyCandidateTaken });
    await expect(turnOnMobileAccess(context(db, deps), NOW)).resolves.toEqual({
      ok: false,
      reason: "port-in-use",
      portInUse: { uses: ["/ → http://127.0.0.1:3131"], isPublic: false },
    });
    expect(commands).toEqual([]);
    expect(getInstallSettings(db).webAddress).toBeNull();
  });

  it("Serve 상태를 읽지 못하면 덮어쓸까 봐 켜지 않는다", async () => {
    const db = database();
    const { deps, commands } = fakeTailscale({ serve: null });
    await expect(turnOnMobileAccess(context(db, deps), NOW)).resolves.toEqual({
      ok: false,
      reason: "serve-unreadable",
    });
    expect(commands).toEqual([]);
  });

  it("CLI 가 없거나 로그아웃이면 아무것도 하지 않는다", async () => {
    for (const over of [{ installed: false }, { backend: "NeedsLogin" as const }]) {
      const db = database();
      const { deps, commands } = fakeTailscale(over);
      await expect(turnOnMobileAccess(context(db, deps), NOW)).resolves.toEqual({
        ok: false,
        reason: "no-tailscale",
      });
      expect(commands).toEqual([]);
      expect(getInstallSettings(db).webAddress).toBeNull();
    }
  });

  it("명령이 실패하면 저장하지 않고, tailnet 에서 HTTPS 를 켜야 하면 그 주소를 돌려준다", async () => {
    const db = database();
    const { deps } = fakeTailscale({
      commandFails: {
        ok: false,
        output: `Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         ${APPROVAL}\n`,
      },
    });
    await expect(turnOnMobileAccess(context(db, deps), NOW)).resolves.toEqual({
      ok: false,
      reason: "serve-failed",
      approvalUrl: APPROVAL,
    });
    expect(getInstallSettings(db).webAddress).toBeNull();
  });

  it("명령이 성공이라 해도 Serve 가 이 서버로 열리지 않았으면 실패다", async () => {
    const db = database();
    const { deps } = fakeTailscale({ commandFails: { ok: true, output: "" } });
    await expect(turnOnMobileAccess(context(db, deps), NOW)).resolves.toEqual({
      ok: false,
      reason: "serve-failed",
    });
  });
});

describe("휴대폰에서 열기 끄기", () => {
  it("이 서버로 연 Serve 443 만 끄고 열 주소를 비운다", async () => {
    const db = database();
    saveInstallAddresses(db, { webAddress: `https://${HOST}`, webhookAddress: null }, NOW);
    const { deps, commands } = fakeTailscale({ serve: ours });
    await expect(turnOffMobileAccess(context(db, deps), NOW, LOCAL)).resolves.toEqual({
      ok: true,
    });
    expect(commands).toEqual([[CLI, "serve", "--https=443", "off"]]);
    expect(getInstallSettings(db).webAddress).toBeNull();
  });

  it("Tailscale 이 아닌 옛 열 주소는 Serve 를 건드리지 않고 비우기만 한다", async () => {
    const db = database();
    saveInstallAddresses(
      db,
      { webAddress: "https://ganger.example.com", webhookAddress: null },
      NOW,
    );
    const { deps, commands } = fakeTailscale({ serve: ours });
    await expect(turnOffMobileAccess(context(db, deps), NOW, LOCAL)).resolves.toEqual({
      ok: true,
    });
    expect(commands).toEqual([]);
    expect(getInstallSettings(db).webAddress).toBeNull();
  });

  it("대체 포트로 켠 Serve 는 그 포트만 끄고 다른 포트와 Funnel 은 그대로 둔다", async () => {
    const db = database();
    saveInstallAddresses(db, { webAddress: `https://${HOST}:8444`, webhookAddress: null }, NOW);
    const { deps, commands, state } = fakeTailscale({ serve: oursOn8444 });
    await expect(turnOffMobileAccess(context(db, deps), NOW, LOCAL)).resolves.toEqual({
      ok: true,
    });
    expect(commands).toEqual([[CLI, "serve", "--https=8444", "off"]]);
    expect(state.serve).toEqual(operatorMac);
    expect(getInstallSettings(db).webAddress).toBeNull();
  });

  it("443 을 다른 대상이 쓰고 있으면 그 설정은 끄지 않는다", async () => {
    const db = database();
    saveInstallAddresses(db, { webAddress: `https://${HOST}`, webhookAddress: null }, NOW);
    const { deps, commands } = fakeTailscale({ serve: webhookFunnelOn443 });
    await turnOffMobileAccess(context(db, deps), NOW, LOCAL);
    expect(commands).toEqual([]);
    expect(getInstallSettings(db).webAddress).toBeNull();
  });

  it("Serve 상태를 읽지 못하면 남은 Serve 를 두고 끄지 않는다", async () => {
    const db = database();
    saveInstallAddresses(db, { webAddress: `https://${HOST}`, webhookAddress: null }, NOW);
    const { deps, commands } = fakeTailscale({ serve: null });
    await expect(turnOffMobileAccess(context(db, deps), NOW, LOCAL)).resolves.toEqual({
      ok: false,
      reason: "serve-unreadable",
    });
    expect(commands).toEqual([]);
    expect(getInstallSettings(db).webAddress).toBe(`https://${HOST}`);
  });

  it("끄는 명령이 실패하면 열 주소를 그대로 둔다", async () => {
    const db = database();
    saveInstallAddresses(db, { webAddress: `https://${HOST}`, webhookAddress: null }, NOW);
    const { deps } = fakeTailscale({ serve: ours, commandFails: { ok: false, output: "" } });
    await expect(turnOffMobileAccess(context(db, deps), NOW, LOCAL)).resolves.toEqual({
      ok: false,
      reason: "serve-failed",
    });
    expect(getInstallSettings(db).webAddress).toBe(`https://${HOST}`);
  });

  it("자동 허용 tailnet 주소여도 끌 그 주소로 연 화면에서는 끄지 않는다", async () => {
    const db = database();
    saveInstallAddresses(db, { webAddress: `https://${HOST}`, webhookAddress: null }, NOW);
    const { deps, commands } = fakeTailscale({ serve: ours });
    const viaServe = { host: HOST, bindHost: "0.0.0.0", webPort: 3000, tailnetHosts: [HOST] };
    await expect(turnOffMobileAccess(context(db, deps), NOW, viaServe)).resolves.toEqual({
      ok: false,
      reason: "locks-out",
    });
    expect(commands).toEqual([]);
  });

  it("포트 붙은 주소로 연 화면에서도 끄지 않는다", async () => {
    const db = database();
    saveInstallAddresses(db, { webAddress: `https://${HOST}:8444`, webhookAddress: null }, NOW);
    const { deps, commands } = fakeTailscale({ serve: oursOn8444 });
    await expect(
      turnOffMobileAccess(context(db, deps), NOW, { ...LOCAL, host: `${HOST}:8444` }),
    ).resolves.toEqual({ ok: false, reason: "locks-out" });
    expect(commands).toEqual([]);
  });

  it("지금 그 주소로 연 화면에서는 끄지 않는다", async () => {
    const db = database();
    saveInstallAddresses(db, { webAddress: `https://${HOST}`, webhookAddress: null }, NOW);
    const { deps, commands } = fakeTailscale({ serve: ours });
    await expect(
      turnOffMobileAccess(context(db, deps), NOW, { ...LOCAL, host: HOST }),
    ).resolves.toEqual({ ok: false, reason: "locks-out" });
    expect(commands).toEqual([]);
    expect(getInstallSettings(db).webAddress).toBe(`https://${HOST}`);
  });
});

describe("Tailscale 명령과 출력", () => {
  it("켜기·끄기 명령은 Serve 만 쓰고 Funnel 은 쓰지 않는다", () => {
    expect(serveOnCommand(TARGET, 443)).toEqual(["serve", "--bg", "--yes", "--https=443", TARGET]);
    expect(serveOffCommand(8444)).toEqual(["serve", "--https=8444", "off"]);
  });

  it("대체 포트에는 webhook Funnel 이 고르는 포트가 없다", () => {
    for (const port of FUNNEL_PORTS_BY_PREFERENCE)
      expect(MOBILE_FALLBACK_PORTS).not.toContain(port);
  });

  it("승인 주소는 login.tailscale.com 의 https 주소만 받는다", () => {
    expect(approvalUrlOf(`visit ${APPROVAL} now`)).toBe(APPROVAL);
    expect(approvalUrlOf("visit https://evil.example.com/f/serve")).toBeUndefined();
    expect(approvalUrlOf("visit http://login.tailscale.com/f/serve")).toBeUndefined();
    expect(approvalUrlOf("")).toBeUndefined();
  });
});
