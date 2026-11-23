export const CONTRACT_VERSION = 1;
export const MIN_CLIENT_CONTRACT_VERSION = 1;

export const APP_CONTRACT_VERSION = CONTRACT_VERSION;
export const MIN_SERVER_CONTRACT_VERSION = 1;

export interface ServerContract {
  contractVersion: number;
  minClientContractVersion: number;
}

export interface AppContract {
  contractVersion: number;
  minServerContractVersion: number;
}

export type ContractFit = "compatible" | "update-app" | "update-server";

const THIS_APP: AppContract = {
  contractVersion: APP_CONTRACT_VERSION,
  minServerContractVersion: MIN_SERVER_CONTRACT_VERSION,
};

export function contractFit(server: ServerContract, app: AppContract = THIS_APP): ContractFit {
  if (app.contractVersion < server.minClientContractVersion) return "update-app";
  if (server.contractVersion < app.minServerContractVersion) return "update-server";
  return "compatible";
}
