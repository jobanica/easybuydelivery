-- Departments above the shelves.
--
-- The shop's categories have been one flat row: Purefoods, Mekeni, Pampanga's
-- Best, CDO, Panalo. Those are brands, and brands are a fine way to find a
-- hotdog — but they are all the same department. A customer after raw pork or a
-- tin of milk has nowhere to look, and adding those as more tiles in the same
-- row would put a department name beside five brand names and call them peers.
--
-- So a category may now sit under another. Two levels, not more: a department
-- you walk to, and a shelf you take something off. A third would be a filing
-- system rather than a shop.
--
-- Everything that has no parent keeps behaving exactly as it did, which is what
-- every restaurant menu in the system relies on.

alter table menu_categories
  add column if not exists parent_id uuid references menu_categories (id) on delete set null;

create index if not exists menu_categories_parent_idx on menu_categories (parent_id);

comment on column menu_categories.parent_id is
  'The department this shelf sits in. NULL = a department (or a plain restaurant menu section).';

-- Two levels. A shelf cannot become a department, and nothing can be its own
-- parent — either would make the shop a maze rather than a shop.
create or replace function guard_category_depth()
returns trigger language plpgsql as $$
begin
  if new.parent_id is null then return new; end if;

  if new.parent_id = new.id then
    raise exception 'A category cannot sit inside itself.';
  end if;

  if exists (select 1 from menu_categories where id = new.parent_id and parent_id is not null) then
    raise exception 'Categories go two levels deep: a department, and the shelves in it.';
  end if;

  if exists (select 1 from menu_categories where parent_id = new.id) then
    raise exception 'This category already has shelves in it, so it cannot be moved inside another.';
  end if;

  -- Food or non-food is the department's answer; the shelves in it inherit,
  -- because a shelf that disagreed with its department would be unreachable.
  select kind into new.kind from menu_categories where id = new.parent_id;

  -- A shelf belongs to the same store as its department.
  if exists (
    select 1 from menu_categories p
     where p.id = new.parent_id and p.store_id <> new.store_id
  ) then
    raise exception 'A shelf must belong to the same store as its department.';
  end if;

  return new;
end;
$$;

drop trigger if exists menu_categories_depth_guard on menu_categories;
create trigger menu_categories_depth_guard
  before insert or update on menu_categories
  for each row execute function guard_category_depth();

-- Moving a department between Food and Non-food takes its shelves with it.
create or replace function cascade_category_kind()
returns trigger language plpgsql as $$
begin
  if new.parent_id is null and new.kind is distinct from old.kind then
    update menu_categories set kind = new.kind
     where parent_id = new.id and kind is distinct from new.kind;
  end if;
  return null;
end;
$$;

drop trigger if exists menu_categories_kind_cascade on menu_categories;
create trigger menu_categories_kind_cascade
  after update on menu_categories
  for each row execute function cascade_category_kind();

-- The own shop's three food departments, and the brands filed under one of
-- them. Frozen Raw Meat and Grocery start empty on purpose — they are shelves
-- waiting for stock, not a guess at what goes on them.
--
-- Every existing food category goes into Meat Products rather than a chosen
-- few, because leaving some at the top level would stand a brand name beside a
-- department name and call them peers, which is the arrangement this migration
-- exists to end. Anything that belongs in Grocery instead is one dropdown away
-- in the admin console; guessing at it here would be worse than asking.
do $$
declare
  v_store uuid;
  v_meat  uuid;
  v_next  int;
begin
  select id into v_store from stores where is_own_shop limit 1;
  if v_store is null then return; end if;

  select coalesce(max(sort_order), 0) + 1 into v_next
    from menu_categories where store_id = v_store;

  insert into menu_categories (store_id, title, kind, sort_order)
  select v_store, t.title, 'food', v_next + t.ord
    from (values ('Meat Products', 0), ('Frozen Raw Meat', 1), ('Grocery', 2)) as t(title, ord)
   where not exists (
     select 1 from menu_categories c
      where c.store_id = v_store and lower(c.title) = lower(t.title)
   );

  select id into v_meat
    from menu_categories
   where store_id = v_store and lower(title) = 'meat products'
   limit 1;

  update menu_categories
     set parent_id = v_meat
   where store_id = v_store
     and parent_id is null
     and kind = 'food'
     and lower(title) not in ('meat products', 'frozen raw meat', 'grocery');
end $$;
