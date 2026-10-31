-- Don't record a reset that was never possible.
--
-- log_rider_password_reset checked the caller's permission and wrote the row,
-- and only then did the Edge Function look up whether the rider had a sign-in
-- account at all. Three of the riders on this system were added without one, so
-- the common case — an operator pressing the button on a rider who has never
-- had a login — wrote an audit row for a reset that could not happen.
--
-- A log is only worth having if a row in it means what it says. Everything that
-- can be known before the write is now checked before the write, so a row means
-- the reset was permitted and attempted against a real account.

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

  -- A rider row with no profile behind it has no password to set. Said here
  -- rather than after the insert, so the refusal leaves no trace of a reset.
  if not exists (
    select 1 from riders r
     where r.id = p_rider_id and r.profile_id is not null
  ) then
    raise exception 'no sign-in account' using errcode = 'check_violation';
  end if;

  select email into v_email from auth.users where id = auth.uid();
  insert into rider_password_resets (rider_id, reset_by, reset_by_email)
  values (p_rider_id, auth.uid(), v_email);
end;
$$;

revoke all on function log_rider_password_reset(uuid) from public;
grant execute on function log_rider_password_reset(uuid) to authenticated;

comment on table rider_password_resets is
  'One row per authorised reset attempt against a real account. Written before the password is set, so nothing can be reset without leaving a trace.';
