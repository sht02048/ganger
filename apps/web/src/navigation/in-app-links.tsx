import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { backState, originOfPath } from "./back-target";

const APP_SCREENS = new Set(["", "tickets", "runs", "runners", "stats", "settings", "onboarding"]);

export interface ClickKeys {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function isPlainLinkClick(click: ClickKeys): boolean {
  return click.button === 0 && !click.metaKey && !click.ctrlKey && !click.shiftKey && !click.altKey;
}

export interface LinkTarget {
  href: string;
  target: string;
  download: boolean;
}

export function inAppHref(link: LinkTarget, current: string): string | null {
  if (link.download || (link.target !== "" && link.target !== "_self")) return null;
  const from = new URL(current);
  const to = new URL(link.href, from);
  if (to.origin !== from.origin) return null;
  if (!APP_SCREENS.has(to.pathname.split("/")[1] ?? "")) return null;
  if (to.pathname === from.pathname && to.search === from.search && to.hash !== "") return null;
  return `${to.pathname}${to.search}${to.hash}`;
}

export function InAppLinks() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !isPlainLinkClick(event)) return;
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (anchor === null) return;
      const href = inAppHref(
        { href: anchor.href, target: anchor.target, download: anchor.hasAttribute("download") },
        window.location.href,
      );
      if (href === null) return;
      event.preventDefault();
      const backOrigin = originOfPath(router.state.location.pathname);
      void router.navigate({
        href,
        ...(backOrigin === null ? {} : { state: backState(backOrigin) }),
      });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router]);
  return null;
}
