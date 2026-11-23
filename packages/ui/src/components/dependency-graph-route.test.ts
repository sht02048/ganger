import { describe, expect, it } from "vitest";
import { COLUMN_GAP, NODE_HEIGHT, NODE_WIDTH, ROW_GAP, edgeRoute } from "./dependency-graph-route";
import type { Point } from "./dependency-graph-route";

const at = (column: number, row: number): Point => ({
  x: column * (NODE_WIDTH + COLUMN_GAP),
  y: 28 + row * (NODE_HEIGHT + ROW_GAP),
});

function crossesBox(points: ReadonlyArray<Point>, box: Point): boolean {
  return points.slice(1).some((end, index) => {
    const start = points[index];
    if (start === undefined) return false;
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    return (
      left < box.x + NODE_WIDTH && right > box.x && top < box.y + NODE_HEIGHT && bottom > box.y
    );
  });
}

describe("관계도 화살표 경로(0182)", () => {
  it("두 열을 건너는 화살표는 같은 행의 중간 상자를 지나지 않는다", () => {
    const { points } = edgeRoute(at(0, 0), at(2, 0));
    expect(crossesBox(points, at(1, 0))).toBe(false);
    expect(crossesBox(points, at(1, 1))).toBe(false);
  });

  it("세 열을 건너 다른 행으로 가는 화살표도 중간 상자를 지나지 않는다", () => {
    const { points } = edgeRoute(at(0, 2), at(3, 0));
    for (const column of [1, 2]) {
      for (const row of [0, 1, 2]) expect(crossesBox(points, at(column, row))).toBe(false);
    }
  });

  it("같은 열에서 한 칸 넘게 떨어진 순환 화살표는 상자 옆으로 돌아간다", () => {
    const route = edgeRoute(at(0, 0), at(0, 2));
    expect(route.usesGutter).toBe(true);
    expect(crossesBox(route.points.slice(1, 3), at(0, 1))).toBe(false);
  });

  it("자기 자신을 기다리는 화살표는 상자 옆에 보인다", () => {
    const route = edgeRoute(at(1, 0), at(1, 0));
    expect(route.usesGutter).toBe(true);
    expect(Math.max(...route.points.map((point) => point.x))).toBeGreaterThan(
      at(1, 0).x + NODE_WIDTH,
    );
  });
});
