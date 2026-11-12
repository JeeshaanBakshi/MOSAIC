// Local stand-ins for the two cloud services, so the REAL client code can be tested without accounts or keys.
//   Upstash Redis REST  on :4401   (get / set [NX, PX] / del; every command is a POST with a JSON array)
//   Resend email API    on :4402   (POST /emails; GET /sent lists what was "sent"; POST /mode {fail:true} makes it refuse)
import http from "node:http";
const kv = new Map(); const expiry = new Map();
const calls = { total: 0, sets: 0 };
const alive = (k) => (expiry.has(k) && expiry.get(k) < Date.now() ? (kv.delete(k), expiry.delete(k), false) : kv.has(k));
http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== "Bearer testtoken") { res.statusCode = 401; return res.end(JSON.stringify({ error: "Unauthorized" })); }
    if (req.url === "/_stats") return res.end(JSON.stringify(calls));
    if (req.url === "/_dump") return res.end(JSON.stringify(Object.fromEntries(kv)));
    const exec = (cmd) => {
      const [op, key, ...rest] = cmd; calls.total++;
      switch (String(op).toLowerCase()) {
        case "get": return { result: alive(key) ? kv.get(key) : null };
        case "set": {
          calls.sets++;
          const flags = rest.slice(1).map((x) => String(x).toUpperCase());
          if (flags.includes("NX") && alive(key)) return { result: null };
          kv.set(key, rest[0]);
          const px = flags.indexOf("PX"); if (px >= 0) expiry.set(key, Date.now() + Number(rest.slice(1)[px + 1])); else expiry.delete(key);
          return { result: "OK" };
        }
        case "del": { let n = 0; for (const k of [key, ...rest]) if (kv.delete(k)) n++; return { result: n }; }
        default: return { error: "unsupported " + op };
      }
    };
    const body = JSON.parse(b);
    // The real client sends single commands to "/" and batches to "/pipeline" (an array of commands, answered with an array).
    if (req.url === "/pipeline") return res.end(JSON.stringify(body.map(exec)));
    const out = exec(body);
    if (out.error) res.statusCode = 400;
    return res.end(JSON.stringify(out));
  });
}).listen(4401, () => console.log("fake upstash on 4401"));

const sent = []; let failMode = false;
http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/sent") return res.end(JSON.stringify(sent));
    if (req.url === "/mode") { failMode = JSON.parse(b).fail; return res.end("{}"); }
    if (req.url === "/emails" && req.method === "POST") {
      if (req.headers.authorization !== "Bearer resend-test-key") { res.statusCode = 401; return res.end(JSON.stringify({ message: "API key is invalid" })); }
      if (failMode) { res.statusCode = 403; return res.end(JSON.stringify({ statusCode: 403, name: "validation_error", message: "You can only send testing emails to your own email address (owner@example.com)." })); }
      const m = JSON.parse(b); sent.push({ ...m, auth: req.headers.authorization, at: Date.now() });
      return res.end(JSON.stringify({ id: "email_" + sent.length }));
    }
    res.statusCode = 404; res.end("{}");
  });
}).listen(4402, () => console.log("fake resend on 4402"));
