// Test-only shim: makes PostgREST look enough like Supabase for supabase-js.
// Maps /rest/v1/* -> PostgREST /*, and stubs the /auth/v1 endpoints the client pings.
import http from "node:http";
import crypto from "node:crypto";

const SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function jwt(role) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role, iss: "supabase", exp: Math.floor(Date.now() / 1000) + 86400 });
  const sig = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

if (process.argv[2] === "--print-key") {
  console.log(jwt("anon"));
  process.exit(0);
}

const server = http.createServer((req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "*",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.url.startsWith("/auth/v1")) {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_implemented" }));
    return;
  }

  const path = req.url.replace(/^\/rest\/v1/, "");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers, host: "127.0.0.1:3001" };
    delete headers.apikey;
    const upstream = http.request(
      { host: "127.0.0.1", port: 3001, path, method: req.method, headers },
      (up) => {
        const h = { ...up.headers };
        // PostgREST sends its own CORS headers; keeping both yields "*, *".
        for (const k of Object.keys(h)) {
          if (k.toLowerCase().startsWith("access-control-")) delete h[k];
        }
        res.writeHead(up.statusCode, { ...h, ...cors });
        up.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      res.writeHead(502, cors);
      res.end(String(e));
    });
    if (body.length) upstream.write(body);
    upstream.end();
  });
});

server.listen(3002, () => console.log("shim on 3002"));
