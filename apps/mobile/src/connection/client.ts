import {
  V1_PATHS,
  appDashboardResponseSchema,
  appErrorSchema,
  appNotificationEventResponseSchema,
  appRunDetailResponseSchema,
  appRunnersResponseSchema,
  connectResponseSchema,
  deviceNotificationsResponseSchema,
  disconnectResponseSchema,
  runActionResponseSchema,
  thisDeviceResponseSchema,
  ticketLinkResponseSchema,
  v1NotificationEventPath,
  v1MetaSchema,
  v1RunActionPath,
  v1RunPath,
  v1RunTicketLinkPath,
  workspacesResponseSchema,
} from "@ganger/api";
import type {
  AppDashboard,
  AppNotificationRecord,
  AppRunDetail,
  AppRunRefusal,
  AppRunner,
  ConnectResult,
  V1AnswerBody,
  V1ContinueBody,
  V1DenyBody,
  V1DeviceNotifications,
  V1HumanCheckBody,
  V1MergeBody,
  V1Meta,
  V1RunKeyBody,
  V1SaveDeviceNotifications,
  V1ThisDevice,
  V1Workspaces,
} from "@ganger/api";
import { z } from "zod";

import { neededUpdate, updateForUnreadableReply } from "./version";
import type { NeededUpdate } from "./version";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type V1Failure =
  | { kind: "token-rejected" }
  | { kind: "host-blocked" }
  | { kind: "unreachable" }
  | { kind: "server-error" }
  | { kind: "incompatible"; update: NeededUpdate; serverVersion: string | null };

export type ConnectFailure =
  | Exclude<V1Failure, { kind: "token-rejected" }>
  | { kind: "code-refused"; reason: "unknown-code" | "expired-code" | "used-code" }
  | { kind: "invalid-request" };

export type V1Result<Data> =
  | { ok: true; data: Data; serverVersion: string }
  | { ok: false; failure: V1Failure };

export type V1Refusal = { kind: "refused"; reason: AppRunRefusal; message?: string };

export type V1RunFailure = V1Failure | V1Refusal | { kind: "invalid-request" };

export type V1RunResult<Data> =
  | { ok: true; data: Data; serverVersion: string }
  | { ok: false; failure: V1RunFailure };

type SendFailure = V1Failure | ConnectFailure | V1Refusal;

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
  const text = await response.text();
  try {
    const body: unknown = JSON.parse(text);
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
  schema: z.ZodType<{ meta: V1Meta; data: Data }>,
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
  if (response.status === 404 && !appErrorSchema.safeParse(body).success) {
    return {
      ok: false,
      failure: { kind: "incompatible", update: "server", serverVersion: null },
    };
  }
  if (!response.ok) return { ok: false, failure: failureOfRefusal(body, response.status) };
  const envelope = metaEnvelopeSchema.safeParse(body);
  if (!envelope.success) return { ok: false, failure: { kind: "server-error" } };
  const { meta } = envelope.data;
  const update = neededUpdate(meta);
  if (update !== null) return { ok: false, failure: incompatibleWith(meta, update) };
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        kind: "incompatible",
        update: updateForUnreadableReply(meta),
        serverVersion: null,
      },
    };
  }
  return { ok: true, data: parsed.data.data, serverVersion: meta.serverVersion };
}

function incompatibleWith(meta: V1Meta, update: NeededUpdate): V1Failure {
  return { kind: "incompatible", update, serverVersion: meta.serverVersion };
}

function failureOfRefusal(body: unknown, status: number): SendFailure {
  const failure = refusalOf(body, status);
  if (failure.kind === "token-rejected") return failure;
  const envelope = metaEnvelopeSchema.safeParse(body);
  if (!envelope.success) return failure;
  const update = neededUpdate(envelope.data.meta);
  return update === null ? failure : incompatibleWith(envelope.data.meta, update);
}

function refusalOf(body: unknown, status: number): SendFailure {
  const refusal = appErrorSchema.safeParse(body);
  if (!refusal.success) return { kind: "server-error" };
  const { reason, message } = refusal.data.error;
  const refused = (known: AppRunRefusal): V1Refusal => ({
    kind: "refused",
    reason: known,
    ...(message === null || message === "" ? {} : { message }),
  });
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
    case "no-write-access":
    case "blocked":
    case "head-changed":
    case "method-not-allowed":
    case "not-open":
    case "no-pull-request":
    case "pr-not-found":
    case "no-code-host":
    case "unauthorized":
    case "rate-limited":
    case "network":
    case "superseded":
      return refused(reason);
    case "unknown":
      return status >= 500 ? { kind: "server-error" } : refused(reason);
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
  dashboard(workspaceId: string, timeZone: string): Promise<V1Result<AppDashboard>>;
  runners(): Promise<V1Result<{ runners: AppRunner[] }>>;
  workspaces(): Promise<V1Result<V1Workspaces>>;
  thisDevice(): Promise<V1Result<V1ThisDevice>>;
  disconnect(): Promise<V1Result<{ disconnected: true }>>;
}

export type V1RunActionBody =
  | { action: "answer"; body: V1AnswerBody }
  | { action: "human-check"; body: V1HumanCheckBody }
  | { action: "deny"; body: V1DenyBody }
  | { action: "resume" | "cancel" | "retry" | "clear-todo"; body: V1RunKeyBody }
  | { action: "continue"; body: V1ContinueBody }
  | { action: "merge"; body: V1MergeBody };

export interface V1RunsClient {
  runDetail(runId: string): Promise<V1RunResult<AppRunDetail>>;
  ticketLink(runId: string): Promise<V1RunResult<{ url: string }>>;
  runAction(runId: string, request: V1RunActionBody): Promise<V1RunResult<{ accepted: true }>>;
}

export interface V1PushClient {
  deviceNotifications(): Promise<V1Result<V1DeviceNotifications>>;
  saveDeviceNotifications(
    request: V1SaveDeviceNotifications,
  ): Promise<V1Result<V1DeviceNotifications>>;
  notificationEvent(id: number): Promise<V1RunResult<AppNotificationRecord>>;
}

export function createV1Client(
  fetcher: FetchLike,
  { server, token }: { server: string; token: string },
): V1Client & V1RunsClient & V1PushClient {
  const authorized = { authorization: `Bearer ${token}` };
  const read = async <Data>(path: string, schema: z.ZodType<{ meta: V1Meta; data: Data }>) =>
    asV1Result(await send(fetcher, server, path, schema, { headers: authorized }));
  return {
    dashboard: (workspaceId, timeZone) => {
      const query = new URLSearchParams({ ws: workspaceId, timeZone });
      return read(`${V1_PATHS.dashboard}?${query.toString()}`, appDashboardResponseSchema);
    },
    runners: () => read(V1_PATHS.runners, appRunnersResponseSchema),
    workspaces: () => read(V1_PATHS.workspaces, workspacesResponseSchema),
    thisDevice: () => read(V1_PATHS.thisDevice, thisDeviceResponseSchema),
    disconnect: async () =>
      asV1Result(
        await send(fetcher, server, V1_PATHS.thisDevice, disconnectResponseSchema, {
          method: "DELETE",
          headers: authorized,
        }),
      ),
    deviceNotifications: () =>
      read(V1_PATHS.thisDeviceNotifications, deviceNotificationsResponseSchema),
    saveDeviceNotifications: async (request) =>
      asV1Result(
        await send(
          fetcher,
          server,
          V1_PATHS.thisDeviceNotifications,
          deviceNotificationsResponseSchema,
          {
            method: "PUT",
            headers: { ...authorized, "content-type": "application/json" },
            body: JSON.stringify(request),
          },
        ),
      ),
    notificationEvent: async (id) =>
      asRunResult(
        await send(
          fetcher,
          server,
          v1NotificationEventPath(id),
          appNotificationEventResponseSchema,
          { headers: authorized },
        ),
      ),
    runDetail: async (runId) =>
      asRunResult(
        await send(fetcher, server, v1RunPath(runId), appRunDetailResponseSchema, {
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
