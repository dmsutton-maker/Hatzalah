# Manual override and location tagging

Two capabilities added after the original brief. Both touch the one thing the system
exists to protect — that 500 printed coupons buy at most 500 ice creams — so the
reasoning is written down here rather than left in the code.

---

## Manual override

### The situation it exists for

A kid hands over a coupon that went through the wash. The barcode is unreadable and so
are the six digits under it. The coupon is obviously real — it is on the right stock,
with the right shield on it — and the kid earned it by wearing a helmet.

Before this existed, the register had two options: refuse a real coupon in front of a
child, or hand out ice cream off the books. Both are worse than a recorded override.

### How the cap is guaranteed

The tempting implementation is a counter: "redeemed += 1". That is exactly the design
that eventually hands out 503 ice creams, because a counter can be double-incremented,
reset, or race with itself.

Instead, `redeem_override()` **claims a real coupon row**:

```sql
update coupons set redeemed_at = now(), ...
 where serial = (
   select serial from coupons
    where redeemed_at is null and not is_test and <in active range>
    order by serial desc limit 1
    for update skip locked
 )
```

There are 500 rows. Scans and overrides compete for the same 500 rows. No sequence of
either can produce a 501st redemption — when the subquery finds nothing, the function
returns `exhausted` and the screen says **NONE LEFT**. The cap is a property of the
data, not of the code that touches it.

`FOR UPDATE SKIP LOCKED` handles two registers overriding in the same instant: they
take two *different* serials, and neither waits on the other. Verified — see
`tests/README.md`.

### Why it consumes from the top of the range

Coupons were handed out from `000001` upward, so the unclaimed serials at the top are
the ones least likely to be in a child's pocket. If a paper `000500` does later turn
up, it reads ALREADY USED — a visible collision that David can investigate in the log,
rather than a silent one.

### Why it is logged as `override`, not `ok`

`scan_log` is the record shown to Carvel if a redemption is ever disputed. A coupon
whose barcode was read by a machine and a coupon a staffer judged to be real are
different kinds of evidence, and the log should not pretend otherwise. The dashboard
count and the amount owed both come from `coupons`, so overrides are still paid for —
they are just distinguishable.

> Note for the acceptance list: the original check "admin count matches `scan_log` rows
> with `result = 'ok'`" becomes `result in ('ok','override')`.

### Why three fixed reasons and no free-text box

The reason is written to `override_log`. A text box at a busy register produces "asdf".
Three named reasons produce a log David can actually read, and take one tap instead of
twenty. Opening the panel is a separate tap from choosing a reason, so it takes two
deliberate actions — hard to hit by accident, fast when meant.

---

## Location tagging

### What it catches

The serial numbers cannot tell you *where* a scan happened. The register URL is
unguessable but not secret — anyone who photographs the QR by the counter can open it
later from anywhere. Location tagging is what makes that visible.

### Why it flags instead of blocking, by default

`stores.enforce_geofence` is **false** out of the box. This is the important decision
in this document, so the reasoning is explicit:

- Indoor GPS beside a metal ice cream machine is routinely 100 m or worse. A phone with
  Wi-Fi positioning off can be a kilometre out and completely confident about it.
- A staffer who taps "Don't Allow" on the location prompt has no fix at all, forever.
- With blocking on, both of those become a red screen in front of a customer holding a
  legitimate coupon.

A false refusal costs a child their ice cream, in person, with a line behind them. A
false flag costs David ten seconds in the admin log. The asymmetry decides it.

Turn enforcement on per register — in **Settings → Registers** — once the log shows
what accuracy actually looks like at that counter. The dashboard surfaces the off-site
count so there is something to base that on.

### The `far` test is accuracy-aware

A scan is only classified `far` when:

```
distance_from_store - reported_accuracy > geofence_radius_m
```

A fix 350 m away that reports ±300 m accuracy is not evidence of anything, and is
classified `ok`. The admin log always shows the accuracy next to the distance for the
same reason — "1.2 km away ±2 km" should not read as guilt.

### It never slows a scan down

A GPS lock can take ten seconds indoors. A register with a line does not have ten
seconds. So the page starts a location watch when it loads and keeps the most recent
fix in memory; a scan sends whatever is on hand at that moment, or nothing at all.
Sending nothing is a normal outcome (`no_fix`), not an error.

### The store's coordinates

Seeded from an OpenStreetMap geocode of 175 Monmouth Rd, which can be tens of metres
off a specific doorway. **Settings → Registers → "Use my current location"** fixes it
properly: stand at the register once, press it, save.

### Privacy

This records the staff phone's location on every scan, so the staff screen says so in
its footer. Worth mentioning to the Carvel manager before launch rather than after —
it is their employees' phones. Nothing else about the device is collected: the
`device_hint` is a random per-browser id plus "ios"/"android", specifically so two
registers can be told apart without identifying anyone.
