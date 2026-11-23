import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import { readCacheText } from "./offline-cache";
import type { CacheFiles } from "./offline-cache";

const DIRECTORY_NAME = "ganger-offline";

const cacheDirectory = () => new Directory(Paths.cache, DIRECTORY_NAME);

async function fileFor(server: string): Promise<File> {
  const name = await digestStringAsync(CryptoDigestAlgorithm.SHA256, server);
  return new File(cacheDirectory(), `${name}.json`);
}

export const cacheFiles: CacheFiles = {
  read: async (server) => {
    const file = await fileFor(server);
    return file.exists ? readCacheText(file) : null;
  },
  write: async (server, text) => {
    const directory = cacheDirectory();
    directory.create({ idempotent: true, intermediates: true });
    const target = await fileFor(server);
    const draft = new File(directory, `${target.name}.draft`);
    if (draft.exists) draft.delete();
    draft.create();
    await draft.write(text);
    await draft.move(target, { overwrite: true });
  },
  remove: async (server) => {
    const target = await fileFor(server);
    const draft = new File(cacheDirectory(), `${target.name}.draft`);
    if (draft.exists) draft.delete();
    if (target.exists) target.delete();
  },
  removeAll: async () => {
    const directory = cacheDirectory();
    if (directory.exists) directory.delete();
  },
};
