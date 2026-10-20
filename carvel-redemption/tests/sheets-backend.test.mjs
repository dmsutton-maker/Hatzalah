// Runs gas/Code.gs against an in-memory stand-in for Google's Apps Script services.
//
//   node tests/sheets-backend.test.mjs [path/to/Code.gs]
//
// This proves the RULES (single claim, cap, location, test mode, fail-closed). It does
// not prove Google's runtime behaves — only a deployed script can. See docs/SHEETS_BACKEND.md.

import fs from "node:fs";
import { makeEnv } from "./gas-mock.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? path.join(here, "../gas/Code.gs");
const source = fs.readFileSync(file, "utf8");

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------------------------------------------------------------------- helpers

const makeEnv_ = () => makeEnv(source);

const post = (env, body) =>
  JSON.parse(env.g.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).getContent());
const get = (env, action) => JSON.parse(env.g.doGet({ parameter: { action } }).getContent());

const STORE = "CARVEL-WLB";
const AT_STORE = { lat: 40.294485, lon: -74.028126, acc: 15 };
const MANHATTAN = { lat: 40.758, lon: -73.9855, acc: 15 };

// ---------------------------------------------------------------------- tests

let env = makeEnv_();
env.g.setup();

const redeemedTotal = () => get(env, "stats").redeemed_total;
const row = (serial) => env.sheets.Coupons.rows.find((r) => r?.[0] === serial);

let s = get(env, "stats");
check("setup carries over the 81 redemptions", s.redeemed_total === 81, `${s.redeemed_total}`);
check("setup leaves 419 remaining of 500 real coupons", s.remaining === 419, `${s.remaining}`);
check("owed = redeemed x unit cost", s.amount_owed === 81 && s.unit_cost === 1, `$${s.amount_owed}`);
check("510 coupon rows (500 real + 10 demo)", env.sheets.Coupons.getLastRow() === 511);
check("135 historical log rows loaded", env.sheets.Log.getLastRow() === 136);

let threw = false;
try {
  env.g.setup();
} catch {
  threw = true;
}
check("setup refuses to run twice", threw);
check("...and left the data alone", redeemedTotal() === 81);

// --- the hard rule
let r = post(env, { action: "redeem", serial: 1, store: STORE, device: "a/ios", ...AT_STORE });
check("000001 -> ok", r.result === "ok", r.result);
const first = r.redeemed_at;
r = post(env, { action: "redeem", serial: 1, store: STORE, device: "b/ios" });
check("000001 again -> already_used", r.result === "already_used", r.result);
check("...with the ORIGINAL timestamp", r.redeemed_at === first);
check("exactly one redemption recorded for serial 1", row(1)[3] === STORE && row(1)[4] === "a/ios", row(1)[4]);
check("count went up by exactly one", redeemedTotal() === 82);

r = post(env, { action: "redeem", serial: 3, store: STORE });
check("an already-redeemed (from Supabase) coupon -> already_used", r.result === "already_used", r.result);

r = post(env, { action: "redeem", serial: 999999, store: STORE });
check("999999 -> out_of_range", r.result === "out_of_range", r.result);
r = post(env, { action: "redeem", serial: 900001, store: STORE });
check("sample 900001 in live mode -> out_of_range", r.result === "out_of_range", r.result);
check("...and was not claimed", !row(900001)[2]);
r = post(env, { action: "redeem", serial: 900001, store: STORE, test: true });
check("sample 900001 with test mode -> test", r.result === "test", r.result);
r = post(env, { action: "redeem", serial: 2, store: STORE, test: true });
check("test mode on a live serial -> test", r.result === "test", r.result);
check("...and did NOT consume it", !row(2)[2]);

r = post(env, { action: "redeem", serial: 5, store: "NOT-A-REGISTER" });
check("unknown register -> bad_format", r.result === "bad_format", r.result);
check("...and did not consume it", !row(5)[2]);
r = post(env, { action: "redeem", serial: "abc", store: STORE });
check("garbage serial -> bad_format", r.result === "bad_format", r.result);

// --- fail closed
r = post(env, "this is not json");
check("garbage request -> error (staff screen shows NO CONNECTION)", r.result === "error", r.result);
env.state.lockFail = true;
r = post(env, { action: "redeem", serial: 7, store: STORE });
check("lock timeout -> error, never an approval", r.result === "error", r.result);
env.state.lockFail = false;
check("...and the coupon was not consumed", !row(7)[2]);

// --- lock discipline: every Coupons read inside a request happened while holding the lock
env = makeEnv_();
env.g.setup();
env.state.unlockedReads = 0;
post(env, { action: "redeem", serial: 10, store: STORE });
post(env, { action: "override", store: STORE, reason: "Barcode won't scan" });
check("every scan took the lock", env.state.lockTakes === 2, `${env.state.lockTakes}`);
check("the sheet is never read outside the lock", env.state.unlockedReads === 0, `${env.state.unlockedReads} unlocked reads`);

// --- override
env = makeEnv_();
env.g.setup();
r = post(env, { action: "override", store: STORE, reason: "Barcode won't scan", ...AT_STORE });
check("override -> override", r.result === "override", r.result);
check("override claims the TOP of the range (500)", r.serial === 500, `${r.serial}`);
check("override reports remaining", r.remaining === 418, `${r.remaining}`);
r = post(env, { action: "override", store: STORE, reason: "Coupon torn or wet" });
check("second override takes 499", r.serial === 499, `${r.serial}`);
check("overrides are logged with their reason", env.sheets.Overrides.getLastRow() === 3 && env.sheets.Overrides.rows[1][2] === "Barcode won't scan");
r = post(env, { action: "override", store: STORE, reason: "x", test: true });
check("override in test mode consumes nothing", r.result === "test" && redeemedTotal() === 83, `${redeemedTotal()}`);
r = post(env, { action: "override", store: STORE, reason: "" });
check("override without a reason -> bad_format", r.result === "bad_format", r.result);

// --- THE CAP: drain every coupon, then keep overriding
env = makeEnv_();
env.g.setup();
let n = 0;
while (post(env, { action: "override", store: STORE, reason: "drain" }).result === "override") {
  if (++n > 600) break;
}
check("override drains exactly the remaining 419", n === 419, `${n}`);
r = post(env, { action: "override", store: STORE, reason: "one more" });
check("then override -> exhausted", r.result === "exhausted", r.result);
check("redeemed total is EXACTLY 500, never more", redeemedTotal() === 500, `${redeemedTotal()}`);
r = post(env, { action: "redeem", serial: 123, store: STORE });
check("and every individual coupon now reads already_used", r.result === "already_used", r.result);
check("overrides never touch demo coupons", !row(900001)[2] && !row(900010)[2]);

// --- location
env = makeEnv_();
env.g.setup();
r = post(env, { action: "redeem", serial: 20, store: STORE, ...AT_STORE });
check("at the store -> geo ok", r.geo_status === "ok" && r.distance_m < 5, `${r.geo_status} ${Math.round(r.distance_m)}m`);
r = post(env, { action: "redeem", serial: 21, store: STORE, ...MANHATTAN });
check("Manhattan still redeems by default, flagged far", r.result === "ok" && r.geo_status === "far", `${r.result}/${r.geo_status}`);
r = post(env, { action: "redeem", serial: 26, store: STORE });
check("no location -> no_fix, still redeems", r.result === "ok" && r.geo_status === "no_fix", `${r.result}/${r.geo_status}`);
r = post(env, { action: "redeem", serial: 27, store: STORE, lat: 40.297635, lon: -74.028126, acc: 300 });
check("350m away but +/-300m accuracy -> NOT far", r.geo_status === "ok", r.geo_status);
env.sheets.Settings.rows[7][6] = true; // enforce on
r = post(env, { action: "redeem", serial: 28, store: STORE, ...MANHATTAN });
check("enforcement on: off-site -> wrong_location", r.result === "wrong_location", r.result);
check("...and nothing was claimed", !row(28)[2]);
r = post(env, { action: "redeem", serial: 28, store: STORE, ...AT_STORE });
check("enforcement on: at the store still works", r.result === "ok", r.result);
r = post(env, { action: "override", store: STORE, reason: "x", ...MANHATTAN });
check("enforcement on: off-site override refused too", r.result === "wrong_location", r.result);

// --- settings are live
env = makeEnv_();
env.g.setup();
env.sheets.Settings.rows[3][1] = false; // enabled = false
r = post(env, { action: "redeem", serial: 30, store: STORE });
check("range disabled in Settings -> out_of_range (kill switch)", r.result === "out_of_range", r.result);
env.sheets.Settings.rows[3][1] = true;
env.sheets.Settings.rows[2][1] = 100; // serial_max = 100
r = post(env, { action: "redeem", serial: 150, store: STORE });
check("serial_max edited in Settings is respected", r.result === "out_of_range", r.result);
env.sheets.Settings.rows[7][2] = false; // register disabled
r = post(env, { action: "redeem", serial: 30, store: STORE });
check("register disabled in Settings -> refused", r.result === "bad_format", r.result);

// --- stats endpoint
env = makeEnv_();
env.g.setup();
post(env, { action: "redeem", serial: 41, store: STORE, ...MANHATTAN });
post(env, { action: "override", store: STORE, reason: "x" });
s = get(env, "stats");
check("stats: today counts the two just redeemed", s.redeemed_today === 2, `${s.redeemed_today}`);
check("stats: 1 override today", s.overrides_today === 1, `${s.overrides_today}`);
check("stats: 1 off-site today", s.offsite_today === 1, `${s.offsite_today}`);
check("stats: totals", s.redeemed_total === 83 && s.remaining === 417 && s.amount_owed === 83, JSON.stringify(s));
check("stats: counts only (no serials leak)", !JSON.stringify(s).match(/serial|lat|lon/));
check("ping works", get(env, "ping").ok === true);

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
