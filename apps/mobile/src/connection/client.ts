import {
  V1_PATHS,
  connectResponseSchema,
  dashboardResponseSchema,
  disconnectResponseSchema,
  runActionResponseSchema,
  runDetailResponseSchema,
  runnersResponseSchema,
  thisDeviceResponseSchema,
  ticketLinkResponseSchema,
  v1ErrorSchema,
  v1MetaSchema,
  v1RunActionPath,
  v1RunPath,
  v1RunTicketLinkPath,
  workspacesResponseSchema,
} from "@ganger/api";
import type {
  ConnectResult,
  V1AnswerBody,
  V1ContinueBody,
  V1Dashboard,
  V1DenyBody,
  V1HumanCheckBody,
  V1RunDetail,
  V1RunKeyBody,
  V1RunRefusal,
  V1Runner,
  V1ThisDevice,
  V1Workspaces,
} from "@ganger/api";
import { z } from "zod";

import { isCompatibleServer } from "./version";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type V1Failure =
  | { kind: "token-rejected" }
  | { kind: "host-blocked" }
  | { kind: "unreachable" }
  | { kind: "server-error" }
  | { kind: "incompatible"; serverVersion: string | null };

export type ConnectFailure =
  | Exclude<V1Failure, { kind: "token-rejected" }>
  | { kind: "code-refused"; reason: "unknown-code" | "expired-code" | "used-code" }
  | { kind: "invalid-request" };

export type V1Result<Data> =
  | { ok: true; data: Data; serverVersion: string }
  | { ok: false; failure: V1Failure };

export type V1RunFailure =
  | V1Failure
  | { kind: "refused"; reason: V1RunRefusal }
  | { kind: "invalid-request" };

export type V1RunResult<Data> =
  | { ok: true; data: Data; serverVersion: string }
  | { ok: false; failure: V1RunFailure };

type SendFailure = V1Failure | ConnectFailure | { kind: "refused"; reason: V1RunRefusal };

type SendResult<Data> =
  | { ok: true; data: Data; serverVersion: string }
  | { ok: false; failure: SendFailure };

export const REQUEST_TIMEOUT_MS = 10_000;

export const IDENTITY_PATH = "/api/identity";

const identitySchema = z.object({
  product: z.literal("ganger"),
  webAccess: z.enum(["allowed", "host-not-allowed"]).catch("host-not-allowed"),
});
const metaEnvelopeSchema = z.object({ meta: v1MetaSchema });

async function readJson(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    return null;
  }
}

async function withTimeout<Result>(
  init: RequestInit,
  run: (init: RequestInit) => Promise<Result>,
): Promise<Result> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await run({ ...init, signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function classifyForbidden(fetcher: FetchLike, server: string): Promise<V1Failure> {
  try {
    const { response, body } = await withTimeout({}, async (init) => {
      const reply = await fetcher(`${server}${IDENTITY_PATH}`, init);
      return { response: reply, body: await readJson(reply) };
    });
    if (!response.ok) return { kind: "server-error" };
    const identity = identitySchema.safeParse(body);
    if (!identity.success) return { kind: "server-error" };
    return identity.data.webAccess === "host-not-allowed"
      ? { kind: "host-blocked" }
      : { kind: "server-error" };
  } catch {
    return { kind: "unreachable" };
  }
}

async function send<Data>(
  fetcher: FetchLike,
  server: string,
  path: string,
  schema: z.ZodType<{ meta: { serverVersion: string }; data: Data }>,
  init: RequestInit,
): Promise<SendResult<Data>> {
  let response: Response;
  let body: unknown;
  try {
    ({ response, body } = await withTimeout(init, async (timed) => {
      const reply = await fetcher(`${server}${path}`, timed);
      return { response: reply, body: reply.status === 403 ? null : await readJson(reply) };
    }));
  } catch {
    return { ok: false, failure: { kind: "unreachable" } };
  }
  if (response.status === 403) {
    return { ok: false, failure: await classifyForbidden(fetcher, server) };
  }
  if (response.status === 404 && !v1ErrorSchema.safeParse(body).success) {
    return { ok: false, failure: { kind: "incompatible", serverVersion: null } };
  }
  if (!response.ok) return { ok: false, failure: refusalOf(body) };
  const envelope = metaEnvelopeSchema.safeParse(body);
  if (!envelope.success) return { ok: false, failure: { kind: "server-error" } };
  const { meta } = envelope.data;
  if (!isCompatibleServer(meta)) {
    return { ok: false, failure: { kind: "incompatible", serverVersion: meta.serverVersion } };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, failure: { kind: "incompatible", serverVersion: null } };
  }
  return { ok: true, data: parsed.data.data, serverVersion: meta.serverVersion };
}

function refusalOf(body: unknown): SendFailure {
  const refusal = v1ErrorSchema.safeParse(body);
  if (!refusal.success) return { kind: "server-error" };
  const { reason } = refusal.data.error;
  switch (reason) {
    case "invalid-token":
      return { kind: "token-rejected" };
    case "unknown-code":
    case "expired-code":
    case "used-code":
      return { kind: "code-refused", reason };
    case "invalid-request":
      return { kind: "invalid-request" };
    case "tracker-unavailable":
      return { kind: "server-error" };
    case "not-found":
    case "already-answered":
    case "already-denied":
    case "resolved":
    case "request-reused":
    case "already-ended":
    case "not-paused":
    case "cancelling":
    case "state-changed":
    case "active-run":
    case "previous-agent":
    case "cannot-assign":
      return { kind: "refused", reason };
  }
}

function asV1Result<Data>(result: SendResult<Data>): V1Result<Data> {
  if (result.ok) return result;
  const { failure } = result;
  return failure.kind === "code-refused" ||
    failure.kind === "invalid-request" ||
    failure.kind === "refused"
    ? { ok: false, failure: { kind: "server-error" } }
    : { ok: false, failure };
}

function asRunResult<Data>(result: SendResult<Data>): V1RunResult<Data> {
  if (result.ok) return result;
  const { failure } = result;
  return failure.kind === "code-refused"
    ? { ok: false, failure: { kind: "server-error" } }
    : { ok: false, failure };
}

export async function connectToServer(
  fetcher: FetchLike,
  input: { server: string; code: string; name: string },
): Promise<{ ok: true; result: ConnectResult } | { ok: false; failure: ConnectFailure }> {
  const reply = await send(fetcher, input.server, V1_PATHS.connect, connectResponseSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: input.code, name: input.name }),
  });
  if (reply.ok) return { ok: true, result: reply.data };
  return reply.failure.kind === "token-rejected" || reply.failure.kind === "refused"
    ? { ok: false, failure: { kind: "server-error" } }
    : { ok: false, failure: reply.failure };
}

export interface V1Client {
  dashboard(workspaceId: string, timeZone: string): Promise<V1Result<V1Dashboard>>;
  runners(): Promise<V1Result<{ runners: V1Runner[] }>>;
  workspaces(): Promise<V1Result<V1Workspaces>>;
  thisDevice(): Promise<V1Result<V1ThisDevice>>;
  disconnect(): Promise<V1Result<{ disconnected: true }>>;
}

export type V1RunActionBody =
  | { action: "answer"; body: V1AnswerBody }
  | { action: "human-check"; body: V1HumanCheckBody }
  | { action: "deny"; body: V1DenyBody }
  | { action: "resume" | "cancel" | "retry"; body: V1RunKeyBody }
  | { action: "continue"; body: V1ContinueBody };

export interface V1RunsClient {
  runDetail(runId: string): Promise<V1RunResult<V1RunDetail>>;
  ticketLink(runId: string): Promise<V1RunResult<{ url: string }>>;
  runAction(runId: string, request: V1RunActionBody): Promise<V1RunResult<{ accepted: true }>>;
}

export function createV1Client(
  fetcher: FetchLike,
  { server, token }: { server: string; token: string },
): V1Client & V1RunsClient {
  const authorized = { authorization: `Bearer ${token}` };
  const read = async <Data>(
    path: string,
    schema: z.ZodType<{ meta: { serverVersion: string }; data: Data }>,
  ) => asV1Result(await send(fetcher, server, path, schema, { headers: authorized }));
  return {
    dashboard: (workspaceId, timeZone) => {
      const query = new URLSearchParams({ ws: workspaceId, timeZone });
      return read(`${V1_PATHS.dashboard}?${query.toString()}`, dashboardResponseSchema);
    },
    runners: () => read(V1_PATHS.runners, runnersResponseSchema),
    workspaces: () => read(V1_PATHS.workspaces, workspacesResponseSchema),
    thisDevice: () => read(V1_PATHS.thisDevice, thisDeviceResponseSchema),
    disconnect: async () =>
      asV1Result(
        await send(fetcher, server, V1_PATHS.thisDevice, disconnectResponseSchema, {
          method: "DELETE",
          headers: authorized,
        }),
      ),
    runDetail: async (runId) =>
      asRunResult(
        await send(fetcher, server, v1RunPath(runId), runDetailResponseSchema, {
          headers: authorized,
        }),
      ),
    ticketLink: async (runId) =>
      asRunResult(
        await send(fetcher, server, v1RunTicketLinkPath(runId), ticketLinkResponseSchema, {
          headers: authorized,
        }),
      ),
    runAction: async (runId, { action, body }) =>
      asRunResult(
        await send(fetcher, server, v1RunActionPath(runId, action), runActionResponseSchema, {
          method: "POST",
          headers: { ...authorized, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
  };
}
