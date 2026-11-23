import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PILL_STATUSES, type PillStatus } from "@ganger/ui";
import { describe, expect, it } from "vitest";
import domain from "../messages/ko/domain.json" with { type: "json" };
import ds from "../messages/ko/ds.json" with { type: "json" };
import home from "../messages/ko/home.json" with { type: "json" };
import run from "../messages/ko/run.json" with { type: "json" };
import runners from "../messages/ko/runners.json" with { type: "json" };
import runs from "../messages/ko/runs.json" with { type: "json" };
import settings from "../messages/ko/settings.json" with { type: "json" };
import shell from "../messages/ko/shell.json" with { type: "json" };
import stats from "../messages/ko/stats.json" with { type: "json" };
import tickets from "../messages/ko/tickets.json" with { type: "json" };
import { HomeScreen } from "./home/home-screen";
import { loadHomePage } from "@ganger/app/home/load";
import { homeMessages } from "./home/messages";
import { useStatusName } from "./status";
import { pillsOf } from "./testing/pills";
import { renderWithMessages } from "./testing/render";
import { now, seedDatabase } from "./testing/seed";

const TERMS: Record<PillStatus, string> = {
  queued: "Queued",
  running: "Running",
  "waiting-for-input": "Waiting for Input",
  paused: "Paused",
  disconnected: "Disconnected",
  succeeded: "Succeeded",
  failed: "Failed",
  canceled: "Canceled",
  online: "Online",
  offline: "Offline",
  question: "Question",
  permission: "Permission",
  "human-check": "Human Check",
  "runner-issue": "Runner Issue",
};
const TERM_NAMES = new Set(Object.values(TERMS));
const SCREENS = ["Dashboard", "Tickets", "Runs", "Runners", "Stats", "Settings"];

describe("메시지 파일 낱말(ADR 0010 1·3번)", () => {
  it("런 상태·요약 결과·러너 상태·To do 종류는 GLOSSARY 영어 용어다", () => {
    expect(domain.runState).toEqual({
      queued: TERMS.queued,
      running: TERMS.running,
      "waiting-for-input": TERMS["waiting-for-input"],
      paused: TERMS.paused,
      disconnected: TERMS.disconnected,
      ended: "Ended",
    });
    expect(domain.summary).toEqual({
      succeeded: TERMS.succeeded,
      failed: TERMS.failed,
      canceled: TERMS.canceled,
    });
    expect(domain.runnerState).toEqual({ online: TERMS.online, offline: TERMS.offline });
    expect(domain.attention).toEqual({
      question: TERMS.question,
      permission: TERMS.permission,
      "human-check": TERMS["human-check"],
      failed: TERMS.failed,
      disconnected: TERMS.disconnected,
      "runner-issue": TERMS["runner-issue"],
    });
  });

  it("메뉴와 화면 제목은 영어 화면 이름이다", () => {
    const { label: _label, withIssues: _withIssues, ...nav } = shell.nav;
    expect(Object.values(nav)).toEqual(SCREENS);
    expect([home, tickets, runs, runners, stats, settings].map((m) => m.title)).toEqual(SCREENS);
  });

  it("화면 메시지의 상태 이름 자리도 영어 용어다", () => {
    expect(stats.throughput.columns.canceled).toBe(TERMS.canceled);
  });

  it("To do 는 이름 자리에서 To do, 필터와 문장 안에서는 처리할 일이다(ADR 0010 0068 갱신)", () => {
    expect(ds.typography.sampleHeading).toBe("To do");
    expect(home.view.todo).toBe("처리할 일만");
    expect(ds.tabs.todo).toBe(tickets.filter.todo);
    expect([run.reason.canceled, runs.panel.reason.canceled]).toEqual([
      "운영자가 취소한 런이에요. 처리할 일에 올리지 않아요.",
      "운영자가 취소한 런이에요. 처리할 일에 올리지 않아요.",
    ]);
  });

  it("useStatusName 은 상태 값마다 그 영어 용어를 준다", () => {
    function Names() {
      const name = useStatusName();
      return <>{PILL_STATUSES.map((status) => `${status}=${name(status)};`).join("")}</>;
    }
    const html = renderWithMessages(<Names />);
    for (const status of PILL_STATUSES) expect(html).toContain(`${status}=${TERMS[status]};`);
  });
});

describe("화면의 상태 알약", () => {
  it("Dashboard 의 알약 글은 영어 용어이고 상태 값과 맞는다", () => {
    const { db } = seedDatabase();
    const pills = [
      ...pillsOf(
        renderWithMessages(
          <HomeScreen
            page={loadHomePage(db, "ws-commerce", now, "UTC")}
            onAnswer={() => Promise.resolve()}
            onHumanCheck={() => Promise.resolve()}
            onDeny={() => Promise.resolve()}
            onControl={() => Promise.resolve("requested" as const)}
            onMerge={() => Promise.resolve({ ok: true as const, replayed: false })}
            onLoadCommits={() => Promise.resolve([])}
          />,
          homeMessages,
        ),
      ),
    ];
    expect(pills.length).toBeGreaterThan(5);
    for (const pill of pills) {
      expect(TERM_NAMES.has(pill.label)).toBe(true);
      expect(pill.label).toBe(new Map(Object.entries(TERMS)).get(pill.status));
    }
  });
});

describe("상태 표시 컴포넌트는 StatusPill 하나다(ADR 0010 4번)", () => {
  const root = new URL(".", import.meta.url).pathname;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });

  it("앱 코드는 @ganger/ui 에서 다른 상태 표시(Status, Dot, Badge)를 가져오지 않는다", () => {
    const offenders: string[] = [];
    for (const file of files(root)) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"@ganger\/ui"/g)) {
        const names = (m[1] ?? "").split(",").map((n) => n.replace(/^\s*type\s+/, "").trim());
        for (const name of names) {
          if (/^(Status|StatusTone|Dot|DotTone|Badge)$/.test(name))
            offenders.push(`${relative(root, file)}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("앱 코드는 상태 색을 직접 고르지 않는다(statusTone·data-status 는 packages/ui 만)", () => {
    const offenders = files(root)
      .filter((file) => /statusTone\(|data-status=/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file))
      .filter((file) => !file.startsWith("ds/") && !file.startsWith("testing/"));
    expect(offenders).toEqual([]);
  });
});
