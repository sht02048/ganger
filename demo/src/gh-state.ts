export const DEMO_GH_STATES = ["connected", "logged-out", "missing"] as const;
export type DemoGhState = (typeof DEMO_GH_STATES)[number];
export const DEMO_GH_ENV = "GANGER_DEMO_GH";

interface DemoGhSwitch {
  state: DemoGhState;
  listeners: Set<() => void>;
}

declare global {
  var __gangerDemoGhSwitch: DemoGhSwitch | undefined;
}

export function parseDemoGhState(raw: string | undefined): DemoGhState {
  return DEMO_GH_STATES.find((state) => state === raw) ?? "connected";
}

export function demoGhSwitch(): DemoGhSwitch {
  globalThis.__gangerDemoGhSwitch ??= {
    state: parseDemoGhState(process.env[DEMO_GH_ENV]),
    listeners: new Set(),
  };
  return globalThis.__gangerDemoGhSwitch;
}

export function nextDemoGhState(): DemoGhState {
  const gh = demoGhSwitch();
  const index = DEMO_GH_STATES.indexOf(gh.state);
  gh.state = DEMO_GH_STATES[(index + 1) % DEMO_GH_STATES.length] ?? "connected";
  for (const listener of gh.listeners) listener();
  return gh.state;
}
