/**
 * Who works here, and what each of them can open.
 *
 * There are two layers. RLS draws the hard lines (see 0011_staff_rls.sql and
 * 0079_owner_and_permissions.sql): the owner sits above everyone, staff may
 * touch operational tables, and settings and the staff list follow an explicit
 * permission. This file is the layer the console reads to decide which sections
 * to show — the same decision, made client-side so the nav is honest.
 *
 * Access can be decided two ways. A role carries a sensible default set, which
 * is how everyone hired before per-person permissions existed still works. Or
 * the owner ticks the sections one person may open, and that list wins outright.
 */

export type StaffRole = 'admin' | 'manager' | 'dispatcher' | 'support';

export type AdminSection =
  | 'dashboard' | 'analytics' | 'stores' | 'ridersActive' | 'riders'
  | 'orders' | 'history' | 'settlements' | 'broadcast' | 'areas' | 'users' | 'settings' | 'staff';

export const STAFF_ROLES: StaffRole[] = ['admin', 'manager', 'dispatcher', 'support'];

export const ROLE_LABEL: Record<StaffRole, string> = {
  admin: 'Admin', manager: 'Manager', dispatcher: 'Dispatcher', support: 'Support',
};

const ALL: AdminSection[] = [
  'dashboard', 'analytics', 'stores', 'ridersActive', 'riders',
  'orders', 'history', 'settlements', 'broadcast', 'areas', 'users', 'settings', 'staff',
];

/** Every section, in the order the console lists them. */
export const ALL_SECTIONS: readonly AdminSection[] = ALL;

/** What each section is called, and what handing it over actually gives away. */
export const SECTION_LABEL: Record<AdminSection, string> = {
  dashboard: 'Dashboard', analytics: 'Analytics', stores: 'Stores & menus',
  ridersActive: 'Riders', riders: 'Rider applications', orders: 'Live orders',
  history: 'Order history', settlements: 'Settlements', broadcast: 'Broadcast SMS',
  areas: 'Service areas', users: 'Users & installs', settings: 'Settings', staff: 'Staff',
};

export const SECTION_NOTE: Record<AdminSection, string> = {
  dashboard: 'Today’s orders and takings at a glance.',
  analytics: 'Revenue, commission and order trends over time.',
  stores: 'Add stores, products, categories, prices and opening hours.',
  ridersActive: 'See who is on duty and where they are.',
  riders: 'Approve, reject and suspend rider applications.',
  orders: 'Watch live orders, assign carriers, chat with customers.',
  history: 'Every past order and what it earned.',
  settlements: 'Rider balances and marking them paid. This is your money.',
  broadcast: 'Send SMS to customers or riders.',
  areas: 'Where you deliver, and the fee bands.',
  users: 'The customer list and who has installed the app.',
  settings: 'Fees, commission, markup, and switching services on or off.',
  staff: 'See the staff list. Only you can actually change it.',
};

/** Sections each role may open when nobody has ticked anything for them. */
const ACCESS: Record<StaffRole, AdminSection[]> = {
  admin: ALL,
  manager: ['dashboard', 'analytics', 'stores', 'ridersActive', 'riders', 'orders', 'history', 'settlements', 'broadcast', 'areas', 'users'],
  dispatcher: ['dashboard', 'ridersActive', 'riders', 'orders', 'history'],
  support: ['dashboard', 'orders', 'history', 'broadcast'],
};

/** True when a role may open a section by default. */
export function can(role: StaffRole, section: AdminSection): boolean {
  return ACCESS[role]?.includes(section) ?? false;
}

/** Sections a role may open by default, in canonical order. */
export function sectionsFor(role: StaffRole): AdminSection[] {
  return ALL.filter((s) => can(role, s));
}

export function isStaffRole(role: string | null | undefined): role is StaffRole {
  return role === 'admin' || role === 'manager' || role === 'dispatcher' || role === 'support';
}

export function isAdminSection(s: string): s is AdminSection {
  return (ALL as string[]).includes(s);
}

/**
 * One staff member's standing: the role they hold, whether they own the
 * business, and the sections the owner ticked for them (null = never ticked,
 * so their role decides).
 */
export interface StaffAccess {
  id?: string;
  role: StaffRole;
  isOwner?: boolean;
  permissions?: readonly AdminSection[] | null;
}

/** The sections this person may actually open, in canonical order. */
export function allowedSections(access: StaffAccess): AdminSection[] {
  if (access.isOwner) return [...ALL];
  if (access.permissions) {
    const ticked = new Set(access.permissions);
    return ALL.filter((s) => ticked.has(s));
  }
  return sectionsFor(access.role);
}

/** True when this person may open this section. */
export function canAccess(access: StaffAccess, section: AdminSection): boolean {
  if (access.isOwner) return true;
  if (access.permissions) return access.permissions.includes(section);
  return can(access.role, section);
}

/**
 * Hiring, firing, changing a role, and deciding what anyone may see belong to
 * the owner alone — the database enforces the same rule, so a console that
 * offered these to anyone else would only be lying about what would happen.
 */
export function canManageStaff(access: StaffAccess): boolean {
  return access.isOwner === true;
}
