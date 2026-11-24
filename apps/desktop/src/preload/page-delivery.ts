import type { DesktopPage } from "@ganger/app/shell/nav-shortcuts";

export const PAGE_LISTENER_WAIT_MS = 5_000;
const PAGE_LISTENER_POLL_MS = 100;

export interface PageDelivery {
  listeners: () => ReadonlySet<(page: DesktopPage) => void>;
  unsupported: (page: DesktopPage) => void;
  later: (run: () => void, ms: number) => void;
}

export function deliverDesktopPage(
  page: DesktopPage,
  delivery: PageDelivery,
  waitMs = PAGE_LISTENER_WAIT_MS,
): void {
  const listeners = delivery.listeners();
  if (listeners.size > 0) {
    for (const listener of listeners) listener(page);
    return;
  }
  if (waitMs <= 0) {
    delivery.unsupported(page);
    return;
  }
  delivery.later(
    () => deliverDesktopPage(page, delivery, waitMs - PAGE_LISTENER_POLL_MS),
    PAGE_LISTENER_POLL_MS,
  );
}
