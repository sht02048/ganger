import type { UpdateView } from "@ganger/app/updates/view";
import { describe, expect, it } from "vitest";
import settings from "../../messages/ko/settings.json" with { type: "json" };
import { PRODUCT_VERSION } from "../identity/identity";
import { labeledTimesOf } from "../testing/labeled-times";
import { renderWithMessages } from "../testing/render";
import { settingsMessages } from "./messages";
import { BrowserUpdates, DesktopUpdates } from "./updates-panel";

const NOTES = "https://github.com/acme/ganger/releases/tag/v0.2.0";

function view(overrides: Partial<UpdateView> = {}): UpdateView {
  return {
    appVersion: "0.2.0",
    server: { kind: "app", version: "0.2.0" },
    autoUpdate: true,
    lastCheckedAt: null,
    latest: null,
    check: { kind: "latest" },
    toast: null,
    ...overrides,
  };
}

function text(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function render(value: UpdateView): string {
  return renderWithMessages(<DesktopUpdates view={value} act={() => {}} />, settingsMessages);
}

describe("Settings 업데이트 구역(0083)", () => {
  it("지금 버전, 앱과 서버가 같은지, 마지막 확인, 지금 확인, 자동 업데이트와 IP 안내를 보인다", () => {
    const html = render(view());
    const shown = text(html);
    expect(shown).toContain("0.2.0 · 앱과 서버가 같아요");
    expect(shown).toContain(settings.updates.never);
    expect(shown).toContain(settings.updates.checkNow);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(shown).toContain("IP와 지금 버전이 GitHub Releases에 전해져요");
    expect(shown).toContain("끄면 확인하지 않고");
  });

  it.each([
    ["idle", { kind: "idle" }, ""],
    ["latest", { kind: "latest" }, " · 새 버전이 없어요"],
    [
      "manual",
      { kind: "manual", version: "0.3.0", notesUrl: NOTES, reason: "outside-applications" },
      " · 새 버전 0.3.0이 있어요",
    ],
  ] as const)(
    "%s 확인 줄은 마지막으로 확인한 때를 시간만 보이고 뜻은 숨긴 글과 툴팁에 둔다(0216)",
    (_kind, check, rest) => {
      const at = new Date(Date.now() - 5 * 60_000 - 1000).toISOString();
      const html = render(view({ lastCheckedAt: at, check }));
      const label = settings.updates.checkedLabel;
      expect(labeledTimesOf(html)).toEqual([
        { dateTime: at, title: label, hidden: label, visible: "5 min ago" },
      ]);
      expect(text(html)).toContain(`${label} 5 min ago${rest}`);
      expect(text(html)).not.toContain("5 min ago 확인");
    },
  );

  it("자동 업데이트를 끈 상태를 그대로 보인다", () => {
    const html = render(view({ autoUpdate: false }));
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
  });

  it("받은 새 버전이 있으면 다시 시작과 바뀐 내용을 보인다", () => {
    const html = render(view({ check: { kind: "ready", version: "0.3.0", notesUrl: NOTES } }));
    expect(text(html)).toContain("새 버전 0.3.0을 받았어요. 다시 시작하면 바뀌어요");
    expect([...html.matchAll(/data-variant="primary"/g)]).toHaveLength(0);
    expect(html).toMatch(/data-variant="secondary"[^>]*>다시 시작</);
    expect(html).toContain(`href="${NOTES}"`);
  });

  it("Applications 밖에서 실행하면 옮기라고 안내한다", () => {
    const shown = text(
      render(
        view({
          check: {
            kind: "manual",
            reason: "outside-applications",
            version: "0.3.0",
            notesUrl: NOTES,
          },
        }),
      ),
    );
    expect(shown).toContain(settings.updates.manual["outside-applications"].title);
    expect(shown).toContain("Applications 폴더로 옮긴 뒤 다시 열면");
  });

  it("바꿀 권한이 없으면 Release 링크를 준다", () => {
    const html = render(
      view({
        check: { kind: "manual", reason: "no-permission", version: "0.3.0", notesUrl: NOTES },
      }),
    );
    expect(text(html)).toContain(settings.updates.manual["no-permission"].title);
    expect(text(html)).toContain("새 버전 0.3.0이 있어요");
    expect(html).toMatch(new RegExp(`href="${NOTES}"[^>]*>${settings.updates.openRelease}<`));
  });

  it("원격 서버에 붙은 앱은 앱과 서버 판이 다르면 알린다", () => {
    const shown = text(render(view({ server: { kind: "remote", version: "0.1.0" } })));
    expect(shown).toContain("앱 0.2.0 · 서버 0.1.0");
    expect(shown).toContain(settings.updates.serverDiffers.remote.title);
    expect(shown).toContain("서버 기계에서 서버를 업데이트해 주세요");
  });

  it("앱이 띄우지 않은 이 Mac 의 서버도 판이 다르면 따로 바꾸라고 알린다", () => {
    const shown = text(render(view({ server: { kind: "external", version: "0.1.0" } })));
    expect(shown).toContain("앱이 띄우지 않아");
  });

  it("앱이 띄운 서버는 판이 달라도 앱이 바꾸므로 따로 알리지 않는다", () => {
    const shown = text(render(view({ server: { kind: "app", version: "0.1.0" } })));
    expect(shown).not.toContain(settings.updates.serverDiffers.remote.title);
  });

  it("CLI·Linux 서버를 브라우저로 열면 자동 업데이트가 없다는 표시만 한다", () => {
    const shown = text(renderWithMessages(<BrowserUpdates />, settingsMessages));
    expect(shown).toContain(PRODUCT_VERSION);
    expect(shown).toContain(settings.updates.browserManual);
    expect(shown).not.toContain(settings.updates.checkNow);
  });

  it("업데이트 주소가 없는 빌드는 지금 확인을 두지 않고 자동 업데이트를 못 바꾼다", () => {
    const html = render(view({ check: { kind: "unavailable" } }));
    expect(text(html)).toContain(settings.updates.unavailable);
    expect(text(html)).not.toContain(settings.updates.checkNow);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
  });

  it("확인 중에는 지금 확인을 누를 수 없다고 알리고 결과를 status 로 알린다", () => {
    const html = render(view({ check: { kind: "checking" } }));
    expect(html).toMatch(/aria-busy="true"[^>]*>/);
    expect(html).toContain('role="status"');
    expect(text(html)).toContain(settings.updates.checkingStatus);
  });

  it("확인이 실패하면 다시 확인하는 법을 말하고, 확인한 적 없다는 말과 섞지 않는다", () => {
    const shown = text(render(view({ check: { kind: "failed" } })));
    expect(shown).toContain(settings.updates.failedStatus);
    expect(shown).not.toContain(settings.updates.never);
  });

  it("받은 새 버전은 토스트가 알리므로 패널의 status 로 다시 알리지 않는다", () => {
    const html = render(view({ check: { kind: "ready", version: "0.3.0", notesUrl: NOTES } }));
    expect(html).toMatch(/<span role="status"><\/span>/);
  });
});
