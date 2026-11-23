import { exitOnFatal, log, processStartFields, setupProcessLog } from "@ganger/log";
import { bootWorker } from "./boot.js";
import { listenForDeviceActivity, listenForWake } from "./wake-listener.js";

const processLog = setupProcessLog({ proc: "worker", env: process.env });
exitOnFatal(process, log, (code) => process.exit(code));

const { migrated, worker } = bootWorker({ env: process.env });
log().info("process.started", { ...processStartFields(), migrated: migrated.length });
listenForWake(process, () => worker.wake());
listenForDeviceActivity(process, (deviceId, lastUsedAt) =>
  worker.recordDeviceUse(deviceId, lastUsedAt),
);

let stopping = false;
const stop = (signal: NodeJS.Signals): void => {
  if (stopping) return;
  stopping = true;
  log().info("process.stopping", { signal });
  worker.stop().then(
    () => {
      log().info("process.stopped");
      processLog.close();
      process.exit(0);
    },
    (error: unknown) => {
      log().error("process.stop_failed", { error });
      processLog.close();
      process.exit(1);
    },
  );
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
