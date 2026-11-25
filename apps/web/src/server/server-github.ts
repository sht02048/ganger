import { loadServerGitHub } from "@ganger/app/pr-read-diagnosis";
import type { ServerGitHub } from "@ganger/app/pr-read-diagnosis";
import { countUnreadPrRuns, listCodeHostConnections } from "@ganger/db";
import type { Database } from "@ganger/db";
import { getGitHubAuth, getSecretBox } from "./adapters";

export async function serverGitHubForDiagnosis(db: Database): Promise<ServerGitHub | null> {
  if (countUnreadPrRuns(db)["no-access"] === 0) return null;
  try {
    return await loadServerGitHub(getGitHubAuth(), listCodeHostConnections(db, getSecretBox()));
  } catch {
    return null;
  }
}
