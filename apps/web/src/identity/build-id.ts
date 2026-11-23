declare const __GANGER_BUILD_ID__: string | undefined;

export const DEV_BUILD_ID = "dev";

export const BUILD_ID =
  typeof __GANGER_BUILD_ID__ === "string" ? __GANGER_BUILD_ID__ : DEV_BUILD_ID;
