export const MOTION_BURST_LIMIT = 3;

export interface MotionBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MotionListOrder {
  listId: string;
  keys: readonly string[];
}

export interface MotionChanges {
  entered: ReadonlySet<string>;
  left: ReadonlySet<string>;
  crossed: ReadonlySet<string>;
  displaced: ReadonlySet<string>;
  count: number;
}

export interface MotionRow<T> {
  key: string;
  item: T;
  leaving: boolean;
}

export type MoveStyle = "slide" | "fade";

export interface MoveStyleInput {
  changeCount: number;
  reducedMotion: boolean;
  crossesList: boolean;
  from: MotionBox;
  to: MotionBox;
  visibleArea: MotionBox;
}

function keysOutsideLongestRun(keys: readonly string[], rank: ReadonlyMap<string, number>) {
  const tails: number[] = [];
  const previous: number[] = keys.map(() => -1);
  keys.forEach((key, index) => {
    const value = rank.get(key) ?? 0;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const tail = tails[middle] ?? 0;
      if ((rank.get(keys[tail] ?? "") ?? 0) < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1] ?? -1;
    tails[low] = index;
  });
  const kept = new Set<string>();
  let cursor = tails.at(-1) ?? -1;
  while (cursor >= 0) {
    kept.add(keys[cursor] ?? "");
    cursor = previous[cursor] ?? -1;
  }
  return keys.filter((key) => !kept.has(key));
}

export function diffMotionOrders(
  before: readonly MotionListOrder[],
  after: readonly MotionListOrder[],
): MotionChanges {
  const beforeList = new Map<string, string>();
  const beforeRank = new Map<string, number>();
  for (const { listId, keys } of before) {
    keys.forEach((key, index) => {
      beforeList.set(key, listId);
      beforeRank.set(key, index);
    });
  }
  const afterKeys = new Set(after.flatMap(({ keys }) => keys));
  const entered = new Set<string>();
  const crossed = new Set<string>();
  const displaced = new Set<string>();
  for (const { listId, keys } of after) {
    const stayed: string[] = [];
    for (const key of keys) {
      const origin = beforeList.get(key);
      if (origin === undefined) entered.add(key);
      else if (origin === listId) stayed.push(key);
      else crossed.add(key);
    }
    for (const key of keysOutsideLongestRun(stayed, beforeRank)) displaced.add(key);
  }
  const left = new Set([...beforeList.keys()].filter((key) => !afterKeys.has(key)));
  return {
    entered,
    left,
    crossed,
    displaced,
    count: entered.size + left.size + crossed.size + displaced.size,
  };
}

function overlaps(a: MotionBox, b: MotionBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function isStackedMove(from: MotionBox, to: MotionBox): boolean {
  const shared = Math.min(from.right, to.right) - Math.max(from.left, to.left);
  const narrower = Math.min(from.right - from.left, to.right - to.left);
  return narrower > 0 && shared >= narrower / 2;
}

export function chooseMoveStyle(input: MoveStyleInput): MoveStyle {
  if (input.reducedMotion || input.changeCount > MOTION_BURST_LIMIT) return "fade";
  if (!overlaps(input.to, input.visibleArea)) return "fade";
  if (input.crossesList && isStackedMove(input.from, input.to)) return "fade";
  return "slide";
}

export function keepsViewTransition(
  changeCount: number,
  changedStyles: readonly MoveStyle[],
): boolean {
  return changeCount <= MOTION_BURST_LIMIT && changedStyles.every((style) => style === "slide");
}

export type IssueGroupPhase = "opening" | "closing";

export const ISSUE_LINE_STAGGER_MS = 30;
export const ISSUE_LINE_STAGGER_ROWS = 8;
export const ISSUE_LINE_MOTION_MAX_CHILDREN = 30;
const ISSUE_GROUP_SETTLE_MARGIN_MS = 34;

export function issueGroupPhaseFor(
  opening: boolean,
  reducedMotion: boolean,
): IssueGroupPhase | null {
  if (reducedMotion) return null;
  return opening ? "opening" : "closing";
}

export function hasIssueLineMotion(childCount: number): boolean {
  return childCount <= ISSUE_LINE_MOTION_MAX_CHILDREN;
}

export function issueLineDelayMs(index: number, childCount: number): number {
  if (!hasIssueLineMotion(childCount)) return 0;
  return Math.min(index, ISSUE_LINE_STAGGER_ROWS - 1) * ISSUE_LINE_STAGGER_MS;
}

export function issueGroupSettleMs(input: {
  phase: IssueGroupPhase;
  childCount: number;
  openMs: number;
  closeMs: number;
  lineEnterMs: number;
  lineFadeMs: number;
}): number {
  const { phase, childCount, openMs, closeMs, lineEnterMs, lineFadeMs } = input;
  const lines = hasIssueLineMotion(childCount);
  const longest =
    phase === "closing"
      ? Math.max(closeMs, lines ? lineFadeMs : 0)
      : Math.max(openMs, lines ? lineEnterMs + issueLineDelayMs(childCount - 1, childCount) : 0);
  return longest + ISSUE_GROUP_SETTLE_MARGIN_MS;
}

export function reconcileMotionRows<T>(
  previous: readonly MotionRow<T>[],
  items: readonly T[],
  getKey: (item: T) => string,
): MotionRow<T>[] {
  const rows: MotionRow<T>[] = items.map((item) => ({
    key: getKey(item),
    item,
    leaving: false,
  }));
  const present = new Set(rows.map((row) => row.key));
  let anchor: string | null = null;
  for (const row of previous) {
    if (present.has(row.key)) {
      anchor = row.key;
      continue;
    }
    const anchorKey: string | null = anchor;
    const at = anchorKey === null ? 0 : rows.findIndex((entry) => entry.key === anchorKey) + 1;
    rows.splice(at, 0, { ...row, leaving: true });
    anchor = row.key;
  }
  return rows;
}
