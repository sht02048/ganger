import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { renderWithMessages } from "../testing/render";
import { useTime, type TimeFormat } from "./time";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function draw(use: (time: TimeFormat) => string, timeZone = "UTC"): string {
  function Probe() {
    return <>{use(useTime())}</>;
  }
  return renderWithMessages(<Probe />, {}, timeZone).replaceAll("&lt;", "<");
}

describe("시간 표기(ADR 0010 7번)", () => {
  it.each([
    ["0초", 0, "<1 min", "Just now"],
    ["59초", 59 * SECOND, "<1 min", "Just now"],
    ["60초", MINUTE, "1 min", "1 min ago"],
    ["59분 59초", 59 * MINUTE + 59 * SECOND, "59 min", "59 min ago"],
    ["1시간 정각", HOUR, "1 hr", "1 hr ago"],
    ["1시간 3분", HOUR + 3 * MINUTE, "1 hr 3 min", "1 hr ago"],
    ["23시간 59분", 23 * HOUR + 59 * MINUTE, "23 hr 59 min", "23 hr ago"],
    ["24시간", DAY, "1 day", "11월 17일"],
    ["47시간", 47 * HOUR, "1 day", "11월 17일"],
    ["49시간", 49 * HOUR, "2 days", "11월 17일"],
  ])("%s는 경과·양과 지난 일을 영어 단위로 쓴다", (_name, ms, amount, past) => {
    const at = "2026-11-17T01:00:00.000Z";
    expect(draw((time) => time.elapsed(ms))).toBe(amount);
    expect(draw((time) => time.duration(ms))).toBe(amount);
    expect(draw((time) => time.ago(at, ms))).toBe(past);
  });

  it("하루가 넘으면 운영자 시간대의 날짜를 쓴다", () => {
    const at = new Date("2026-11-17T20:00:00.000Z");
    expect(draw((time) => time.ago(at, DAY + MINUTE))).toBe("11월 17일");
    expect(draw((time) => time.ago(at, DAY + MINUTE), "Asia/Seoul")).toBe("11월 18일");
  });

  it("타임라인은 운영자 시간대의 시각이다", () => {
    const at = "2026-11-18T01:45:00.000Z";
    expect(draw((time) => time.clock(at))).toBe("01:45");
    expect(draw((time) => time.clock(at), "Asia/Seoul")).toBe("10:45");
    expect(draw((time) => time.clock(at), "America/New_York")).toBe("20:45");
  });

  it("타임라인 시각은 지금과 다른 날이면 운영자 시간대의 날짜를 붙인다", () => {
    const now = "2026-11-18T03:00:00.000Z";
    expect(draw((time) => time.stamp("2026-11-18T01:45:00.000Z", now))).toBe("01:45");
    expect(draw((time) => time.stamp("2026-11-17T23:10:00.000Z", now))).toBe("11월 17일 23:10");
    expect(draw((time) => time.stamp("2026-11-17T23:10:00.000Z", now), "Asia/Seoul")).toBe("08:10");
  });

  it("통계의 하루는 날짜와 눈금으로 쓰고 시간대를 다시 적용하지 않는다", () => {
    const day = Date.UTC(2026, 10, 4);
    expect(draw((time) => time.statsDay(day).long)).toBe("11월 4일");
    expect(draw((time) => time.statsDay(day).short, "America/New_York")).toBe("11/4");
  });

  it("음수 시간은 1분 안으로 쓴다", () => {
    expect(draw((time) => time.duration(-5 * SECOND))).toBe("<1 min");
  });
});

describe("앱 코드는 useTime() 밖에서 시각·날짜를 만들지 않는다(ADR 0010 7번)", () => {
  const root = new URL("..", import.meta.url).pathname;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  const formatting =
    /useFormatter|\.dateTime\(|\.relativeTime\(|toLocale(?:Date|Time)?String|Intl\.(?:DateTimeFormat|RelativeTimeFormat)|\.get(?:UTC)?(?:Month|Date|Day|Hours|Minutes)\(/;
  const allowed = new Set(["format/time.ts", "time-zone.ts"]);

  it("format/time.ts 밖의 앱 코드에 날짜 포매터가 없다", () => {
    const offenders = files(root)
      .map((file) => relative(root, file))
      .filter((file) => !allowed.has(file))
      .filter((file) => formatting.test(readFileSync(join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
