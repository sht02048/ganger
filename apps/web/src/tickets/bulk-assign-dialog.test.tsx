// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkAssignInput, BulkAssignResult } from "@ganger/app/tickets/assign";
import type { TicketGroup } from "@ganger/app/tickets/groups";
import type { TicketBlockersResult, TicketRun, TicketView } from "@ganger/app/tickets/model";
import { DEFAULT_TIME_ZONE } from "@ganger/app/time-zone";
import { appMessages, defaultLocale } from "../i18n";
import { BulkAssignDialog } from "./bulk-assign-dialog";
import type { BulkAssignDialogProps } from "./bulk-assign-dialog";
import { ticketsMessages } from "./messages";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.assign(Element.prototype, { getAnimations: () => [] });
Object.assign(Element.prototype, { scrollIntoView: () => {} });
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
});

const CHECKING = ticketsMessages.tickets.bulkAssign.checkingBlockers;
const UNREAD = ticketsMessages.tickets.bulkAssign.hint["blocker-unread"];
const defaults = { runnerProject: "github:acme/web", agent: "claude", repos: [] };

function child(key: string, overrides: Partial<TicketView> = {}): TicketView {
  return {
    id: JSON.stringify(["conn-acme", key]),
    connection: "conn-acme",
    key,
    title: `${key} 제목`,
    url: null,
    trackerProject: { id: "tp-web", name: "Web" },
    trackerState: { name: "Todo", category: "unstarted" },
    priority: "none",
    ancestors: [],
    isParentIssue: false,
    blockerWait: null,
    waitingTickets: [],
    labels: [],
    runs: [],
    mapping: defaults,
    assignability: { kind: "ready", defaults },
    ...overrides,
  };
}

const failedRun: TicketRun = {
  id: "run-failed",
  runnerName: "runner-a",
  state: "ended",
  endedAt: "2026-11-22T00:00:00.000Z",
  endedAgoMs: 0,
  agentResult: "reported-failure",
  prState: "none",
  laterPrState: null,
  pullRequest: null,
  summary: "failed",
};

function groupOf(children: ReadonlyArray<TicketView>): TicketGroup {
  return {
    id: "group-root",
    connection: "conn-acme",
    root: {
      key: "ACME-100",
      title: "상위 이슈",
      url: null,
      state: { name: "Todo", category: "unstarted" },
    },
    rootTicket: null,
    children,
    progress: { done: 0, inProgress: 0, remaining: children.length, total: children.length },
    stage: "assignable",
    expandedByDefault: true,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const noBlockers: TicketBlockersResult = { ok: true, blockers: [] };

function blockedBy(key: string, category: string): TicketBlockersResult {
  return {
    ok: true,
    blockers: [{ key, title: `${key} 제목`, stateName: category, stateCategory: category }],
  };
}

let host: HTMLDivElement;
let root: Root;

function wrapped(node: ReactNode) {
  return (
    <IntlProvider
      locale={defaultLocale}
      messages={{ ...appMessages, ...ticketsMessages }}
      timeZone={DEFAULT_TIME_ZONE}
    >
      {node}
    </IntlProvider>
  );
}

function props(overrides: Partial<BulkAssignDialogProps>): BulkAssignDialogProps {
  return {
    group: groupOf([child("ACME-1")]),
    open: true,
    onOpenChange: () => {},
    onAssignMany: () => Promise.resolve({ results: [] }),
    onReadBlockers: () => Promise.resolve(noBlockers),
    onAssigned: () => {},
    finalFocus: () => null,
    ...overrides,
  };
}

async function mount(overrides: Partial<BulkAssignDialogProps>): Promise<void> {
  await act(async () => {
    root.render(wrapped(<BulkAssignDialog {...props(overrides)} />));
    await Promise.resolve();
  });
}

async function settle(work: () => void = () => {}): Promise<void> {
  await act(async () => {
    work();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function checkbox(key: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    const label = labelledBy === null ? null : document.getElementById(labelledBy);
    return (label?.textContent ?? element.closest("label")?.textContent ?? "").includes(key);
  });
  if (found === undefined) throw new Error(`no checkbox for ${key}`);
  return found;
}

const isChecked = (key: string) => checkbox(key).getAttribute("aria-checked") === "true";

function buttonNamed(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((button) =>
    button.textContent.includes(name),
  );
  if (found === undefined) throw new Error(`no button ${name}`);
  return found;
}

const submitButton = () => buttonNamed("할당하기");
const isBusy = (button: HTMLElement) => button.getAttribute("aria-busy") === "true";

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
  document.body.replaceChildren();
});

describe("선행 티켓을 읽는 동안(0176)", () => {
  it("다 읽을 때까지 관계도를 그리지 않고 할당 버튼을 막으며, 다 읽으면 한 번에 그린다(0182)", async () => {
    const read = deferred<TicketBlockersResult>();
    const onAssignMany = vi.fn<(input: BulkAssignInput) => Promise<BulkAssignResult>>(() =>
      Promise.resolve({ results: [] }),
    );
    await mount({
      group: groupOf([child("ACME-1"), child("ACME-2")]),
      onReadBlockers: (ticket) =>
        ticket.key === "ACME-1" ? read.promise : Promise.resolve(noBlockers),
      onAssignMany,
    });
    await settle();
    expect(isBusy(submitButton())).toBe(true);
    expect(submitButton().textContent).toContain(CHECKING);

    await settle(() => submitButton().click());
    expect(onAssignMany).not.toHaveBeenCalled();

    expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(0);
    expect(document.querySelector("[data-spinner]")).not.toBeNull();

    await settle(() => read.resolve(noBlockers));
    expect(isBusy(submitButton())).toBe(false);
    expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
    expect(document.querySelector("[data-spinner]")).toBeNull();
    await settle(() => checkbox("ACME-2").click());
    await settle(() => submitButton().click());
    expect(onAssignMany.mock.calls[0]?.[0].assignments.map((one) => one.ticketKey)).toEqual([
      "ACME-1",
    ]);
  });

  it("열린 뒤 다시 읽어 새로 할당할 수 있게 된 하위 티켓도 읽고, 그동안 버튼을 막는다", async () => {
    const late = deferred<TicketBlockersResult>();
    const onReadBlockers = vi.fn<BulkAssignDialogProps["onReadBlockers"]>((ticket) =>
      ticket.key === "ACME-2" ? late.promise : Promise.resolve(noBlockers),
    );
    await mount({ group: groupOf([child("ACME-1")]), onReadBlockers });
    await settle();
    expect(isBusy(submitButton())).toBe(false);

    await mount({ group: groupOf([child("ACME-1"), child("ACME-2")]), onReadBlockers });
    await settle();
    expect(onReadBlockers.mock.calls.map(([ticket]) => ticket.key)).toEqual(["ACME-1", "ACME-2"]);
    expect(isBusy(submitButton())).toBe(true);

    await settle(() => late.resolve(blockedBy("ACME-9", "canceled")));
    expect(isBusy(submitButton())).toBe(false);
    expect(document.body.textContent).toContain("ACME-9 티켓이 취소돼서");
    expect(isChecked("ACME-2")).toBe(false);
  });
});

describe("선행 티켓 읽기 결과(0176)", () => {
  it("읽기가 실패하면 체크를 풀고 안내하며, 모든 읽기가 끝나면 사람이 골라 할당할 수 있다", async () => {
    const onAssignMany = vi.fn<(input: BulkAssignInput) => Promise<BulkAssignResult>>(() =>
      Promise.resolve({ results: [] }),
    );
    await mount({
      group: groupOf([child("ACME-1"), child("ACME-2")]),
      onReadBlockers: (ticket) =>
        ticket.key === "ACME-1"
          ? Promise.resolve({ ok: false, reason: "failed" })
          : Promise.reject(new Error("network")),
      onAssignMany,
    });
    await settle();
    expect(isChecked("ACME-1")).toBe(false);
    expect(isChecked("ACME-2")).toBe(false);
    expect(document.body.textContent).toContain(UNREAD);
    expect(isBusy(submitButton())).toBe(false);

    await settle(() => checkbox("ACME-1").click());
    await settle(() => submitButton().click());
    expect(onAssignMany.mock.calls[0]?.[0].assignments.map((one) => one.ticketKey)).toEqual([
      "ACME-1",
    ]);
  });

  it("선행 티켓이 취소된 하위 티켓은 체크를 푼다", async () => {
    await mount({ onReadBlockers: () => Promise.resolve(blockedBy("ACME-9", "canceled")) });
    await settle();
    expect(isChecked("ACME-1")).toBe(false);
    expect(document.body.textContent).toContain("ACME-9 티켓이 취소돼서 할당하면 Queued에 멈춰요");
  });

  it("지난 런이 Failed인 하위 티켓도 선행 안내를 보이고 체크하지 않는다", async () => {
    await mount({
      group: groupOf([child("ACME-1", { runs: [failedRun] })]),
      onReadBlockers: () => Promise.resolve(blockedBy("ACME-9", "started")),
    });
    await settle();
    expect(isChecked("ACME-1")).toBe(false);
    expect(document.body.textContent).toContain("지난 런이 Failed예요 · ACME-9 뒤에 시작해요");
  });
});

describe("관계도(0182)", () => {
  const chain = (ticket: TicketView): Promise<TicketBlockersResult> => {
    if (ticket.key === "ACME-2") return Promise.resolve(blockedBy("ACME-1", "unstarted"));
    if (ticket.key === "ACME-3") return Promise.resolve(blockedBy("ACME-2", "unstarted"));
    return Promise.resolve(noBlockers);
  };
  const nodeTone = (key: string) =>
    checkbox(key).closest("[data-graph-node]")?.getAttribute("data-tone");
  const descriptionOf = (key: string) => {
    const id = checkbox(key).getAttribute("aria-describedby");
    return id === null ? null : document.getElementById(id)?.textContent;
  };

  it("앞 티켓 체크를 풀면 뒤 티켓의 체크는 그대로 두고 여러 단계 모두 빨간 테두리로 바꾼다", async () => {
    await mount({
      group: groupOf([child("ACME-1"), child("ACME-2"), child("ACME-3")]),
      onReadBlockers: chain,
    });
    await settle();
    expect(nodeTone("ACME-3")).toBe("default");
    expect(descriptionOf("ACME-2")).toBe("ACME-1 뒤에 시작해요");

    await settle(() => checkbox("ACME-1").click());
    expect(isChecked("ACME-2")).toBe(true);
    expect(isChecked("ACME-3")).toBe(true);
    expect(nodeTone("ACME-2")).toBe("problem");
    expect(nodeTone("ACME-3")).toBe("problem");
    expect(descriptionOf("ACME-3")).toContain("할당해도 시작하지 못해요");
    expect(document.querySelectorAll('svg [data-edge-tone="problem"]')).toHaveLength(2);
  });

  it("Tab 순서는 1열 위에서 아래, 그다음 2열이고 화살표는 화면 읽기에서 숨긴다", async () => {
    await mount({
      group: groupOf([child("ACME-2"), child("ACME-1"), child("ACME-4")]),
      onReadBlockers: (ticket) =>
        ticket.key === "ACME-2"
          ? Promise.resolve(blockedBy("ACME-1", "unstarted"))
          : Promise.resolve(noBlockers),
    });
    await settle();
    const order = [...document.querySelectorAll('[role="checkbox"]')].map(
      (box) => box.closest("label")?.textContent,
    );
    expect(order.map((text) => text?.slice(0, 6))).toEqual(["ACME-1", "ACME-4", "ACME-2"]);
    expect(
      document.querySelector("[data-edge-tone]")?.closest("svg")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("일부만 할당돼도 할당한 앞 티켓 때문에 뒤 티켓을 빨갛게 바꾸지 않는다", async () => {
    await mount({
      group: groupOf([child("ACME-1"), child("ACME-2")]),
      onReadBlockers: chain,
      onAssignMany: () =>
        Promise.resolve({
          results: [
            { connection: "conn-acme", ticketKey: "ACME-1", ok: true, runId: "r1" },
            { connection: "conn-acme", ticketKey: "ACME-2", ok: false, reason: "active-run" },
          ],
        }),
    });
    await settle();
    await settle(() => submitButton().click());
    expect(isChecked("ACME-1")).toBe(false);
    expect(nodeTone("ACME-2")).toBe("default");
  });

  it("고를 수 없는 하위 티켓은 관계도에서 빼고 개수만 한 줄로 보인다", async () => {
    await mount({
      group: groupOf([
        child("ACME-1"),
        child("ACME-2", { trackerState: { name: "Done", category: "completed" } }),
        child("ACME-3", { mapping: null, assignability: { kind: "no-mapping" } }),
      ]),
    });
    await settle();
    expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(1);
    expect(document.body.textContent).toContain("고를 수 없는 하위 티켓 2개");
  });
});

describe("할당과 닫기(0176)", () => {
  it("보내는 동안에는 닫기를 눌러도 닫히지 않는다", async () => {
    const sending = deferred<BulkAssignResult>();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    await mount({ onAssignMany: () => sending.promise, onOpenChange });
    await settle();
    await settle(() => submitButton().click());
    await settle(() => buttonNamed("닫기").click());
    expect(onOpenChange).not.toHaveBeenCalled();
    await settle(() =>
      sending.resolve({
        results: [{ connection: "conn-acme", ticketKey: "ACME-1", ok: true, runId: "r1" }],
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("일부가 실패하면 결과를 보이고 성공한 줄의 체크를 푼다", async () => {
    const onAssigned = vi.fn<() => void>();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    await mount({
      group: groupOf([child("ACME-1"), child("ACME-2")]),
      onAssigned,
      onOpenChange,
      onAssignMany: () =>
        Promise.resolve({
          results: [
            { connection: "conn-acme", ticketKey: "ACME-1", ok: true, runId: "r1" },
            { connection: "conn-acme", ticketKey: "ACME-2", ok: false, reason: "active-run" },
          ],
        }),
    });
    await settle();
    await settle(() => submitButton().click());
    expect(onAssigned).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(isChecked("ACME-1")).toBe(false);
    expect(isChecked("ACME-2")).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "ACME-2 티켓은 할당하지 못했어요",
    );
  });

  it("할당 없이 닫으면 포커스가 지정한 요소로 돌아간다", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    function Harness({ open }: { open: boolean }) {
      return wrapped(
        <BulkAssignDialog
          {...props({
            open,
            finalFocus: () => opener,
            onOpenChange: (next) => {
              if (!next) void closeDialog();
            },
          })}
        />,
      );
    }
    const closeDialog = () =>
      Promise.resolve().then(() => {
        root.render(<Harness open={false} />);
      });
    await act(async () => {
      root.render(<Harness open />);
      await Promise.resolve();
    });
    await settle();
    await settle(() => buttonNamed("닫기").click());
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
