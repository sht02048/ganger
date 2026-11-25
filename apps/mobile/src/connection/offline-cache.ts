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

interface UnparsedEntry {
  raw: unknown;
  fetchedAt: number;
}

type Slot<Data> = ({ parsed: true } & CachedEntry<Data>) | ({ parsed: false } & UnparsedEntry);

interface RunSlot {
  id: string;
  slot: Slot<AppRunDetail>;
}

interface WorkspaceCache {
  dashboard: Slot<AppDashboard> | null;
  runs: RunSlot[];
}

const rawEntrySchema = z.object({ data: z.unknown(), fetchedAt: z.number() });
const runKeySchema = z.object({ id: z.string() });

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

function isFresh(fetchedAt: number, now: number): boolean {
  const age = now - fetchedAt;
  return age >= 0 && age <= CACHE_MAX_AGE_MS;
}

function unparsed(raw: z.infer<typeof rawEntrySchema> | null, now: number): UnparsedEntry | null {
  if (raw === null || !isFresh(raw.fetchedAt, now)) return null;
  return { raw: raw.data, fetchedAt: raw.fetchedAt };
}

function parsedSlot<Data>(data: Data, fetchedAt: number): Slot<Data> {
  return { parsed: true, data, fetchedAt };
}

function parseSlot<Data>(slot: Slot<Data>, schema: z.ZodType<Data>): Slot<Data> | null {
  if (slot.parsed) return slot;
  const parsed = schema.safeParse(slot.raw);
  return parsed.success ? parsedSlot(parsed.data, slot.fetchedAt) : null;
}

function storedSlot<Data>(slot: Slot<Data>): { data: unknown; fetchedAt: number } {
  return { data: slot.parsed ? slot.data : slot.raw, fetchedAt: slot.fetchedAt };
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
  #loading: Promise<void> | null = null;
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

  async load(workspaceId: string): Promise<CachedContent> {
    await this.#read();
    return this.contentFor(workspaceId);
  }

  contentFor(workspaceId: string): CachedContent {
    const dashboards = new Map<string, CachedEntry<AppDashboard>>();
    const dashboard = this.#closed ? null : this.#dashboardOf(workspaceId);
    if (dashboard !== null) dashboards.set(workspaceId, dashboard);
    return { dashboards, workspaces: this.#workspaceList?.data ?? [] };
  }

  #read(): Promise<void> {
    this.#loading ??= this.#readFile();
    return this.#loading;
  }

  #dashboardOf(workspaceId: string): CachedEntry<AppDashboard> | null {
    const board = this.#boards.get(workspaceId);
    if (board === undefined || board.dashboard === null) return null;
    if (!isFresh(board.dashboard.fetchedAt, this.#now())) return null;
    board.dashboard = parseSlot(board.dashboard, appDashboardSchema);
    return board.dashboard?.parsed === true
      ? { data: board.dashboard.data, fetchedAt: board.dashboard.fetchedAt }
      : null;
  }

  saveDashboard(
    workspaceId: string,
    data: AppDashboard,
    fetchedAt: number,
    workspaces: V1Workspaces["workspaces"],
  ): void {
    if (this.#closed) return;
    this.#boardOf(workspaceId).dashboard = parsedSlot(data, fetchedAt);
    this.#workspaceList = { data: workspaces, fetchedAt };
    this.#schedule();
  }

  confirmDashboard(workspaceId: string, fetchedAt: number): void {
    if (this.#closed) return;
    const board = this.#boards.get(workspaceId);
    const dashboard = board?.dashboard ?? null;
    if (board === undefined || dashboard === null || dashboard.fetchedAt >= fetchedAt) return;
    board.dashboard = { ...dashboard, fetchedAt };
    this.#touched = true;
  }

  saveRun(detail: AppRunDetail, fetchedAt: number): void {
    if (this.#closed) return;
    this.#dropRun(detail.id);
    const board = this.#boardOf(detail.workspace.id);
    board.runs = [{ id: detail.id, slot: parsedSlot(detail, fetchedAt) }, ...board.runs].slice(
      0,
      CACHED_RUNS_PER_WORKSPACE,
    );
    this.#schedule();
  }

  forgetRun(runId: string): void {
    if (this.#closed) return;
    if (this.#dropRun(runId)) this.#schedule();
  }

  cachedRun(runId: string): CachedEntry<AppRunDetail> | null {
    const now = this.#now();
    for (const board of this.#boards.values()) {
      const found = board.runs.find((entry) => entry.id === runId);
      if (found === undefined) continue;
      if (now - found.slot.fetchedAt > CACHE_MAX_AGE_MS) return null;
      const slot = parseSlot(found.slot, appRunDetailSchema);
      if (slot === null || !slot.parsed || slot.data.id !== runId) {
        board.runs = board.runs.filter((entry) => entry !== found);
        return null;
      }
      found.slot = slot;
      return { data: slot.data, fetchedAt: slot.fetchedAt };
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
      const kept = board.runs.filter((entry) => entry.id !== runId);
      dropped ||= kept.length !== board.runs.length;
      board.runs = kept;
    }
    return dropped;
  }

  async #readFile(): Promise<void> {
    let text: string | null = null;
    try {
      text = await this.#files.read(this.#server);
    } catch {
      this.#readFailed = true;
    }
    if (this.#closed || text === null) return;
    const file = parseCacheFile(text, this.#server);
    if (file !== null) this.#merge(file);
    if (!this.#hasContent()) await this.#files.remove(this.#server).catch(() => undefined);
  }

  #hasContent(): boolean {
    return [...this.#boards.values()].some(
      (board) => board.dashboard !== null || board.runs.length > 0,
    );
  }

  #merge(file: z.infer<typeof cacheFileSchema>): void {
    const now = this.#now();
    const listEntry = unparsed(file.workspaceList, now);
    const list = listEntry === null ? null : workspacesSchema.safeParse(listEntry.raw);
    if (listEntry !== null && list?.success === true)
      this.#workspaceList ??= { data: list.data.workspaces, fetchedAt: listEntry.fetchedAt };
    for (const stored of file.workspaces) {
      const board = this.#boardOf(stored.workspaceId);
      const dashboard = unparsed(stored.dashboard, now);
      if (dashboard !== null) board.dashboard ??= { parsed: false, ...dashboard };
      const known = new Set(board.runs.map((entry) => entry.id));
      const runs = stored.runs.flatMap((raw): RunSlot[] => {
        const entry = unparsed(raw, now);
        const key = entry === null ? null : runKeySchema.safeParse(entry.raw);
        if (entry === null || key?.success !== true || known.has(key.data.id)) return [];
        known.add(key.data.id);
        return [{ id: key.data.id, slot: { parsed: false, ...entry } }];
      });
      board.runs = [...board.runs, ...runs].slice(0, CACHED_RUNS_PER_WORKSPACE);
    }
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
      await this.#read();
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
        dashboard: board.dashboard === null ? null : storedSlot(board.dashboard),
        runs: board.runs.map((entry) => storedSlot(entry.slot)),
      })),
    });
  }
}
