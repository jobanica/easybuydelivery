-- Easy Buy's own shop: a store the operator stocks themselves.
--
-- Every store here is already admin-owned — merchants have never had logins, and
-- the write policies on `stores` and `menu_items` allow only admin or staff. So
-- this adds no new permission; what it adds is identity. A first-party shop
-- selling shampoo and rice alongside forty-nine restaurants needs to be findable
-- as something other than a restaurant, and the app has no way to tell them
-- apart.
--
-- Nothing about the catalogue needs changing to sell non-food. A category is a
-- title and a product is a name and a price; neither has ever been food-specific.

alter table stores
  add column if not exists is_own_shop boolean not null default false;

-- At most one shop can be the operator's own — two would make "the Easy Buy
-- Shop" ambiguous everywhere it is referenced.
create unique index if not exists stores_one_own_shop
  on stores ((true)) where is_own_shop;

comment on column stores.is_own_shop is
  'True for the operator''s own shop: stocked by the operator, shown as a service in its own right rather than listed among partner restaurants.';

-- The shop is a service like any other, so the operator can take it offline
-- without deleting it. Defaults on; it stays invisible to customers until a
-- store is actually flagged.
alter table app_settings
  add column if not exists service_shop boolean not null default true;
