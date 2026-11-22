const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%()]+/g;
const TRAILING_PUNCTUATION = ".,;:!?*";
const CLOSING_BRACKETS: Readonly<Record<string, string>> = { ")": "(", "]": "[" };

function countOf(text: string, character: string): number {
  return text.split(character).length - 1;
}

function withoutTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0) {
    const last = url.charAt(end - 1);
    const opening = CLOSING_BRACKETS[last];
    const kept = url.slice(0, end);
    const unmatched = opening !== undefined && countOf(kept, last) > countOf(kept, opening);
    if (!TRAILING_PUNCTUATION.includes(last) && !unmatched) break;
    end -= 1;
  }
  return url.slice(0, end);
}

export type BodyPart = { kind: "text" | "link"; value: string };

export function bodyParts(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let cursor = 0;
  for (const match of body.matchAll(URL_PATTERN)) {
    const url = withoutTrailingPunctuation(match[0]);
    if (match.index > cursor) parts.push({ kind: "text", value: body.slice(cursor, match.index) });
    parts.push({ kind: "link", value: url });
    cursor = match.index + url.length;
  }
  if (cursor < body.length) parts.push({ kind: "text", value: body.slice(cursor) });
  return parts;
}

export function isWebLink(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
