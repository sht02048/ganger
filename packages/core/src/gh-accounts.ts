export interface GhAccount {
  host: string;
  login: string;
  active: boolean;
  expired: boolean;
}

export type GhAccountsReading =
  | { kind: "logged-in"; accounts: GhAccount[] }
  | { kind: "logged-out" }
  | { kind: "not-installed" }
  | { kind: "unreadable" };
