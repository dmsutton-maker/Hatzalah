import { chromium } from "playwright";
import { coupon, reset, setSetting, state } from "./harness.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const AT_STORE = { latitude: 40.294485, longitude: -74.028126, accuracy: 12 };
const MANHATTAN = { latitude: 40.758, longitude: -73.9855, accuracy: 12 };

// Settings tab, 0-based: the register row is 7, its "enforce" box is column 6.
const ENFORCE = (on) => setSetting(7, 6, on);

const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// Latest Log row for a serial: [at, serial, result, register, test, geo, distance_m, ...]
const logFor = async (serial) => (await state()).log.filter((r) => r[1] === serial).pop();

await reset();

const PROXY = process.env.HTTPS_PROXY;
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  ...(PROXY ? { proxy: { server: PROXY, bypass: "127.0.0.1,localhost" } } : {}),
});

async function scan(serial, geo) {
  const ctx = await browser.newContext({
    permissions: geo ? ["geolocation", "camera"] : ["camera"],
    geolocation: geo ?? undefined,
    viewport: { width: 414, height: 896 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/s/CARVEL-WLB`, { waitUntil: "networkidle" });
  // Give the geolocation watch a moment to deliver its first fix.
  await page.waitForTimeout(1200);
  await page.fill("#serial", serial);
  await page.click('button[type="submit"]');
  await page.waitForSelector("[data-result]", { timeout: 20000 });
  const code = await page.getAttribute("[data-result]", "data-result");
  const text = (await page.textContent("[data-result]")).trim();
  await ctx.close();
  return { code, text };
}

// (Serial 3 was redeemed during real use before the move, so these use free ones.)

// 1. At the store: recorded as 'ok', distance ~0.
let r = await scan("000001", AT_STORE);
check("scan at the store redeems", r.code === "ok", r.code);
let l = await logFor(1);
check("recorded as at-store", l?.[5] === "ok", `geo=${l?.[5]}, distance=${l?.[6]}m`);

// 2. From Manhattan: flagged, but NOT blocked (enforcement off by default).
r = await scan("000002", MANHATTAN);
check("off-site scan still redeems by default", r.code === "ok", r.code);
l = await logFor(2);
check("off-site scan is flagged far", l?.[5] === "far", `distance=${Math.round((l?.[6] ?? 0) / 1000)}km`);

// 3. Location denied: no fix, still redeems.
r = await scan("000004", null);
check("scan with location denied still redeems", r.code === "ok", r.code);
l = await logFor(4);
check("recorded as no_fix", l?.[5] === "no_fix", l?.[5]);

// 4. Enforcement ON: the same off-site scan is refused, and claims nothing.
await ENFORCE(true);
r = await scan("000005", MANHATTAN);
check("with enforcement on, off-site is refused", r.code === "wrong_location", r.code);
check("refused scan claimed nothing", !(await coupon(5)).redeemed);
check("staff see WRONG LOCATION", /Wrong location/i.test(r.text), r.text.slice(0, 60));

// 5. Enforcement ON but at the store: normal.
r = await scan("000006", AT_STORE);
check("with enforcement on, at-store still works", r.code === "ok", r.code);

await ENFORCE(false);
await browser.close();

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
