// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toRunId, toTicketKey } from "@ganger/core";
import type { HomePullRequest, HomeRun } from "@ganger/app/home/model";
import type { PrCommitView } from "@ganger/app/pr-signals-view";
import { DEFAULT_TIME_ZONE } from "@ganger/app/time-zone";
import homeJson from "../../messages/ko/home.json" with { type: "json" };
import { appMessages, defaultLocale } from "../i18n";
import { homeMessages } from "./messages";
import { PrTabContent } from "./sheet-pr-tab";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const p = homeJson.sheet.pr;
const MINUTE = 60_000;

const longHeadline =
  "Rename the client option to keep it consistent with the rest of the checkout module and the settings screen";

function commit(oid: string, headline: string, agoMinutes: number): PrCommitView {
  return {
    oid,
    shortSha: oid.slice(0, 7),
    url: `https://code.example.com/acme/web/commit/${oid}`,
    headline,
    author: "kim",
    committedAt: new Date(Date.UTC(2026, 10, 23, 12) - agoMinutes * MINUTE).toISOString(),
    agoMs: agoMinutes * MINUTE,
  };
}

const commits = [
  commit("cccccccccc", "Fix lint", 5),
  commit("bbbbbbbbbb", longHeadline, 30),
  commit("aaaaaaaaaa", "Add retry", 90),
];

function pr(over: Partial<HomePullRequest> = {}): HomePullRequest {
  return {
    displayId: "#42",
    url: "https://code.example.com/acme/web/pull/42",
    signals: null,
    ci: "success",
    state: "open",
    settledAt: null,
    settledAgoMs: null,
    branch: "acme-1-retry",
    title: "Retry failed payments",
    baseBranch: "develop",
    commits,
    ...over,
  };
}

function run(pullRequest: HomePullRequest): HomeRun {
  return {
    id: toRunId("run-1"),
    ticketId: "ticket-ACME-1",
    ticketKey: toTicketKey("ACME-1"),
    ticketTitle: "결제 재시도",
    trackerProject: "Web",
    workspace: { id: "ws-commerce", name: "Commerce" },
    runner: { name: "runner-1", online: true },
    agent: "claude",
    waitMs: 0,
    executionMs: MINUTE,
    pullRequest,
    cancelling: false,
    control: null,
    state: "running",
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(pullRequest: HomePullRequest) {
  act(() => {
    root.render(
      <IntlProvider
        locale={defaultLocale}
        messages={{ ...appMessages, ...homeMessages }}
        timeZone={DEFAULT_TIME_ZONE}
      >
        <PrTabContent run={run(pullRequest)} />
      </IntlProvider>,
    );
  });
}

function toggle(): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((b) =>
    b.textContent.startsWith(p.commits.split(" {count}")[0] ?? ""),
  );
  if (button === undefined) throw new Error("no commit toggle");
  return button;
}

function commitLinks(): HTMLAnchorElement[] {
  return [...container.querySelectorAll<HTMLAnchorElement>("a[data-commit]")];
}

describe("「PR」 탭 커밋 내역 (0200)", () => {
  it("처음에는 커밋 수와 마지막 커밋 시각 한 줄로 접혀 있다", () => {
    render(pr());
    const button = toggle();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent).toBe(
      p.commits.replace("{count}", "3").replace("{ago}", "5 min ago"),
    );
    expect(commitLinks()).toHaveLength(0);
  });

  it("누르면 그 자리에서 모든 커밋을 최근 것부터 펼치고, 다시 누르면 접는다", () => {
    render(pr());
    act(() => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const list = document.getElementById(toggle().getAttribute("aria-controls") ?? "");
    expect(list?.tagName).toBe("OL");
    expect(commitLinks().map((link) => link.dataset["commit"])).toEqual([
      "ccccccc",
      "bbbbbbb",
      "aaaaaaa",
    ]);
    const first = commitLinks()[0];
    expect(first?.textContent).toContain("Fix lint");
    expect(first?.textContent).toContain("kim");
    expect(first?.textContent).toContain("5 min ago");

    act(() => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(commitLinks()).toHaveLength(0);
  });

  it("메시지 첫 줄은 마우스를 올리면 전체 글을 보이고, 누르면 커밋 페이지를 새 탭으로 연다", () => {
    render(pr());
    act(() => toggle().click());
    const link = commitLinks()[1];
    expect(link?.querySelector(`[title="${longHeadline}"]`)?.textContent).toBe(longHeadline);
    expect(link?.getAttribute("href")).toBe("https://code.example.com/acme/web/commit/bbbbbbbbbb");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer");
    expect(link?.textContent).toContain(homeJson.sheet.newTab);
  });

  it("웹 주소가 아닌 커밋은 링크 없이 보인다", () => {
    render(pr({ commits: [{ ...commit("dddddddddd", "Local", 1), url: null }] }));
    act(() => toggle().click());
    expect(commitLinks()).toHaveLength(0);
    expect(container.querySelector('[data-commit="ddddddd"]')?.textContent).toContain("Local");
  });

  it("커밋을 읽지 못했으면 커밋 줄을 두지 않는다", () => {
    render(pr({ commits: [] }));
    expect(container.querySelector("button")).toBeNull();
  });

  it("PR 줄은 번호와 제목, 아래 줄은 head → base 다", () => {
    render(pr());
    const text = container.textContent;
    expect(text).toContain("#42 Retry failed payments");
    expect(text).toContain("acme-1-retry → develop");
  });

  it("제목과 base 를 모르면 번호와 head 브랜치만 보인다", () => {
    render(pr({ title: null, baseBranch: null }));
    const text = container.textContent;
    expect(text).not.toContain("→");
    expect(text).toContain("acme-1-retry");
  });
});
