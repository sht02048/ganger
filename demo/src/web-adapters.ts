import type { AdapterRegistry } from "@ganger/core";
import { SecretBox, parseBootConfig } from "@ganger/db";
import type { RunnerEnrollments } from "@ganger/app/runner-setup/enrollment";
import type { GangerSsh } from "@ganger/app/runner-setup/ganger-ssh";
import type { ThisMac } from "@ganger/app/runner-setup/model";
import type { GitHubAuth } from "@ganger/codehost-github";
import { demoEnrollment } from "./enrollment.js";
import { demoGh } from "./gh.js";
import { demoThisMac } from "./this-mac.js";
import { demoWorld } from "./world.js";

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;

export function getAdapterRegistry(): AdapterRegistry {
  registry ??= demoWorld().registry();
  return registry;
}

export function getGitHubAuth(): GitHubAuth {
  return demoGh().auth;
}

export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}

export function getThisMac(): ThisMac {
  return demoThisMac();
}

export function getGangerSsh(): GangerSsh | null {
  return demoEnrollment().ssh;
}

export function getRunnerEnrollments(): RunnerEnrollments {
  return demoEnrollment().enrollments;
}
