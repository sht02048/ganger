import { DESKTOP_ACTIVITY_REPORT_INTERVAL_MS, V1_DEVICE_ACTIVITY_PATH } from "@ganger/api";
import type { V1DeviceActivityRequest } from "@ganger/api";
import type { FeedConnection } from "./device-link.js";

const REPORT_TIMEOUT_MS = 5_000;

export interface ActivityReporterOptions {
  origin: string;
  connection: () => Promise<FeedConnection>;
  idleSeconds: () => number;
  fetch?: typeof fetch;
  intervalMs?: number;
}

export class ActivityReporter {
  private readonly options: ActivityReporterOptions;
  private timer: NodeJS.Timeout | undefined;
  private reporting = false;

  constructor(options: ActivityReporterOptions) {
    this.options = options;
  }

  start(): void {
    void this.report();
    this.timer = setInterval(
      () => void this.report(),
      this.options.intervalMs ?? DESKTOP_ACTIVITY_REPORT_INTERVAL_MS,
    );
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  async report(): Promise<void> {
    if (this.reporting) return;
    this.reporting = true;
    try {
      const connection = await this.options.connection();
      if (connection.kind !== "token") return;
      const body: V1DeviceActivityRequest = { idleSeconds: this.options.idleSeconds() };
      await (this.options.fetch ?? fetch)(new URL(V1_DEVICE_ACTIVITY_PATH, this.options.origin), {
        method: "PUT",
        headers: {
          authorization: `Bearer ${connection.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      return;
    } finally {
      this.reporting = false;
    }
  }
}
