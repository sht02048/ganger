// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelList, PanelListRow, RowLink, Table, TableCell, TableRow, TableRows } from "./index";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const href = "https://code.example.com/acme/web/pull/138";
let root: Root | undefined;
let host: HTMLDivElement | undefined;

function mount(node: ReactNode): HTMLAnchorElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  const link = host.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
  if (link === null) throw new Error("no link");
  link.addEventListener("click", (event) => event.preventDefault());
  return link;
}

function press(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("RowLink(0184)", () => {
  it("새 탭으로 여는 외부 링크다", () => {
    const link = mount(<RowLink href={href}>PR #138</RowLink>);
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noreferrer");
  });

  it("TableRow 안에서 클릭·Enter·Space 는 행을 누르지 않고, 행 클릭은 그대로 누른다", () => {
    const onActivate = vi.fn<() => void>();
    const onValueChange = vi.fn<(value: string) => void>();
    const link = mount(
      <Table columns="1fr">
        <TableRows label="런" value={null} onValueChange={onValueChange}>
          <TableRow value="a" label="첫째" onActivate={onActivate}>
            <TableCell>
              <RowLink href={href}>PR #138</RowLink>
            </TableCell>
          </TableRow>
        </TableRows>
      </Table>,
    );
    act(() => link.click());
    press(link, "Enter");
    press(link, " ");
    expect(onActivate).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();

    const row = link.closest('[role="option"]');
    if (!(row instanceof HTMLElement)) throw new Error("no row");
    act(() => row.click());
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("Tab 과 Esc 는 행까지 올라간다", () => {
    const onKeyDown = vi.fn<() => void>();
    const link = mount(
      <div onKeyDown={onKeyDown}>
        <RowLink href={href}>PR #138</RowLink>
      </div>,
    );
    press(link, "Tab");
    press(link, "Escape");
    expect(onKeyDown).toHaveBeenCalledTimes(2);
  });

  it("PanelListRow 의 after 는 행 버튼 밖에 있어 따로 눌린다", () => {
    const onClick = vi.fn<() => void>();
    const link = mount(
      <PanelList>
        <PanelListRow
          title="제목"
          trailing="Succeeded"
          onClick={onClick}
          after={<RowLink href={href}>PR #138</RowLink>}
        />
      </PanelList>,
    );
    expect(link.closest("button")).toBeNull();
    act(() => link.click());
    expect(onClick).not.toHaveBeenCalled();
    const button = host?.querySelector("button");
    act(() => button?.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
