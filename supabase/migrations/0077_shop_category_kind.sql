-- Food or non-food, for the operator's own shop.
--
-- A shop selling shampoo beside siopao asks the customer one question before
-- anything else: which kind of thing are you here for. Marking it per category
-- rather than per product is the smaller truth to maintain — "Household" is
-- non-food and everything in it follows, so stocking a new item means choosing
-- a category and nothing more.
--
-- Defaults to 'food' because every category that exists today belongs to a
-- restaurant. Nothing changes for partner stores: the split is only ever shown
-- inside the own shop.

alter table menu_categories
  add column if not exists kind text not null default 'food'
    check (kind in ('food', 'non_food'));

comment on column menu_categories.kind is
  'Which half of the own shop this category belongs to. Ignored for partner restaurants, where everything is food.';
