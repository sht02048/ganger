import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { z } from "zod";

import { parseStoredConnection } from "./stored-connection";
import type { ConnectionStore } from "./stored-connection";

const STORE_KEY = "ganger.connection";

const sharedKeychainSchema = z.object({ keychainAccessGroup: z.string().min(1) });

function sharedKeychainOptions(): SecureStore.SecureStoreOptions {
  const parsed = sharedKeychainSchema.safeParse(Constants.expoConfig?.extra);
  return parsed.success ? { accessGroup: parsed.data.keychainAccessGroup } : {};
}

export const connectionStore: ConnectionStore = {
  load: async () => parseStoredConnection(await SecureStore.getItemAsync(STORE_KEY)),
  save: (connection) =>
    SecureStore.setItemAsync(STORE_KEY, JSON.stringify(connection), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      ...sharedKeychainOptions(),
    }),
  clear: () => SecureStore.deleteItemAsync(STORE_KEY),
};
