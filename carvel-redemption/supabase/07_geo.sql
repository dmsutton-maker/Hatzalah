-- ============================================================
-- Location tagging — is the scan happening AT the Carvel?
--
-- Every scan now records where the phone was, and the server measures that
-- against the register's own coordinates. This catches the failure mode the
-- serial numbers cannot: someone walking off with the register URL and burning
-- coupons from their couch.
--
-- >>> DEFAULT BEHAVIOUR IS RECORD-AND-FLAG, NOT BLOCK. <<<
-- Enforcement is per-register and OFF by default (stores.enforce_geofence).
-- Reason: GPS indoors, beside a metal ice cream machine, is routinely 100m+ off,
-- and a staffer who declines the location prompt would otherwise be unable to
-- serve anyone. A false "wrong location" costs a kid their ice cream in person;
-- a flagged row costs David ten seconds in the admin log. Flip enforcement on
-- once you have seen real accuracy figures in the log.
--
-- This file SUPERSEDES the redeem() and redeem_override() bodies in 03 and 05 —
-- same logic, plus the geo parameters. Run the files in order and 07 wins.
-- ============================================================

alter table stores
  add column if not exists lat               double precision,
  add column if not exists lon               double precision,
  add column if not exists geofence_radius_m integer not null default 400,
  add column if not exists enforce_geofence  boolean not null default false;

alter table scan_log
  add column if not exists lat         double precision,
  add column if not exists lon         double precision,
  add column if not exists accuracy_m  double precision,
  add column if not exists distance_m  double precision,
  -- ok | far | no_fix | unset
  add column if not exists geo_status  text;

create index if not exists scan_log_geo_idx on scan_log (geo_status);

-- Carvel, 175 Monmouth Rd, West Long Branch NJ 07764.
-- Geocoded from OpenStreetMap/Nominatim, so treat it as approximate — a rooftop
-- geocode can sit tens of metres off. The admin settings screen has a
-- "use my current location" button: stand at the register once and press it.
update stores
   set lat = 40.294485,
       lon = -74.028126
 where token = 'CARVEL-WLB' and lat is null;


-- Great-circle metres. No PostGIS dependency — at these distances the spherical
-- approximation is accurate to well under a metre.
create or replace function geo_distance_m(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
) returns double precision
language sql immutable parallel safe as $$
  select case
    when lat1 is null or lon1 is null or lat2 is null or lon2 is null then null
    else 2 * 6371000 * asin(least(1, sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
      + cos(radians(lat1)) * cos(radians(lat2))
        * power(sin(radians(lon2 - lon1) / 2), 2)
    )))
  end;
$$;


-- Classify one fix against one register.
-- 'far' requires the phone to be outside the radius by MORE than its own reported
-- accuracy. A 300m-accurate fix 350m away is not evidence of anything.
create or replace function geo_classify(
  p_store text,
  p_lat   double precision,
  p_lon   double precision,
  p_acc   double precision
) returns table (status text, distance_m double precision)
language sql stable parallel safe
set search_path = public as $$
  select
    case
      when s.lat is null or s.lon is null then 'unset'
      when p_lat is null or p_lon is null then 'no_fix'
      when geo_distance_m(s.lat, s.lon, p_lat, p_lon) - coalesce(p_acc, 0)
           > s.geofence_radius_m then 'far'
      else 'ok'
    end,
    geo_distance_m(s.lat, s.lon, p_lat, p_lon)
  from stores s
  where s.token = p_store;
$$;


-- ------------------------------------------------------------
-- redeem() — the hot path, now geo-aware.
--
-- The atomic claim is UNCHANGED and must stay that way:
--     UPDATE ... WHERE serial = ? AND redeemed_at IS NULL
-- Two registers scanning the same coupon in the same instant: exactly one
-- UPDATE matches a row. Never refactor this into SELECT-then-UPDATE.
-- ------------------------------------------------------------
drop function if exists redeem(integer, text, boolean, text);
drop function if exists redeem(integer, text, boolean, text, double precision, double precision, double precision);

create function redeem(
  p_serial  integer,
  p_store   text,
  p_test    boolean default false,
  p_device  text    default null,
  p_lat     double precision default null,
  p_lon     double precision default null,
  p_acc     double precision default null
)
returns table (
  result      text,
  redeemed_at timestamptz,
  serial      integer,
  geo_status  text,
  distance_m  double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       coupons%rowtype;
  v_in_range  boolean;
  v_store_ok  boolean;
  v_geo       text;
  v_dist      double precision;
begin
  select exists (select 1 from stores s where s.token = p_store and s.enabled)
    into v_store_ok;

  if not v_store_ok then
    insert into scan_log(serial, store_token, result, test_mode, device_hint,
                         lat, lon, accuracy_m, distance_m, geo_status)
      values (p_serial, p_store, 'bad_format', p_test, p_device,
              p_lat, p_lon, p_acc, null, 'unset');
    return query select 'bad_format'::text, null::timestamptz, p_serial,
                        'unset'::text, null::double precision;
    return;
  end if;

  select g.status, g.distance_m into v_geo, v_dist
  from geo_classify(p_store, p_lat, p_lon, p_acc) g;

  -- TEST MODE: validate and report, but never mutate coupons.
  if p_test then
    insert into scan_log(serial, store_token, result, test_mode, device_hint,
                         lat, lon, accuracy_m, distance_m, geo_status)
      values (p_serial, p_store, 'test', true, p_device,
              p_lat, p_lon, p_acc, v_dist, v_geo);
    return query select 'test'::text, null::timestamptz, p_serial, v_geo, v_dist;
    return;
  end if;

  -- Off-site and this register enforces. Nothing is claimed.
  if v_geo = 'far' and exists (
    select 1 from stores s where s.token = p_store and s.enforce_geofence
  ) then
    insert into scan_log(serial, store_token, result, test_mode, device_hint,
                         lat, lon, accuracy_m, distance_m, geo_status)
      values (p_serial, p_store, 'wrong_location', false, p_device,
              p_lat, p_lon, p_acc, v_dist, v_geo);
    return query select 'wrong_location'::text, null::timestamptz, p_serial, v_geo, v_dist;
    return;
  end if;

  select exists (
    select 1 from active_ranges r
    where r.enabled and p_serial between r.serial_min and r.serial_max
  ) into v_in_range;

  if not v_in_range then
    insert into scan_log(serial, store_token, result, test_mode, device_hint,
                         lat, lon, accuracy_m, distance_m, geo_status)
      values (p_serial, p_store, 'out_of_range', false, p_device,
              p_lat, p_lon, p_acc, v_dist, v_geo);
    return query select 'out_of_range'::text, null::timestamptz, p_serial, v_geo, v_dist;
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
    insert into scan_log(serial, store_token, result, test_mode, device_hint,
                         lat, lon, accuracy_m, distance_m, geo_status)
      values (p_serial, p_store, 'ok', false, p_device,
              p_lat, p_lon, p_acc, v_dist, v_geo);
    return query select 'ok'::text, v_row.redeemed_at, p_serial, v_geo, v_dist;
    return;
  end if;

  select * into v_row from coupons c where c.serial = p_serial;

  if not found then
    insert into scan_log(serial, store_token, result, test_mode, device_hint,
                         lat, lon, accuracy_m, distance_m, geo_status)
      values (p_serial, p_store, 'not_found', false, p_device,
              p_lat, p_lon, p_acc, v_dist, v_geo);
    return query select 'not_found'::text, null::timestamptz, p_serial, v_geo, v_dist;
    return;
  end if;

  insert into scan_log(serial, store_token, result, test_mode, device_hint,
                       lat, lon, accuracy_m, distance_m, geo_status)
    values (p_serial, p_store, 'already_used', false, p_device,
            p_lat, p_lon, p_acc, v_dist, v_geo);
  return query select 'already_used'::text, v_row.redeemed_at, p_serial, v_geo, v_dist;
end $$;


-- ------------------------------------------------------------
-- redeem_override() — same, geo-aware. The allotment cap is unchanged: it still
-- claims one real coupon row, so scans and overrides draw from the same 500.
-- ------------------------------------------------------------
drop function if exists redeem_override(text, text, boolean, text);
drop function if exists redeem_override(text, text, boolean, text, double precision, double precision, double precision);

create function redeem_override(
  p_store   text,
  p_reason  text,
  p_test    boolean default false,
  p_device  text    default null,
  p_lat     double precision default null,
  p_lon     double precision default null,
  p_acc     double precision default null
)
returns table (
  result     text,
  serial     integer,
  remaining  integer,
  geo_status text,
  distance_m double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_serial     integer;
  v_store_ok   boolean;
  v_remaining  integer;
  v_geo        text;
  v_dist       double precision;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    return query select 'bad_format'::text, null::integer, null::integer,
                        'unset'::text, null::double precision;
    return;
  end if;

  select exists (select 1 from stores s where s.token = p_store and s.enabled)
    into v_store_ok;
  if not v_store_ok then
    insert into scan_log(serial, raw_input, store_token, result, test_mode, device_hint,
                         lat, lon, accuracy_m, geo_status)
      values (null, 'override', p_store, 'bad_format', p_test, p_device,
              p_lat, p_lon, p_acc, 'unset');
    return query select 'bad_format'::text, null::integer, null::integer,
                        'unset'::text, null::double precision;
    return;
  end if;

  select g.status, g.distance_m into v_geo, v_dist
  from geo_classify(p_store, p_lat, p_lon, p_acc) g;

  select count(*) into v_remaining
  from coupons c
  where c.redeemed_at is null
    and not c.is_test
    and exists (
      select 1 from active_ranges r
      where r.enabled and c.serial between r.serial_min and r.serial_max
    );

  if p_test then
    insert into scan_log(serial, raw_input, store_token, result, test_mode, device_hint,
                         lat, lon, accuracy_m, distance_m, geo_status)
      values (null, 'override: ' || p_reason, p_store, 'test', true, p_device,
              p_lat, p_lon, p_acc, v_dist, v_geo);
    return query select 'test'::text, null::integer, v_remaining, v_geo, v_dist;
    return;
  end if;

  if v_geo = 'far' and exists (
    select 1 from stores s where s.token = p_store and s.enforce_geofence
  ) then
    insert into scan_log(serial, raw_input, store_token, result, test_mode, device_hint,
                         lat, lon, accuracy_m, distance_m, geo_status)
      values (null, 'override: ' || p_reason, p_store, 'wrong_location', false, p_device,
              p_lat, p_lon, p_acc, v_dist, v_geo);
    return query select 'wrong_location'::text, null::integer, v_remaining, v_geo, v_dist;
    return;
  end if;

  update coupons c
     set redeemed_at = now(),
         redeemed_by = p_store,
         device_hint = p_device
   where c.serial = (
     select c2.serial
     from coupons c2
     where c2.redeemed_at is null
       and not c2.is_test
       and exists (
         select 1 from active_ranges r
         where r.enabled and c2.serial between r.serial_min and r.serial_max
       )
     order by c2.serial desc
     limit 1
     for update skip locked
   )
  returning c.serial into v_serial;

  if v_serial is null then
    insert into scan_log(serial, raw_input, store_token, result, test_mode, device_hint,
                         lat, lon, accuracy_m, distance_m, geo_status)
      values (null, 'override: ' || p_reason, p_store, 'exhausted', false, p_device,
              p_lat, p_lon, p_acc, v_dist, v_geo);
    return query select 'exhausted'::text, null::integer, 0, v_geo, v_dist;
    return;
  end if;

  insert into override_log(serial, reason, store_token, device_hint)
    values (v_serial, p_reason, p_store, p_device);

  insert into scan_log(serial, raw_input, store_token, result, test_mode, device_hint,
                       lat, lon, accuracy_m, distance_m, geo_status)
    values (v_serial, 'override: ' || p_reason, p_store, 'override', false, p_device,
            p_lat, p_lon, p_acc, v_dist, v_geo);

  return query select 'override'::text, v_serial, greatest(v_remaining - 1, 0), v_geo, v_dist;
end $$;


-- Grants have to be reapplied: the old functions were dropped, and their grants
-- went with them.
revoke all on function redeem(integer, text, boolean, text,
                              double precision, double precision, double precision)
  from public, anon, authenticated;
grant execute on function redeem(integer, text, boolean, text,
                                 double precision, double precision, double precision)
  to anon, authenticated;

revoke all on function redeem_override(text, text, boolean, text,
                                       double precision, double precision, double precision)
  from public, anon, authenticated;
grant execute on function redeem_override(text, text, boolean, text,
                                          double precision, double precision, double precision)
  to anon, authenticated;

-- Off-site scans, for the admin dashboard.
create or replace view v_offsite as
select l.id, l.at, l.serial, l.store_token, l.result,
       l.distance_m, l.accuracy_m, l.lat, l.lon
from scan_log l
where l.geo_status = 'far'
  and not l.test_mode
order by l.at desc;

grant select on v_offsite to authenticated;


-- ------------------------------------------------------------
-- Verify
--   -- at the store: 'ok'
--   select * from redeem(2,'CARVEL-WLB',true, null, 40.294485, -74.028126, 20);
--
--   -- across the river in Manhattan: 'far' (but still 'test', not blocked)
--   select * from redeem(2,'CARVEL-WLB',true, null, 40.7580, -73.9855, 20);
--
--   -- no location shared: 'no_fix', never blocked
--   select * from redeem(2,'CARVEL-WLB',true);
--
--   -- turn blocking on for this register, then a far scan returns wrong_location:
--   update stores set enforce_geofence = true where token = 'CARVEL-WLB';
-- ------------------------------------------------------------
