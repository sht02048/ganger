import { toRunId, toTicketKey } from "@ganger/core";
import { Text } from "@ganger/ui";
import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import homeJson from "../../messages/ko/home.json" with { type: "json" };
import questionJson from "../../messages/ko/question.json" with { type: "json" };
import { QuestionAnswer } from "../question/question-answer";
import { buttonsOf } from "../testing/buttons";
import { pillsOf } from "../testing/pills";
import { renderWithMessages } from "../testing/render";
import { addTitledRun, minutes, now, seedDatabase } from "../testing/seed";
import { changeRunState, completeRunControlRequest, requestRunControl } from "@ganger/db";
import { COLUMN_VISIBLE, DONE_TODO_VISIBLE, HomeScreen, SETTLED_VISIBLE } from "./home-screen";
import type { DashboardView } from "./home-screen";
import { loadHomePage } from "@ganger/app/home/load";
import { homeMessages } from "./messages";
import type { HomePage, HomeRun, InputWait } from "@ganger/app/home/model";
import type { PrSignalsView } from "@ganger/app/pr-signals-view";

const reject = () => Promise.reject(new Error("unused"));

function render(page: HomePage) {
  return renderWithMessages(
    <HomeScreen
      page={page}
      onAnswer={reject}
      onHumanCheck={reject}
      onDeny={reject}
      onControl={reject}
    />,
    homeMessages,
  );
}

function renderView(page: HomePage, view: DashboardView) {
  return renderWithMessages(
    <HomeScreen
      page={page}
      view={view}
      onAnswer={reject}
      onHumanCheck={reject}
      onDeny={reject}
      onControl={reject}
    />,
    homeMessages,
  );
}

function renderForm(question: Extract<InputWait, { kind: "question" }>) {
  return renderWithMessages(
    <QuestionAnswer body={question.body} options={question.choices} onSend={reject} />,
    homeMessages,
  );
}

function seededPage(ws = "ws-commerce"): HomePage {
  const { db } = seedDatabase();
  return loadHomePage(db, ws, now, "UTC");
}

function balanced(html: string, start: number, tag: string): string {
  const pattern = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  pattern.lastIndex = start;
  let depth = 0;
  for (const match of html.matchAll(pattern)) {
    if (match.index < start) continue;
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, match.index + match[0].length);
  }
  return html.slice(start);
}

function section(html: string, name: string): string {
  const start = html.indexOf(`<section aria-label="${name}"`);
  return start < 0 ? "" : balanced(html, start, "section");
}

function actionsOf(html: string) {
  return buttonsOf(html).filter((button) => button.variant !== "other");
}

function tagsOf(html: string): Array<string | null> {
  return rows(html).map((li) => /^<li[^>]*data-tag="([^"]+)"/.exec(li)?.[1] ?? null);
}

function rows(html: string): string[] {
  return [...html.matchAll(/<li\b[^>]*>.*?<\/li>/gs)].map((m) => m[0]);
}

function row(html: string, key: string): string {
  return rows(html).find((li) => li.includes(`>${key}</span>`)) ?? "";
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function dots(html: string): string[] {
  return [...html.matchAll(/<span data-status="([^"]+)" data-tone="[^"]+"/g)].map(
    (m) => m[1] ?? "",
  );
}

function runOf(page: HomePage, key: string): HomeRun {
  const found = page.attention.find((item) => item.run.ticketKey === key);
  if (found === undefined) throw new Error(`no ${key}`);
  return found.run;
}

function withInput(page: HomePage, input: InputWait): HomePage {
  return {
    ...page,
    attention: page.attention.map((item) =>
      item.run.ticketKey === "ACME-11" && item.run.state === "waiting-for-input"
        ? { ...item, run: { ...item.run, input, waitingMs: 25 * 60_000 } }
        : item,
    ),
  };
}

function withPermission(page: HomePage): HomePage {
  const acme11 = runOf(page, "ACME-11");
  const permissionRun: HomeRun = {
    ...acme11,
    id: toRunId("run-permission"),
    ticketKey: toTicketKey("ACME-22"),
    state: "waiting-for-input",
    input: { kind: "permission", promptId: "p-1", detail: "git push --force", denied: false },
    waitingMs: null,
  };
  return { ...page, attention: [...page.attention, { kind: "run", run: permissionRun }] };
}

const question: Extract<InputWait, { kind: "question" }> = {
  kind: "question",
  questionId: "q-1",
  body: "재시도 간격을 바꿀까요?",
  choices: ["지수 백오프", "30초 고정"],
  answered: false,
};

describe("Dashboard 한 줄 머리(ADR 0010 8번, 0113 갱신)", () => {
  const header = (html: string) => html.slice(html.indexOf("<header"), html.indexOf("</header>"));

  it("제목은 화면 이름 Dashboard 이고, 그 옆 요약 한 줄이 처리할 일을 묶음별로 말한다", () => {
    const html = render(seededPage());
    expect(header(html)).toMatch(/<h1[^>]*>Dashboard<\/h1>/);
    expect(text(header(html))).toContain("처리할 일은 답할 질문 1개, 멈춘 런 6개예요.");
    expect(text(header(html))).not.toContain("확인할 PR");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("보기(모두 / 처리할 일만)는 머리 줄 오른쪽 행동이다", () => {
    expect(header(render(seededPage()))).toContain(`aria-label="${homeJson.view.label}"`);
  });

  it("요약 문장에서 0인 묶음은 뺀다", () => {
    const page = seededPage();
    const html = render({
      ...page,
      attention: page.attention.filter((item) => item.run.ticketKey === "ACME-2"),
    });
    expect(text(header(html))).toContain("처리할 일은 멈춘 런 1개예요.");
    expect(text(header(html))).not.toContain("답할 질문");
  });

  it("To do 가 0이면 처리할 일이 없다고 하고 In progress 수를 요약한다", () => {
    const page = seededPage();
    const empty = { ...page, attention: [] };
    expect(text(header(render(empty)))).toContain(
      `처리할 일은 없고, 진행 중인 런이 ${page.running.length + page.queued.length}개 있어요.`,
    );
    expect(text(header(render({ ...empty, running: [], queued: [] })))).toContain(
      homeJson.summary.idle,
    );
  });

  it("모든 Workspace 보기는 제목에 모든 Workspace 를 붙인다", () => {
    expect(render(seededPage("all"))).toMatch(/<h1[^>]*>Dashboard · 모든 Workspace<\/h1>/);
  });
});

describe("Dashboard 칸반(티켓 0100)", () => {
  it("Queued·Running·Done 칸과 Runners 열이 이 순서이고 칸 제목은 h2 다", () => {
    const html = render(seededPage());
    const names = ["Queued", "Running", "Done", "Runners"];
    const order = names.map((name) => html.indexOf(`<section aria-label="${name}"`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    for (const name of names)
      expect(section(html, name)).toMatch(new RegExp(`<h2[^>]*>${name}</h2>`));
  });

  it("Queued 칸은 Queued 런을 까닭·러너·경과와 함께 보이고 꼬리표가 없다", () => {
    const page = seededPage();
    const queued = section(render(page), "Queued");
    expect(rows(queued)).toHaveLength(page.queued.length);
    expect(pillsOf(queued)).toEqual([]);
    expect(text(row(queued, "ACME-14"))).toContain(homeJson.card.queuedAnyOffline);
    expect(text(row(queued, "ACME-14"))).toMatch(/(<1 min|\d+ (min|hr|days?))$/);
  });

  it("Running 칸은 꼬리표 카드(Question·Permission·Disconnected)를 맨 위에, 그 아래 Running 런을 둔다", () => {
    const page = withPermission(withInput(seededPage(), question));
    const running = section(render(page), "Running");
    expect(tagsOf(running)).toEqual(["question", "disconnected", "permission", null]);
    expect(pillsOf(running).map((pill) => pill.status)).toEqual([
      "question",
      "disconnected",
      "permission",
    ]);
    expect(pillsOf(running).map((pill) => pill.label)).toEqual([
      "Question",
      "Disconnected",
      "Permission",
    ]);
    expect(text(row(running, "ACME-10"))).toContain("runner-a · Claude Code");
  });

  it("Question 카드는 질문 한 줄·기다린 경과·답하기를 보이고 선택지는 패널 전까지 그리지 않는다", () => {
    const running = section(render(withInput(seededPage(), question)), "Running");
    const card = row(running, "ACME-11");
    expect(text(card)).toContain(question.body);
    expect(text(card)).toContain("25 min");
    expect(actionsOf(card)).toEqual([{ variant: "secondary", label: homeJson.card.answer }]);
    expect(card).not.toContain('type="radio"');
  });

  it("Permission 카드는 명령을 보이고 카드에 거절 버튼을 두지 않는다", () => {
    const card = row(section(render(withPermission(seededPage())), "Running"), "ACME-22");
    expect(text(card)).toContain("git push --force");
    expect(actionsOf(card)).toEqual([]);
  });

  it("Disconnected 카드는 닿지 않은 러너와 경과를 보인다", () => {
    const page = seededPage();
    const html = render({
      ...page,
      attention: page.attention.map((item) =>
        item.run.state === "disconnected"
          ? { ...item, run: { ...item.run, unreachableMs: 7 * 60_000 } }
          : item,
      ),
    });
    expect(text(row(section(html, "Running"), "ACME-12"))).toContain(
      "runner-a에 7 min 닿지 않아요",
    );
  });

  it("Done 칸은 꼬리표 카드(Failed)를 앞 4장만 보이고 N개 더 보기를 둔다. Succeeded 런은 PR 이 열려 있어도 꼬리표가 없다 (0145)", () => {
    const page = seededPage();
    const done = section(render(page), "Done");
    const tagged = tagsOf(done).filter((tag) => tag !== null);
    expect(tagged).toEqual(["failed", "failed", "failed", "failed"]);
    expect(DONE_TODO_VISIBLE).toBe(4);
    expect(actionsOf(done)).toContainEqual({ variant: "ghost", label: "1개 더 보기" });
    expect(done).not.toContain('data-tag="human-check"');
    const succeeded = row(done, "ACME-7");
    expect(succeeded).not.toContain("data-tag=");
    expect(text(succeeded)).toContain("Succeeded · PR #7");
    expect(text(succeeded)).toContain("1 hr ago");
  });

  it("처리할 일 없이 끝난 카드는 소제목 아래에 꼬리표 없이 상태 이름과 함께 모은다", () => {
    const done = section(render(seededPage()), "Done");
    const subheading = done.indexOf(homeJson.board.settled);
    expect(subheading).toBeGreaterThan(0);
    const merged = row(done, "ACME-1");
    expect(done.indexOf(merged)).toBeGreaterThan(subheading);
    expect(merged).not.toContain("data-tag=");
    expect(text(merged)).toContain("Succeeded");
    for (const tagged of ["ACME-6", "ACME-5"])
      expect(done.indexOf(row(done, tagged))).toBeLessThan(subheading);
  });

  it("처리할 일 없이 끝난 카드가 5장을 넘으면 5장만 보이고 더 보기나 Runs 링크를 두지 않는다 (0186)", () => {
    const page = seededPage();
    const merged = page.endedRecently.find((run) => run.ticketKey === "ACME-1");
    if (merged === undefined) throw new Error("no ACME-1");
    const extra = [1, 2, 3, 4, 5, 6].map((n) => ({
      ...merged,
      id: toRunId(`run-extra-${n}`),
      ticketKey: toTicketKey(`ACME-${40 + n}`),
    }));
    const done = section(
      render({ ...page, endedRecently: [...page.endedRecently, ...extra] }),
      "Done",
    );
    const settled = done.slice(done.indexOf(homeJson.board.settled));
    expect(SETTLED_VISIBLE).toBe(5);
    expect(rows(settled)).toHaveLength(SETTLED_VISIBLE);
    expect(settled).not.toContain("Runs에서 모두 보기");
    expect(actionsOf(settled).filter(({ label }) => label.includes("더 보기"))).toEqual([]);
  });

  it("Done 칸 머리만 끝난 런 모두를 보여 주는 Runs 링크다 (0186)", () => {
    const html = render(seededPage());
    const head = section(html, "Done").match(/<a href="([^"]+)" aria-label="([^"]+)"/);
    expect(head?.[1]?.replaceAll("&amp;", "&")).toBe("/runs?ws=ws-commerce&view=all");
    expect(head?.[2]).toMatch(/^Done \d+, Runs에서 보기$/);
    for (const name of ["Queued", "Running"])
      expect(section(html, name)).not.toContain("Runs에서 보기");
  });

  it("Done 칸 머리 개수는 보이는 카드 수 제한과 상관없이 칸에 든 런 전체다 (0163)", () => {
    const page = seededPage();
    const merged = page.endedRecently.find((run) => run.ticketKey === "ACME-1");
    if (merged === undefined) throw new Error("no ACME-1");
    const extra = [1, 2, 3, 4].map((n) => ({
      ...merged,
      id: toRunId(`run-count-${n}`),
      ticketKey: toTicketKey(`ACME-${80 + n}`),
    }));
    const done = section(
      render({ ...page, endedRecently: [...page.endedRecently, ...extra] }),
      "Done",
    );
    expect(done).toMatch(/<\/h2><span[^>]*>11<\/span>/);
  });

  it("7일보다 오래된 꼬리표 카드도 Done 칸 머리 개수에 든다 (0163)", () => {
    const page = seededPage();
    const onlyOldTagged = section(render({ ...page, endedRecently: [] }), "Done");
    expect(onlyOldTagged).toMatch(/<\/h2><span[^>]*>5<\/span>/);
    expect(row(onlyOldTagged, "ACME-6")).toContain("data-tag=");

    const oldTaggedAndRecent = section(
      render({
        ...page,
        endedRecently: page.endedRecently.filter((run) => run.ticketKey !== "ACME-6"),
      }),
      "Done",
    );
    expect(oldTaggedAndRecent).toMatch(/<\/h2><span[^>]*>7<\/span>/);
    expect(row(oldTaggedAndRecent, "ACME-6")).toContain("data-tag=");
  });

  it("Queued·Running 칸은 6장이 넘으면 앞 6장과 N개 더 보기를 보인다", () => {
    const page = seededPage();
    const base = page.queued[0];
    if (base === undefined) throw new Error("no queued run");
    const queued = Array.from({ length: COLUMN_VISIBLE + 3 }, (_, n) => ({
      ...base,
      id: toRunId(`run-q-${n}`),
      ticketKey: toTicketKey(`ACME-${60 + n}`),
    }));
    const column = section(render({ ...page, queued }), "Queued");
    expect(rows(column)).toHaveLength(COLUMN_VISIBLE);
    expect(actionsOf(column)).toEqual([{ variant: "ghost", label: "3개 더 보기" }]);
  });

  it("빈 칸은 칸마다 한 줄로 알린다", () => {
    const page = seededPage();
    const html = render({ ...page, attention: [], queued: [], running: [], endedRecently: [] });
    expect(text(section(html, "Queued"))).toContain(homeJson.columnEmpty.queued);
    expect(text(section(html, "Running"))).toContain(homeJson.columnEmpty.running);
    expect(text(section(html, "Done"))).toContain(homeJson.columnEmpty.done);
  });

  it("처리할 일만 보기는 꼬리표 카드만 남기고, 꼬리표 카드가 없는 칸은 처리할 일이 없다고 한다", () => {
    const page = seededPage();
    const html = renderView(page, "todo");
    expect(rows(section(html, "Queued"))).toEqual([]);
    expect(text(section(html, "Queued"))).toContain(homeJson.columnEmpty.todo);
    expect(tagsOf(section(html, "Running"))).toEqual(["waiting-for-input", "disconnected"]);
    expect(html).not.toContain(homeJson.board.settled);
    expect(rows(section(html, "Running")).every((card) => card.includes("data-tag="))).toBe(true);
  });

  it("모두 / 처리할 일만 {n} 분할 버튼을 머리 오른쪽에 두고 지금 보기를 고른 상태로 보인다", () => {
    const page = seededPage();
    const html = renderView(page, "todo");
    expect(html).toMatch(
      /<div[^>]*aria-label="보기"[^>]*role="tablist"|role="tablist"[^>]*aria-label="보기"/,
    );
    const tabs = html.slice(html.indexOf(">", html.indexOf('role="tablist"')) + 1);
    expect(text(tabs)).toMatch(new RegExp(`^모두 처리할 일만 ${page.attention.length} Queued`));
    expect(tabs).toMatch(/aria-selected="true"[^>]*>처리할 일만/);
  });

  it("카드는 패널을 여는 버튼이고, 행동 버튼과 링크는 그 버튼 밖에 둔다", () => {
    const html = render(withInput(seededPage(), question));
    for (const key of ["ACME-11", "ACME-6", "ACME-10"]) {
      const card = row(html, key);
      expect(card).toMatch(/<button type="button" aria-haspopup="dialog" aria-expanded="false"/);
    }
    expect(html).not.toMatch(
      /<button[^>]*aria-haspopup="dialog"[^>]*>(?:(?!<\/button>).)*<(a|button)\b/s,
    );
  });

  it("카드를 끌 수 있어 보이는 모양(손잡이, grab 커서)이 없다", () => {
    const html = render(seededPage());
    expect(html).not.toMatch(/draggable|grab/);
  });

  it("화면의 버튼은 보조·덜 중요한 버튼뿐이고 노란 주 버튼이 없다(ADR 0010 6번)", () => {
    const html = render(withPermission(withInput(seededPage(), question)));
    const variants = [...html.matchAll(/data-variant="([^"]+)"/g)].map((m) => m[1]);
    expect(variants).not.toContain("primary");
    const layer = buttonsOf(renderForm(question));
    expect(layer.filter((b) => b.variant === "primary")).toEqual([
      { variant: "primary", label: questionJson.send },
    ]);
  });

  it("답을 보낸 질문과 거절을 보낸 권한 대기는 카드에 결과를 보이고 답하기를 두지 않는다", () => {
    const answered = row(
      render(withInput(seededPage(), { ...question, answered: true })),
      "ACME-11",
    );
    expect(actionsOf(answered)).toEqual([]);
    expect(text(answered)).toContain(homeJson.card.answered);
    const denied = row(
      render(
        withInput(seededPage(), {
          kind: "permission",
          promptId: "p-1",
          detail: "rm",
          denied: true,
        }),
      ),
      "ACME-11",
    );
    expect(text(denied)).toContain(homeJson.card.denied);
  });

  it("취소를 요청한 런에는 '취소 중'을 함께 보인다(Q82.21)", () => {
    const page = seededPage();
    const html = render({
      ...page,
      attention: page.attention.map((item) =>
        item.run.ticketKey === "ACME-12"
          ? { ...item, run: { ...item.run, cancelling: true } }
          : item,
      ),
    });
    expect(text(row(html, "ACME-12"))).toContain(homeJson.card.cancelling);
  });

  it("할당 때 저장한 티켓 제목을 회색 키 옆에 보인다(ADR 0010 9번, 0064)", () => {
    const { db } = seedDatabase();
    const id = addTitledRun(db, "ACME-30", "결제 실패 재시도");
    const html = render(loadHomePage(db, "ws-commerce", now, "UTC"));
    const titled = rows(html).find((li) => li.includes(`data-run="${id}"`)) ?? "";
    expect(text(titled)).toContain("ACME-30 결제 실패 재시도");
    expect(titled.indexOf(">ACME-30</span>")).toBeGreaterThan(-1);
    expect(titled.indexOf(">결제 실패 재시도<")).toBeGreaterThan(titled.indexOf(">ACME-30</span>"));
  });

  it("선행 티켓을 기다리는 카드도 취소 중과 Workspace 이름을 보인다(0160)", () => {
    const page = seededPage("all");
    const queued = page.queued.map((run) =>
      run.state === "queued"
        ? {
            ...run,
            cancelling: true,
            queuedReason: {
              kind: "blockers-waiting" as const,
              blockers: [
                {
                  key: "ACME-11",
                  title: "앞 티켓",
                  stateName: "In Progress",
                  stateCategory: "started",
                },
              ],
            },
          }
        : run,
    );
    const first = queued[0];
    if (first === undefined) throw new Error("no queued run");
    const body = text(section(render({ ...page, queued }), "Queued"));

    expect(body).toContain(homeJson.card.cancelling);
    expect(body).toContain(first.workspace.name);
  });

  it("Queued 까닭은 러너 이름에 맞는 조사로 쓴다", () => {
    const page = seededPage();
    const queued = page.queued.map((run) =>
      run.state === "queued"
        ? {
            ...run,
            queuedReason: { kind: "runner-offline" as const },
            runner: { name: "build-farm", online: false },
          }
        : run,
    );
    expect(text(section(render({ ...page, queued }), "Queued"))).toContain(
      "build-farm이 Offline이라 기다려요",
    );
  });
});

describe("모든 Workspace 보기(0066)", () => {
  it("칸과 Runners 열을 모두 보이고 카드에 Workspace 이름을 붙인다", () => {
    const html = render(seededPage("all"));
    for (const name of ["Queued", "Running", "Done", "Runners"])
      expect(section(html, name)).not.toBe("");
    expect(text(row(section(html, "Done"), "ACME-6"))).toContain("Acme Commerce");
    expect(text(row(section(html, "Running"), "ACME-10"))).toContain("Acme Commerce");
    expect(text(row(section(html, "Done"), "ACME-1"))).toContain("Acme Commerce");
  });
});

describe("질문 레이어", () => {
  it("질문, 선택지 라디오, 마지막 직접 쓰기를 보이고 고르기 전에는 고르라고 안내한다", () => {
    const html = renderForm(question);
    expect(html).toMatch(/<p[^>]*>재시도 간격을 바꿀까요\?<\/p>/);
    const labelledBy = /role="radiogroup" aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<div id="${labelledBy}"`);
    const radios = [...html.matchAll(/<input type="radio"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/g)];
    expect(radios.map((m) => m[1])).toEqual([...question.choices, questionJson.other]);
    expect(html).not.toContain("checked");
    expect(html).toMatch(/<button[^>]*data-variant="primary"[^>]*>보내기<\/button>/);
    expect(text(html)).toContain(questionJson.pick);
    expect(html).not.toContain("<textarea");
  });

  it("긴 선택지 문구는 자르지 않고 그대로 다 그린다", () => {
    const long = `${"재시도 간격을 지수 백오프로 바꾸고 최대 다섯 번까지 다시 시도한 뒤 ".repeat(4)}끝내요`;
    const html = renderForm({ ...question, choices: [long, "30초 고정"] });
    expect(html).toContain(`>${long}</span>`);
    expect(html).not.toContain("…");
  });
});

describe("질문 레이어: 선택지 없이 온 질문(0116)", () => {
  const inline = {
    ...question,
    body: "02 작업 전제인 01이 main에 없어요. 어떻게 할까요? (A) 01 이 머지될 때까지 기다린다 (B) 02 를 먼저 한다(충돌 가능). 기본 제안은 B 예요.",
    choices: [],
  };

  it("글 안의 (A) (B)를 글자와 함께 선택지로 나누고 추천 문장은 선택지 아래에 둔다", () => {
    const html = renderForm(inline);
    const radios = [
      ...html.matchAll(/<input type="radio"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span><\/label>/g),
    ];
    expect(radios.map((m) => text(m[1] ?? ""))).toEqual([
      "A 01 이 머지될 때까지 기다린다",
      "B 02 를 먼저 한다(충돌 가능).",
      questionJson.other,
    ]);
    expect(html).toMatch(/<p[^>]*>02 작업 전제인 01이 main에 없어요. 어떻게 할까요\?<\/p>/);
    expect(html.indexOf("기본 제안은 B 예요.")).toBeGreaterThan(html.indexOf(questionJson.other));
    expect(html).not.toContain("(A)");
  });

  it("나눌 수 없으면 문단을 그대로 두고 라디오 없이 바로 쓰는 답 칸을 보인다", () => {
    const html = renderForm({
      ...question,
      body: "첫 줄\n둘째 줄\n\n테스트를 건너뛸까요?",
      choices: [],
    });
    expect(html).not.toContain('type="radio"');
    expect(html).toMatch(/<p[^>]*>첫 줄\n둘째 줄<\/p>/);
    expect(html).toMatch(/<p[^>]*>테스트를 건너뛸까요\?<\/p>/);
    expect(html).toContain("<textarea");
    expect(text(html)).toContain(questionJson.answerLabel);
    expect(text(html)).toContain(questionJson.shortcut);
  });

  it("카드는 선택지를 뺀 질문만 두 줄 요약으로 보인다", () => {
    const card = row(section(render(withInput(seededPage(), inline)), "Running"), "ACME-11");
    expect(text(card)).toContain("어떻게 할까요?");
    expect(text(card)).not.toContain("머지될 때까지");
  });
});

describe("Runners", () => {
  it("러너마다 상태 점·이름·칸·숫자를 한 줄로 보이고 문제가 있으면 빨간 상자 하나를 둔다", () => {
    const html = section(render(seededPage()), "Runners");
    const offline = row(html, "runner-b");
    expect(dots(offline)).toEqual(["offline"]);
    expect(offline).toContain('href="/runners?ws=ws-commerce&amp;sel=runner-b"');
    expect(offline).toMatch(/role="img" aria-label="1자리 중 0자리 사용" data-tone="problem"/);
    expect(text(offline)).toBe("Offline runner-b 0/1");
    const online = row(html, "runner-a");
    expect(dots(online)).toEqual(["online"]);
    expect(online).toMatch(/role="img" aria-label="10자리 중 4자리 사용" data-tone="progress"/);
    expect(html.indexOf("runner-b")).toBeLessThan(html.indexOf("runner-a"));

    expect([...html.matchAll(/<section aria-labelledby/g)]).toHaveLength(1);
    expect(html).toMatch(/<h3[^>]*>러너 1대에 문제가 있어요<\/h3>/);
    expect(text(html)).toContain("Offline이에요: runner-b(2 hr)");
    expect(html).toMatch(
      /<a href="\/runners\?ws=ws-commerce" data-variant="secondary"[^>]*>Runners에서 고치기<\/a>/,
    );
  });

  it("칸 하나가 자리 하나이고, 쓰는 자리는 Online이면 초록·문제 러너면 빨강, 빈자리는 테두리만이다", () => {
    const page = seededPage();
    const html = section(
      render({
        ...page,
        runners: {
          list: [
            {
              id: "r-half",
              name: "mac-half",
              cause: null,
              offlineMs: null,
              used: 2,
              capacity: 3,
              usage: null,
              limits: [],
            },
            {
              id: "r-full",
              name: "mac-full",
              cause: null,
              offlineMs: null,
              used: 3,
              capacity: 3,
              usage: null,
              limits: [],
            },
            {
              id: "r-auth",
              name: "mac-auth",
              cause: "auth",
              offlineMs: null,
              used: 1,
              capacity: 2,
              usage: null,
              limits: [],
            },
          ],
        },
      }),
      "Runners",
    );
    const cells = (name: string) =>
      [...row(html, name).matchAll(/data-cell="(used|free)"/g)].map((m) => m[1]);
    expect(cells("mac-half")).toEqual(["used", "used", "free"]);
    expect(cells("mac-full")).toEqual(["used", "used", "used"]);
    expect(cells("mac-auth")).toEqual(["used", "free"]);
    expect(row(html, "mac-half")).toContain('data-tone="progress"');
    expect(row(html, "mac-auth")).toContain('data-tone="problem"');
    expect(text(row(html, "mac-half"))).toBe("Online mac-half 2/3");
  });

  it("구역 머리에 Online이고 문제 없는 러너의 빈자리 합을 새 런 받을 자리로 보인다", () => {
    const page = seededPage();
    const html = section(
      render({
        ...page,
        runners: {
          list: [
            {
              id: "r-half",
              name: "mac-half",
              cause: null,
              offlineMs: null,
              used: 2,
              capacity: 3,
              usage: null,
              limits: [],
            },
            {
              id: "r-free",
              name: "mac-free",
              cause: null,
              offlineMs: null,
              used: 0,
              capacity: 2,
              usage: null,
              limits: [],
            },
            {
              id: "r-over",
              name: "mac-over",
              cause: null,
              offlineMs: null,
              used: 3,
              capacity: 2,
              usage: null,
              limits: [],
            },
            {
              id: "r-off",
              name: "mac-off",
              cause: "offline",
              offlineMs: 60_000,
              used: 0,
              capacity: 4,
              usage: null,
              limits: [],
            },
            {
              id: "r-auth",
              name: "mac-auth",
              cause: "auth",
              offlineMs: null,
              used: 0,
              capacity: 4,
              usage: null,
              limits: [],
            },
          ],
        },
      }),
      "Runners",
    );
    expect(text(html)).toContain("Runners 5 새 런 받을 자리 3");
    expect(text(section(render(seededPage()), "Runners"))).toContain("새 런 받을 자리 6");
  });

  it("러너가 없으면 새 런 받을 자리 줄을 두지 않는다", () => {
    const page = seededPage();
    const html = section(render({ ...page, runners: { list: [] } }), "Runners");
    expect(text(html)).not.toContain("새 런 받을 자리");
    expect(text(html)).toContain("아직 러너가 없어요.");
  });

  it("GitHub 인증이 깨진 러너는 Runner Issue 점과 인증 까닭으로 보인다", () => {
    const page = seededPage();
    const html = section(
      render({
        ...page,
        runners: {
          list: page.runners.list.map((runner) =>
            runner.id === "runner-a" ? { ...runner, cause: "auth" as const } : runner,
          ),
        },
      }),
      "Runners",
    );
    expect(dots(row(html, "runner-a"))).toEqual(["runner-issue"]);
    expect(html).toMatch(/<h3[^>]*>러너 2대에 문제가 있어요<\/h3>/);
    expect(text(html)).toContain("GitHub 인증을 다시 해야 해요: runner-a");
  });

  it("문제가 없으면 빨간 상자가 없다", () => {
    const page = seededPage();
    const html = section(
      render({ ...page, runners: { list: page.runners.list.filter((r) => r.cause === null) } }),
      "Runners",
    );
    expect(html).not.toContain("<section aria-labelledby");
  });
});

describe("문구", () => {
  it("상태 이름은 GLOSSARY 영어 용어다(ADR 0010 1번)", () => {
    const html = render(seededPage());
    const terms = new Map<string, string>([
      ...Object.entries(domain.runState),
      ...Object.entries(domain.summary),
      ...Object.entries(domain.runnerState),
      ...Object.entries(domain.attention),
    ]);
    const dotted = [
      ...html.matchAll(
        /<span data-status="([^"]+)" data-tone="[^"]+"[^>]*><span aria-hidden="true"[^>]*><\/span><span[^>]*>([^<]+)<\/span>/g,
      ),
    ].map(([, status, label]) => ({ status: status ?? "", label: label ?? "" }));
    const named = [...dotted, ...pillsOf(html)];
    expect(named.length).toBeGreaterThan(5);
    for (const { status, label } of named) expect(label).toBe(terms.get(status));
  });

  it("문구는 메시지 파일에서 온다", () => {
    const html = render(withPermission(withInput(seededPage(), question))) + renderForm(question);
    expect(html).not.toMatch(/\b(home|domain|question)\.[a-zA-Z]/);
  });
});

describe("Runners 공급자 사용량(0086)", () => {
  const base = { cause: null, offlineMs: null, used: 1, capacity: 2, limits: [] };

  it("러너 행 아래에 가장 높은 사용량을 숫자로, 90% 이상이면 빨강 글자로 보인다", () => {
    const html = section(
      render({
        ...seededPage(),
        runners: {
          list: [
            {
              ...base,
              id: "r-a",
              name: "mac-a",
              usage: { provider: "claude", window: "weekly", usedPercent: 72.4 },
            },
            {
              ...base,
              id: "r-b",
              name: "mac-b",
              usage: { provider: "codex", window: "session", usedPercent: 93 },
            },
            { ...base, id: "r-c", name: "mac-c", usage: null },
          ],
        },
      }),
      "Runners",
    );
    expect(text(row(html, "mac-a"))).toBe("Online mac-a Claude 주간 72% 1/2");
    expect(text(row(html, "mac-b"))).toContain("Codex 5시간 93%");
    expect(row(html, "mac-a")).toContain(
      renderWithMessages(
        <Text variant="meta" numeric>
          Claude 주간 72%
        </Text>,
      ),
    );
    expect(row(html, "mac-b")).toContain(
      renderWithMessages(
        <Text variant="meta" numeric tone="problem">
          Codex 5시간 93%
        </Text>,
      ),
    );
    expect(text(row(html, "mac-c"))).toBe("Online mac-c 1/2");
  });

  it("100%에 닿은 러너는 문제 상자에 한 줄, 머리 문장에 언제 다시 받는지 보인다", () => {
    const page: HomePage = {
      ...seededPage(),
      runners: {
        list: [
          {
            ...base,
            id: "r-c",
            name: "runner-c",
            usage: { provider: "claude", window: "session", usedPercent: 100 },
            limits: [{ provider: "claude", window: "session", resetsInMs: 72 * 60_000 }],
          },
          { ...base, id: "r-a", name: "runner-a", usage: null },
        ],
      },
    };
    const html = render(page);
    const runners = section(html, "Runners");
    expect(text(runners)).toContain("러너 1대에 문제가 있어요");
    expect(text(runners)).toContain(
      "Claude 5시간 한도에 닿았어요: runner-c · 1 hr 12 min 뒤 한도가 풀리면 다시 런을 받아요",
    );
    expect(text(html)).toContain(
      "한도에 닿은 러너 1대는 1 hr 12 min 뒤 한도가 풀리면 다시 런을 받아요.",
    );
  });

  it("한도에 닿은 러너가 없으면 문제 상자와 머리 문장에 한도 이야기가 없다", () => {
    const html = render({
      ...seededPage(),
      runners: { list: [{ ...base, id: "r-a", name: "runner-a", usage: null }] },
    });
    expect(text(html)).not.toContain("한도");
  });
});

describe("Dashboard 카드의 PR 칩(0167)", () => {
  const openPr = (over: Partial<PrSignalsView>): PrSignalsView => ({
    ciFailed: false,
    checkTotal: 4,
    failedCount: 0,
    failedChecks: [],
    checksTruncated: false,
    conflict: false,
    behindBy: 0,
    checkedAt: now.toISOString(),
    ...over,
  });

  const withSignals = (page: HomePage, key: string, signals: PrSignalsView): HomePage => {
    const patch = (run: HomeRun): HomeRun =>
      run.ticketKey === key
        ? {
            ...run,
            pullRequest: {
              displayId: "#42",
              url: "https://code.example.com/acme/web/pull/420",
              signals,
            },
          }
        : run;
    return {
      ...page,
      attention: page.attention.map((item) => ({ ...item, run: patch(item.run) })),
      running: page.running.map(patch),
      queued: page.queued.map(patch),
      endedRecently: page.endedRecently.map(patch),
    };
  };

  const chipsOf = (card: string) =>
    [...card.matchAll(/data-pr-chip="([^"]+)"/g)].map((match) => match[1]);

  const questionPage = () => withInput(seededPage(), question);

  it("PR이 없는 카드에는 칩이 없다", () => {
    expect(chipsOf(row(render(questionPage()), "ACME-11"))).toEqual([]);
  });

  it("Open PR의 CI 실패는 칩 하나로 보인다", () => {
    const page = withSignals(questionPage(), "ACME-11", openPr({ ciFailed: true }));
    const card = row(render(page), "ACME-11");
    expect(chipsOf(card)).toEqual(["ci-failed"]);
    expect(text(card)).toContain(homeJson.card.prChip.ciFailed);
  });

  it.each([
    ["충돌 없음·최신", { conflict: false, behindBy: 0 }],
    ["아직 모름", { conflict: null, behindBy: null }],
  ])("CI 통과에 %s이면 칩을 만들지 않는다", (_name, over) => {
    const page = withSignals(questionPage(), "ACME-11", openPr(over));
    expect(chipsOf(row(render(page), "ACME-11"))).toEqual([]);
  });

  it("문제가 셋이면 급한 순서로 둘을 보이고 나머지는 +1 로 묶는다", () => {
    const page = withSignals(
      questionPage(),
      "ACME-11",
      openPr({ ciFailed: true, conflict: true, behindBy: 4 }),
    );
    const card = row(render(page), "ACME-11");
    expect(chipsOf(card)).toEqual(["ci-failed", "conflict", "more"]);
    expect(text(card)).toContain("+1");
  });

  it("선행 티켓 칩이 먼저, PR 칩이 뒤에 온다", () => {
    const page = seededPage();
    const first = page.queued[0];
    if (first === undefined) throw new Error("no queued run");
    const blocked: HomePage = {
      ...page,
      queued: page.queued.map((run) =>
        run.id === first.id && run.state === "queued"
          ? {
              ...run,
              queuedReason: {
                kind: "blockers-waiting" as const,
                blockers: [
                  {
                    key: "ACME-90",
                    title: "앞 티켓",
                    stateName: "In Progress",
                    stateCategory: "started",
                  },
                ],
              },
            }
          : run,
      ),
    };
    const card = row(
      render(withSignals(blocked, first.ticketKey, openPr({ ciFailed: true }))),
      first.ticketKey,
    );
    expect(card.indexOf("data-blocker-state")).toBeGreaterThan(-1);
    expect(card.indexOf("data-blocker-state")).toBeLessThan(card.indexOf("data-pr-chip"));
  });

  it("Question 카드에서 칩은 질문 문장 아래, 바닥 줄 위에 있다", () => {
    const page = withSignals(questionPage(), "ACME-11", openPr({ ciFailed: true }));
    const card = row(render(page), "ACME-11");
    const chip = card.indexOf("data-pr-chip");
    expect(card.indexOf(question.body)).toBeLessThan(chip);
    const runnerName = runOf(page, "ACME-11").runner?.name;
    if (runnerName === undefined) throw new Error("no runner");
    expect(chip).toBeLessThan(card.indexOf(runnerName));
  });

  it("칩 글은 카드 버튼의 설명에 들어가고, +N 은 묶인 문제를 읽어 준다", () => {
    const page = withSignals(
      questionPage(),
      "ACME-11",
      openPr({ ciFailed: true, conflict: true, behindBy: 4 }),
    );
    const card = row(render(page), "ACME-11");
    const described = /aria-describedby="([^"]+)"/.exec(card)?.[1]?.split(" ") ?? [];
    const chipsId = described.find((id) => {
      const start = card.indexOf(`<span id="${id}"`);
      return start >= 0 && balanced(card, start, "span").includes("data-pr-chip");
    });
    if (chipsId === undefined) throw new Error("칩 줄이 설명에 없다");
    const chips = text(balanced(card, card.indexOf(`<span id="${chipsId}"`), "span"));
    expect(chips).toContain(homeJson.card.prChip.ciFailed);
    expect(chips).toContain(homeJson.card.prChip.conflict);
    expect(chips).toContain(homeJson.card.prChip.behind.replace("{count}", "4"));
  });

  it.each([
    ["처리할 일 없이 끝난 카드", "reported-success"],
    ["Failed 카드", "timed-out"],
  ] as const)("PR을 못 읽은 %s는 칩 없이 바닥 줄에 쓴다", (_name, agentResult) => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("seed");
    expect(
      changeRunState(
        db,
        id,
        { to: "ended", agentResult, prState: "unknown", prReadError: "other" },
        minutes(110),
      ).ok,
    ).toBe(true);
    const card = row(render(loadHomePage(db, "ws-commerce", now, "UTC")), "ACME-10");
    expect(chipsOf(card)).toEqual([]);
    expect(text(card)).toContain(homeJson.card.prUnread);
  });
});

describe("Dashboard 멈추기·재개(0118)", () => {
  function pausedPage() {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    expect(changeRunState(db, id, { to: "paused" }, minutes(100))).toMatchObject({ ok: true });
    return { db, id };
  }

  it("Running 카드는 오른쪽 위 메뉴로 멈추고, Paused 카드는 Running 칸에 꼬리표와 재개하기를 단다", () => {
    const running = row(section(render(seededPage()), homeJson.column.running), "ACME-10");
    expect(running).toContain(`aria-label="${homeJson.card.menu.replace("{key}", "ACME-10")}"`);

    const { db } = pausedPage();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(page.attention.some((item) => item.run.ticketKey === "ACME-10")).toBe(false);
    const paused = row(section(render(page), homeJson.column.running), "ACME-10");
    expect(pillsOf(paused)).toEqual([{ status: "paused", label: domain.runState.paused }]);
    expect(buttonsOf(paused).map((button) => button.label)).toContain(homeJson.card.resume);
    expect(paused).not.toContain(homeJson.card.menu.replace("{key}", "ACME-10"));
    expect(text(paused)).toContain("20 min");
    expect(text(paused)).toContain(domain.pauseSource.operator);
  });

  it("러너에서 멈춘 런도 Running 칸의 Paused 카드로 두고 누가 멈췄는지만 다르게 보인다(0120)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    expect(changeRunState(db, id, { to: "paused", source: "runner" }, minutes(100))).toMatchObject({
      ok: true,
    });
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(page.attention.some((item) => item.run.ticketKey === "ACME-10")).toBe(false);
    const paused = row(section(render(page), homeJson.column.running), "ACME-10");
    expect(pillsOf(paused)).toEqual([{ status: "paused", label: domain.runState.paused }]);
    expect(buttonsOf(paused).map((button) => button.label)).toContain(homeJson.card.resume);
    expect(text(paused)).toContain(domain.pauseSource.runner);
  });

  it("요청 중이면 카드 아래 줄에 멈추는 중을 보이고 행동을 숨기며, 실패하면 이유를 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    requestRunControl(db, id, "pause", minutes(110));
    const pending = row(
      section(render(loadHomePage(db, "ws-commerce", now, "UTC")), homeJson.column.running),
      "ACME-10",
    );
    expect(text(pending)).toContain(homeJson.card.pausing);
    expect(pending).not.toContain('aria-haspopup="menu"');

    completeRunControlRequest(db, {
      runId: id,
      requestedAt: minutes(110),
      completedAt: minutes(111),
      error: "agent-not-running",
    });
    const failed = row(
      section(render(loadHomePage(db, "ws-commerce", now, "UTC")), homeJson.column.running),
      "ACME-10",
    );
    expect(text(failed)).toContain(
      homeJson.card.pauseFailed.replace("{reason}", domain.runControlFailure["agent-not-running"]),
    );
  });
});
