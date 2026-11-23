import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STARTUP_TIMEOUT_MS = 30_000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url: string, exited: () => boolean): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited()) throw new Error("web server exited before it started listening");
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`web server did not start within ${STARTUP_TIMEOUT_MS} ms`);
}

function rawRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => (body += chunk.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.once("error", reject);
    req.end();
  });
}

async function checkHostGuard(base: string): Promise<string | undefined> {
  const foreignHost = await rawRequest(`${base}/runs`, "GET", { host: "evil.example.com" });
  if (foreignHost.status !== 403)
    return `GET /runs with a foreign Host returned ${foreignHost.status}`;
  console.log(`GET /runs (Host: evil.example.com) -> ${foreignHost.status}`);

  const foreignOrigin = await rawRequest(`${base}/_serverFn/smoke`, "POST", {
    origin: "https://evil.example.com",
  });
  if (foreignOrigin.status !== 403) {
    return `POST with a foreign Origin returned ${foreignOrigin.status}`;
  }
  console.log(`POST (Origin: https://evil.example.com) -> ${foreignOrigin.status}`);

  const identity = await rawRequest(`${base}/api/identity`, "GET", {
    host: "server.example.ts.net",
  });
  const parsed: unknown = JSON.parse(identity.body);
  const expected = ["instanceId", "product", "version", "webAccess"];
  if (
    identity.status !== 200 ||
    typeof parsed !== "object" ||
    parsed === null ||
    JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(expected) ||
    !("product" in parsed && parsed.product === "ganger") ||
    !("webAccess" in parsed && parsed.webAccess === "host-not-allowed")
  ) {
    return `GET /api/identity returned ${identity.status} ${identity.body}`;
  }
  console.log(`GET /api/identity -> ${identity.status} ${identity.body}`);
  return undefined;
}

async function checkClientBuildId(base: string): Promise<string | undefined> {
  const response = await fetch(`${base}/api/build`);
  const parsed: unknown = await response.json();
  const buildId =
    typeof parsed === "object" && parsed !== null && "buildId" in parsed ? parsed.buildId : null;
  if (typeof buildId !== "string" || buildId === "dev") {
    return `GET /api/build returned ${JSON.stringify(parsed)}`;
  }
  const assets = join(import.meta.dirname, "..", "apps", "web", "dist", "client", "assets");
  const inClient = readdirSync(assets)
    .filter((name) => name.endsWith(".js"))
    .some((name) => readFileSync(join(assets, name), "utf8").includes(buildId));
  if (!inClient) return `client assets do not carry the server build id ${buildId}`;
  console.log(`GET /api/build -> ${buildId}, same id in client assets`);
  return undefined;
}

const dir = mkdtempSync(join(tmpdir(), "ganger-smoke-"));
const port = await freePort();
let output = "";
let hasExited = false;
const server = spawn("pnpm", ["--filter", "@ganger/web", "start"], {
  detached: true,
  env: {
    ...process.env,
    WEB_HOST: "127.0.0.1",
    WEB_PORT: String(port),
    DATABASE_PATH: join(dir, "ganger.db"),
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
server.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
server.once("exit", () => (hasExited = true));

let failure: string | undefined;
try {
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base, () => hasExited);
  const response = await fetch(`${base}/runs`);
  const body = await response.text();
  if (response.status !== 200) {
    const errors = body.match(/\b(?:[A-Z]\w*Error|ENOENT)\b[^"<]{0,300}/g) ?? [body.slice(0, 2000)];
    failure = `GET /runs returned ${response.status}\n${[...new Set(errors)].join("\n")}`;
  } else {
    console.log(`GET /runs -> ${response.status}`);
    failure = (await checkHostGuard(base)) ?? (await checkClientBuildId(base));
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  if (!hasExited && server.pid !== undefined) process.kill(-server.pid, "SIGKILL");
  rmSync(dir, { recursive: true, force: true });
}

if (failure !== undefined) {
  console.error(`web production smoke test failed: ${failure}\n--- server output ---\n${output}`);
  process.exitCode = 1;
}
