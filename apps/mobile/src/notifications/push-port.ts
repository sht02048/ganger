export type PushPermission = "granted" | "denied" | "undetermined";

export interface PushResponse {
  data: unknown;
  actionIdentifier: string;
}

export interface PushDevicePort {
  supported: boolean;
  permission(): Promise<PushPermission>;
  requestPermission(): Promise<PushPermission>;
  pushAddress(): Promise<string | null>;
  subscribeResponses(handler: (response: PushResponse) => void): () => void;
  setBadgeCount(count: number): Promise<void>;
}

export interface PushMemoryValue {
  asked: boolean;
  registered: boolean;
  address: string | null;
}

export const EMPTY_PUSH_MEMORY: PushMemoryValue = {
  asked: false,
  registered: false,
  address: null,
};

export interface PushMemory {
  load(): Promise<PushMemoryValue>;
  save(value: PushMemoryValue): Promise<void>;
  clear(): Promise<void>;
}
