import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadMeters } from "./components/load-meters";

describe("LoadMeters", () => {
  it("값이 있으면 meter 로 읽고 tone 과 설명을 보인다", () => {
    const html = renderToString(
      <LoadMeters
        items={[
          {
            id: "cpu",
            name: "CPU",
            percent: 92.4,
            label: "runner-a CPU 부하",
            emptyText: "없음",
            tone: "problem",
            note: "코어 10개",
          },
        ]}
      />,
    );
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="runner-a CPU 부하"');
    expect(html).toContain('aria-valuetext="92%"');
    expect(html).toContain('data-tone="problem"');
    expect(html).toContain("코어 10개");
  });

  it("값이 없으면 막대 없이 빈 문구를 보인다", () => {
    const html = renderToString(
      <LoadMeters
        density="compact"
        items={[{ id: "gpu", name: "GPU", percent: null, label: "GPU 부하", emptyText: "없음" }]}
      />,
    );
    expect(html).not.toContain('role="meter"');
    expect(html).toContain("없음");
  });
});
