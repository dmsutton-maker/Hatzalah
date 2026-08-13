import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000";
const STORE = { lat: 40.294485, lon: -74.028126 };

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

const ctx = await browser.newContext({
  permissions: ["geolocation", "camera"],
  geolocation: { latitude: STORE.lat, longitude: STORE.lon, accuracy: 12 },
  viewport: { width: 414, height: 896 },
  isMobile: true,
  hasTouch: true,
});

const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("  [browser error]", m.text());
});

async function enter(serial) {
  await page.fill("#serial", serial);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-result]', { timeout: 15000 });
  const code = await page.getAttribute('[data-result]', 'data-result');
  const headline = (await page.textContent('[data-result] p')).trim();
  const all = (await page.textContent('[data-result]')).trim();
  return { code, headline, all };
}

async function dismiss() {
  await page.click('[data-result] button');
  await page.waitForSelector('[data-result]', { state: "detached", timeout: 8000 });
}

// ---------------------------------------------------------------- live mode
await page.goto(`${BASE}/s/CARVEL-WLB`, { waitUntil: "networkidle" });
check("staff page loads", await page.isVisible("#serial"));
check(
  "manual entry is visible without any tap",
  await page.isVisible("#serial"),
  "no 'having trouble?' link to find",
);
check("no test banner in live mode", !(await page.isVisible("text=TEST MODE")));

let r = await enter("000001");
check("scan 000001 -> VALID", r.code === "ok", `${r.code} / ${r.headline}`);
check("shows the serial", r.all.includes("000001"), r.all.replace(/\s+/g, " ").slice(0, 90));
await dismiss();

r = await enter("000001");
check("re-scan 000001 -> ALREADY USED", r.code === "already_used", `${r.code} / ${r.headline}`);
check(
  "shows the original redemption time",
  /Redeemed \w{3} \d+, \d{4} at/.test(r.all),
  (r.all.match(/Redeemed[^A-Z]*(AM|PM)/) || ["no timestamp"])[0],
);
await dismiss();

r = await enter("999999");
check("999999 -> NOT VALID", r.code === "out_of_range" && /Not valid/i.test(r.headline), `${r.code} / ${r.headline}`);
await dismiss();

r = await enter("900001");
check("sample coupon 900001 in live mode -> NOT VALID", r.code === "out_of_range" && /Not valid/i.test(r.headline), `${r.code} / ${r.headline}`);
await dismiss();

// auto-return after 4s
await enter("000002");
const start = Date.now();
await page.waitForSelector('[data-result]', { state: "detached", timeout: 9000 });
const elapsed = Date.now() - start;
check("result auto-clears after ~4s", elapsed > 2500 && elapsed < 7000, `${elapsed}ms`);

// ------------------------------------------------------------------ override
await page.click("text=Can’t scan or read the coupon?");
check("override asks for a reason", await page.isVisible("text=Redeem without the number?"));
await page.click("text=Barcode won't scan");
await page.waitForSelector('[data-result]', { timeout: 15000 });
const ovCode = await page.getAttribute('[data-result]', 'data-result');
const ov = (await page.textContent('[data-result]')).trim();
check("override -> VALID", ovCode === "override" && /Valid/i.test(ov), `${ovCode} / ${ov.replace(/\s+/g, " ").slice(0, 80)}`);
check("override reports which serial it consumed", /000500/.test(ov), ov.includes("000500") ? "000500" : "missing");
check("override reports how many are left", /coupons left/.test(ov));
await dismiss();

// ----------------------------------------------------------------- test mode
await page.goto(`${BASE}/s/CARVEL-WLB?test=1`, { waitUntil: "networkidle" });
check("test banner is impossible to miss", await page.isVisible("text=TEST MODE — NOTHING IS BEING RECORDED"));
r = await enter("900001");
check("sample coupon with ?test=1 -> TEST — VALID", r.code === "test", `${r.code} / ${r.headline}`);
await dismiss();
r = await enter("000010");
check("live serial under ?test=1 -> TEST — VALID", r.code === "test", `${r.code} / ${r.headline}`);
await dismiss();

// ------------------------------------------------------------------- offline
// Load the page first, THEN pull the network — that is what airplane mode mid-shift
// actually looks like.
await page.goto(`${BASE}/s/CARVEL-WLB`, { waitUntil: "networkidle" });
await ctx.setOffline(true);
r = await enter("000020").catch((e) => ({ code: "threw", headline: `error: ${e.message}`, all: "" }));
check("airplane mode -> NO CONNECTION, never approved", r.code === "offline", `${r.code} / ${r.headline}`);
await ctx.setOffline(false);

// The decisive half: nothing may have been recorded or approved.
const { execSync } = await import("node:child_process");
const claimed = execSync(
  `psql -h /var/tmp -p 5433 -U postgres -d carvel -tAc "select coalesce((select 1 from coupons where serial=20 and redeemed_at is not null),0);"`,
).toString().trim();
check("airplane mode recorded nothing", claimed === "0", `serial 20 claimed flag = ${claimed}`);

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
