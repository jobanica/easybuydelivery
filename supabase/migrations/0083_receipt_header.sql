-- What the top and bottom of a printed receipt say.
--
-- A receipt with no address and no phone number is a slip of paper, not a
-- record: the whole point of handing one over is that the customer can come
-- back and find you. None of this belongs in code — it changes when the shop
-- moves or changes its number, and that should not need a deploy.
--
-- All three are optional. Empty means the line is simply left off the paper
-- rather than printed blank, because a thermal roll is narrow and every line
-- costs paper.

alter table app_settings
  add column if not exists receipt_address text,
  add column if not exists receipt_contact text,
  add column if not exists receipt_footer  text;

comment on column app_settings.receipt_address is
  'Shop address printed under the name on a receipt. Null leaves the line off.';
comment on column app_settings.receipt_contact is
  'Phone number printed on a receipt, so a customer can come back to you.';
comment on column app_settings.receipt_footer is
  'The line under the total — thanks, a returns policy, whatever the shop wants.';
