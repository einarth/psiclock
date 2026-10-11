/**
 * Staff roles, lowest first. Each role can do everything the roles before it
 * can: desk staff can also bust players, the director can also work the desk.
 * Anyone without a login can only watch the screens.
 */
export const roles = ['floor', 'desk', 'director', 'admin'] as const;
export type Role = (typeof roles)[number];

export const roleNames: Record<Role, string> = {
  floor: 'Floor',
  desk: 'Desk',
  director: 'Director',
  admin: 'Admin',
};

export const roleDescriptions: Record<Role, string> = {
  floor: 'Bust players, move players, balance and break tables',
  desk: 'Floor, plus registration, rebuys, add-ons, payouts and the player database',
  director: 'Desk, plus the clock, tournament settings, payout table and screens',
  admin: 'Director, plus managing logins',
};

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export const isRole = (r: unknown): r is Role => roles.includes(r as Role);

/** True when the user's role is at least `need`. */
export function hasRole(user: Pick<User, 'role'> | null | undefined, need: Role): boolean {
  return !!user && roles.indexOf(user.role) >= roles.indexOf(need);
}
