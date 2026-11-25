import { parseBootConfig } from "@ganger/db";
import {
  loadMobileAccess,
  turnOffMobileAccess,
  turnOnMobileAccess,
} from "@ganger/app/mobile-access";
import type { MobileAccessContext } from "@ganger/app/mobile-access";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { getDatabase } from "./database";
import { autoAllowInput } from "./request-access";
import { getMobileAccessDeps } from "./webhook-reach";

function context(): MobileAccessContext {
  const boot = parseBootConfig(process.env);
  return {
    db: getDatabase(),
    bindHost: boot.host,
    webPort: boot.port,
    deps: getMobileAccessDeps(),
  };
}

export const getMobileAccess = createServerFn({ method: "GET" }).handler(() =>
  loadMobileAccess(context()),
);

export const turnOnMobile = createServerFn({ method: "POST" }).handler(() =>
  turnOnMobileAccess(context(), new Date()),
);

export const turnOffMobile = createServerFn({ method: "POST" }).handler(() =>
  turnOffMobileAccess(context(), new Date(), {
    host: getRequestHeader("host") ?? null,
    bindHost: parseBootConfig(process.env).host,
    ...autoAllowInput(),
  }),
);
