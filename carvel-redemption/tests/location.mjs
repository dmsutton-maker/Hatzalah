import { chromium } from "playwright";
import { execSync } from "node:child_process";

const BASE = "http://127.0.0.1:3000";
const AT_STORE = { latitude: 40.294485, longitude: -74.028126, accuracy: 12 };
const MANHATTAN = { latitude: 40.758, longitude: -73.9855, accuracy: 12 };

const sql = (q) =>
  execSync(`psql -h /var/tmp -p 5433 -U postgres -d carvel -tAc "${q}"`).toString().trim();

const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

sql("update coupons set redeemed_at=null, redeemed_by=null;");
sql("truncate scan_log, override_log;");
sql("update stores set enforce_geofence=false where token='CARVEL-WLB';");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

async function scan(serial, geo, ctxOpts = {}) {
  const ctx = await browser.newContext({
    permissions: geo ? ["geolocation", "camera"] : ["camera"],
    geolocation: geo ?? undefined,
    viewport: { width: 414, height: 896 },
    isMobile: true,
    hasTouch: true,
    ...ctxOpts,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/s/CARVEL-WLB`, { waitUntil: "networkidle" });
  // Give the geolocation watch a moment to deliver its first fix.
  await page.waitForTimeout(1200);
  await page.fill("#serial", serial);
  await page.click('button[type="submit"]');
  await page.waitForSelector("[data-result]", { timeout: 15000 });
  const code = await page.getAttribute("[data-result]", "data-result");
  const text = (await page.textContent("[data-result]")).trim();
  await ctx.close();
  return { code, text };
}

// 1. Scanning at the store: recorded as 'ok', distance ~0.
let r = await scan("000001", AT_STORE);
check("scan at the store redeems", r.code === "ok", r.code);
check(
  "recorded as at-store",
  sql("select geo_status from scan_log where serial=1 and result='ok';") === "ok",
  `geo_status=${sql("select geo_status from scan_log where serial=1;")}, distance=${sql("select round(distance_m) from scan_log where serial=1;")}m`,
);

// 2. Scanning from Manhattan: flagged, but NOT blocked (enforcement off by default).
r = await scan("000002", MANHATTAN);
check("off-site scan still redeems by default", r.code === "ok", r.code);
check(
  "off-site scan is flagged",
  sql("select geo_status from scan_log where serial=2;") === "far",
  `distance=${sql("select round(distance_m/1000) from scan_log where serial=2;")}km`,
);
check(
  "off-site scan appears in v_offsite",
  sql("select count(*) from v_offsite;") === "1",
  `${sql("select count(*) from v_offsite;")} row(s)`,
);

// 3. Location denied: no fix, still redeems.
r = await scan("000003", null);
check("scan with location denied still redeems", r.code === "ok", r.code);
check(
  "recorded as no_fix",
  sql("select geo_status from scan_log where serial=3;") === "no_fix",
  sql("select geo_status from scan_log where serial=3;"),
);

// 4. Enforcement ON: the same off-site scan is refused, and claims nothing.
sql("update stores set enforce_geofence=true where token='CARVEL-WLB';");
r = await scan("000004", MANHATTAN);
check("with enforcement on, off-site is refused", r.code === "wrong_location", r.code);
check(
  "refused scan claimed nothing",
  sql("select count(*) from coupons where serial=4 and redeemed_at is not null;") === "0",
);
check("staff see WRONG LOCATION", /Wrong location/i.test(r.text), r.text.slice(0, 60));

// 5. Enforcement ON but at the store: normal.
r = await scan("000005", AT_STORE);
check("with enforcement on, at-store still works", r.code === "ok", r.code);

sql("update stores set enforce_geofence=false where token='CARVEL-WLB';");
await browser.close();

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
