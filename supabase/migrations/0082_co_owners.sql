-- A business can have more than one owner.
--
-- 0079 assumed exactly one, because at the time there was exactly one and the
-- point was to put somebody above the admins. But ownership is a role in a
-- business, not a seat, and a business with two people running it needs both of
-- them able to hire — otherwise the second one is an admin with a title.
--
-- What does not change is that owners are peers, not superiors: an owner's row
-- is still theirs alone, so no owner can demote, rename, or strip another. That
-- rule already lives in guard_profile_role() and needs nothing here.

drop index if exists profiles_one_owner;

-- Still worth an index — is_owner() reads it on every staff write.
create index if not exists profiles_owner_idx on profiles (is_owner) where is_owner;

comment on column profiles.is_owner is
  'An operator who owns the business. Owners are peers: each can hire and set access, none can touch another. Unsettable from the app — it moves only by direct database access.';

update profiles p
   set is_owner = true
  from auth.users u
 where u.id = p.id
   and lower(u.email) = 'ngasparillo@gmail.com'
   and not p.is_owner;

-- The staff list, with the address each person actually signs in with.
--
-- The console has been listing staff straight from `profiles`, which holds no
-- email — so anyone whose display name was never set showed as the first eight
-- characters of their uuid. "fc63064b" is not a person. The email is the thing
-- an operator recognises and the thing they'd type to invite someone, and it
-- lives in auth.users, which the anon role cannot read. Hence a definer
-- function, gated on the same permission as the page itself.
create or replace function list_staff()
returns table (
  id          uuid,
  email       text,
  full_name   text,
  role        text,
  is_owner    boolean,
  permissions text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, u.email::text, p.full_name, p.role::text, p.is_owner, p.permissions
    from profiles p
    join auth.users u on u.id = p.id
   where staff_can('staff')
     and (p.role::text in ('admin', 'manager', 'dispatcher', 'support') or p.is_owner)
   order by p.is_owner desc, u.email;
$$;

revoke all on function list_staff() from public;
grant execute on function list_staff() to authenticated;
