import { z } from "zod";

import { EMPTY_PUSH_MEMORY } from "./push-port";
import type { PushMemoryValue } from "./push-port";

const pushMemorySchema = z.object({
  asked: z.boolean(),
  registered: z.boolean(),
  address: z.string().nullable(),
});

export function parsePushMemory(text: string | null): PushMemoryValue {
  if (text === null) return EMPTY_PUSH_MEMORY;
  try {
    const parsed = pushMemorySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : EMPTY_PUSH_MEMORY;
  } catch {
    return EMPTY_PUSH_MEMORY;
  }
}
