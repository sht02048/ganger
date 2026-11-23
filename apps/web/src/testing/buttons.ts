import type { ButtonVariant } from "@ganger/ui";

export interface RenderedButton {
  variant: ButtonVariant | "other";
  label: string;
}

function toVariant(value: string | undefined): ButtonVariant | "other" {
  switch (value) {
    case "primary":
    case "secondary":
    case "danger":
    case "ghost":
    case "answer":
      return value;
    case undefined:
    default:
      return "other";
  }
}

export function buttonsOf(html: string): RenderedButton[] {
  return [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map((m) => ({
    variant: toVariant(/data-variant="([^"]+)"/.exec(m[1] ?? "")?.[1]),
    label: (m[2] ?? "")
      .replace(/<span aria-hidden="true"[^>]*>.*?<\/span>/gs, "")
      .replace(/<[^>]+>/g, "")
      .trim(),
  }));
}
