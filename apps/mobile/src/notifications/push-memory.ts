import * as SecureStore from "expo-secure-store";

import { parsePushMemory } from "./push-memory-schema";
import type { PushMemory } from "./push-port";

const STORE_KEY = "ganger.push";

export const pushMemory: PushMemory = {
  load: async () => parsePushMemory(await SecureStore.getItemAsync(STORE_KEY)),
  save: (value) =>
    SecureStore.setItemAsync(STORE_KEY, JSON.stringify(value), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  clear: () => SecureStore.deleteItemAsync(STORE_KEY),
};
