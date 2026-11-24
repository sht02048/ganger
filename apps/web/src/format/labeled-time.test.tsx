import { describe, expect, it } from "vitest";
import { renderWithMessages } from "../testing/render";
import { labeledTimesOf } from "../testing/labeled-times";
import { LabeledTime } from "./labeled-time";

describe("뜻을 단 시간(티켓 0216)", () => {
  const html = renderWithMessages(
    <LabeledTime dateTime="2026-11-24T00:00:00.000Z" label="마지막으로 읽은 때">
      1 min ago
    </LabeledTime>,
  );

  it("화면에는 시간만 보이고 뜻은 숨긴 글과 툴팁으로 남긴다", () => {
    expect(labeledTimesOf(html)).toEqual([
      {
        dateTime: "2026-11-24T00:00:00.000Z",
        title: "마지막으로 읽은 때",
        hidden: "마지막으로 읽은 때",
        visible: "1 min ago",
      },
    ]);
  });

  it("스크린 리더는 뜻을 시간 앞에 읽는다", () => {
    const spoken = html.replace(/<[^>]+>/g, "");
    expect(spoken).toBe("마지막으로 읽은 때 1 min ago");
  });

  it("뜻은 화면에서 감추는 스타일의 span 에 둔다", () => {
    expect(html).toMatch(/<time[^>]*><span class="[^"]+">마지막으로 읽은 때 <\/span>/);
  });
});
