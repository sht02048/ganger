import { z } from "zod";

export const storedConnectionSchema = z.object({
  server: z.url(),
  token: z.string().min(1),
  deviceId: z.string().min(1),
});
export type StoredConnection = z.infer<typeof storedConnectionSchema>;

export interface ConnectionStore {
  load(): Promise<StoredConnection | null>;
  save(connection: StoredConnection): Promise<void>;
  clear(): Promise<void>;
}

export function parseStoredConnection(text: string | null): StoredConnection | null {
  if (text === null) return null;
  try {
    const parsed = storedConnectionSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
