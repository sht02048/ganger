import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import type { Plugin, ViteDevServer } from "vite";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));

export interface WebServer {
  server: ViteDevServer;
  baseUrl: string;
}

export async function startWebServer(options: {
  plugins: Plugin[];
  cacheDir: string;
  hmr?: boolean;
  port?: number;
}): Promise<WebServer> {
  const server = await createServer({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    cacheDir: options.cacheDir,
    logLevel: "warn",
    plugins: options.plugins,
    server: {
      host: "127.0.0.1",
      port: options.port ?? 0,
      strictPort: options.port !== undefined,
      hmr: options.hmr ?? false,
      watch: null,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    await server.close();
    throw new Error("web dev server has no TCP address");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}
