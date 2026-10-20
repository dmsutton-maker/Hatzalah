// Talks to tests/local-harness/gas-server.mjs (the stand-in for the deployed script).
const HARNESS = process.env.HARNESS_URL ?? "http://127.0.0.1:3002";

const post = (p, body = {}) =>
  fetch(`${HARNESS}${p}`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());

export const reset = () => post("/__debug/reset");
export const state = () => fetch(`${HARNESS}/__debug/state`).then((r) => r.json());
/** Settings tab cell, 0-based [row][col] — e.g. (7, 6) is the register's "enforce" box. */
export const setSetting = (row, col, value) => post("/__debug/setting", { row, col, value });

export async function coupon(serial) {
  const s = await state();
  const r = s.coupons.find((x) => x[0] === serial);
  return { redeemed: r?.[2] !== "" && r?.[2] != null, row: r };
}
