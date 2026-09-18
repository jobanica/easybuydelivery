import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  can, sectionsFor, isStaffRole, STAFF_ROLES,
  allowedSections, canAccess, canManageStaff, ALL_SECTIONS,
} from './roles.ts';

test('admin can open every section', () => {
  assert.equal(can('admin', 'settings'), true);
  assert.equal(can('admin', 'staff'), true);
  assert.equal(can('admin', 'orders'), true);
});

test('settings and staff are admin-only', () => {
  for (const r of ['manager', 'dispatcher', 'support'] as const) {
    assert.equal(can(r, 'settings'), false, `${r} settings`);
    assert.equal(can(r, 'staff'), false, `${r} staff`);
  }
});

test('manager runs operations but not settings', () => {
  assert.equal(can('manager', 'settlements'), true);
  assert.equal(can('manager', 'broadcast'), true);
  assert.equal(can('manager', 'settings'), false);
});

test('dispatcher is focused on orders and riders', () => {
  assert.equal(can('dispatcher', 'orders'), true);
  assert.equal(can('dispatcher', 'ridersActive'), true);
  assert.equal(can('dispatcher', 'broadcast'), false);
  assert.equal(can('dispatcher', 'settlements'), false);
});

test('support sees orders, history, broadcast only', () => {
  assert.deepEqual(sectionsFor('support'), ['dashboard', 'orders', 'history', 'broadcast']);
});

test('sectionsFor always begins with dashboard', () => {
  for (const r of STAFF_ROLES) assert.equal(sectionsFor(r)[0], 'dashboard');
});

test('isStaffRole guards non-staff roles', () => {
  assert.equal(isStaffRole('admin'), true);
  assert.equal(isStaffRole('customer'), false);
  assert.equal(isStaffRole(null), false);
});

test('the owner opens everything, whatever their permissions say', () => {
  const owner = { role: 'support' as const, isOwner: true, permissions: [] };
  assert.deepEqual(allowedSections(owner), [...ALL_SECTIONS]);
  assert.equal(canAccess(owner, 'settings'), true);
  assert.equal(canAccess(owner, 'staff'), true);
});

test('a ticked list wins over the role', () => {
  const member = { role: 'support' as const, permissions: ['settlements' as const] };
  assert.deepEqual(allowedSections(member), ['settlements']);
  assert.equal(canAccess(member, 'settlements'), true, 'ticked despite support default');
  assert.equal(canAccess(member, 'orders'), false, 'unticked despite support default');
});

test('no list means the role still decides', () => {
  const member = { role: 'dispatcher' as const, permissions: null };
  assert.deepEqual(allowedSections(member), sectionsFor('dispatcher'));
});

test('an empty list is hired but shown nothing', () => {
  const member = { role: 'admin' as const, permissions: [] };
  assert.deepEqual(allowedSections(member), []);
  assert.equal(canAccess(member, 'dashboard'), false);
});

test('permissions are listed in the console order, not tick order', () => {
  const member = { role: 'support' as const, permissions: ['settings' as const, 'orders' as const, 'dashboard' as const] };
  assert.deepEqual(allowedSections(member), ['dashboard', 'orders', 'settings']);
});

test('only the owner manages staff — an admin is not enough', () => {
  assert.equal(canManageStaff({ role: 'admin', isOwner: true }), true);
  assert.equal(canManageStaff({ role: 'admin' }), false);
  assert.equal(canManageStaff({ role: 'admin', permissions: ['staff'] }), false);
});
