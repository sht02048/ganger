import type { ConnectionStore, StoredConnection } from "./stored-connection";

let remembered: StoredConnection | null = null;

export const connectionStore: ConnectionStore = {
  load: () => Promise.resolve(remembered),
  save: (connection) => {
    remembered = connection;
    return Promise.resolve();
  },
  clear: () => {
    remembered = null;
    return Promise.resolve();
  },
};
