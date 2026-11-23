export interface DevConnectionEnv {
  server: string | undefined;
  token: string | undefined;
}

function isAllowedDevServer(address: string): boolean {
  const url = URL.parse(address);
  if (url === null || url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && url.hostname === "127.0.0.1";
}

export function devConnectionFrom(
  isDevelopmentBuild: boolean,
  env: DevConnectionEnv,
): { server: string; token: string } | null {
  if (!isDevelopmentBuild) return null;
  const { server, token } = env;
  if (server === undefined || server === "" || token === undefined || token === "") return null;
  if (!isAllowedDevServer(server)) return null;
  return { server: server.replace(/\/+$/u, ""), token };
}

export function bundledDevConnection(): { server: string; token: string } | null {
  if (!__DEV__) return null;
  return devConnectionFrom(true, {
    server: process.env.EXPO_PUBLIC_GANGER_DEV_SERVER,
    token: process.env.EXPO_PUBLIC_GANGER_DEV_TOKEN,
  });
}
