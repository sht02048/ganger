import { describe, expect, it } from "vitest";
import {
  ISSUE_LINE_MOTION_MAX_CHILDREN,
  ISSUE_LINE_STAGGER_MS,
  MOTION_BURST_LIMIT,
  chooseMoveStyle,
  diffMotionOrders,
  hasIssueLineMotion,
  issueGroupPhaseFor,
  issueGroupSettleMs,
  issueLineDelayMs,
  keepsViewTransition,
  reconcileMotionRows,
  type MotionBox,
  type MotionRow,
} from "./components/motion-plan";
import { parseDurationMs } from "./components/motion-token";

const viewport: MotionBox = { left: 0, top: 0, right: 1000, bottom: 800 };
const box = (left: number, top: number): MotionBox => ({
  left,
  top,
  right: left + 200,
  bottom: top + 60,
});
const slideInput = {
  changeCount: 1,
  reducedMotion: false,
  crossesList: true,
  from: box(0, 0),
  to: box(320, 0),
  visibleArea: viewport,
};

describe("한꺼번에 많이 바뀜 판단(M3)", () => {
  it("한 행을 맨 위로 올리면 밀려난 행은 세지 않고 1건이다", () => {
    const changes = diffMotionOrders(
      [{ listId: "a", keys: ["1", "2", "3", "4", "5", "6"] }],
      [{ listId: "a", keys: ["6", "1", "2", "3", "4", "5"] }],
    );
    expect(changes.count).toBe(1);
    expect([...changes.displaced]).toEqual(["6"]);
  });

  it("칸 사이로 옮긴 카드, 들어온 카드, 빠진 카드를 따로 센다", () => {
    const changes = diffMotionOrders(
      [
        { listId: "q", keys: ["1", "2"] },
        { listId: "r", keys: ["3"] },
      ],
      [
        { listId: "q", keys: ["2", "9"] },
        { listId: "r", keys: ["1"] },
      ],
    );
    expect([...changes.crossed]).toEqual(["1"]);
    expect([...changes.entered]).toEqual(["9"]);
    expect([...changes.left]).toEqual(["3"]);
    expect(changes.count).toBe(3);
  });

  it("3건까지는 미끄러지고 4건부터 흐려진다", () => {
    expect(chooseMoveStyle({ ...slideInput, changeCount: MOTION_BURST_LIMIT })).toBe("slide");
    expect(chooseMoveStyle({ ...slideInput, changeCount: MOTION_BURST_LIMIT + 1 })).toBe("fade");
  });

  it("옮겨 갈 자리가 보이는 영역 밖이면 흐려진다", () => {
    expect(chooseMoveStyle({ ...slideInput, to: box(320, 900) })).toBe("fade");
  });

  it("칸이 세로로 쌓여 옮기면 흐려지고, 같은 목록 안 이동은 미끄러진다", () => {
    const stacked = { ...slideInput, to: box(0, 400) };
    expect(chooseMoveStyle(stacked)).toBe("fade");
    expect(chooseMoveStyle({ ...stacked, crossesList: false })).toBe("slide");
  });
});

describe("View Transition 유지 판단(M3)", () => {
  it("옮긴 행 없이 4건이 들어와도 전환을 건너뛴다", () => {
    expect(keepsViewTransition(MOTION_BURST_LIMIT + 1, [])).toBe(false);
  });

  it("3건 이하이고 바뀐 행이 모두 미끄러지면 유지한다", () => {
    expect(keepsViewTransition(MOTION_BURST_LIMIT, ["slide"])).toBe(true);
  });

  it("바뀐 행 하나라도 흐려지면 건너뛴다", () => {
    expect(keepsViewTransition(1, ["fade"])).toBe(false);
  });
});

describe("시간 토큰 읽기", () => {
  it("빌드가 줄여 쓴 초 단위도 밀리초로 읽는다", () => {
    expect(parseDurationMs("160ms")).toBe(160);
    expect(parseDurationMs("0.16s")).toBeCloseTo(160);
    expect(parseDurationMs(".3s")).toBeCloseTo(300);
  });

  it("읽을 수 없는 값은 움직이지 않게 0 이다", () => {
    expect(parseDurationMs("")).toBe(0);
    expect(parseDurationMs("fast")).toBe(0);
  });
});

describe("움직임 줄이기(M4)", () => {
  it("다른 조건이 모두 미끄러짐이어도 흐려진다", () => {
    expect(chooseMoveStyle({ ...slideInput, reducedMotion: true })).toBe("fade");
  });
});

describe("상위 이슈 펼치고 접기(0175)", () => {
  const timing = { openMs: 220, closeMs: 160, lineEnterMs: 200, lineFadeMs: 120 };

  it("하위 줄은 30ms 간격이고 9번째 줄부터 8번째 줄과 함께 나타난다", () => {
    expect(issueLineDelayMs(0, 12)).toBe(0);
    expect(issueLineDelayMs(1, 12)).toBe(ISSUE_LINE_STAGGER_MS);
    expect(issueLineDelayMs(7, 12)).toBe(210);
    expect(issueLineDelayMs(8, 12)).toBe(210);
    expect(issueLineDelayMs(11, 12)).toBe(210);
  });

  it("하위가 30개까지는 줄 효과가 있고 넘으면 뺀다", () => {
    expect(hasIssueLineMotion(ISSUE_LINE_MOTION_MAX_CHILDREN)).toBe(true);
    expect(hasIssueLineMotion(ISSUE_LINE_MOTION_MAX_CHILDREN + 1)).toBe(false);
    expect(issueLineDelayMs(5, ISSUE_LINE_MOTION_MAX_CHILDREN + 1)).toBe(0);
  });

  it("움직임 줄이기면 단계 없이 바로 바뀐다", () => {
    expect(issueGroupPhaseFor(true, true)).toBeNull();
    expect(issueGroupPhaseFor(false, true)).toBeNull();
    expect(issueGroupPhaseFor(true, false)).toBe("opening");
    expect(issueGroupPhaseFor(false, false)).toBe("closing");
  });

  it("끝나는 시간은 가장 늦은 움직임을 기다린다", () => {
    const opening = issueGroupSettleMs({ ...timing, phase: "opening", childCount: 12 });
    expect(opening).toBeGreaterThanOrEqual(200 + 210);
    const big = issueGroupSettleMs({ ...timing, phase: "opening", childCount: 31 });
    expect(big).toBeGreaterThanOrEqual(220);
    expect(big).toBeLessThan(200 + 210);
    const closing = issueGroupSettleMs({ ...timing, phase: "closing", childCount: 12 });
    expect(closing).toBeGreaterThanOrEqual(160);
    expect(closing).toBeLessThan(220);
  });
});

describe("빠지는 행 자리 유지", () => {
  const row = (key: string, leaving = false): MotionRow<string> => ({ key, item: key, leaving });
  const self = (item: string) => item;

  it("빠진 행은 앞 이웃 뒤에 남는다", () => {
    const rows = reconcileMotionRows([row("a"), row("b"), row("c")], ["a", "c"], self);
    expect(rows.map(({ key, leaving }) => [key, leaving])).toEqual([
      ["a", false],
      ["b", true],
      ["c", false],
    ]);
  });

  it("맨 앞 행이 빠지면 맨 앞에 남는다", () => {
    const rows = reconcileMotionRows([row("a"), row("b")], ["b"], self);
    expect(rows.map(({ key }) => key)).toEqual(["a", "b"]);
  });

  it("빠지던 행이 돌아오면 다시 보통 행이다", () => {
    const rows = reconcileMotionRows([row("a", true), row("b")], ["a", "b"], self);
    expect(rows.every(({ leaving }) => !leaving)).toBe(true);
  });
});
