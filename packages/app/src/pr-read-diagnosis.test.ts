import type { GhAccountsReading } from "@ganger/core";
import { describe, expect, it } from "vitest";
import { diagnosePrRead, runnerGitHubLogin, serverGitHubOf } from "./pr-read-diagnosis.js";
import type { ServerGitHub } from "./pr-read-diagnosis.js";

const runnerWith = (reading: GhAccountsReading | null) => ({
  name: "runner-a",
  ghAccounts: reading,
});
const loggedIn = (
  ...accounts: Array<{ login: string; active: boolean; expired?: boolean; host?: string }>
): GhAccountsReading => ({
  kind: "logged-in",
  accounts: accounts.map((account) => ({
    host: account.host ?? "github.com",
    login: account.login,
    active: account.active,
    expired: account.expired ?? false,
  })),
});

const ghServer: ServerGitHub = { ghLogins: ["my-personal"], tokenSaved: false, tokenOnly: false };
const runnerDev = runnerWith(loggedIn({ login: "acme-dev", active: true }));

describe("PR 읽기 진단 (0207)", () => {
  it("러너와 서버의 계정이 다르면 두 계정을 함께 담는다", () => {
    expect(diagnosePrRead("no-access", runnerDev, ghServer)).toEqual({
      kind: "different",
      runner: "runner-a",
      runnerLogin: "acme-dev",
      server: { kind: "gh", logins: ["my-personal"] },
    });
  });

  it("서버 gh 계정 가운데 러너 계정이 있으면 계정 차이가 원인이 아니어서 진단하지 않는다", () => {
    expect(
      diagnosePrRead("no-access", runnerDev, {
        ...ghServer,
        ghLogins: ["my-personal", "ACME-dev"],
      }),
    ).toBeNull();
  });

  it("러너 gh 계정을 모르면 서버 계정만 담고 러너 계정은 모른다고 한다", () => {
    const unknown = [
      null,
      { kind: "logged-out" } as const,
      { kind: "not-installed" } as const,
      { kind: "unreadable" } as const,
      loggedIn({ login: "acme-dev", active: true, expired: true }),
      loggedIn({ login: "acme-dev", active: true, host: "ghe.acme.example" }),
    ];
    for (const reading of unknown) {
      expect(diagnosePrRead("no-access", runnerWith(reading), ghServer)).toEqual({
        kind: "runner-unknown",
        runner: "runner-a",
        server: { kind: "gh", logins: ["my-personal"] },
      });
    }
  });

  it("서버에 쓸 gh 계정이 없으면 붙여 넣은 토큰으로 읽는다고 하고, 둘 다 없으면 진단하지 않는다", () => {
    const tokenOnly = { ghLogins: [], tokenSaved: true, tokenOnly: false };
    expect(diagnosePrRead("no-access", runnerDev, tokenOnly)?.server).toEqual({ kind: "token" });
    expect(
      diagnosePrRead("no-access", runnerDev, { ...ghServer, tokenSaved: true, tokenOnly: true })
        ?.server,
    ).toEqual({ kind: "token" });
    expect(
      diagnosePrRead("no-access", runnerDev, { ghLogins: [], tokenSaved: false, tokenOnly: false }),
    ).toBeNull();
  });

  it("저장소를 볼 수 없는 경우가 아니거나 러너나 서버를 모르면 진단하지 않는다", () => {
    expect(diagnosePrRead("other", runnerDev, ghServer)).toBeNull();
    expect(diagnosePrRead(null, runnerDev, ghServer)).toBeNull();
    expect(diagnosePrRead("no-access", null, ghServer)).toBeNull();
    expect(diagnosePrRead("no-access", runnerDev, null)).toBeNull();
  });

  it("러너 계정은 github.com 의 만료되지 않은 사용 중 계정이다", () => {
    expect(
      runnerGitHubLogin(
        loggedIn(
          { login: "acme-old", active: false, expired: true },
          { login: "acme-ci", active: false },
          { login: "acme-dev", active: true },
        ),
      ),
    ).toBe("acme-dev");
  });
});

describe("서버 GitHub 계정 (0207)", () => {
  it("만료된 gh 계정은 서버 계정에서 빼고, 토큰 값은 담지 않는다", () => {
    const server = serverGitHubOf(
      {
        kind: "logged-in",
        accounts: [
          { login: "acme-old", expired: true },
          { login: "my-personal", expired: false },
        ],
      },
      [{ config: {}, secrets: { token: "github_pat_SECRET_1" } }],
    );
    expect(server).toEqual({ ghLogins: ["my-personal"], tokenSaved: true, tokenOnly: false });
    expect(JSON.stringify(server)).not.toContain("github_pat_SECRET_1");
  });

  it("토큰만 쓰는 연결은 tokenOnly 로 알아본다", () => {
    expect(
      serverGitHubOf({ kind: "missing" }, [
        { config: { credentials: "token" }, secrets: { token: "t" } },
      ]),
    ).toEqual({ ghLogins: [], tokenSaved: true, tokenOnly: true });
  });
});
