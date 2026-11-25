import { describe, expect, it } from "vitest";

import { busySnapshot } from "../demo/data";
import { runsOf } from "../dashboard/model";
import { reuseRuns } from "./reuse-runs";

const NOW = new Date("2026-11-25T03:00:00.000Z");
const read = () => structuredClone(busySnapshot(NOW).dashboardFor("all"));

describe("런 객체 재사용(티켓 0225)", () => {
  it("내용이 같으면 이전 대시보드를 그대로 쓴다", () => {
    const previous = read();
    expect(reuseRuns(previous, read())).toBe(previous);
  });

  it("한 런만 바뀌면 그 런만 새 객체고 다른 런과 바뀌지 않은 칸은 이전 것을 쓴다", () => {
    const previous = read();
    const next = read();
    const [changed, ...others] = next.columns.running.todo;
    if (changed === undefined) throw new Error("demo has no todo run");
    next.columns.running.todo = [{ ...changed, ticketTitle: "새 제목" }, ...others];
    const merged = reuseRuns(previous, next);
    expect(merged).not.toBe(previous);
    expect(merged.columns.running.todo[0]?.ticketTitle).toBe("새 제목");
    const before = new Map(runsOf(previous).map((run) => [run.id, run]));
    const renewed = runsOf(merged)
      .filter((run) => run !== before.get(run.id))
      .map((run) => run.id);
    expect(renewed).toEqual([changed.id]);
    expect(merged.columns.queued).toBe(previous.columns.queued);
    expect(merged.columns.done.rest).toBe(previous.columns.done.rest);
    expect(merged.columns.running.todo).not.toBe(previous.columns.running.todo);
  });

  it("칸을 옮긴 런도 내용이 같으면 이전 객체를 쓰고, 순서가 바뀐 칸은 새 배열이다", () => {
    const previous = read();
    const next = read();
    const moved = next.columns.running.todo.shift();
    if (moved === undefined) throw new Error("demo has no todo run");
    next.columns.running.rest = [moved, ...next.columns.running.rest];
    const merged = reuseRuns(previous, next);
    expect(merged.columns.running.rest[0]).toBe(previous.columns.running.todo[0]);
    expect(merged.columns.running.rest).not.toBe(previous.columns.running.rest);
  });
});
