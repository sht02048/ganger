import type { IssueGroupPhase } from "@ganger/ui";
import { describe, expect, it } from "vitest";
import { rowOffsets, windowOf } from "./row-window";
import { listBlocks, movingChildPhases, withClosingGroupsOpen } from "./ticket-rows";
import type { BlockRow, TicketListBlock as Block } from "./ticket-rows";

type TicketListBlock = Block<BlockRow>;

function parent(id: string): BlockRow {
  return { kind: "parent", id, surface: "first" };
}

function child(id: string, surface: "middle" | "last" = "middle"): BlockRow {
  return { kind: "child", id, surface };
}

function loose(id: string): BlockRow {
  return { kind: "loose", id };
}

const rows: BlockRow[] = [
  parent("p"),
  child("c1"),
  child("c2"),
  child("c3", "last"),
  loose("after1"),
  loose("after2"),
];
const offsets = rowOffsets(rows.map(() => 50));

function bodyOf(blocks: TicketListBlock[]) {
  const body = blocks.find((block) => block.kind === "body");
  if (body?.kind !== "body") throw new Error("no body");
  return body;
}

function shownIds(blocks: TicketListBlock[]): string[] {
  return blocks.flatMap((block) => {
    if (block.kind === "row") return [block.row.id];
    if (block.kind !== "body") return [];
    return block.items.flatMap((item) => (item.kind === "line" ? [item.row.id] : []));
  });
}

function totalHeight(blocks: TicketListBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    if (block.kind === "space") total += block.height;
    else if (block.kind === "row") total += 50;
    else for (const item of block.items) total += item.kind === "space" ? item.height : 50;
  }
  return total;
}

describe("움직이는 묶음의 줄 배치(0175)", () => {
  it("멈춰 있으면 단계 없이 그리고 마지막 하위 줄 면을 지킨다", () => {
    const blocks = listBlocks(
      rows,
      { start: 0, end: rows.length, offsets, collapsed: null },
      new Map(),
    );
    const body = bodyOf(blocks);
    expect(body.phase).toBeUndefined();
    const last = body.items.at(-1);
    expect(last?.kind === "line" && last.row.kind === "child" && last.row.surface).toBe("last");
  });

  it("움직이는 동안 마지막 하위 줄은 가운데 면이고 꼬리는 본문이 맡는다", () => {
    const phases = new Map<string, IssueGroupPhase>([["p", "closing"]]);
    const body = bodyOf(
      listBlocks(rows, { start: 0, end: rows.length, offsets, collapsed: null }, phases),
    );
    const last = body.items.at(-1);
    expect(last?.kind === "line" && last.row.kind === "child" && last.row.surface).toBe("middle");
  });

  it("창 밖 하위 줄은 본문 안 빈 공간이 돼 묶음 전체 높이를 지킨다", () => {
    const phases = new Map<string, IssueGroupPhase>([["p", "opening"]]);
    const blocks = listBlocks(rows, { start: 0, end: 2, offsets, collapsed: null }, phases);
    const body = bodyOf(blocks);
    expect(body.items.map((item) => item.kind)).toEqual(["line", "space", "line"]);
    expect(totalHeight(blocks)).toBe(300);
  });

  it("두 묶음이 함께 움직이면 위 묶음이 낮은 동안 보이는 아래 묶음의 줄도 그린다", () => {
    const twoGroups: BlockRow[] = [
      parent("a"),
      ...Array.from({ length: 20 }, (_, i) => child(`a${i}`, i === 19 ? "last" : "middle")),
      parent("b"),
      ...Array.from({ length: 5 }, (_, i) => child(`b${i}`, i === 4 ? "last" : "middle")),
    ];
    const phases = new Map<string, IssueGroupPhase>([
      ["a", "opening"],
      ["b", "opening"],
    ]);
    const moving = movingChildPhases(twoGroups, phases);
    const full = rowOffsets(twoGroups.map(() => 52));
    const closed = rowOffsets(twoGroups.map((row) => (moving.has(row.id) ? 0 : 52)));
    const main = windowOf(full, 0, 600);
    const blocks = listBlocks(
      twoGroups,
      {
        start: main.start,
        end: main.end,
        offsets: full,
        collapsed: { ...windowOf(closed, 0, 600), offsets: closed, from: 0, to: 600 },
      },
      phases,
    );
    expect(shownIds(blocks)).toEqual(expect.arrayContaining(["b", "b0", "b1", "b2", "b3", "b4"]));
  });

  it("접힌 배치에서 보이는 아래 줄도 함께 그려 밀려 올라오게 한다", () => {
    const phases = new Map<string, IssueGroupPhase>([["p", "closing"]]);
    const moving = movingChildPhases(rows, phases);
    const collapsedOffsets = rowOffsets(rows.map((row) => (moving.has(row.id) ? 0 : 50)));
    const collapsed = {
      ...windowOf(collapsedOffsets, 0, 120, 0),
      offsets: collapsedOffsets,
      from: 0,
      to: 120,
    };
    const blocks = listBlocks(rows, { start: 0, end: 3, offsets, collapsed }, phases);
    expect(shownIds(blocks)).toEqual(["p", "c1", "c2", "c3", "after1", "after2"]);
    expect(totalHeight(blocks)).toBe(300);
  });

  it("접히는 묶음만 펼친 채로 두고 저장한 펼침 값은 바꾸지 않는다", () => {
    const overrides = new Map([["p", false]]);
    const presented = withClosingGroupsOpen(overrides, new Map([["p", "closing"]]));
    expect(presented.get("p")).toBe(true);
    expect(overrides.get("p")).toBe(false);
    expect(withClosingGroupsOpen(overrides, new Map([["p", "opening"]]))).toBe(overrides);
  });

  it("단계가 없으면 움직이는 하위 줄도 없다", () => {
    expect(movingChildPhases(rows, new Map()).size).toBe(0);
    expect([...movingChildPhases(rows, new Map([["p", "opening"]])).keys()]).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });
});
