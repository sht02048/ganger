import { readFileSync } from "node:fs";
import {
  toLabelId,
  toTicketKey,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LinearApiError, LinearTrackerError } from "./client.js";
import type { Fetch } from "./client.js";
import { LinearTracker, linearTrackerFactory } from "./tracker.js";

const fixtureSchema = z.object({
  status: z.number(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown(),
});

type Fixture = z.infer<typeof fixtureSchema>;

function fixture(name: string): Fixture {
  return fixtureSchema.parse(
    JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8")),
  );
}

const requestSchema = z.object({
  query: z.string(),
  variables: z.record(z.string(), z.unknown()),
});

interface SentRequest {
  url: string;
  authorization: string | null;
  query: string;
  variables: Record<string, unknown>;
}

function fakeFetch(...responses: Array<Fixture | Error>): { fetch: Fetch; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const queue = [...responses];
  const fetch: Fetch = (url, init) => {
    const body = requestSchema.parse(JSON.parse(z.string().parse(init.body)));
    sent.push({
      url,
      authorization: new Headers(init.headers).get("authorization"),
      query: body.query,
      variables: body.variables,
    });
    const next = queue.shift();
    if (next === undefined) return Promise.reject(new Error("응답을 준비하지 않은 요청"));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(
      new Response(JSON.stringify(next.body), { status: next.status, headers: next.headers }),
    );
  };
  return { fetch, sent };
}

function tracker(...responses: Array<Fixture | Error>) {
  const { fetch, sent } = fakeFetch(...responses);
  return {
    tracker: new LinearTracker({ apiKey: "lin_api_test", webhookSecret: null, fetch }),
    sent,
  };
}

function withBody(base: Fixture, edit: (body: unknown) => unknown): Fixture {
  const copy: unknown = structuredClone(base.body);
  return { ...base, body: edit(copy) };
}

const connectionBody = z.object({
  data: z.record(
    z.string(),
    z.object({ nodes: z.array(z.unknown()), pageInfo: z.record(z.string(), z.unknown()) }).loose(),
  ),
});

function lastPage(base: Fixture): Fixture {
  return withBody(base, (body) => {
    const parsed = connectionBody.parse(body);
    for (const connection of Object.values(parsed.data)) {
      connection.pageInfo["hasNextPage"] = false;
    }
    return parsed;
  });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("거절되지 않았다");
}

const PROJECT = toTrackerProjectId("00000000-0000-4000-8000-000000000102");
const KEY = toTicketKey("ENG-123");

describe("checkConnection", () => {
  it("API 키로 viewer를 읽으면 연결된 것이고 조직 이름을 돌려준다. 키는 Bearer 없이 보낸다", async () => {
    const { tracker: t, sent } = tracker(fixture("connection-ok"), fixture("organization-ok"));

    await expect(t.checkConnection()).resolves.toEqual({
      ok: true,
      organizationName: "Example organization",
    });
    expect(sent[0]?.authorization).toBe("lin_api_test");
    expect(sent[0]?.url).toBe("https://api.linear.app/graphql");
  });

  it("viewer는 읽히는데 조직을 읽지 못하면 연결은 된 것이고 조직 이름은 비운다", async () => {
    const partial = withBody(fixture("organization-ok"), () => ({
      data: { viewer: { organization: null } },
      errors: [{ message: "Forbidden", extensions: { code: "FORBIDDEN" } }],
    }));
    for (const second of [partial, new TypeError("fetch failed")]) {
      const { tracker: t } = tracker(fixture("connection-ok"), second);
      await expect(t.checkConnection()).resolves.toEqual({ ok: true, organizationName: null });
    }
  });

  it("조직 urlKey 를 읽으면 그 조직의 webhook 설정 주소를 함께 돌려준다", async () => {
    const withKey = (urlKey: string) =>
      withBody(fixture("organization-ok"), () => ({
        data: { viewer: { organization: { name: "Acme", urlKey } } },
      }));
    const { tracker: t } = tracker(fixture("connection-ok"), withKey("acme"));
    await expect(t.checkConnection()).resolves.toEqual({
      ok: true,
      organizationName: "Acme",
      webhookSettingsUrl: "https://linear.app/acme/settings/api",
    });

    const { tracker: odd } = tracker(fixture("connection-ok"), withKey("../evil"));
    await expect(odd.checkConnection()).resolves.toEqual({ ok: true, organizationName: "Acme" });
  });

  it("인증 실패를 unauthorized로 돌려준다", async () => {
    const { tracker: t } = tracker(fixture("error-unauthorized"));

    await expect(t.checkConnection()).resolves.toEqual({
      ok: false,
      error: { kind: "unauthorized" },
    });
  });

  it("닿지 않으면 network로 돌려준다", async () => {
    const cause = new TypeError("fetch failed");
    const { tracker: t } = tracker(cause);

    await expect(t.checkConnection()).resolves.toEqual({
      ok: false,
      error: { kind: "network", cause },
    });
  });
});

describe("조회", () => {
  it("getTicket이 티켓 키로 조회해 core 티켓으로 바꾼다", async () => {
    const { tracker: t, sent } = tracker(fixture("ticket"));

    const ticket = await t.getTicket(KEY);

    expect(sent[0]?.variables).toEqual({ id: "ENG-123" });
    expect(ticket).toEqual({
      key: "ENG-123",
      title: "Example ticket",
      body: "Example description.",
      url: "https://linear.app/acme/issue/ENG-123/example-ticket",
      labels: [],
      project: { id: PROJECT, name: "Example project" },
      state: {
        id: "00000000-0000-4000-8000-000000000117",
        name: "In Progress",
        category: "started",
      },
      updatedAt: new Date("2026-11-17T16:05:59.058Z"),
      priority: "none",
    });
  });

  it("getTicketRelations가 blocks 관계만 선행 티켓으로 읽고 우선순위를 옮기며 다음 쪽까지 읽는다", async () => {
    const relation = (type: string, identifier: string, stateType: string) => ({
      type,
      issue: {
        identifier,
        title: `Title ${identifier}`,
        state: { id: `state-${stateType}`, name: stateType, type: stateType },
      },
    });
    const page = (nodes: unknown[], endCursor: string | null) => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        data: {
          issue: {
            priority: 2,
            inverseRelations: {
              nodes,
              pageInfo: { hasNextPage: endCursor !== null, endCursor },
            },
          },
        },
      },
    });
    const { tracker: t, sent } = tracker(
      page(
        [relation("blocks", "OPS-1", "completed"), relation("related", "OPS-2", "started")],
        "c1",
      ),
      page([relation("blocks", "OPS-3", "canceled")], null),
    );

    const relations = await t.getTicketRelations(KEY);

    expect(sent[0]?.query).toContain("includeArchived: true");
    expect(sent[1]?.variables["after"]).toBe("c1");
    expect(relations?.priority).toBe("high");
    expect(relations?.blockers.map((b) => [b.key, b.state.category])).toEqual([
      ["OPS-1", "completed"],
      ["OPS-3", "canceled"],
    ]);
  });

  it("getTicketRelations가 없는 티켓에 null을 돌려준다", async () => {
    const { tracker: t } = tracker(fixture("error-ticket-not-found"));

    await expect(t.getTicketRelations(toTicketKey("ENG-999999"))).resolves.toBeNull();
  });

  it("getTicket이 없는 티켓에 null을 돌려준다", async () => {
    const { tracker: t } = tracker(fixture("error-ticket-not-found"));

    await expect(t.getTicket(toTicketKey("ENG-999999"))).resolves.toBeNull();
  });

  it("getTicket이 본문 없는 티켓의 본문을 빈 문자열로 둔다", async () => {
    const { tracker: t } = tracker(
      withBody(fixture("ticket"), (body) => {
        const parsed = z
          .object({ data: z.object({ issue: z.record(z.string(), z.unknown()) }) })
          .parse(body);
        parsed.data.issue["description"] = null;
        parsed.data.issue["project"] = null;
        return parsed;
      }),
    );

    const ticket = await t.getTicket(KEY);

    expect(ticket?.body).toBe("");
    expect(ticket?.project).toBeNull();
  });

  it("listProjectTickets가 트래커 프로젝트의 티켓 한 쪽과 다음 커서를 돌려준다", async () => {
    const { tracker: t, sent } = tracker(fixture("project-tickets"));

    const page = await t.listProjectTickets(PROJECT, { first: 2 });

    expect(sent[0]?.variables).toEqual({ projectId: PROJECT, first: 2, after: null });
    expect(page.items.map((ticket) => ticket.key)).toEqual(["ENG-124", "ENG-125"]);
    expect(page.items[0]?.labels).toEqual([
      { id: toLabelId("00000000-0000-4000-8000-000000000103"), name: "ready-for-agent" },
    ]);
    expect(page.nextCursor).toBe("00000000-0000-4000-8000-000000000104");
  });

  it.each([
    [undefined, 50],
    [{ first: 1000 }, 250],
    [{ first: 0 }, 1],
  ])("listProjectTickets의 쪽 크기 %j를 %i로 맞춘다(Linear 상한 250)", async (page, first) => {
    const { tracker: t, sent } = tracker(lastPage(fixture("project-tickets")));

    const result = await t.listProjectTickets(PROJECT, page);

    expect(sent[0]?.variables["first"]).toBe(first);
    expect(result.nextCursor).toBeNull();
  });

  describe("상위 이슈 읽기(0171)", () => {
    const issue = (identifier: string, parent: unknown = null) => ({
      id: `id-${identifier}`,
      identifier,
      title: `${identifier} 제목`,
      url: `https://linear.app/acme/issue/${identifier}`,
      state: { name: "In Review", type: "started" },
      parent,
    });
    const page = (parent: unknown) =>
      withBody(lastPage(fixture("project-tickets")), (body) => {
        const parsed = connectionBody.parse(body);
        for (const connection of Object.values(parsed.data)) {
          connection.nodes = connection.nodes.slice(0, 1).map((node) => ({
            ...z.record(z.string(), z.unknown()).parse(node),
            parent,
          }));
        }
        return parsed;
      });
    const keysOf = async (parent: unknown) => {
      const { tracker: t } = tracker(page(parent));
      const { items } = await t.listProjectTickets(PROJECT);
      return items[0]?.ancestors?.map((ancestor) => ancestor.key);
    };

    it("상위가 없으면 빈 목록이다", async () => {
      await expect(keysOf(null)).resolves.toEqual([]);
    });

    it("1·2·3단계를 가까운 순서로 읽고 키·제목·주소·상태를 담는다", async () => {
      await expect(keysOf(issue("ENG-1"))).resolves.toEqual(["ENG-1"]);
      await expect(keysOf(issue("ENG-2", issue("ENG-1")))).resolves.toEqual(["ENG-2", "ENG-1"]);
      await expect(keysOf(issue("ENG-3", issue("ENG-2", issue("ENG-1"))))).resolves.toEqual([
        "ENG-3",
        "ENG-2",
        "ENG-1",
      ]);
      const { tracker: t } = tracker(page(issue("ENG-1")));
      const { items } = await t.listProjectTickets(PROJECT);
      expect(items[0]?.ancestors?.[0]).toEqual({
        id: "id-ENG-1",
        key: toTicketKey("ENG-1"),
        title: "ENG-1 제목",
        url: "https://linear.app/acme/issue/ENG-1",
        state: { name: "In Review", category: "started" },
      });
    });

    it("3단계를 넘는 값은 읽지 않고, 쿼리도 3단계까지만 묻는다", async () => {
      const deep = issue("ENG-4", issue("ENG-3", issue("ENG-2", issue("ENG-1"))));
      await expect(keysOf(deep)).resolves.toEqual(["ENG-4", "ENG-3", "ENG-2"]);
      const { tracker: t, sent } = tracker(page(null));
      await t.listProjectTickets(PROJECT);
      expect(sent[0]?.query.match(/parent \{/g)).toHaveLength(3);
    });

    it("상위 이슈 모양이 틀리면 파싱에 실패한다", async () => {
      const { tracker: t } = tracker(page({ id: "id-only" }));
      await expect(t.listProjectTickets(PROJECT)).rejects.toBeInstanceOf(Error);
    });

    it("티켓 하나를 읽는 쿼리는 상위 이슈를 묻지 않는다", async () => {
      const { tracker: t, sent } = tracker(fixture("ticket"));
      await t.getTicket(KEY).catch(() => null);
      expect(sent[0]?.query).not.toContain("parent");
    });
  });

  it("listLabeledTickets가 라벨과 시각으로 거르고 모든 쪽을 250개씩 읽는다", async () => {
    const { tracker: t, sent } = tracker(
      fixture("labeled-tickets"),
      lastPage(fixture("labeled-tickets")),
    );
    const label = toLabelId("00000000-0000-4000-8000-000000000103");

    const tickets = await t.listLabeledTickets({
      labelId: label,
      updatedSince: new Date("2026-11-01T00:00:00Z"),
    });

    expect(tickets).toHaveLength(4);
    expect(sent.map((request) => request.variables)).toEqual([
      { labelId: label, updatedSince: "2026-11-01T00:00:00.000Z", first: 250, after: null },
      {
        labelId: label,
        updatedSince: "2026-11-01T00:00:00.000Z",
        first: 250,
        after: "00000000-0000-4000-8000-000000000104",
      },
    ]);
  });

  it("listComments가 댓글과 작성자 이름을 돌려준다", async () => {
    const { tracker: t, sent } = tracker(fixture("comments"));

    const page = await t.listComments(KEY);

    expect(sent[0]?.variables).toEqual({ id: "ENG-123", first: 50, after: null });
    expect(page).toEqual({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000100",
          body: "Example comment.",
          createdAt: new Date("2026-11-17T16:06:00.169Z"),
          author: "Jane Doe",
        },
      ],
      nextCursor: null,
    });
  });

  it("listProjects가 트래커 프로젝트 목록을 돌려준다", async () => {
    const { tracker: t, sent } = tracker(fixture("projects"));

    await expect(t.listProjects()).resolves.toEqual([
      {
        id: PROJECT,
        name: "Example project",
        url: "https://linear.app/acme/project/example-project-000000000102",
      },
    ]);
    expect(sent[0]?.variables).toEqual({ first: 250, after: null });
  });

  it("listStates가 트래커 프로젝트의 팀 상태를 워크플로 순서로 돌려준다", async () => {
    const { tracker: t, sent } = tracker(fixture("project-teams"), fixture("team-states"));

    const states = await t.listStates(PROJECT);

    expect(sent[0]?.variables).toEqual({ id: PROJECT });
    expect(sent[1]?.variables).toEqual({
      teamIds: ["00000000-0000-4000-8000-000000000112"],
      first: 250,
      after: null,
    });
    expect(states.map((state) => [state.name, state.category])).toEqual([
      ["Backlog", "backlog"],
      ["Todo", "unstarted"],
      ["In Progress", "started"],
      ["In Review", "started"],
      ["Done", "completed"],
      ["Canceled", "canceled"],
      ["Duplicate", "duplicate"],
    ]);
  });

  it("listLabels가 팀 라벨과 워크스페이스 라벨을 이름순으로, 그룹 라벨은 빼고 돌려준다", async () => {
    const labels = withBody(fixture("team-labels"), (body) => {
      const parsed = z
        .object({
          data: z.object({ issueLabels: z.object({ nodes: z.array(z.unknown()) }).loose() }),
        })
        .parse(body);
      parsed.data.issueLabels.nodes.push({ id: "group-1", name: "Area", isGroup: true });
      return parsed;
    });
    const { tracker: t } = tracker(fixture("project-teams"), labels);

    const result = await t.listLabels(PROJECT);

    expect(result.map((label) => label.name)).toEqual([
      "Bug",
      "Feature",
      "Improvement",
      "needs-info",
      "needs-triage",
      "ready-for-agent",
      "ready-for-human",
      "wontfix",
    ]);
  });

  it("없는 트래커 프로젝트의 상태를 찾으면 not-found를 던진다", async () => {
    const { tracker: t } = tracker(fixture("error-project-not-found"));

    const error = await rejection(t.listStates(toTrackerProjectId("missing")));

    expect(error).toBeInstanceOf(LinearTrackerError);
    expect(error).toMatchObject({ detail: { kind: "not-found" } });
  });
});

describe("갱신", () => {
  const IN_PROGRESS = toTrackerStateId("00000000-0000-4000-8000-000000000117");

  it("setState가 티켓 키와 상태 ID로 상태를 바꾼다", async () => {
    const { tracker: t, sent } = tracker(fixture("set-state"));

    await t.setState(KEY, IN_PROGRESS);

    expect(sent[0]?.query).toContain("issueUpdate");
    expect(sent[0]?.variables).toEqual({ id: "ENG-123", stateId: IN_PROGRESS });
  });

  it.each(["error-set-state-ticket-not-found", "error-state-not-found"])(
    "setState가 %s를 not-found로 던진다",
    async (name) => {
      const { tracker: t } = tracker(fixture(name));

      const error = await rejection(t.setState(KEY, IN_PROGRESS));

      expect(error).toMatchObject({ detail: { kind: "not-found" } });
    },
  );

  it("addComment가 결과 댓글을 달고 댓글 ID와 URL을 돌려준다", async () => {
    const { tracker: t, sent } = tracker(fixture("add-comment"));

    const comment = await t.addComment(KEY, "런 결과");

    expect(sent[0]?.variables).toEqual({ issueId: "ENG-123", body: "런 결과" });
    expect(comment).toEqual({
      id: "00000000-0000-4000-8000-000000000100",
      url: "https://linear.app/acme/issue/ENG-123/example-ticket#comment-00000000",
    });
  });

  const labelColor = "given-color";

  it("createLabel이 팀 없이 워크스페이스 라벨을 받은 색 그대로 만들고 새 라벨을 돌려준다(0115)", async () => {
    const { tracker: t, sent } = tracker(fixture("create-label"));

    const label = await t.createLabel({ name: "ganger", color: labelColor });

    expect(sent[0]?.query).toContain("issueLabelCreate");
    expect(sent[0]?.query).not.toContain("teamId");
    expect(sent[0]?.variables).toEqual({ name: "ganger", color: labelColor });
    expect(label).toEqual({
      id: toLabelId("00000000-0000-4000-8000-000000000200"),
      name: "ganger",
    });
  });

  it("createLabel이 Linear가 거절한 라벨 만들기를 LinearApiError로 던진다(0115)", async () => {
    const { tracker: t } = tracker(fixture("error-create-label-forbidden"));

    const error = await rejection(t.createLabel({ name: "ganger", color: labelColor }));

    expect(error).toBeInstanceOf(LinearApiError);
  });

  it("addComment가 없는 티켓에 not-found를 던진다", async () => {
    const { tracker: t } = tracker(fixture("error-add-comment-ticket-not-found"));

    const error = await rejection(t.addComment(toTicketKey("ENG-999999"), "x"));

    expect(error).toMatchObject({ detail: { kind: "not-found" } });
  });
});

describe("오류 파싱", () => {
  it("인증 실패를 unauthorized로 던진다", async () => {
    const { tracker: t } = tracker(fixture("error-unauthorized"));

    const error = await rejection(t.getTicket(KEY));

    expect(error).toBeInstanceOf(LinearTrackerError);
    expect(error).toMatchObject({ detail: { kind: "unauthorized" } });
  });

  it("rate limit을 기다릴 시간과 함께 rate-limited로 던진다(research 0002 B.4)", async () => {
    const { tracker: t } = tracker({
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "30" },
      body: {
        errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED" } }],
      },
    });

    const error = await rejection(t.listProjects());

    expect(error).toMatchObject({ detail: { kind: "rate-limited", retryAfterSeconds: 30 } });
  });

  it("Retry-After가 없는 RATELIMITED는 기다릴 시간을 null로 둔다", async () => {
    const { tracker: t } = tracker({
      status: 200,
      headers: {},
      body: { data: null, errors: [{ message: "x", extensions: { code: "RATELIMITED" } }] },
    });

    const error = await rejection(t.listProjects());

    expect(error).toMatchObject({ detail: { kind: "rate-limited", retryAfterSeconds: null } });
  });

  it("응답을 받지 못하거나 5xx면 network로 던진다", async () => {
    const cause = new TypeError("fetch failed");
    const unreachable = tracker(cause).tracker;
    const serverError = tracker({ status: 502, headers: {}, body: "bad gateway" }).tracker;

    await expect(rejection(unreachable.listProjects())).resolves.toMatchObject({
      detail: { kind: "network", cause },
    });
    await expect(rejection(serverError.listProjects())).resolves.toMatchObject({
      detail: { kind: "network" },
    });
  });

  it("core 오류 종류가 아닌 GraphQL 오류는 LinearApiError로 던진다", async () => {
    const { tracker: t } = tracker(fixture("error-invalid-first"));

    const error = await rejection(t.listProjects());

    expect(error).toBeInstanceOf(LinearApiError);
    expect(error).toMatchObject({ code: "INVALID_INPUT", message: "Argument Validation Error" });
  });

  it("data가 예상한 모양이 아니면 LinearApiError로 던진다", async () => {
    const { tracker: t } = tracker({
      status: 200,
      headers: {},
      body: { data: { issue: { identifier: "ENG-1" } } },
    });

    await expect(rejection(t.getTicket(KEY))).resolves.toBeInstanceOf(LinearApiError);
  });
});

describe("linearTrackerFactory", () => {
  it("종류 linear 어댑터를 저장한 설정으로 만든다", () => {
    const tracker = linearTrackerFactory.create({
      config: { apiUrl: "https://linear.example.com/graphql" },
      secrets: { apiKey: "lin_api_x", webhookSecret: "s" },
    });

    expect(linearTrackerFactory.kind).toBe(toTrackerKind("linear"));
    expect(tracker.kind).toBe("linear");
    expect(tracker).toBeInstanceOf(LinearTracker);
  });

  it.each([
    ["API 키 없음", { config: {}, secrets: {} }],
    ["secrets 없음", { config: {} }],
    ["apiUrl이 URL이 아님", { config: { apiUrl: "nope" }, secrets: { apiKey: "k" } }],
  ])("%s이면 만들지 않는다", (_, config) => {
    expect(() => linearTrackerFactory.create(config)).toThrow(z.ZodError);
  });
});
