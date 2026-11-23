import {
  AdapterRegistry,
  toDeliveryId,
  toLabelId,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import { SecretBox, parseBootConfig } from "@ganger/db";
import { fakeKind, trackerProject } from "./browser/fixtures.js";

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;

export function getAdapterRegistry(): AdapterRegistry {
  if (registry === undefined) {
    const tracker = new FakeTracker(fakeKind);
    tracker.projects.push(
      { id: trackerProject, name: "Web", url: "https://tracker.example.com/web" },
      { id: toTrackerProjectId("tp-api"), name: "API", url: "https://tracker.example.com/api" },
    );
    for (const project of [trackerProject, toTrackerProjectId("tp-api")]) {
      tracker.states.set(project, [
        { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
        { id: toTrackerStateId("in-progress"), name: "In Progress", category: "started" },
      ]);
    }
    tracker.labels.set(trackerProject, [
      { id: toLabelId("label-api"), name: "api" },
      { id: toLabelId("label-infra"), name: "infra" },
    ]);
    tracker.verifyWebhookWith = ({ rawBody, now }) => {
      const body = new TextDecoder().decode(rawBody);
      if (!body.startsWith("signed:")) return { ok: false, error: "bad-signature" };
      return {
        ok: true,
        event: {
          deliveryId: toDeliveryId(body.slice("signed:".length)),
          kind: "other",
          ticketKey: null,
          projectId: null,
          labelIds: null,
          previousLabelIds: null,
          receivedAt: now,
        },
      };
    };
    registry = new AdapterRegistry().registerTracker({ kind: fakeKind, create: () => tracker });
  }
  return registry;
}

export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}

export { getThisMac } from "./browser/fake-adapters.js";

export { getGitHubAuth } from "./browser/fake-gh.js";
