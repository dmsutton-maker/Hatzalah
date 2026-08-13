-- ============================================================
-- Daily tally, for the 10pm report.
--
-- Returns counts only — no serials, no timestamps, no locations, nothing that
-- identifies a coupon or a scan. That is what makes it safe to expose to anon:
-- the worst case is someone learning how many ice creams a community charity
-- has given away, which is a number David would tell you anyway.
--
-- The alternative was handing a service_role key to a scheduled job, which
-- would have full read/write on everything. This is the smaller blast radius.
--
-- "Today" is New Jersey's day, not UTC's — a 9pm redemption belongs to the day
-- the staff worked, and UTC would have already rolled over.
--
-- Run after 07_geo.sql.
-- ============================================================

create or replace function daily_stats()
returns table (
  day              date,
  redeemed_today   integer,
  overrides_today  integer,
  offsite_today    integer,
  redeemed_total   integer,
  remaining        integer,
  unit_cost        numeric,
  amount_owed      numeric
)
language sql
security definer
set search_path = public
stable
as $$
  with today as (
    select (now() at time zone 'America/New_York')::date as d
  )
  select
    (select d from today),
    (select count(*)::integer from coupons c, today t
      where not c.is_test and c.redeemed_at is not null
        and (c.redeemed_at at time zone 'America/New_York')::date = t.d),
    (select count(*)::integer from override_log o, today t
      where (o.at at time zone 'America/New_York')::date = t.d),
    (select count(*)::integer from scan_log l, today t
      where l.geo_status = 'far' and not l.test_mode
        and (l.at at time zone 'America/New_York')::date = t.d),
    (select count(*)::integer from coupons where not is_test and redeemed_at is not null),
    (select count(*)::integer from coupons where not is_test and redeemed_at is null),
    (select coalesce(max(unit_cost), 0) from active_ranges where enabled),
    (select count(*) from coupons where not is_test and redeemed_at is not null)
      * (select coalesce(max(unit_cost), 0) from active_ranges where enabled);
$$;

revoke all on function daily_stats() from public, anon, authenticated;
grant execute on function daily_stats() to anon, authenticated;

-- ------------------------------------------------------------
-- Verify
--   select * from daily_stats();
--   -- as anon, over HTTP:
--   curl -X POST "$SUPABASE_URL/rest/v1/rpc/daily_stats" \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
-- ------------------------------------------------------------
