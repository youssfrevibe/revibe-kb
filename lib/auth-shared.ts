/**
 * Types and constants shared between server and client components.
 *
 * Kept separate from lib/auth.ts because that module imports `server-only`
 * plus firebase-admin (Node-only). Client components need the enum values +
 * labels without pulling in that whole tree.
 */

export type Team = "inbound" | "tickets" | "ops_orders" | "claims";
export type Role = "owner" | "admin" | "member";

export const TEAMS: Team[] = ["inbound", "tickets", "ops_orders", "claims"];

export const TEAM_LABEL: Record<Team, string> = {
  inbound: "Inbound",
  tickets: "Tickets",
  ops_orders: "Ops / Orders",
  claims: "Claims",
};

export const ROLES: Role[] = ["owner", "admin", "member"];
