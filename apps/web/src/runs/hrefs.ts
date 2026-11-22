export function runnerRunsHref(ws: string | undefined, runnerId: string): string {
  const search = new URLSearchParams(ws === undefined ? {} : { ws });
  search.set("runner", runnerId);
  return `/runs?${search.toString()}`;
}

export function runDetailRunnerHref(
  page: { kind: "found"; run: { workspace: { id: string } } } | { kind: string },
  ws: string | undefined,
  runnerId: string,
): string {
  return runnerRunsHref("run" in page ? page.run.workspace.id : ws, runnerId);
}
