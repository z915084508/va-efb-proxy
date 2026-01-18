/**
 * VA EFB Proxy (Render Node Service) — PKCE (Pilot OAuth) + API Forward
 * Node 18+/22 OK (ESM)
 */

import express from "express";
import cors from "cors";

const app = express();
app.use(express.json({ limit: "1mb" }));

/* =========================
 * CORS
 * ========================= */
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-VA-User"],
  })
);

/* =========================
 * ENV / Config
 * ========================= */
const VAMSYS_BASE_URL = process.env.VAMSYS_BASE_URL || "https://vamsys.io";

// OAuth token endpoint
const TOKEN_URL = process.env.VAMSYS_TOKEN_URL || `${VAMSYS_BASE_URL}/oauth/token`;

// vAMSYS API v3 base (注意：你之前写的是 https://vamsys.io/api/v3)
const API_BASE = process.env.VAMSYS_API_BASE || `${VAMSYS_BASE_URL}/api/v3`;

// OAuth Client (Pilot PKCE)
const CLIENT_ID = process.env.VAMSYS_CLIENT_ID || "";
// PKCE public client 通常不需要 secret；如果你后台确实给了 secret，再填
const CLIENT_SECRET = process.env.VAMSYS_CLIENT_SECRET || "";

// Render sets PORT
const PORT = process.env.PORT || 3000;

/* =========================
 * Helpers
 * ========================= */
function assertEnv(name, value) {
  if (!value) throw new Error(`Missing env var: ${name}`);
}

function getBearer(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : "";
}

/* =========================
 * Health
 * ========================= */
app.get("/", (req, res) => res.type("text").send("VA EFB Proxy OK"));

app.get("/api/_debug/info", (req, res) => {
  res.json({
    apiBase: API_BASE,
    tokenUrl: TOKEN_URL,
    corsOrigin: CORS_ORIGIN,
    hasClientId: Boolean(CLIENT_ID),
    hasClientSecret: Boolean(CLIENT_SECRET),
  });
});

/* =========================
 * OAuth Exchange (PKCE)
 * 前端 main.js 会 POST 到这里：
 * POST /api/oauth/exchange
 * body: { code, redirect_uri, code_verifier }
 * return: { token, user? }
 * ========================= */
app.post("/api/oauth/exchange", async (req, res) => {
  try {
    assertEnv("VAMSYS_CLIENT_ID", CLIENT_ID);

    const { code, redirect_uri, code_verifier } = req.body || {};
    if (!code || !redirect_uri || !code_verifier) {
      return res.status(400).json({
        ok: false,
        error: "Missing code / redirect_uri / code_verifier",
      });
    }

    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("client_id", CLIENT_ID);
    body.set("code", String(code));
    body.set("redirect_uri", String(redirect_uri));
    body.set("code_verifier", String(code_verifier));

    // 如果 vAMSYS 给了 secret，你再启用（否则别填）
    if (CLIENT_SECRET) body.set("client_secret", CLIENT_SECRET);

    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json, text/plain, */*",
      },
      body,
    });

    const txt = await r.text();

    if (!r.ok) {
      // vAMSYS 有时会回 HTML 错误页，所以把前 1200 字符返给前端 debug
      return res.status(r.status).json({
        ok: false,
        error: "Token exchange failed",
        upstream_status: r.status,
        upstream_body: txt.slice(0, 1200),
      });
    }

    let data;
    try {
      data = JSON.parse(txt);
    } catch {
      return res.status(502).json({
        ok: false,
        error: "Token exchange returned non-JSON",
        upstream_body: txt.slice(0, 1200),
      });
    }

    const token = data.access_token || "";
    if (!token) {
      return res.status(502).json({
        ok: false,
        error: "No access_token in response",
        upstream: data,
      });
    }

    // 最简：把 token 回给前端存 localStorage
    // （要拿 user 可以再加 /me 转发，但先不必）
    return res.json({ ok: true, token });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* =========================
 * Flights (forward using pilot token)
 * 前端会带 Authorization: Bearer <token>
 * ========================= */
app.get("/api/flights", async (req, res) => {
  try {
    const token = getBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Bearer token" });
    }

    const url = `${API_BASE}/flights`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json, text/plain, */*",
      },
    });

    const txt = await r.text();

    // 直接把上游 status 和 body 透传给前端，方便你看 vAMSYS 错误
    // 如果你更希望统一成 JSON，可再做 parse
    res.status(r.status).send(txt);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* =========================
 * Events (demo echo)
 * ========================= */
app.post("/api/flights/:flightId/events", async (req, res) => {
  try {
    const { flightId } = req.params;
    const ev = req.body || {};
    res.json({ ok: true, flightId, received: ev, note: "Demo only (not stored)" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* =========================
 * Start
 * ========================= */
app.listen(PORT, () => {
  console.log(`va-efb-proxy listening on port ${PORT}`);
});
