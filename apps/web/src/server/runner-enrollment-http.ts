import { getInstallSettings } from "@ganger/db";
import { z } from "zod";
import {
  acceptEnrollmentOffer,
  enrollmentReplyText,
  receiveEnrollment,
  setupScriptFor,
} from "@ganger/app/runner-setup/enrollment";
import { SETUP_SCRIPT_TOKEN_PARAM } from "@ganger/app/runner-setup/setup-script";
import { getAdapterRegistry, getGangerSsh, getRunnerEnrollments, getSecretBox } from "./adapters";
import { getDatabase } from "./database";

const BODY_LIMIT_BYTES = 16 * 1024;
const NO_STORE = { "cache-control": "no-store" };
const TEXT = { "content-type": "text/plain; charset=utf-8", ...NO_STORE };

export async function readLimited(
  request: Request,
  limitBytes: number = BODY_LIMIT_BYTES,
): Promise<string | null> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limitBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readFields(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > BODY_LIMIT_BYTES) return null;
  const text = await readLimited(request);
  if (text === null) return null;
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(text);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? Object.fromEntries(Object.entries(parsed))
        : null;
    } catch {
      return null;
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

export async function receiveRunnerEnrollment(request: Request): Promise<Response> {
  const fields = await readFields(request);
  const reply = receiveEnrollment(
    {
      db: getDatabase(),
      secretBox: getSecretBox(),
      registry: getAdapterRegistry(),
      enrollments: getRunnerEnrollments(),
      ssh: getGangerSsh(),
    },
    fields ?? {},
    new Date(),
  );
  return new Response(enrollmentReplyText(reply), { status: reply.status, headers: TEXT });
}

export async function serveSetupScript(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get(SETUP_SCRIPT_TOKEN_PARAM);
  const script = await setupScriptFor({
    enrollments: getRunnerEnrollments(),
    ssh: getGangerSsh(),
    webAddress: getInstallSettings(getDatabase()).webAddress,
    token,
  });
  if (script === null) {
    return new Response(
      "echo 'Ganger: this command expired or was already used. Get a new command on the Ganger screen.' >&2; exit 1\n",
      { status: 200, headers: TEXT },
    );
  }
  return new Response(script, { status: 200, headers: TEXT });
}

export function serveEnrollmentOffer(): Response {
  return Response.json({ offer: getRunnerEnrollments().openOffer() }, { headers: NO_STORE });
}

const offerId = z.object({ id: z.uuid() });

export async function acceptRunnerEnrollmentOffer(request: Request): Promise<Response> {
  const parsed = offerId.safeParse(await readFields(request));
  if (!parsed.success) {
    return Response.json({ ok: false, reason: "unknown" }, { status: 410, headers: NO_STORE });
  }
  const reply = await acceptEnrollmentOffer({
    enrollments: getRunnerEnrollments(),
    ssh: getGangerSsh(),
    webAddress: getInstallSettings(getDatabase()).webAddress,
    id: parsed.data.id,
  });
  return Response.json(reply.body, { status: reply.status, headers: NO_STORE });
}
