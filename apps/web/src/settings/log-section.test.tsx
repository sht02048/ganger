import { describe, expect, it } from "vitest";
import settings from "../../messages/ko/settings.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import { LogSection } from "./log-section";
import type { LogActions } from "./log-section";
import { settingsMessages } from "./messages";
import { EditorProvider } from "./row-state";

const actions = (openFolder: LogActions["openFolder"] = null): LogActions => ({
  saveDebug: () => Promise.resolve({ ok: true }),
  makeDiagnostics: () => Promise.resolve({ ok: true, name: "x.zip" }),
  openFolder,
});

function text(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function render(view: Parameters<typeof LogSection>[0]["view"], logActions = actions()): string {
  return renderWithMessages(
    <EditorProvider>
      <LogSection view={view} actions={logActions} />
    </EditorProvider>,
    settingsMessages,
  );
}

describe("Settings 로그와 진단 구역(0134)", () => {
  it("크기, 폴더 경로와 복사, 꺼진 자세한 로그, 진단 묶음 만들기를 보이고 지우기 버튼은 없다", () => {
    const html = render({
      available: true,
      folder: "/srv/ganger/logs",
      folderShown: "/srv/ganger/logs",
      totalBytes: 12.4 * 1024 * 1024,
      debug: false,
      runs: [],
    });
    const shown = text(html);
    expect(shown).toContain(settings.logs.title);
    expect(shown).toContain("모두 12.4MB");
    expect(shown).toContain("/srv/ganger/logs");
    expect(shown).toContain(settings.logs.copyPath);
    expect(shown).not.toContain(settings.logs.openFolder);
    expect(html).toMatch(
      /role="switch"[^>]*aria-checked="false"|aria-checked="false"[^>]*role="switch"/,
    );
    expect(html).toContain('aria-label="진단 묶음 만들기"');
    expect(shown).not.toMatch(/지우기|삭제/);
  });

  it("작은 로그는 kB로 보이고 켜 둔 자세한 로그는 켜진 채로 보인다", () => {
    const html = render({
      available: true,
      folder: "/Users/alice/.ganger/logs",
      folderShown: "~/.ganger/logs",
      totalBytes: 2048,
      debug: true,
      runs: [],
    });
    expect(text(html)).toContain("모두 2kB");
    expect(text(html)).toContain("~/.ganger/logs");
    expect(text(html)).not.toContain("/Users/alice");
    expect(html).toMatch(
      /role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/,
    );
  });

  it("홈이 없는 서버는 로그를 쓰지 않는다고 알리고 스위치를 잠근다", () => {
    const html = render({ available: false });
    expect(text(html)).toContain(settings.logs.unavailable);
    expect(text(html)).not.toContain(settings.logs.folder);
    expect(html).toMatch(/role="switch"[^>]*disabled=""|disabled=""[^>]*role="switch"/);
  });
});
