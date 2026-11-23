import type { McpActionOutcome, StoredMcpAction } from "@ganger/db";

export const MCP_RUN_TOOLS = [
  "assign_ticket",
  "answer_question",
  "answer_human_check",
  "deny_permission",
  "pause_run",
  "resume_run",
  "continue_run",
  "cancel_run",
  "start_run_without_waiting",
  "request_run_log",
] as const;

export const MCP_SETTINGS_TOOLS = [
  "update_workspace",
  "add_tracker_project",
  "remove_tracker_project",
  "set_mapping",
  "set_in_progress_state",
  "set_auto_assign_label",
  "check_tracker_connection",
  "check_github_token",
  "set_runner_capacity",
  "request_runner_check",
  "set_prevent_sleep",
] as const;

export const MCP_WRITE_TOOLS = [...MCP_RUN_TOOLS, ...MCP_SETTINGS_TOOLS] as const;
export type McpWriteTool = (typeof MCP_WRITE_TOOLS)[number];

export type McpRunTool = (typeof MCP_RUN_TOOLS)[number];

export function isMcpRunTool(tool: string): tool is McpRunTool {
  return MCP_RUN_TOOLS.some((name) => name === tool);
}

export function isMcpWriteTool(tool: string): tool is McpWriteTool {
  return MCP_WRITE_TOOLS.some((name) => name === tool);
}

export const MAX_MCP_CLIENT_NAME_LENGTH = 60;
export const UNNAMED_MCP_CLIENT = "unnamed";
export const RECENT_MCP_ACTIONS = 20;

export function mcpClientName(raw: string | undefined): string {
  const cleaned = Array.from((raw ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ""))
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  const cut = Array.from(cleaned).slice(0, MAX_MCP_CLIENT_NAME_LENGTH).join("").trim();
  return cut === "" ? UNNAMED_MCP_CLIENT : cut;
}

export const MCP_REJECT_REASONS = [
  "not-found",
  "workspace",
  "no-mapping",
  "active-run",
  "unknown-agent",
  "unknown-runner",
  "runner-assignment-blocked",
  "no-question",
  "already-answered",
  "no-permission",
  "already-denied",
  "resolved",
  "already-ended",
  "not-running",
  "not-queued",
  "not-waiting",
  "cancelling",
  "no-human-check",
  "not-paused",
  "control-pending",
  "not-ended",
  "not-started",
  "superseded",
  "worktree-removing",
  "worktree-settled",
  "previous-agent",
  "request-reused",
  "taken",
  "unauthorized",
  "rate-limited",
  "network",
  "invalid",
  "unavailable",
] as const;
export type McpRejectReason = (typeof MCP_REJECT_REASONS)[number];

export function isMcpRejectReason(reason: string | null): reason is McpRejectReason {
  return MCP_REJECT_REASONS.some((known) => known === reason);
}

export interface McpActionView {
  at: string;
  client: string;
  tool: string;
  target: string | null;
  outcome: McpActionOutcome;
  reason: string | null;
}

export function mcpActionView(action: StoredMcpAction): McpActionView {
  return {
    at: action.at.toISOString(),
    client: mcpClientName(action.client),
    tool: action.tool,
    target: action.target,
    outcome: action.outcome,
    reason: action.reason,
  };
}
