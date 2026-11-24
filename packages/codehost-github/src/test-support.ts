import { readFileSync } from "node:fs";
import { z } from "zod";

const recorded = z.object({
  status: z.number(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown(),
});
export type Recorded = z.infer<typeof recorded>;

export function fixture(name: string): Recorded {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url);
  return recorded.parse(JSON.parse(readFileSync(url, "utf8")));
}

export function researchFixture(name: string): Recorded {
  const url = new URL(`../../../docs/research/fixtures/0006/${name}.json`, import.meta.url);
  const body: unknown = JSON.parse(readFileSync(url, "utf8"));
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

export interface SentRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  graphql: { query: string; variables: Record<string, unknown> } | null;
  json: unknown;
}

const graphqlBody = z.object({ query: z.string(), variables: z.record(z.string(), z.unknown()) });

export function fakeFetch(handler: (req: SentRequest) => Recorded | Error): {
  fetch: typeof fetch;
  sent: SentRequest[];
} {
  const sent: SentRequest[] = [];
  const fn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = z.record(z.string(), z.string()).parse(init?.headers ?? {});
    const url = input instanceof Request ? input.url : String(input);
    const json: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const req: SentRequest = {
      url,
      method: init?.method ?? "GET",
      headers,
      graphql: url.endsWith("/graphql") ? graphqlBody.parse(json) : null,
      json,
    };
    sent.push(req);
    const answer = handler(req);
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), { status: answer.status, headers: answer.headers }),
    );
  };
  return { fetch: fn, sent };
}

export function route(answers: {
  graphql: Recorded | ((req: SentRequest) => Recorded | Error) | Error;
  actions?: Recorded | ((req: SentRequest) => Recorded | Error) | Error;
}): (req: SentRequest) => Recorded | Error {
  const pick = (
    answer: Recorded | ((req: SentRequest) => Recorded | Error) | Error | undefined,
    req: SentRequest,
  ): Recorded | Error => {
    if (answer === undefined) return new Error(`unexpected request ${req.url}`);
    return typeof answer === "function" ? answer(req) : answer;
  };
  return (req) =>
    req.url.endsWith("/graphql") ? pick(answers.graphql, req) : pick(answers.actions, req);
}
