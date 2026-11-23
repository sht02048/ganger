import { spawn } from "node:child_process";
import { join } from "node:path";
import { DEV_DEVICE_NAME, mobileDevEnv } from "./mobile-env.ts";
import { repoRoot, startDevServer } from "./server.ts";

const mobileRoot = join(repoRoot, "apps/mobile");
const server = await startDevServer(process.argv.slice(2));
console.info(`[dev:mobile] demo server ${server.url}`);

const expo = spawn(join(mobileRoot, "node_modules/.bin/expo"), ["start"], {
  cwd: mobileRoot,
  env: mobileDevEnv(process.env, {
    url: server.url,
    token: server.issueDeviceToken(DEV_DEVICE_NAME),
  }),
  stdio: "inherit",
});

let stopping = false;
const stop = (exitCode: number): void => {
  if (stopping) return;
  stopping = true;
  if (expo.exitCode === null && expo.signalCode === null) expo.kill("SIGTERM");
  server.stop().then(
    () => process.exit(exitCode),
    (error: unknown) => {
      console.error("[dev:mobile] could not stop cleanly", error);
      process.exit(1);
    },
  );
};

expo.on("error", (error) => {
  console.error("[dev:mobile] could not start Expo", error);
  stop(1);
});
expo.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
