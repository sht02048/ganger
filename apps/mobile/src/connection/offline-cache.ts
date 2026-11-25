import { appDashboardSchema, appRunDetailSchema, workspacesSchema } from "@ganger/api";
import type { AppDashboard, AppRunDetail, V1Workspaces } from "@ganger/api";
import { z } from "zod";

export const CACHE_FORMAT_VERSION = 1;
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const CACHED_RUNS_PER_WORKSPACE = 20;
export const CACHE_WRITE_INTERVAL_MS = 30_000;

export interface CacheFiles {
  read(server: string): Promise<string | null>;
  write(server: string, text: string): Promise<void>;
  remove(server: string): Promise<void>;
  removeAll(): Promise<void>;
}

export async function readCacheText(file: {
  text(): Promise<string>;
  bytes(): Promise<Uint8Array>;
}): Promise<string> {
  try {
    return await file.text();
  } catch {
    await file.bytes();
    return "";
  }
}

export interface CachedEntry<Data> {
  data: Data;
  fetchedAt: number;
}

export interface CachedContent {
  dashboards: ReadonlyMap<string, CachedEntry<AppDashboard>>;
  workspaces: V1Workspaces["workspaces"];
}

interface WorkspaceCache {
  dashboard: CachedEntry<AppDashboard> | null;
  runs: Array<CachedEntry<AppRunDetail>>;
}

const rawEntrySchema = z.object({ data: z.unknown(), fetchedAt: z.number() });

const cacheFileSchema = z.object({
  version: z.literal(CACHE_FORMAT_VERSION),
  server: z.string(),
  workspaceList: rawEntrySchema.nullable(),
  workspaces: z.array(
    z.object({
      workspaceId: z.string(),
      dashboard: rawEntrySchema.nullable(),
      runs: z.array(rawEntrySchema),
    }),
  ),
});

function readEntry<Data>(
  raw: z.infer<typeof rawEntrySchema> | null,
  schema: z.ZodType<Data>,
  now: number,
): CachedEntry<Data> | null {
  if (raw === null) return null;
  const age = now - raw.fetchedAt;
  if (age < 0 || age > CACHE_MAX_AGE_MS) return null;
  const parsed = schema.safeParse(raw.data);
  return parsed.success ? { data: parsed.data, fetchedAt: raw.fetchedAt } : null;
}

function parseCacheFile(text: string, server: string) {
  try {
    const parsed = cacheFileSchema.safeParse(JSON.parse(text));
    return parsed.success && parsed.data.server === server ? parsed.data : null;
  } catch {
    return null;
  }
}

export class OfflineCache {
  readonly #files: CacheFiles;
  readonly #server: string;
  readonly #now: () => number;
  readonly #boards = new Map<string, WorkspaceCache>();
  #workspaceList: CachedEntry<V1Workspaces["workspaces"]> | null = null;
  #loading: Promise<CachedContent> | null = null;
  #closed = false;
  #readFailed = false;
  #dirty = false;
  #touched = false;
  #flushing: Promise<void> | null = null;
  #wait: ReturnType<typeof setTimeout> | null = null;
  #lastWriteAt: number | null = null;

  constructor(files: CacheFiles, server: string, now: () => number) {
    this.#files = files;
    this.#server = server;
    this.#now = now;
  }

  load(): Promise<CachedContent> {
    this.#loading ??= this.#readFile();
    return this.#loading;
  }

  saveDashboard(
    workspaceId: string,
    data: AppDashboard,
    fetchedAt: number,
    workspaces: V1Workspaces["workspaces"],
  ): void {
    if (this.#closed) return;
    this.#boardOf(workspaceId).dashboard = { data, fetchedAt };
    this.#workspaceList = { data: workspaces, fetchedAt };
    this.#schedule();
  }

  confirmDashboard(workspaceId: string, fetchedAt: number): void {
    if (this.#closed) return;
    const board = this.#boards.get(workspaceId);
    const dashboard = board?.dashboard ?? null;
    if (board === undefined || dashboard === null || dashboard.fetchedAt >= fetchedAt) return;
    board.dashboard = { ...dashboard, fetchedAt };
    if (this.#workspaceList !== null) this.#workspaceList = { ...this.#workspaceList, fetchedAt };
    this.#touched = true;
  }

  saveRun(detail: AppRunDetail, fetchedAt: number): void {
    if (this.#closed) return;
    this.#dropRun(detail.id);
    const board = this.#boardOf(detail.workspace.id);
    board.runs = [{ data: detail, fetchedAt }, ...board.runs].slice(0, CACHED_RUNS_PER_WORKSPACE);
    this.#schedule();
  }

  forgetRun(runId: string): void {
    if (this.#closed) return;
    if (this.#dropRun(runId)) this.#schedule();
  }

  cachedRun(runId: string): CachedEntry<AppRunDetail> | null {
    const now = this.#now();
    for (const board of this.#boards.values()) {
      const found = board.runs.find((entry) => entry.data.id === runId);
      if (found !== undefined) return now - found.fetchedAt > CACHE_MAX_AGE_MS ? null : found;
    }
    return null;
  }

  async clear(): Promise<void> {
    this.#closed = true;
    this.#dirty = false;
    this.#touched = false;
    this.#clearWait();
    this.#boards.clear();
    this.#workspaceList = null;
    await this.#flushing;
    await this.#files.remove(this.#server);
  }

  async flush(): Promise<void> {
    await this.#flushing;
    this.#clearWait();
    if (!this.#dirty && !this.#touched) return;
    this.#flushing ??= this.#flush();
    await this.#flushing;
  }

  #boardOf(workspaceId: string): WorkspaceCache {
    const existing = this.#boards.get(workspaceId);
    if (existing !== undefined) return existing;
    const created: WorkspaceCache = { dashboard: null, runs: [] };
    this.#boards.set(workspaceId, created);
    return created;
  }

  #dropRun(runId: string): boolean {
    let dropped = false;
    for (const board of this.#boards.values()) {
      const kept = board.runs.filter((entry) => entry.data.id !== runId);
      dropped ||= kept.length !== board.runs.length;
      board.runs = kept;
    }
    return dropped;
  }

  async #readFile(): Promise<CachedContent> {
    let text: string | null = null;
    try {
      text = await this.#files.read(this.#server);
    } catch {
      this.#readFailed = true;
    }
    if (this.#closed) return { dashboards: new Map(), workspaces: [] };
    if (text === null) return this.#content();
    const file = parseCacheFile(text, this.#server);
    if (file !== null) this.#merge(file);
    if (!this.#hasContent()) await this.#files.remove(this.#server).catch(() => undefined);
    return this.#content();
  }

  #hasContent(): boolean {
    return [...this.#boards.values()].some(
      (board) => board.dashboard !== null || board.runs.length > 0,
    );
  }

  #merge(file: z.infer<typeof cacheFileSchema>): void {
    const now = this.#now();
    const list = readEntry(file.workspaceList, workspacesSchema, now);
    if (list !== null)
      this.#workspaceList ??= { data: list.data.workspaces, fetchedAt: list.fetchedAt };
    for (const stored of file.workspaces) {
      const board = this.#boardOf(stored.workspaceId);
      board.dashboard ??= readEntry(stored.dashboard, appDashboardSchema, now);
      const known = new Set(board.runs.map((entry) => entry.data.id));
      const runs = stored.runs.flatMap((raw) => {
        const entry = readEntry(raw, appRunDetailSchema, now);
        return entry === null || known.has(entry.data.id) ? [] : [entry];
      });
      board.runs = [...board.runs, ...runs].slice(0, CACHED_RUNS_PER_WORKSPACE);
    }
  }

  #content(): CachedContent {
    const dashboards = new Map<string, CachedEntry<AppDashboard>>();
    for (const [workspaceId, board] of this.#boards) {
      if (board.dashboard !== null) dashboards.set(workspaceId, board.dashboard);
    }
    return { dashboards, workspaces: this.#workspaceList?.data ?? [] };
  }

  #schedule(): void {
    this.#dirty = true;
    if (this.#flushing !== null || this.#wait !== null) return;
    const waitMs =
      this.#lastWriteAt === null ? 0 : this.#lastWriteAt + CACHE_WRITE_INTERVAL_MS - this.#now();
    if (waitMs <= 0) {
      this.#flushing = this.#flush();
      return;
    }
    this.#wait = setTimeout(() => {
      this.#wait = null;
      this.#flushing ??= this.#flush();
    }, waitMs);
  }

  #clearWait(): void {
    if (this.#wait !== null) clearTimeout(this.#wait);
    this.#wait = null;
  }

  async #flush(): Promise<void> {
    try {
      await this.load();
      if ((this.#dirty || this.#touched) && !this.#closed && !this.#readFailed) {
        this.#dirty = false;
        this.#touched = false;
        this.#lastWriteAt = this.#now();
        await this.#files.write(this.#server, this.#serialize()).catch(() => undefined);
      }
    } finally {
      this.#flushing = null;
      if (this.#dirty && !this.#closed && !this.#readFailed) this.#schedule();
    }
  }

  #serialize(): string {
    return JSON.stringify({
      version: CACHE_FORMAT_VERSION,
      server: this.#server,
      workspaceList:
        this.#workspaceList === null
          ? null
          : {
              data: { workspaces: this.#workspaceList.data },
              fetchedAt: this.#workspaceList.fetchedAt,
            },
      workspaces: [...this.#boards].map(([workspaceId, board]) => ({
        workspaceId,
        dashboard: board.dashboard,
        runs: board.runs,
      })),
    });
  }
}
