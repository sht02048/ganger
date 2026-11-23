import {
  AdapterRegistry,
  toCodeHostKind,
  toRepoRef,
  toRunnerKind,
  toTrackerKind,
} from "@ganger/core";
import type { RepoRef, RunnerProjectId } from "@ganger/core";
import { FakeCodeHost, FakeRunner, FakeTracker } from "@ganger/core/testing";
import { ASK_GUIDE } from "@ganger/runner-orca/agent-brief";
import {
  RUNNER_PROJECTS,
  demoRelations,
  providerUsageFor,
  ghAccountsFor,
  runnerLoadFor,
  trackerCatalog,
  trackerSpecFor,
} from "./fixtures.js";
import {
  FAIL_AUTH,
  FAIL_NO_ORCA,
  FAIL_OFFLINE,
  FAIL_PUSH_AUTH,
  SLOW_CHECK,
  SLOW_CHECK_MS,
} from "./values.js";

export const TRACKER_KIND = toTrackerKind("linear");
export const RUNNER_KIND = toRunnerKind("orca");
export const CODE_HOST_KIND = toCodeHostKind("github");

export class DemoWorld {
  readonly trackers = new Map<string, FakeTracker>();
  readonly runners = new Map<string, FakeRunner>();
  readonly codeHost = new FakeCodeHost(CODE_HOST_KIND, "");
  private readonly badCodeHost = new FakeCodeHost(CODE_HOST_KIND, "");
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
    this.badCodeHost.connection = { ok: false, error: { kind: "unauthorized" } };
  }

  tracker(apiKey: string): FakeTracker {
    const found = this.trackers.get(apiKey);
    if (found !== undefined) return found;
    const tracker = new FakeTracker(TRACKER_KIND);
    if (apiKey.toLowerCase().includes(FAIL_AUTH)) {
      tracker.connection = { ok: false, error: { kind: "unauthorized" } };
    } else {
      const spec = trackerSpecFor(apiKey);
      tracker.connection = { ok: true, organizationName: spec.name };
      const catalog = trackerCatalog(spec, this.now());
      tracker.projects.push(...catalog.projects);
      for (const project of catalog.projects) {
        tracker.states.set(project.id, catalog.states);
        tracker.labels.set(project.id, catalog.labels);
      }
      for (const ticket of catalog.tickets) tracker.addTicket(ticket);
      for (const [key, relations] of demoRelations(catalog)) tracker.relations.set(key, relations);
    }
    this.trackers.set(apiKey, tracker);
    return tracker;
  }

  runner(sshTarget: string): FakeRunner {
    const found = this.runners.get(sshTarget);
    if (found !== undefined) return found;
    const runner = new FakeRunner(RUNNER_KIND);
    runner.agentProtocol = ASK_GUIDE;
    const target = sshTarget.toLowerCase();
    runner.setProjects(RUNNER_PROJECTS);
    runner.online = !target.includes(FAIL_OFFLINE);
    runner.load = runnerLoadFor(sshTarget);
    runner.ghAccounts = ghAccountsFor(sshTarget);
    const readProviderUsage = runner.readProviderUsage.bind(runner);
    runner.readProviderUsage = () => {
      runner.providerUsage = providerUsageFor(sshTarget, this.now());
      return readProviderUsage();
    };
    runner.prerequisites = [
      {
        id: "orca-service",
        name: "Orca background service",
        satisfied: !target.includes(FAIL_NO_ORCA),
        hint: "orca serve service install --bind 127.0.0.1 --command orca",
        blocksAssignment: false,
      },
      ...RUNNER_PROJECTS.map((project, index) => {
        const denied = target.includes(FAIL_PUSH_AUTH) && index === RUNNER_PROJECTS.length - 1;
        return {
          id: `github-push:${project.id}`,
          name: `GitHub push access: ${project.displayName}`,
          satisfied: !denied,
          hint: "Run `gh auth login --insecure-storage` and `gh auth setup-git` on the runner.",
          blocksAssignment: false,
          project: project.id,
          ...(denied
            ? {
                failure: {
                  kind: "auth" as const,
                  reason: `Permission to ${project.displayName}.git denied to demo-bot.`,
                },
              }
            : {}),
        };
      }),
    ];
    if (target.includes(SLOW_CHECK)) {
      const checkHealth = runner.checkHealth.bind(runner);
      runner.checkHealth = async () => {
        await new Promise((resolve) => setTimeout(resolve, SLOW_CHECK_MS));
        return checkHealth();
      };
    }
    this.runners.set(sshTarget, runner);
    return runner;
  }

  repoOf(project: RunnerProjectId): RepoRef {
    return toRepoRef(project);
  }

  registry(): AdapterRegistry {
    return new AdapterRegistry()
      .registerTracker({
        kind: TRACKER_KIND,
        create: (config) => this.tracker(stringAt(config, "secrets", "apiKey")),
      })
      .registerRunner({
        kind: RUNNER_KIND,
        create: (config) => this.runner(stringAt(config, "sshTarget")),
      })
      .registerCodeHost({
        kind: CODE_HOST_KIND,
        create: (config) =>
          stringAt(config, "secrets", "token").toLowerCase().includes(FAIL_AUTH)
            ? this.badCodeHost
            : this.codeHost,
      });
  }
}

export function stringAt(value: unknown, ...path: string[]): string {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) return "";
    current = Object.getOwnPropertyDescriptor(current, key)?.value;
  }
  return typeof current === "string" ? current : "";
}

declare global {
  var __gangerDemoWorld: DemoWorld | undefined;
}

export function demoWorld(): DemoWorld {
  globalThis.__gangerDemoWorld ??= new DemoWorld();
  return globalThis.__gangerDemoWorld;
}
