-- ============================================================
-- Manual override — "the coupon is real but neither the barcode nor the
-- number can be read"
--
-- Staff hold a coupon that is torn, soaked, or printed badly. Refusing it in
-- front of a kid who earned it is the wrong answer; so is letting the register
-- hand out unlimited ice cream.
--
-- The rule that makes this safe: an override CLAIMS A REAL COUPON ROW. It does
-- not create a redemption out of nothing. There are exactly 500 rows, so no
-- combination of scans and overrides can ever exceed the printed allotment —
-- the cap is structural, not a counter someone can get wrong.
--
-- Run after 04_rls.sql.
-- ============================================================

-- Why each override happened. scan_log records that it happened; this records
-- the reason and pairs it to the serial that was consumed.
create table if not exists override_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  serial       integer     not null,
  reason       text        not null,
  store_token  text,
  device_hint  text
);

create index if not exists override_log_at_idx on override_log (at desc);

alter table override_log enable row level security;

drop policy if exists auth_read_override on override_log;
create policy auth_read_override on override_log
  for select to authenticated using (true);

revoke all on override_log from anon, authenticated;
grant select on override_log to authenticated;


-- Claim the highest-numbered unredeemed coupon in the active range.
--
-- Highest-numbered on purpose: coupons are handed out from the low end, so
-- consuming from the top keeps override-consumed serials clear of the ones
-- still circulating, and a kid who later walks in with the paper 000500 is a
-- visible, investigable collision rather than a silent one.
--
-- Concurrency: the claim is a single UPDATE whose target is picked by a
-- FOR UPDATE SKIP LOCKED subquery. Two registers overriding at the same instant
-- take two different serials; neither blocks, and neither double-claims.
create or replace function redeem_override(
  p_store   text,
  p_reason  text,
  p_test    boolean default false,
  p_device  text    default null
)
returns table (result text, serial integer, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_serial     integer;
  v_store_ok   boolean;
  v_remaining  integer;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    return query select 'bad_format'::text, null::integer, null::integer;
    return;
  end if;

  select exists (select 1 from stores s where s.token = p_store and s.enabled)
    into v_store_ok;
  if not v_store_ok then
    insert into scan_log(serial, raw_input, store_token, result, test_mode, device_hint)
      values (null, 'override', p_store, 'bad_format', p_test, p_device);
    return query select 'bad_format'::text, null::integer, null::integer;
    return;
  end if;

  select count(*) into v_remaining
  from coupons c
  where c.redeemed_at is null
    and not c.is_test
    and exists (
      select 1 from active_ranges r
      where r.enabled and c.serial between r.serial_min and r.serial_max
    );

  -- TEST MODE: prove the whole path without consuming a coupon.
  if p_test then
    insert into scan_log(serial, raw_input, store_token, result, test_mode, device_hint)
      values (null, 'override: ' || p_reason, p_store, 'test', true, p_device);
    return query select 'test'::text, null::integer, v_remaining;
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

  -- Every coupon in the active range is already spoken for. Fail closed: the
  -- allotment is the allotment.
  if v_serial is null then
    insert into scan_log(serial, raw_input, store_token, result, test_mode, device_hint)
      values (null, 'override: ' || p_reason, p_store, 'exhausted', false, p_device);
    return query select 'exhausted'::text, null::integer, 0;
    return;
  end if;

  insert into override_log(serial, reason, store_token, device_hint)
    values (v_serial, p_reason, p_store, p_device);

  -- Logged as 'override', not 'ok', so the audit trail shown to Carvel
  -- distinguishes a scanned coupon from a staff judgement call.
  insert into scan_log(serial, raw_input, store_token, result, test_mode, device_hint)
    values (v_serial, 'override: ' || p_reason, p_store, 'override', false, p_device);

  return query select 'override'::text, v_serial, greatest(v_remaining - 1, 0);
end $$;


revoke all on function redeem_override(text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function redeem_override(text, text, boolean, text)
  to anon, authenticated;


-- ------------------------------------------------------------
-- Verify
--   -- test mode consumes nothing:
--   select * from redeem_override('CARVEL-WLB', 'barcode torn', true);
--   select count(*) from coupons where redeemed_at is not null;  -- unchanged
--
--   -- live override claims exactly one, from the top of the range:
--   select * from redeem_override('CARVEL-WLB', 'barcode torn');
--
--   -- the cap holds. After every coupon is claimed, this returns 'exhausted'
--   -- and redeemed can never exceed the printed count:
--   select count(*) from coupons where not is_test and redeemed_at is not null;
-- ------------------------------------------------------------
