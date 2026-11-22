import { describe, expect, it } from "vitest";
import { DeviceStreams } from "./streams.js";

function endlessSource() {
  const encoder = new TextEncoder();
  let canceled = false;
  let push: (text: string) => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (text) => controller.enqueue(encoder.encode(text));
    },
    cancel() {
      canceled = true;
    },
  });
  return { stream, push: (text: string) => push(text), isCanceled: () => canceled };
}

describe("기기별 열린 스트림", () => {
  it("원본 스트림의 내용을 그대로 전한다", async () => {
    const streams = new DeviceStreams();
    const source = endlessSource();
    const reader = streams.track("device-a", source.stream).getReader();
    source.push("hello");
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe("hello");
    await reader.cancel();
  });

  it("기기를 닫으면 그 기기의 스트림만 끝나고 원본도 취소한다", async () => {
    const streams = new DeviceStreams();
    const first = endlessSource();
    const second = endlessSource();
    const other = endlessSource();
    const firstReader = streams.track("device-a", first.stream).getReader();
    const secondReader = streams.track("device-a", second.stream).getReader();
    const otherReader = streams.track("device-b", other.stream).getReader();

    streams.closeDevice("device-a");

    expect((await firstReader.read()).done).toBe(true);
    expect((await secondReader.read()).done).toBe(true);
    expect(first.isCanceled()).toBe(true);
    expect(second.isCanceled()).toBe(true);
    expect(other.isCanceled()).toBe(false);
    expect(streams.openCount("device-a")).toBe(0);
    expect(streams.openCount("device-b")).toBe(1);
    await otherReader.cancel();
  });

  it("클라이언트가 먼저 끊으면 목록에서 빠지고 원본을 취소한다", async () => {
    const streams = new DeviceStreams();
    const source = endlessSource();
    const reader = streams.track("device-a", source.stream).getReader();

    await reader.cancel();

    expect(source.isCanceled()).toBe(true);
    expect(streams.openCount("device-a")).toBe(0);
    expect(() => streams.closeDevice("device-a")).not.toThrow();
  });
});
