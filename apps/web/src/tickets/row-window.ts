import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

const ROWS_BEFORE_MEASURING = 30;
const EXTRA_ROWS_EACH_SIDE = 6;
const ROW_HEIGHT_BEFORE_MEASURING = 52;

export interface RowWindow {
  start: number;
  end: number;
  spaceBefore: number;
  spaceAfter: number;
}

export function rowOffsets(heights: ReadonlyArray<number>): number[] {
  const offsets = [0];
  let total = 0;
  for (const height of heights) {
    total += height;
    offsets.push(total);
  }
  return offsets;
}

function firstRowEndingAfter(offsets: ReadonlyArray<number>, position: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((offsets[middle + 1] ?? Infinity) <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function windowOf(
  offsets: ReadonlyArray<number>,
  visibleFrom: number,
  visibleTo: number,
  extra = EXTRA_ROWS_EACH_SIDE,
): RowWindow {
  const count = offsets.length - 1;
  const total = offsets[count] ?? 0;
  const first = firstRowEndingAfter(offsets, visibleFrom);
  const last = firstRowEndingAfter(offsets, visibleTo);
  const start = clamp(first - extra, 0, count);
  const end = clamp(last + 1 + extra, start, count);
  const before = offsets[start] ?? 0;
  return { start, end, spaceBefore: before, spaceAfter: total - (offsets[end] ?? total) };
}

export function useRowWindow(
  root: RefObject<HTMLElement | null>,
  rowKeys: ReadonlyArray<string>,
  indexToKeepInView: number,
): RowWindow {
  const measured = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<{ from: number; to: number } | null>(null);

  const offsets = useMemo(
    () =>
      rowOffsets(rowKeys.map((key) => measured.current.get(key) ?? ROW_HEIGHT_BEFORE_MEASURING)),
    [rowKeys, version],
  );

  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    let changed = false;
    for (const row of element.querySelectorAll<HTMLElement>("[data-row-key]")) {
      const key = row.dataset["rowKey"];
      if (key === undefined) continue;
      const style = getComputedStyle(row);
      const height =
        row.getBoundingClientRect().height +
        Number.parseFloat(style.marginTop) +
        Number.parseFloat(style.marginBottom);
      if (height > 0 && measured.current.get(key) !== height) {
        measured.current.set(key, height);
        changed = true;
      }
    }
    if (changed) setVersion((current) => current + 1);
  });

  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    const scroller = scrollParent(element);
    const update = () => {
      const list = element.querySelector('[role="list"]');
      if (list === null) return;
      const listTop = list.getBoundingClientRect().top;
      const area = visibleArea(scroller);
      const from = Math.max(0, area.top - listTop);
      const to = Math.max(0, area.bottom - listTop);
      setView((prev) => (prev?.from === from && prev.to === to ? prev : { from, to }));
    };
    const remeasure = () => {
      measured.current.clear();
      setVersion((current) => current + 1);
      update();
    };
    update();
    const scrollTarget: HTMLElement | Window = scroller ?? window;
    scrollTarget.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", remeasure);
    const observer = new ResizeObserver(update);
    observer.observe(scroller ?? element);
    return () => {
      scrollTarget.removeEventListener("scroll", update);
      window.removeEventListener("resize", remeasure);
      observer.disconnect();
    };
  }, [root, rowKeys.length]);

  const keyToKeepInView = rowKeys[indexToKeepInView];
  useLayoutEffect(() => {
    const element = root.current;
    if (element === null || indexToKeepInView < 0) return;
    const list = element.querySelector('[role="list"]');
    if (list === null) return;
    const scroller = scrollParent(element);
    const listTop = list.getBoundingClientRect().top;
    const rowTop = listTop + (offsets[indexToKeepInView] ?? 0);
    const rowBottom = listTop + (offsets[indexToKeepInView + 1] ?? 0);
    const area = visibleArea(scroller);
    let delta = 0;
    if (rowTop < area.top) delta = rowTop - area.top;
    else if (rowBottom > area.bottom) delta = rowBottom - area.bottom;
    if (delta === 0) return;
    if (scroller === null) window.scrollBy(0, delta);
    else scroller.scrollTop += delta;
  }, [root, keyToKeepInView]);

  if (view === null) {
    const end = Math.min(rowKeys.length, ROWS_BEFORE_MEASURING);
    return {
      start: 0,
      end,
      spaceBefore: 0,
      spaceAfter: (offsets[rowKeys.length] ?? 0) - (offsets[end] ?? 0),
    };
  }
  return windowOf(offsets, view.from, view.to);
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

function visibleArea(scroller: HTMLElement | null): { top: number; bottom: number } {
  if (scroller === null) return { top: 0, bottom: window.innerHeight };
  const top = scroller.getBoundingClientRect().top + scroller.clientTop;
  return { top, bottom: top + scroller.clientHeight };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
