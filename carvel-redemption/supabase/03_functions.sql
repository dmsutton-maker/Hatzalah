-- ============================================================
-- Redemption RPC + admin reporting views
-- ============================================================

-- The whole hot path. Called by anon staff clients; nothing else is exposed.
--
-- Concurrency note: the claim is a single
--     UPDATE ... WHERE serial = ? AND redeemed_at IS NULL
-- If two registers scan the same coupon at the same instant, exactly one
-- UPDATE matches a row. The loser matches zero rows and reports already_used.
-- Do NOT refactor this into SELECT-then-UPDATE; that reintroduces the race.

create or replace function redeem(
  p_serial  integer,
  p_store   text,
  p_test    boolean default false,
  p_device  text    default null
)
returns table (result text, redeemed_at timestamptz, serial integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       coupons%rowtype;
  v_in_range  boolean;
  v_store_ok  boolean;
begin
  -- unknown or disabled register
  select exists (select 1 from stores s where s.token = p_store and s.enabled)
    into v_store_ok;
  if not v_store_ok then
    insert into scan_log(serial, store_token, result, test_mode, device_hint)
      values (p_serial, p_store, 'bad_format', p_test, p_device);
    return query select 'bad_format'::text, null::timestamptz, p_serial;
    return;
  end if;

  -- TEST MODE: validate and report, but never mutate coupons.
  if p_test then
    insert into scan_log(serial, store_token, result, test_mode, device_hint)
      values (p_serial, p_store, 'test', true, p_device);
    return query select 'test'::text, null::timestamptz, p_serial;
    return;
  end if;

  select exists (
    select 1 from active_ranges r
    where r.enabled and p_serial between r.serial_min and r.serial_max
  ) into v_in_range;

  if not v_in_range then
    insert into scan_log(serial, store_token, result, test_mode, device_hint)
      values (p_serial, p_store, 'out_of_range', false, p_device);
    return query select 'out_of_range'::text, null::timestamptz, p_serial;
    return;
  end if;

  -- atomic claim
  update coupons c
     set redeemed_at = now(),
         redeemed_by = p_store,
         device_hint = p_device
   where c.serial = p_serial
     and c.redeemed_at is null
  returning c.* into v_row;

  if found then
    insert into scan_log(serial, store_token, result, test_mode, device_hint)
      values (p_serial, p_store, 'ok', false, p_device);
    return query select 'ok'::text, v_row.redeemed_at, p_serial;
    return;
  end if;

  select * into v_row from coupons c where c.serial = p_serial;

  if not found then
    insert into scan_log(serial, store_token, result, test_mode, device_hint)
      values (p_serial, p_store, 'not_found', false, p_device);
    return query select 'not_found'::text, null::timestamptz, p_serial;
    return;
  end if;

  insert into scan_log(serial, store_token, result, test_mode, device_hint)
    values (p_serial, p_store, 'already_used', false, p_device);
  return query select 'already_used'::text, v_row.redeemed_at, p_serial;
end $$;


-- Admin: reverse a misscan. Authenticated only (see 04_rls.sql).
create or replace function unredeem(p_serial integer, p_reason text, p_actor text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update coupons set redeemed_at = null, redeemed_by = null
   where serial = p_serial and redeemed_at is not null;
  if not found then return false; end if;
  insert into unredeem_log(serial, reason, actor) values (p_serial, p_reason, p_actor);
  return true;
end $$;


-- Admin dashboard cards, in one query.
create or replace view v_summary as
select
  (select count(*) from coupons where not is_test)                        as issued,
  (select count(*) from coupons where not is_test
      and redeemed_at is not null)                                        as redeemed,
  (select count(*) from coupons where not is_test
      and redeemed_at is null)                                            as remaining,
  (select coalesce(max(unit_cost),0) from active_ranges where enabled)    as unit_cost,
  (select count(*) from coupons where not is_test and redeemed_at is not null)
    * (select coalesce(max(unit_cost),0) from active_ranges where enabled) as amount_owed;

-- Redemptions per day, for the chart.
create or replace view v_daily as
select date_trunc('day', redeemed_at)::date as day, count(*) as redeemed
from coupons
where redeemed_at is not null and not is_test
group by 1 order by 1;
