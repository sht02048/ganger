import { isAbsolute } from "node:path";
import { HOME_ENV } from "@ganger/cli/home";
import { createAdapterRegistry } from "@ganger/app/adapters";
import { RunnerEnrollments } from "@ganger/app/runner-setup/enrollment";
import { runCommand } from "@ganger/app/runner-setup/commands";
import { localGangerSsh } from "@ganger/app/runner-setup/ganger-ssh";
import type { GangerSsh } from "@ganger/app/runner-setup/ganger-ssh";
import type { ThisMac } from "@ganger/app/runner-setup/model";
import { localThisMac } from "@ganger/app/runner-setup/this-mac";
import { defaultGitHubAuth } from "@ganger/codehost-github";
import type { GitHubAuth } from "@ganger/codehost-github";
import type { AdapterRegistry } from "@ganger/core";
import { SecretBox, parseBootConfig } from "@ganger/db";
import { z } from "zod";

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;
let thisMac: ThisMac | undefined;
let enrollments: RunnerEnrollments | undefined;

export function getAdapterRegistry(): AdapterRegistry {
  registry ??= createAdapterRegistry();
  return registry;
}

export function getGitHubAuth(): GitHubAuth {
  return defaultGitHubAuth();
}

export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}

const gangerHomeSchema = z.string().trim().min(1).refine(isAbsolute).optional().catch(undefined);

function gangerHome(): string | undefined {
  return gangerHomeSchema.parse(process.env[HOME_ENV]);
}

export function getThisMac(): ThisMac {
  thisMac ??= localThisMac({ gangerHome: gangerHome() });
  return thisMac;
}

export function getGangerSsh(): GangerSsh | null {
  const home = gangerHome();
  return home === undefined ? null : localGangerSsh(home, runCommand);
}

export function getRunnerEnrollments(): RunnerEnrollments {
  enrollments ??= new RunnerEnrollments();
  return enrollments;
}
