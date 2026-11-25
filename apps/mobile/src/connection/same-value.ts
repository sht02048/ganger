const MINUTE_MS = 60_000;

const SHOWN_BY_MINUTE = new Set([
  "waitMs",
  "executionMs",
  "pausedMs",
  "waitingMs",
  "unreachableMs",
  "endedAgoMs",
  "offlineMs",
  "resetsInMs",
  "soonestLimitResetMs",
  "agoMs",
]);
const SERVER_CLOCK = new Set(["now"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameField(key: string, left: unknown, right: unknown): boolean {
  if (SERVER_CLOCK.has(key)) return true;
  if (SHOWN_BY_MINUTE.has(key) && typeof left === "number" && typeof right === "number") {
    return Math.floor(left / MINUTE_MS) === Math.floor(right / MINUTE_MS);
  }
  return sameValue(left, right);
}

export function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && sameField(key, left[key], right[key]));
}
