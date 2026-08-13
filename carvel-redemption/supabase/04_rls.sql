-- ============================================================
-- Row Level Security + grants
--
-- Principle: the anonymous staff client can call exactly ONE function
-- (redeem) and can read NOTHING. No table is directly reachable by anon.
-- This is what keeps the coupon list from being enumerable by anyone who
-- opens the register URL.
-- ============================================================

alter table coupons       enable row level security;
alter table active_ranges enable row level security;
alter table stores        enable row level security;
alter table scan_log      enable row level security;
alter table unredeem_log  enable row level security;

-- No policies for anon == no rows visible. Deliberate.
-- Authenticated (David) can read everything.
drop policy if exists auth_read_coupons on coupons;
create policy auth_read_coupons on coupons
  for select to authenticated using (true);

drop policy if exists auth_all_ranges on active_ranges;
create policy auth_all_ranges on active_ranges
  for all to authenticated using (true) with check (true);

drop policy if exists auth_all_stores on stores;
create policy auth_all_stores on stores
  for all to authenticated using (true) with check (true);

drop policy if exists auth_read_log on scan_log;
create policy auth_read_log on scan_log
  for select to authenticated using (true);

drop policy if exists auth_read_unredeem on unredeem_log;
create policy auth_read_unredeem on unredeem_log
  for select to authenticated using (true);

-- Strip default table access from the public API roles.
revoke all on coupons, active_ranges, stores, scan_log, unredeem_log
  from anon, authenticated;

grant select on coupons, active_ranges, stores, scan_log, unredeem_log
  to authenticated;
grant update on active_ranges to authenticated;
grant select on v_summary, v_daily to authenticated;

-- The only thing anon may do.
revoke all on function redeem(integer, text, boolean, text) from public, anon, authenticated;
grant execute on function redeem(integer, text, boolean, text) to anon, authenticated;

-- Admin-only.
revoke all on function unredeem(integer, text, text) from public, anon, authenticated;
grant execute on function unredeem(integer, text, text) to authenticated;

-- ------------------------------------------------------------
-- Verify (expect: anon cannot select, anon CAN execute redeem)
--   set role anon;  select * from coupons;        -- 0 rows / denied
--   set role anon;  select redeem(1,'CARVEL-WLB',true);  -- returns 'test'
--   reset role;
-- ------------------------------------------------------------
