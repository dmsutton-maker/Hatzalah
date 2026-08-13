# Design notes

Background on decisions already made, so they don't get silently undone.

---

## Printed coupon

**Size 4.1667 × 3.0833 in, 18 per 13 × 19 sheet.** Chosen because 12.5 / 3 and 18.5 / 6
land on exact thirds and sixths of the printable area with clean 0.25 in margins. 500
coupons = 28 sheets; the last holds 14.

An earlier 50-up version (2.5 × 1.85 in) was rejected: at that scale the legal fine print
computed to **2.7 pt**, which no printer holds. The current size puts it at 6.5 pt.

**Layout values live in a 180 pt-wide coordinate space** (`layout50.json`) and are scaled
linearly at render time. Changing `COLS`/`ROWS` in `gen_grid.py` rescales type, rules,
logo and barcode together — no re-tuning.

**Barcode: Code 128-C, 6 digits, no check suffix.** 68 modules plus 10-module quiet zones.
At the current width that's **24 mil narrow bars**, well above the ~10 mil practical floor.
Decoding verified with zbar at 150 / 200 / 300 / 600 dpi.

**Typography is Playfair Display**, not the original artwork's face — it was reconstructed
by measuring the source image and auto-fitting sizes to within a few pixels. Two spots
differ slightly from the original: the "1" in "1 FREE" is a touch narrower, and CARVEL is
set in Playfair rather than Carvel's real logotype.

**The shield** is a 600 dpi raster of `jersey_shore_hatzalah_new_logo_light_colors.pdf`,
which is true vector artwork. In the coupon it lands around 740 dpi. For anything larger
than a coupon, go back to that source PDF rather than pulling the image out of these files.

**Vertical centring in the "Helmet Safety Reward" pill** needed an explicit offset.
CSS `vertical-align: middle` aligns to the parent's baseline plus half its x-height, not
to the box centre — with all-caps text that pushes content visibly low. `pill_ty` corrects
it; the value was converged by measuring rendered ink.

---

## Redemption system

**Redemption is one atomic UPDATE.** `UPDATE coupons SET redeemed_at = now() WHERE serial
= ? AND redeemed_at IS NULL`. Two registers scanning the same coupon simultaneously: one
UPDATE matches, the other matches zero rows and reports `already_used`. A SELECT-then-
UPDATE would have a race window in which both scans succeed. Do not refactor it.

**Anon has zero table access.** The staff page ships a public anon key, which is only safe
because RLS leaves anon with exactly one executable function and no readable tables.
Loosening RLS breaks this.

**Failing closed when offline.** No optimistic approval, no queued-for-later sync. A queued
redemption that turns out to be a duplicate has already given away the ice cream — the
error is unrecoverable in the physical world, so the software refuses rather than guesses.

**Two separate test mechanisms.** `?test=1` validates without writing (for demos), and
test serials 900001–900010 sit outside the active range so they read NOT VALID in live
mode. The SAMPLE coupon on the register sign carries 900001, which makes an accidental
scan of the sign harmless and a deliberate one a live demo of the rejection path.

**Plain serials, knowingly.** No signature in the barcode; the system prevents reuse, not
forgery. Acceptable given staff collect the physical coupon and the 500 are already
printed. Upgrade path — an HMAC suffix on a reprint — is in `BUILD_BRIEF.md` §8. Write the
serial parser to tolerate an optional `-XXXX` suffix now so that upgrade doesn't require
touching the scanner.

---

## Content

- Expiry **12/31/2026** on every coupon.
- Attribution line: **"Compliments of Jersey Shore Hatzalah"**, matching the shield.
- Store: Carvel, 175 Monmouth Rd, West Long Branch, NJ 07764.
- Fine print: one Kiddie Cup, topping extra, no cash value, no reproduction, one per child.

---

## Override and location (added after the original brief)

**An override claims a row, it does not increment a counter.** `redeem_override()`
takes one real unclaimed coupon from the top of the active range with `FOR UPDATE SKIP
LOCKED`. Because there are exactly 500 rows, no sequence of scans and overrides can
produce a 501st redemption — the cap is a property of the data, not of the code around
it. Do not replace this with a count-and-compare.

**Overrides log as `override`, not `ok`.** `scan_log` is the evidence shown to Carvel;
a machine-read barcode and a staff judgement call are different kinds of evidence.
Consequence: the redeemed count reconciles against `result in ('ok','override')`.

**Location flags, it does not block — by default.** Indoor GPS is routinely 100m+ out
and a declined permission prompt yields no fix at all. A false refusal costs a child
their ice cream in person; a false flag costs ten seconds in the admin log. Enforcement
is per-register and off until real accuracy figures justify it. The `far` test also
subtracts the fix's own reported accuracy before deciding.

**Acquiring a fix never gates a scan.** The page watches location from load and each
scan sends whatever is in hand. Waiting on a GPS lock at a register with a line is not
an option, so `no_fix` is a normal, non-blocking outcome.

Full reasoning: `docs/OVERRIDE_AND_LOCATION.md`.
