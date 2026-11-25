import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const DESKTOP = resolve(import.meta.dirname, "..");
const REPO = resolve(DESKTOP, "..", "..");
const BRAND = join(REPO, "packages", "ui", "brand");
const WEB_PUBLIC = join(REPO, "apps", "web", "public");
const ICONS = join(DESKTOP, "icons");
const ASSETS = join(DESKTOP, "assets");
const MOBILE_ASSETS = join(REPO, "apps", "mobile", "assets");

const source = (name: string): string => readFileSync(join(BRAND, name), "utf8");

function fillOf(svg: string, element: RegExp): string {
  const tag = element.exec(svg)?.[0];
  const fill = tag === undefined ? undefined : /fill="([^"]+)"/.exec(tag)?.[1];
  if (fill === undefined) throw new Error(`fill missing for ${element.source}`);
  return fill;
}

function inner(svg: string): string {
  const open = svg.indexOf(">") + 1;
  return svg.slice(open, svg.lastIndexOf("</svg>"));
}

function viewBoxOf(svg: string): string {
  const match = /viewBox="([^"]+)"/.exec(svg);
  if (match?.[1] === undefined) throw new Error("viewBox missing");
  return match[1];
}

function recolor(svg: string, colors: { ink: string; mouthpiece?: string }): string {
  return inner(svg)
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/class="ink"/g, `fill="${colors.ink}"`)
    .replace(/(<rect[^>]*?) fill="[^"]+"/g, `$1 fill="${colors.mouthpiece ?? colors.ink}"`);
}

const favicon = source("mark-favicon.svg");
const appIcon = source("app-icon.svg");
const ICON_BACKGROUND = fillOf(appIcon, /<rect width="1024"[^>]*>/);
const BODY = fillOf(appIcon, /<path[^>]*>/);
const YELLOW = fillOf(appIcon, /<rect x="66"[^>]*>/);
const TEMPLATE_BLACK = "currentColor";
const markBody = /<path[^>]*fill-rule="evenodd"[^>]*\/>/.exec(appIcon)?.[0];
const mouthpiece = /<rect x="66"[^>]*\/>/.exec(appIcon)?.[0];
if (markBody === undefined || mouthpiece === undefined)
  throw new Error("app-icon.svg layers missing");
const iconCanvas = (background: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${background}<g transform="translate(194.56 174.08) scale(6.5536)">${body}</g></svg>\n`;
const layer = (body: string) => iconCanvas("", body);
const singleColor = (shape: string, fill: string) =>
  shape.replace(/fill="[^"]+"/, `fill="${fill}"`);

const faviconTile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${ICON_BACKGROUND}"/><svg x="6" y="6" width="88" height="88" viewBox="${viewBoxOf(favicon)}">${recolor(favicon, { ink: BODY, mouthpiece: YELLOW })}</svg></svg>`;

const squircle = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><clipPath id="s"><rect x="100" y="100" width="824" height="824" rx="185.4"/></clipPath></defs><g clip-path="url(#s)"><svg x="100" y="100" width="824" height="824" viewBox="0 0 1024 1024">${inner(appIcon)}</svg></g></svg>`;

const trayTemplate = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxOf(favicon)}">${recolor(favicon, { ink: TEMPLATE_BLACK })}</svg>`;

const mobileDark = layer(markBody + mouthpiece);
const mobileTinted = iconCanvas(
  `<rect width="1024" height="1024" fill="${ICON_BACKGROUND}"/>`,
  singleColor(markBody, BODY) + singleColor(mouthpiece, BODY),
);

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();

async function png(svg: string, size: number): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`,
  );
  await page.locator("img").evaluate((img: HTMLImageElement) => img.decode());
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

function ico(images: ReadonlyArray<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

mkdirSync(WEB_PUBLIC, { recursive: true });
writeFileSync(join(WEB_PUBLIC, "icon.svg"), favicon);
writeFileSync(
  join(WEB_PUBLIC, "favicon.ico"),
  ico([
    { size: 16, data: await png(faviconTile, 16) },
    { size: 32, data: await png(faviconTile, 32) },
  ]),
);
writeFileSync(join(WEB_PUBLIC, "apple-touch-icon.png"), await png(appIcon, 180));

writeFileSync(join(ASSETS, "trayTemplate.png"), await png(trayTemplate, 16));
writeFileSync(join(ASSETS, "trayTemplate@2x.png"), await png(trayTemplate, 32));

mkdirSync(MOBILE_ASSETS, { recursive: true });
writeFileSync(join(MOBILE_ASSETS, "icon.png"), await png(appIcon, 1024));
writeFileSync(join(MOBILE_ASSETS, "icon-dark.png"), await png(mobileDark, 1024));
writeFileSync(join(MOBILE_ASSETS, "icon-tinted.png"), await png(mobileTinted, 1024));

mkdirSync(ICONS, { recursive: true });
const iconset = join(mkdtempSync(join(tmpdir(), "ganger-icon-")), "icon.iconset");
mkdirSync(iconset);
for (const base of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${base}x${base}.png`), await png(squircle, base));
  writeFileSync(join(iconset, `icon_${base}x${base}@2x.png`), await png(squircle, base * 2));
}
await browser.close();
const iconutil = spawnSync("iconutil", ["-c", "icns", iconset, "-o", join(ICONS, "icon.icns")], {
  stdio: "inherit",
});
rmSync(resolve(iconset, ".."), { recursive: true, force: true });
if (iconutil.status !== 0) throw new Error(`iconutil exited with ${iconutil.status ?? "unknown"}`);

const composer = join(ICONS, "AppIcon.icon");
rmSync(composer, { recursive: true, force: true });
mkdirSync(join(composer, "Assets"), { recursive: true });
writeFileSync(join(composer, "Assets", "body.svg"), layer(markBody));
writeFileSync(join(composer, "Assets", "mouthpiece.svg"), layer(mouthpiece));
writeFileSync(
  join(composer, "icon.json"),
  `${JSON.stringify(
    {
      fill: { solid: "srgb:0.05490,0.05882,0.07059,1.00000" },
      groups: [
        {
          layers: [
            { "image-name": "mouthpiece.svg", name: "mouthpiece" },
            { "image-name": "body.svg", name: "body" },
          ],
        },
      ],
      "supported-platforms": { squares: ["macOS"] },
    },
    null,
    2,
  )}\n`,
);

console.log(`web: ${WEB_PUBLIC}`);
console.log(`desktop: ${ICONS}, ${ASSETS}`);
console.log(`mobile: ${MOBILE_ASSETS}`);
