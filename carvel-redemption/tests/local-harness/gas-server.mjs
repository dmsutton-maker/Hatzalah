// Serves gas/Code.gs over HTTP the way a deployed Apps Script web app behaves, so the
// real staff screen can be driven against the real backend logic.
//
//   node tests/local-harness/gas-server.mjs        (listens on :3002)
//
// Mimics the two Google quirks the client has to survive:
//   - a POST to /exec is answered with a 302 to a one-shot GET URL (the body is
//     processed at the first hop, the JSON comes back from the second)
//   - the browser may not send a preflight, so a non-"simple" request must fail here too
//
// Not a security boundary and not a deployment path. Test rig only.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeEnv } from "../gas-mock.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "../../gas/Code.gs"), "utf8");
const PORT = Number(process.env.PORT ?? 3002);

let env;
function reset() {
  env = makeEnv(source);
  env.g.setup();
}
reset();

const pending = new Map();
let nextId = 1;

const CORS = { "Access-Control-Allow-Origin": "*" };
const json = (res, code, obj, extra = {}) => {
  res.writeHead(code, { "Content-Type": "application/json", ...CORS, ...extra });
  res.end(JSON.stringify(obj));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();

      // ---- test-only inspection / control
      if (url.pathname === "/__debug/state") {
        const rows = (n) => env.sheets[n].rows.filter(Boolean);
        return json(res, 200, { coupons: rows("Coupons"), log: rows("Log"), overrides: rows("Overrides"), settings: rows("Settings") });
      }
      if (url.pathname === "/__debug/reset") {
        reset();
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/__debug/setting") {
        const { row, col, value } = JSON.parse(body);
        (env.sheets.Settings.rows[row] ??= [])[col] = value;
        return json(res, 200, { ok: true });
      }

      // ---- the web app
      if (url.pathname === "/exec") {
        if (req.method === "OPTIONS") {
          // A real browser only preflights a non-simple request. Google would not
          // answer it, so neither do we: the client must never trigger one.
          res.writeHead(405);
          return res.end();
        }
        if (req.method === "POST") {
          const ct = (req.headers["content-type"] ?? "").split(";")[0].trim();
          if (ct && !["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"].includes(ct)) {
            res.writeHead(415, CORS);
            return res.end("non-simple content-type would be preflighted by a browser");
          }
          const out = env.g.doPost({ postData: { contents: body } }).getContent();
          const id = nextId++;
          pending.set(id, out);
          res.writeHead(302, { Location: `/echo?id=${id}`, ...CORS });
          return res.end();
        }
        const out = env.g.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent();
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        return res.end(out);
      }
      if (url.pathname === "/echo") {
        const id = Number(url.searchParams.get("id"));
        const out = pending.get(id);
        pending.delete(id);
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        return res.end(out ?? "{}");
      }

      res.writeHead(404);
      res.end();
    });
  })
  .listen(PORT, () => console.log(`gas-server on :${PORT}`));
