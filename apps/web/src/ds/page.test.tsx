import { readFileSync, readdirSync } from "node:fs";
import * as ui from "@ganger/ui";
import { describe, expect, it } from "vitest";

import { labeledTimesOf } from "../testing/labeled-times";
import { renderWithMessages } from "../testing/render";
import { dsMessages } from "./messages";
import { DesignSystemPage } from "./page";

const messages = dsMessages;

function renderPage(): string {
  return renderWithMessages(<DesignSystemPage />, dsMessages);
}

describe("/ds 서버 렌더", () => {
  it("PanelSection 예시의 읽은 때는 시간만 보이고 뜻은 숨긴 글과 툴팁에 둔다(0216)", () => {
    const label = messages.ds.signals.metaLabel;
    expect(labeledTimesOf(renderPage())).toContainEqual(
      expect.objectContaining({ title: label, hidden: label, visible: messages.ds.signals.meta }),
    );
    const visible = labeledTimesOf(renderPage()).map((time) => time.visible);
    expect(visible).toContain(messages.ds.usage.panelMeta);
    expect(renderPage().replace(/<[^>]+>/g, "")).not.toMatch(/ago [가-힣]/);
  });

  it("오류 없이 모든 토큰·컴포넌트 구역을 그린다", () => {
    const html = renderPage();
    const ids = [
      "colors",
      "typography",
      "space",
      "size",
      "radius",
      "shadow",
      "motion",
      "buttons",
      "status",
      "tabs",
      "table",
      "definitions",
      "menu",
      "form",
      "tooltip",
      "dialog",
      "dependencyGraph",
      "toast",
      "surfaces",
      "statusDot",
      "sections",
      "segmented",
      "groupHeader",
      "capacity",
      "usage",
      "capacityCells",
      "problem",
      "statTile",
      "brand",
      "shell",
      "links",
      "chips",
      "choices",
      "question",
      "codeBlock",
      "qrCode",
      "dataTable",
      "outcomes",
      "steps",
      "disclosure",
      "dividedList",
      "popover",
      "kanban",
      "sheet",
      "settingsRows",
      "settingsSteps",
      "sectionNav",
      "settingsNav",
      "icons",
      "motionPrimitives",
    ];
    expect(ids.filter((id) => !html.includes(`id="${id}"`))).toEqual([]);
    expect(ids.filter((id) => !html.includes(`href="#${id}"`))).toEqual([]);
  });

  it("문구는 메시지 파일에서 온다", () => {
    const html = renderPage();
    expect(html).toContain(messages.ds.title);
    expect(html).toContain(messages.ds.buttons.primary);
    expect(html).toContain(messages.ds.table.rows.r1051.title);
    expect(html).not.toMatch(/ds\.(nav|buttons|table)\./);
  });

  it("새 글자 역할과 컴포넌트 미리보기를 그린다(티켓 0073)", () => {
    const html = renderPage();
    expect(html).toContain(messages.ds.typography.sampleDisplay);
    expect(html).toContain(messages.ds.typography.sampleSubheading);
    expect(html).toContain(`aria-label="${messages.ds.segmented.periodLabel}"`);
    expect(html).toContain('role="meter"');
    expect(html).toContain(messages.ds.problem.title);
    expect(html).toContain(messages.ds.groupHeader.stuckTitle);
    expect(html).toContain(messages.ds.statTile.doneDetail);
  });
});

const RENDERED_ONCE_AT_APP_ROOT = new Set(["Toaster", "WindowDragFrame"]);

function exportedComponents(): string[] {
  return Object.entries(ui)
    .filter(([name, value]) => /^[A-Z][a-z]/.test(name) && typeof value === "function")
    .map(([name]) => name)
    .filter((name) => !RENDERED_ONCE_AT_APP_ROOT.has(name))
    .sort();
}

function previewSource(): string {
  const dir = new URL(".", import.meta.url);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
    .map((file) => readFileSync(new URL(file, dir), "utf8"))
    .join("\n");
}

describe("/ds 빠짐 시험(티켓 0074)", () => {
  it("packages/ui 가 내보내는 컴포넌트마다 /ds 미리보기가 있다", () => {
    const source = previewSource();
    const missing = exportedComponents().filter(
      (name) => !new RegExp(`<${name}[\\s>/<]`).test(source),
    );
    expect(missing).toEqual([]);
  });

  it("컴포넌트 목록을 실제로 읽는다", () => {
    expect(exportedComponents()).toEqual(expect.arrayContaining(["Button", "DataTable", "Chip"]));
    expect(exportedComponents()).not.toContain("TEXT_VARIANTS");
  });
});
