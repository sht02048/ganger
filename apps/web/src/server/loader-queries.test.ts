import {
  toAgentId,
  toAgentRef,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
  toWorktreeRef,
} from "@ganger/core";
import { assignRun, changeRunState } from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it, vi } from "vitest";
import { loadHomePage } from "@ganger/app/home/load";
import { loadRunnersPage } from "@ganger/app/runners/load";
import { loadRunsBoard } from "@ganger/app/runs/board-load";
import { loadRunsPage } from "@ganger/app/runs/load";
import { loadShell } from "@ganger/app/shell/load";
import { loadStatsPage } from "@ganger/app/stats/load";
import { loadTicketRuns } from "@ganger/app/tickets/load";
import { commerce, connection, minutes, now, seedDatabase } from "../testing/seed";

function statementsFor(db: Database, read: () => unknown): number {
  const prepare = vi.spyOn(db.$client, "prepare");
  try {
    read();
    return prepare.mock.calls.length;
  } finally {
    prepare.mockRestore();
  }
}

function addEndedRuns(db: Database, from: number, count: number): void {
  for (let i = from; i < from + count; i += 1) {
    const key = `ACME-${500 + i}`;
    const assigned = assignRun(db, {
      ticket: { connection, key: toTicketKey(key) },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("claude"),
      now: minutes(60),
    });
    if (!assigned.ok) throw new Error(assigned.reason);
    const { id } = assigned.run;
    for (const change of [
      changeRunState(
        db,
        id,
        {
          to: "running",
          started: {
            worktree: toWorktreeRef(`wt-${key}`),
            branch: `acme/${key}`,
            agentRef: toAgentRef(`agent-${key}`),
          },
        },
        minutes(61),
      ),
      changeRunState(
        db,
        id,
        { to: "ended", agentResult: "timed-out", prState: "open" },
        minutes(90),
      ),
    ]) {
      if (!change.ok) throw new Error(JSON.stringify(change));
    }
  }
}

const loaders: ReadonlyArray<[string, (db: Database) => unknown]> = [
  ["셸", (db) => loadShell(db)],
  ["Dashboard", (db) => loadHomePage(db, commerce, now, "UTC")],
  ["Runs", (db) => loadRunsPage(db, commerce, now, 20, {}, "UTC")],
  [
    "Runs 보드",
    (db) => loadRunsBoard(db, commerce, now, { endedLimit: 50, view: "all", timeZone: "UTC" }),
  ],
  ["Runners", (db) => loadRunnersPage(db, now)],
  ["Stats", (db) => loadStatsPage(db, commerce, now, "UTC", 30)],
  ["Tickets 의 DB 부분", (db) => loadTicketRuns(db, commerce, now)],
];

describe("화면 로더의 쿼리 수(0117)", () => {
  it.each(loaders)("%s 로더는 런이 늘어도 같은 수의 쿼리로 읽는다", (_name, load) => {
    const { db } = seedDatabase();
    addEndedRuns(db, 0, 30);
    const before = statementsFor(db, () => load(db));
    addEndedRuns(db, 30, 30);
    expect(statementsFor(db, () => load(db))).toBe(before);
  });
});
