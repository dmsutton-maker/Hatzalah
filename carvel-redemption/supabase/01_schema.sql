-- ============================================================
-- Carvel Coupon Redemption — schema
-- Run in the Supabase SQL editor, in order: 01 → 02 → 03 → 04
-- ============================================================

-- One row per printed coupon. Serial is the barcode payload.
create table if not exists coupons (
  serial        integer primary key,
  batch         text        not null default 'helmet-2026',
  is_test       boolean     not null default false,
  redeemed_at   timestamptz,
  redeemed_by   text,
  device_hint   text,
  created_at    timestamptz not null default now()
);

-- Which serials are live right now. Admin-editable.
create table if not exists active_ranges (
  id          bigserial primary key,
  batch       text          not null default 'helmet-2026',
  serial_min  integer       not null,
  serial_max  integer       not null,
  enabled     boolean       not null default true,
  unit_cost   numeric(6,2)  not null default 0.00,   -- what Hatzalah pays per cup
  note        text,
  created_at  timestamptz   not null default now(),
  constraint range_sane check (serial_max >= serial_min)
);

-- Register / store identities. The token appears in the QR URL.
create table if not exists stores (
  token       text primary key,
  name        text        not null,
  enabled     boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- Append-only audit trail. EVERY scan lands here, successes and failures.
-- This is the record you show Carvel if a redemption is ever disputed.
create table if not exists scan_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  serial       integer,
  raw_input    text,
  store_token  text,
  result       text not null,   -- ok | already_used | out_of_range | not_found | bad_format | test
  test_mode    boolean not null default false,
  device_hint  text
);

-- Manual reversals (misscans). Never delete from scan_log; append here.
create table if not exists unredeem_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  serial      integer     not null,
  reason      text        not null,
  actor       text
);

create index if not exists coupons_redeemed_idx  on coupons (redeemed_at);
create index if not exists coupons_batch_idx     on coupons (batch);
create index if not exists scan_log_at_idx       on scan_log (at desc);
create index if not exists scan_log_serial_idx   on scan_log (serial);
