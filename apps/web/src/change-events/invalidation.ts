import type { QueryKey } from "@tanstack/react-query";
import { CHANGE_KINDS, CHANGE_PARTS } from "@ganger/db/change-events-model";
import type { ChangeKind } from "@ganger/db/change-events-model";
import { z } from "zod";

export const changeMessageSchema = z.object({
  kind: z.enum(CHANGE_KINDS),
  targetId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  part: z.enum(CHANGE_PARTS).nullable(),
});

export type ReceivedChange = z.infer<typeof changeMessageSchema>;

const RUN_KEYS: ReadonlyArray<QueryKey> = [
  ["runs", "detail"],
  ["runs", "list"],
  ["dashboard"],
  ["tickets", "runs"],
  ["runners", "list"],
  ["stats"],
  ["settings"],
];

export const INVALIDATED_KEYS: Readonly<Record<ChangeKind, ReadonlyArray<QueryKey>>> = {
  run: RUN_KEYS,
  assignment: RUN_KEYS,
  runner: [
    ["shell"],
    ["runners", "list"],
    ["dashboard"],
    ["tickets", "runs"],
    ["settings"],
    ["runs"],
    ["stats"],
  ],
  workspace: [
    ["shell"],
    ["settings"],
    ["dashboard"],
    ["tickets", "runs"],
    ["runners", "list"],
    ["runs"],
    ["stats"],
  ],
  settings: [["settings"], ["devices"], ["dashboard"], ["tickets", "runs"], ["runs"], ["stats"]],
  tracker: [["tracker"]],
};

function keysOf(change: ReceivedChange): ReadonlyArray<QueryKey> {
  if (change.kind === "run" && change.part === "log" && change.targetId !== null)
    return [["runs", "detail", change.targetId]];
  return INVALIDATED_KEYS[change.kind];
}

function covers(prefix: QueryKey, key: QueryKey): boolean {
  return prefix.length <= key.length && prefix.every((part, index) => part === key[index]);
}

export function invalidatedKeysOf(changes: ReadonlyArray<ReceivedChange>): QueryKey[] {
  const keys = new Map<string, QueryKey>();
  for (const change of changes) {
    for (const key of keysOf(change)) keys.set(JSON.stringify(key), key);
  }
  const all = [...keys.values()];
  return all.filter(
    (key) => !all.some((other) => other !== key && other.length < key.length && covers(other, key)),
  );
}
