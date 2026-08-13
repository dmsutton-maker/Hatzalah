-- ============================================================
-- Seed data
-- ============================================================

-- Real coupons: serials 1..500, matching the printed batch.
insert into coupons (serial, batch, is_test)
select g, 'helmet-2026', false
from generate_series(1, 500) g
on conflict (serial) do nothing;

-- Demo coupons: 900001..900010. Deliberately OUTSIDE the active range,
-- so in live mode they return NOT VALID and cannot cost anyone an ice cream.
-- Serial 900001 is the SAMPLE coupon printed on the register sign.
insert into coupons (serial, batch, is_test)
select g, 'demo', true
from generate_series(900001, 900010) g
on conflict (serial) do nothing;

-- The live range. unit_cost is what Hatzalah reimburses Carvel per Kiddie Cup.
-- >>> SET unit_cost TO THE REAL NEGOTIATED PRICE BEFORE LAUNCH <<<
insert into active_ranges (batch, serial_min, serial_max, enabled, unit_cost, note)
values ('helmet-2026', 1, 500, true, 0.00, 'Helmet Safety Reward, expires 2026-12-31')
on conflict do nothing;

-- The register. Token appears in the URL: /s/CARVEL-WLB
insert into stores (token, name, enabled)
values ('CARVEL-WLB', 'Carvel — 175 Monmouth Rd, West Long Branch NJ', true)
on conflict (token) do nothing;
