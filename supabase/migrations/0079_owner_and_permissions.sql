-- An owner above the admins, and per-person access to the console.
--
-- Until now every admin was every other admin's equal: each could change the
-- fees, hire and fire, and demote the person who owns the business. That is
-- fine while the only admin is the owner, and untenable the moment someone is
-- hired. So two things change.
--
-- First, one profile is marked as the owner. Nobody can take that mark, nobody
-- can edit the owner's row, and nobody but the owner decides who is staff or
-- what they may see. The mark itself moves only by direct database access,
-- which means it moves by a deliberate act, never through a signed-in session.
--
-- Second, access stops being a property of the role and becomes a property of
-- the person. `permissions` lists the console sections that particular member
-- may open. NULL means "as before" — the role decides — so everyone who
-- already had access keeps exactly what they had, and only new hires get the
-- explicit list.

alter table profiles
  add column if not exists is_owner boolean not null default false,
  add column if not exists permissions text[];

comment on column profiles.is_owner is
  'The operator who owns the business. Exactly one. Unsettable from the app — it moves only by direct database access.';
comment on column profiles.permissions is
  'Console sections this member may open. NULL = fall back to the role''s defaults.';

-- One owner, and no way to end up with two by accident.
create unique index if not exists profiles_one_owner
  on profiles (is_owner) where is_owner;

create or replace function is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_owner);
$$;

-- May the caller open this section of the console?
--
-- The owner may open everything. Anyone with an explicit permission list may
-- open exactly what is on it. Anyone without one falls back to how it worked
-- before this migration: an admin could reach everything, and no other role
-- could reach settings or staff.
create or replace function staff_can(p_section text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid()
       and (
         p.is_owner
         or (p.permissions is not null and p_section = any (p.permissions))
         or (p.permissions is null and p.role::text = 'admin')
       )
  );
$$;

-- Replaces the 0012 guard, which only stopped a customer promoting themselves.
-- The new rules are about admins: who they may change, and who they may not.
create or replace function guard_profile_role()
returns trigger
language plpgsql
as $$
begin
  -- These rules exist to constrain app sessions. PostgREST switches to `anon`
  -- or `authenticated` for those; anything else reaching this table — the
  -- service role, a migration, a psql session — is someone with the keys to
  -- the database already, and is trusted.
  if current_user not in ('anon', 'authenticated') then return new; end if;

  -- The mark of ownership moves only against the database, never through the
  -- app — so no session, however privileged, can hand it to itself.
  if new.is_owner is distinct from old.is_owner then
    raise exception 'ownership cannot be changed from the app';
  end if;

  -- The owner's row is theirs alone. Another admin cannot rename them,
  -- demote them, or strip their access.
  if old.is_owner and auth.uid() <> old.id then
    raise exception 'only the owner may change the owner''s account';
  end if;

  -- Who is staff, and what each of them may see, is the owner's call.
  if new.role is distinct from old.role and not is_owner() then
    raise exception 'only the owner may change a role';
  end if;
  if new.permissions is distinct from old.permissions and not is_owner() then
    raise exception 'only the owner may change what a staff member can access';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_role_guard on profiles;
create trigger profiles_role_guard
  before update on profiles
  for each row execute function guard_profile_role();

-- Deleting the owner would silently un-own the business.
create or replace function guard_profile_delete()
returns trigger language plpgsql as $$
begin
  if old.is_owner and current_user in ('anon', 'authenticated') then
    raise exception 'the owner''s account cannot be deleted';
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_delete_guard on profiles;
create trigger profiles_delete_guard
  before delete on profiles
  for each row execute function guard_profile_delete();

-- Settings follow the permission, not the role, so the owner can hand them to
-- one person without handing over the staff list as well.
drop policy if exists app_settings_admin_write on app_settings;
create policy app_settings_admin_write on app_settings
  for all using (staff_can('settings')) with check (staff_can('settings'));

-- Same for the staff directory. The triggers above are what actually stop a
-- delegate from touching the owner or handing out permissions; this policy only
-- decides who gets to see the page at all.
drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles
  for all using (staff_can('staff')) with check (staff_can('staff'));

-- The owner is whoever runs the business. Marked here once, by the migration,
-- because the app is not allowed to do it.
update profiles p
   set is_owner = true
  from auth.users u
 where u.id = p.id
   and lower(u.email) = 'hirestaff25@gmail.com'
   and not exists (select 1 from profiles where is_owner);
