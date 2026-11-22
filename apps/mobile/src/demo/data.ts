import type {
  V1Dashboard,
  V1DashboardRun,
  V1Runner,
  V1RunnerUsage,
  V1UsageWindow,
} from "@ganger/api";

import { ALL_WORKSPACES } from "../dashboard/model";
import type { MobileSnapshot, WorkspaceOption } from "../screen-model";

export interface DemoSnapshot extends MobileSnapshot {
  dashboardFor: (workspaceId: string) => V1Dashboard;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const payments: WorkspaceOption = { id: "ws-payments", name: "Payments" };
const growth: WorkspaceOption = { id: "ws-growth", name: "Growth" };

const mini = { name: "acme-runner", online: true };
const studio = { name: "studio", online: false };

const base = (key: string, title: string, workspace: WorkspaceOption = payments) => ({
  id: `run-${key}`,
  ticketId: `ticket-${key}`,
  ticketKey: key,
  ticketTitle: title,
  trackerProject: "ACME",
  workspace,
  runner: mini,
  agent: "claude",
  waitMs: 4 * MINUTE,
  executionMs: 25 * MINUTE,
  pullRequest: null,
  cancelling: false,
  control: null,
  todoTag: null,
});

const blocker = (key: string, title: string) => ({
  key,
  title,
  stateName: "In Progress",
  stateCategory: "started",
});

function demoTodoTag(run: V1DashboardRun): V1DashboardRun["todoTag"] {
  switch (run.state) {
    case "waiting-for-input":
      return run.input === null ? "waiting-for-input" : run.input.kind;
    case "disconnected":
      return "disconnected";
    case "ended":
      return run.summary === "failed" ? "failed" : null;
    case "queued":
    case "running":
    case "paused":
      return null;
  }
}

function demoDashboard(
  allRuns: ReadonlyArray<V1DashboardRun>,
  runners: ReadonlyArray<V1Runner>,
  workspaceId: string,
  workspaces: ReadonlyArray<WorkspaceOption>,
): V1Dashboard {
  const chosen = workspaces.find((workspace) => workspace.id === workspaceId);
  const runs = allRuns
    .filter((run) => chosen === undefined || run.workspace.id === chosen.id)
    .map((run): V1DashboardRun => ({ ...run, todoTag: demoTodoTag(run) }));
  const isTodo = (run: V1DashboardRun) => run.todoTag !== null;
  const unfinished = runs.filter((run) => run.state !== "ended");
  const ended = runs.filter((run) => run.state === "ended");
  const queued = runs.filter((run) => run.state === "queued");
  const working = runs.filter((run) => run.state === "running" || run.state === "paused");
  const todoCount = (...tags: ReadonlyArray<V1DashboardRun["todoTag"]>) =>
    runs.filter((run) => run.todoTag !== null && tags.includes(run.todoTag)).length;
  const resets = runners.flatMap((runner) =>
    runner.limits.flatMap((limit) => (limit.resetsInMs === null ? [] : [limit.resetsInMs])),
  );
  return {
    workspace:
      chosen === undefined || workspaceId === ALL_WORKSPACES
        ? { kind: "all" }
        : { kind: "one", workspace: chosen },
    summary: {
      todo: {
        check: todoCount("human-check"),
        answer: todoCount("question", "permission", "waiting-for-input"),
        stopped: todoCount("disconnected", "failed"),
      },
      inProgress: working.length + queued.length,
      limitedRunners: runners.filter((runner) => runner.limits.length > 0).length,
      soonestLimitResetMs: resets.length === 0 ? null : Math.min(...resets),
      runnerIssues: runners.filter((runner) => runner.cause !== null).length,
    },
    columns: {
      queued,
      running: { todo: unfinished.filter(isTodo), rest: working },
      done: { todo: ended.filter(isTodo), rest: ended.filter((run) => !isTodo(run)) },
    },
  };
}

const prDisplayId = (pullNumber: number) => `#${pullNumber}`;

const usageReadAt = (now: Date) => ({
  readAt: new Date(now.getTime() - 2 * MINUTE).toISOString(),
  agoMs: 2 * MINUTE,
  now: now.toISOString(),
});

function readUsage(now: Date, provider: string, windows: V1UsageWindow[]): V1RunnerUsage {
  const highest = windows.toSorted((a, b) => b.usedPercent - a.usedPercent)[0];
  return {
    ...usageReadAt(now),
    kind: "read",
    providers: [{ provider, status: "ok", windows }],
    highest: highest === undefined ? null : { provider, window: highest },
  };
}

export function busySnapshot(now: Date): DemoSnapshot {
  const endedAt = (agoMs: number) => new Date(now.getTime() - agoMs).toISOString();
  const ended = (agoMs: number) => ({
    endedAt: endedAt(agoMs),
    endedAgoMs: agoMs,
    prReadError: null,
  });

  const runs: V1DashboardRun[] = [
    {
      ...base("ACME-142", "결제 실패 재시도 간격 조정"),
      state: "waiting-for-input",
      waitingMs: 6 * MINUTE,
      input: {
        kind: "human-check",
        questionId: "check-142",
        body: "스테이징 결제 화면에서 재시도 안내를 확인해 주세요.",
        answered: false,
      },
    },
    {
      ...base("ACME-138", "환불 웹훅 중복 처리"),
      state: "waiting-for-input",
      waitingMs: 12 * MINUTE,
      input: {
        kind: "question",
        questionId: "question-138",
        body: "중복 웹훅은 무시할까요, 기록만 남길까요?",
        summary: "중복 웹훅은 무시할까요, 기록만 남길까요?",
        choices: ["무시해요", "기록만 남겨요"],
        answered: false,
      },
    },
    {
      ...base("ACME-131", "영수증 메일 템플릿 교체", growth),
      state: "waiting-for-input",
      waitingMs: 3 * MINUTE,
      input: {
        kind: "permission",
        promptId: "permission-131",
        detail: "pnpm db:migrate",
        denied: false,
      },
    },
    {
      ...base("ACME-127", "정산 리포트 시간대 수정"),
      runner: studio,
      state: "disconnected",
      unreachableMs: 18 * MINUTE,
    },
    {
      ...base("ACME-150", "카드 등록 화면 접근성 개선"),
      state: "running",
      executionMs: 63 * MINUTE,
      pullRequest: {
        displayId: prDisplayId(212),
        url: "https://example.com/acme/pay/pull/212",
        problems: [{ kind: "ci-failed" }, { kind: "conflict" }, { kind: "behind", commits: 3 }],
      },
    },
    {
      ...base("ACME-149", "구독 해지 사유 수집", growth),
      state: "running",
      cancelling: true,
    },
    {
      ...base("ACME-147", "쿠폰 만료 배치 분리"),
      state: "paused",
      pausedMs: 40 * MINUTE,
      pauseSource: "operator",
    },
    {
      ...base("ACME-146", "세금 계산 반올림 통일"),
      state: "paused",
      pausedMs: 9 * MINUTE,
      pauseSource: "unreported",
    },
    {
      ...base("ACME-155", "결제 수단 정렬"),
      executionMs: null,
      state: "queued",
      queuedReason: { kind: "no-capacity", runner: "acme-runner" },
    },
    {
      ...base("ACME-156", "청구서 PDF 글꼴 교체"),
      runner: studio,
      executionMs: null,
      state: "queued",
      queuedReason: { kind: "runner-offline" },
    },
    {
      ...base("ACME-157", "결제 내역 검색 필터"),
      executionMs: null,
      waitMs: 2 * HOUR,
      state: "queued",
      queuedReason: {
        kind: "blockers-waiting",
        blockers: [blocker("ACME-150", "카드 등록 화면 접근성 개선")],
        finished: [],
      },
    },
    {
      ...base("ACME-158", "해외 카드 수수료 표시", growth),
      executionMs: null,
      waitMs: 26 * HOUR,
      state: "queued",
      queuedReason: {
        kind: "blockers-stuck",
        cause: "canceled",
        blocker: blocker("ACME-120", "환율 API 교체"),
        blockers: [blocker("ACME-120", "환율 API 교체")],
      },
    },
    {
      ...base("ACME-159", "포인트 적립 알림"),
      executionMs: null,
      state: "queued",
      queuedReason: { kind: "usage-limit", provider: "claude", resetsInMs: 42 * MINUTE },
    },
    {
      ...base("ACME-119", "정기 결제 재시도 큐 분리"),
      state: "ended",
      summary: "failed",
      agentResult: "reported-failure",
      prState: "none",
      ...ended(2 * HOUR),
    },
    {
      ...base("ACME-118", "결제 위젯 로딩 개선"),
      state: "ended",
      summary: "succeeded",
      agentResult: "reported-success",
      prState: "merged",
      pullRequest: {
        displayId: prDisplayId(205),
        url: "https://example.com/acme/pay/pull/205",
        problems: [],
      },
      ...ended(45 * MINUTE),
    },
    {
      ...base("ACME-117", "관리자 환불 권한 분리"),
      state: "ended",
      summary: "succeeded",
      agentResult: "reported-success",
      prState: "open",
      pullRequest: {
        displayId: prDisplayId(203),
        url: "https://example.com/acme/pay/pull/203",
        problems: [{ kind: "behind", commits: 2 }],
      },
      ...ended(5 * HOUR),
    },
    {
      ...base("ACME-112", "이벤트 배너 문구 수정", growth),
      state: "ended",
      summary: "canceled",
      agentResult: "canceled",
      prState: "none",
      ...ended(2 * DAY),
    },
  ];

  const runners: V1Runner[] = [
    {
      id: "runner-studio",
      name: "studio",
      cause: "offline",
      offlineMs: 18 * MINUTE,
      used: 0,
      capacity: 2,
      usage: { ...usageReadAt(now), kind: "unreadable" },
      limits: [],
    },
    {
      id: "runner-build",
      name: "build-box",
      cause: "auth",
      offlineMs: null,
      used: 0,
      capacity: 2,
      usage: readUsage(now, "codex", [{ kind: "weekly", usedPercent: 31, resetsAt: null }]),
      limits: [],
    },
    {
      id: "runner-mini",
      name: "acme-runner",
      cause: null,
      offlineMs: null,
      used: 3,
      capacity: 4,
      usage: readUsage(now, "claude", [
        { kind: "session", usedPercent: 100, resetsAt: null },
        { kind: "weekly", usedPercent: 64, resetsAt: null },
      ]),
      limits: [{ provider: "claude", window: "session", resetsInMs: 42 * MINUTE }],
    },
  ];
  const workspaces = [payments, growth];
  return {
    workspaces,
    runners,
    dashboardFor: (workspaceId) => demoDashboard(runs, runners, workspaceId, workspaces),
  };
}

export function emptySnapshot(): DemoSnapshot {
  const workspaces = [payments, growth];
  return {
    workspaces,
    runners: [],
    dashboardFor: (workspaceId) => demoDashboard([], [], workspaceId, workspaces),
  };
}
