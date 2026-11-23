import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface ColorLiteral {
  line: number;
  column: number;
  text: string;
}

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".css",
]);

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", ".output", "coverage"]);

const SKIP_FILES = new Set(["routeTree.gen.ts"]);
const ALLOWED_ROOT = join("packages", "ui");
const MOBILE_TOKENS = "apps/mobile/src/design/tokens.ts";

const COLOR_FUNCTION =
  /(?<![\w.-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/gi;

const HEX_WITH_LETTER = /#(?=[0-9a-f]*[a-f])(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const HEX = "#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\\w-])";
const QUOTED_HEX = new RegExp(`(["'\`])(${HEX})\\1`, "gi");
const HEX_IN_CSS_VALUE = new RegExp(
  `(?:\\b(?:solid|dashed|dotted|double|inset)|\\d(?:px|em|rem)|,)\\s+(${HEX})`,
  "gi",
);
const ANY_HEX = new RegExp(HEX, "gi");

const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet " +
    "brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue " +
    "darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange " +
    "darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise " +
    "darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia " +
    "gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo " +
    "ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue " +
    "lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon " +
    "mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue " +
    "mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin " +
    "navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen " +
    "paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red " +
    "rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue " +
    "slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white " +
    "whitesmoke yellow yellowgreen"
  ).split(" "),
);
const COLOR_PROPERTIES = new Set([
  "fill",
  "stroke",
  "background",
  "border",
  "bordertop",
  "borderright",
  "borderbottom",
  "borderleft",
  "borderblock",
  "borderblockstart",
  "borderblockend",
  "borderinline",
  "borderinlinestart",
  "borderinlineend",
  "outline",
  "boxshadow",
  "textshadow",
  "textdecoration",
  "columnrule",
]);
const isColorProperty = (name: string): boolean => {
  const key = name.replace(/-/g, "").toLowerCase();
  return COLOR_PROPERTIES.has(key) || /colou?r$/.test(key);
};
const OBJECT_KEY = /(?<![\w$.-])(["']?)([A-Za-z_$][\w$-]*)\1\s*:(?!:)/g;
const JSX_ATTRIBUTE = /(?<=\s)(?<!\b(?:const|let|var)\s+)([A-Za-z][\w-]*)\s*=\s*(?=["'{])/g;
const GRADIENT = /(?<![\w-])(?:repeating-)?(?:linear|radial|conic)-gradient\(/gi;
const GRADIENT_WORD = /(?<![\w.$-])[a-z]+(?![\w-])/gi;
const NAMED_IN_CSS_VALUE =
  /(?<=(?:\b(?:solid|dashed|dotted|double|inset)|\d(?:px|em|rem|%)?)\s+)([a-z]+)\b/gi;
const CSS_DECLARATION = /:([^;{}]*)(?:;|}|$)/g;
const WORD = /[a-z]+/gi;

export type SourceKind = "code" | "css";

interface StringToken {
  start: number;
  content: string;
}

function readString(text: string, start: number): { token: StringToken; end: number } {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote) i += text[i] === "\\" ? 2 : 1;
  return { token: { start: start + 1, content: text.slice(start + 1, i) }, end: i + 1 };
}

function stringsInValue(text: string, start: number): StringToken[] {
  const tokens: StringToken[] = [];
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const { token, end } = readString(text, i);
      tokens.push(token);
      i = end;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && (ch === "," || ch === ";")) break;
    i += 1;
  }
  return tokens;
}

function matchingParen(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

export function findColorLiterals(source: string, kind: SourceKind = "code"): ColorLiteral[] {
  const found: ColorLiteral[] = [];
  const text =
    kind === "css" ? source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")) : source;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") lineStarts.push(i + 1);
  const add = (offset: number, match: string) => {
    let line = lineStarts.length - 1;
    while ((lineStarts[line] ?? 0) > offset) line -= 1;
    const column = offset - (lineStarts[line] ?? 0) + 1;
    if (!found.some((f) => f.line === line + 1 && f.column === column)) {
      found.push({ line: line + 1, column, text: match });
    }
  };
  const isNamed = (word: string | undefined): word is string =>
    word !== undefined && NAMED_COLORS.has(word.toLowerCase());

  for (const m of text.matchAll(COLOR_FUNCTION)) add(m.index, m[0]);
  for (const m of text.matchAll(HEX_WITH_LETTER)) add(m.index, m[0]);

  if (kind === "css") {
    for (const m of text.matchAll(ANY_HEX)) add(m.index, m[0]);
    for (const d of text.matchAll(CSS_DECLARATION)) {
      const value = d[1] ?? "";
      const base = d.index + 1;
      for (const w of value.matchAll(WORD)) if (isNamed(w[0])) add(base + w.index, w[0]);
    }
  } else {
    for (const m of text.matchAll(QUOTED_HEX)) {
      if (m[2] !== undefined) add(m.index + 1, m[2]);
    }
    for (const m of text.matchAll(HEX_IN_CSS_VALUE)) {
      const hex = m[1];
      if (hex !== undefined) add(m.index + m[0].length - hex.length, hex);
    }
    const addNamedStrings = (tokens: StringToken[]) => {
      for (const t of tokens) if (isNamed(t.content)) add(t.start, t.content);
    };
    for (const m of text.matchAll(OBJECT_KEY)) {
      if (m[2] !== undefined && isColorProperty(m[2])) {
        addNamedStrings(stringsInValue(text, m.index + m[0].length));
      }
    }
    for (const m of text.matchAll(JSX_ATTRIBUTE)) {
      if (m[1] === undefined || !isColorProperty(m[1])) continue;
      const valueStart = m.index + m[0].length;
      addNamedStrings(
        text[valueStart] === "{"
          ? stringsInValue(text, valueStart + 1)
          : [readString(text, valueStart).token],
      );
    }
    for (const m of text.matchAll(GRADIENT)) {
      const bodyStart = m.index + m[0].length;
      const body = text
        .slice(bodyStart, matchingParen(text, bodyStart - 1))
        .replace(/\$\{[^}]*\}/g, (s) => " ".repeat(s.length));
      for (const w of body.matchAll(GRADIENT_WORD)) {
        if (isNamed(w[0])) add(bodyStart + w.index, w[0]);
      }
    }
    for (const m of text.matchAll(NAMED_IN_CSS_VALUE)) {
      if (isNamed(m[1])) add(m.index + m[0].length - m[1].length, m[1]);
    }
  }
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

export function isChecked(path: string): boolean {
  const normalized = path.split(sep).join("/");
  if (!/^(apps|packages)\//.test(normalized)) return false;
  if (normalized === ALLOWED_ROOT.split(sep).join("/") || normalized.startsWith("packages/ui/")) {
    return false;
  }
  if (normalized === MOBILE_TOKENS) return false;
  const parts = normalized.split("/");
  if (parts.some((p) => SKIP_DIRS.has(p))) return false;
  const name = parts.at(-1) ?? "";
  if (SKIP_FILES.has(name)) return false;
  return CODE_EXTENSIONS.has(extname(name));
}

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && path !== ALLOWED_ROOT) walk(root, path, out);
    } else if (isChecked(path)) {
      out.push(path);
    }
  }
}

function main(argv: ReadonlyArray<string>): number {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files =
    argv.length > 0
      ? argv.map((f) => relative(root, resolve(f))).filter(isChecked)
      : ["apps", "packages"].flatMap((dir) => {
          const out: string[] = [];
          walk(root, dir, out);
          return out;
        });

  let count = 0;
  for (const file of files) {
    const kind = extname(file) === ".css" ? "css" : "code";
    for (const f of findColorLiterals(readFileSync(join(root, file), "utf8"), kind)) {
      count += 1;
      console.error(`${file}:${f.line}:${f.column}  색 값 ${f.text} 을(를) 직접 썼어요`);
    }
  }
  if (count > 0) {
    console.error(
      `\n색 값 ${count}개를 packages/ui 밖에서 직접 썼어요. @ganger/ui/tokens.stylex 의 colors 토큰으로 바꿔요(packages/ui/DESIGN.md).`,
    );
    return 1;
  }
  console.log(`색 리터럴 검사: 파일 ${files.length}개, 위반 없음`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
