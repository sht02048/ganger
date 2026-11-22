import * as SecureStore from "expo-secure-store";

import { parseStoredConnection } from "./stored-connection";
import type { ConnectionStore } from "./stored-connection";

const STORE_KEY = "ganger.connection";

export const connectionStore: ConnectionStore = {
  load: async () => parseStoredConnection(await SecureStore.getItemAsync(STORE_KEY)),
  save: (connection) =>
    SecureStore.setItemAsync(STORE_KEY, JSON.stringify(connection), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  clear: () => SecureStore.deleteItemAsync(STORE_KEY),
};
