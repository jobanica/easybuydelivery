-- The operator hands a rider a temporary password.
--
-- Riders lose phones, forget passwords, and reinstall the app on a borrowed
-- handset mid-shift. Until now the only way back in was the reset email, which
-- assumes a rider reads an inbox — a poor assumption for a job done on a
-- motorbike with a prepaid SIM. So the operator can set a temporary one and
-- read it out over the phone.
--
-- What this cannot do, and must not be made to do, is show an existing
-- password. Supabase stores a bcrypt hash; the original is not in the database
-- to be shown. Keeping a readable copy alongside it would hand every admin —
-- and anyone who ever reads a backup — a credential most riders also use for
-- their email and their GCash. A reset answers the real question ("my rider
-- cannot get in") without that.
--
-- Setting someone's password is the power to *become* them: accept orders,
-- mark deliveries, move money. So every reset is written down. Nothing here
-- prevents a dishonest staff member — a record of who did it, and when, is
-- what makes it answerable afterwards, which is the most a log can do.

create table if not exists rider_password_resets (
  id          uuid primary key default gen_random_uuid(),
  rider_id    uuid not null references riders (id) on delete cascade,
  -- Who did it. Kept even if they later leave, which is exactly when a reset
  -- is most worth being able to trace.
  reset_by    uuid references profiles (id) on delete set null,
  reset_by_email text,
  created_at  timestamptz not null default now()
);

create index if not exists rider_password_resets_rider_idx
  on rider_password_resets (rider_id, created_at desc);
create index if not exists rider_password_resets_by_idx
  on rider_password_resets (reset_by, created_at desc);

alter table rider_password_resets enable row level security;

-- Readable by whoever can open the Riders section, because the point of the
-- record is that the next person to look can see it.
drop policy if exists rider_password_resets_staff_read on rider_password_resets;
create policy rider_password_resets_staff_read on rider_password_resets
  for select using (staff_can('ridersActive'));

/**
 * Record a reset. Called by the Edge Function that actually sets the password,
 * which is the only thing holding the service role.
 *
 * Definer so the caller's own session can write the row without being granted
 * insert on the table, and gated on the same permission as the page the button
 * lives on — a staff member who cannot see riders cannot reset one.
 */
create or replace function log_rider_password_reset(p_rider_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if staff_can('ridersActive') is not true then
    raise exception 'not allowed';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into rider_password_resets (rider_id, reset_by, reset_by_email)
  values (p_rider_id, auth.uid(), v_email);
end;
$$;

revoke all on function log_rider_password_reset(uuid) from public;
grant execute on function log_rider_password_reset(uuid) to authenticated;

/**
 * The riders a staff member may reset, with the address each signs in with and
 * when their password was last changed for them.
 *
 * The email is the half of the credential that *is* showable, and it is the
 * thing an operator needs: they are about to tell someone "sign in as this,
 * with that". It lives in auth.users, which no ordinary session may read.
 */
create or replace function rider_login_details(p_rider_id uuid)
returns table (
  rider_id      uuid,
  email         text,
  last_reset_at timestamptz,
  last_reset_by text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         u.email::text,
         l.created_at,
         l.reset_by_email
    from riders r
    left join auth.users u on u.id = r.profile_id
    left join lateral (
      select created_at, reset_by_email
        from rider_password_resets
       where rider_id = r.id
       order by created_at desc
       limit 1
    ) l on true
   where staff_can('ridersActive')
     and (p_rider_id is null or r.id = p_rider_id);
$$;

revoke all on function rider_login_details(uuid) from public;
grant execute on function rider_login_details(uuid) to authenticated;
