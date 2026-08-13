import { chromium } from "playwright";

// When BASE_URL points at a deployed site, outbound HTTPS goes through the agent
// proxy; local runs must bypass it.
const PROXY = process.env.HTTPS_PROXY;
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  ...(PROXY ? { proxy: { server: PROXY, bypass: "127.0.0.1,localhost" } } : {}),
});
const ctx = await browser.newContext({
  permissions: ["geolocation", "camera"],
  geolocation: { latitude: 40.294485, longitude: -74.028126, accuracy: 12 },
  viewport: { width: 414, height: 896 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
const out = process.argv[2] || "/var/tmp/shots";

await page.goto("http://127.0.0.1:3000/s/CARVEL-WLB", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/1-scanner.png` });

await page.fill("#serial", "000123");
await page.click('button[type="submit"]');
await page.waitForSelector("[data-result]");
await page.screenshot({ path: `${out}/2-valid.png` });
await page.click("[data-result] button");

await page.fill("#serial", "000123");
await page.click('button[type="submit"]');
await page.waitForSelector("[data-result]");
await page.screenshot({ path: `${out}/3-already-used.png` });
await page.click("[data-result] button");

await page.click("text=Can’t scan or read the coupon?");
await page.screenshot({ path: `${out}/4-override.png` });
await page.click("text=Cancel");

await page.goto("http://127.0.0.1:3000/s/CARVEL-WLB?test=1", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/5-test-mode.png` });

await page.goto("http://127.0.0.1:3000/admin/login", { waitUntil: "networkidle" });
await page.screenshot({ path: `${out}/6-login.png` });

await browser.close();
console.log("shots written to", out);
