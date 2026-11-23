import { AdapterError } from "@ganger/core";
import type { CodeHostErrorDetail } from "@ganger/core";
import { z } from "zod";

export class GitHubError extends AdapterError<CodeHostErrorDetail> {
  constructor(detail: CodeHostErrorDetail, options?: { cause?: unknown }) {
    super(detail, options);
    this.name = "GitHubError";
  }
}

export interface HttpOptions {
  token: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface RestResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

const API_URL = "https://api.github.com";
const TIMEOUT_MS = 30_000;
const USER_AGENT = "ganger";
const GRAPHQL_ACCEPT = "application/vnd.github.merge-info-preview+json";
const REST_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
};

const graphqlErrors = z.array(
  z.object({
    type: z.string().optional(),
    message: z.string(),
    path: z.array(z.union([z.string(), z.number()])).optional(),
  }),
);

const graphqlEnvelope = z.object({
  data: z.unknown().optional(),
  errors: graphqlErrors.optional(),
});

export type GraphqlError = z.infer<typeof graphqlErrors>[number];

export class GitHubHttp {
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(options: HttpOptions) {
    this.token = options.token;
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<{ data: T; errors: ReadonlyArray<GraphqlError> }> {
    const res = await this.send(
      `${API_URL}/graphql`,
      "POST",
      { "content-type": "application/json", accept: GRAPHQL_ACCEPT },
      JSON.stringify({ query, variables }),
    );
    if (res.status !== 200) throw this.httpError(res);

    const envelope = graphqlEnvelope.safeParse(res.body);
    if (!envelope.success) throw malformed(envelope.error);
    const errors = envelope.data.errors ?? [];
    if (errors.some((e) => e.type === "RATE_LIMITED")) {
      throw new GitHubError({ kind: "rate-limited", resetAt: this.resetAt(res.headers) });
    }
    const data = schema.safeParse(envelope.data.data);
    if (!data.success) {
      if (errors.some((e) => e.type === "FORBIDDEN")) {
        throw new GitHubError({ kind: "unauthorized" });
      }
      throw malformed(errors.length > 0 ? errors : data.error);
    }
    return { data: data.data, errors };
  }

  async get(path: string): Promise<RestResponse> {
    return this.send(`${API_URL}${path}`, "GET", REST_HEADERS);
  }

  async put(path: string, body: Record<string, unknown>): Promise<RestResponse> {
    return this.send(
      `${API_URL}${path}`,
      "PUT",
      { ...REST_HEADERS, "content-type": "application/json" },
      JSON.stringify(body),
    );
  }

  isRateLimitedResponse(res: RestResponse): boolean {
    return (
      res.status === 429 ||
      (res.status === 403 && (isRateLimited(res.headers) || mentionsRateLimit(res.body)))
    );
  }

  httpError(res: RestResponse): GitHubError {
    if (res.status === 401) return new GitHubError({ kind: "unauthorized" });
    if (res.status === 429 || res.status === 403) {
      if (res.status === 429 || isRateLimited(res.headers) || mentionsRateLimit(res.body)) {
        return new GitHubError({ kind: "rate-limited", resetAt: this.resetAt(res.headers) });
      }
      return new GitHubError({ kind: "unauthorized" });
    }
    if (res.status === 404) return new GitHubError({ kind: "not-found" });
    return new GitHubError({ kind: "network", cause: new Error(`HTTP ${res.status}`) });
  }

  private async send(
    url: string,
    method: "GET" | "POST" | "PUT",
    headers: Record<string, string>,
    body?: string,
  ): Promise<RestResponse> {
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: { ...headers, authorization: `bearer ${this.token}`, "user-agent": USER_AGENT },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      throw new GitHubError({ kind: "network", cause }, { cause });
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch (cause) {
      if (response.ok) throw new GitHubError({ kind: "network", cause }, { cause });
    }
    return { status: response.status, headers: response.headers, body: json };
  }

  private resetAt(headers: Headers): Date | null {
    const retryAfter = numberHeader(headers, "retry-after");
    if (retryAfter !== null) return new Date(this.now().getTime() + retryAfter * 1000);
    const reset = numberHeader(headers, "x-ratelimit-reset");
    return reset === null ? null : new Date(reset * 1000);
  }
}

function isRateLimited(headers: Headers): boolean {
  return headers.get("x-ratelimit-remaining") === "0" || headers.has("retry-after");
}

function mentionsRateLimit(body: unknown): boolean {
  const parsed = z.object({ message: z.string() }).safeParse(body);
  return parsed.success && /rate limit/i.test(parsed.data.message);
}

function numberHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function malformed(cause: unknown): GitHubError {
  return new GitHubError({ kind: "network", cause }, { cause });
}
