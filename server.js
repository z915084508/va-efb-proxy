/**
 * VA EFB Proxy (Render Node Service)
 * - Acts as a backend proxy to vAMSYS API
 * - Keeps OAuth client secret server-side
 * - Provides simple endpoints for EFB frontend
 *
 * Node 18+/22 OK (ESM)
 */

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

/** =========================
 *  Basic app init
 *  ========================= */
const app = express();
app.use(express.json({ limit: "1mb" }));

// ---- CORS ----
// 生产建议写死你的前端域名，如 https://va-efb-frontend.onrender.com
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(
  cors({
    origin: CORS_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-VA-User"],
  })
);

/** =========================
 *  Env / Config
 *  ========================= */
const API_BASE = process.env.VAMSYS_API_BASE || "https://vamsys.io/api/v3";
const TOKEN_URL = process.env.VAMSYS_TOKEN_URL || "https://vamsys.io/oauth/token";

// OAuth Client (Client Credentials)
const CLIENT_ID = process.env.VAMSYS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.VAMSYS_CLIENT_SECRET || "";

// Optional: allow password grant (pilot login) if vAMSYS supports it
const ENABLE_PASSWORD_GRANT = (process.env.ENABLE_PASSWORD_GRANT || "0") === "1";

// Render sets PORT
const PORT = process.env.PORT || 3000;

/** =========================
 *  Helpers
 *  ========================= */
function assertEnv(name, value) {
  if (!value) throw new Error(`Missing env var: ${name}`);
}

function b64(s) {
  return Buffer.from(s).toString("base64");
}

/** =========================
 *  Token cache (client credentials)
 *  ========================= */
let cachedToken = "";
let tokenExpiresAt = 0;

async function getClientToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  assertEnv("VAMSYS_CLIENT_ID", CLIENT_ID);
  assertEnv("VAMSYS_CLIENT_SECRET", CLIENT_SECRET);

  // Typical OAuth2 client_credentials: Authorization Basic base64(client:secret)
  const auth = `Basic ${b64(`${CLIENT_ID}:${CLIENT_SECRET}`)}`;

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  // 如果 vAMSYS 要 scope，可以加： body.set("scope", "operations"); 之类（看你们后台）
  // body.set("scope", process.env.VAMSYS_SCOPE || "");

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const txt = await r.text();
  if (!r.ok) {
    throw new Error(`Token request failed (${r.status}): ${txt}`);
  }

  const data = JSON.parse(txt);
  cachedToken = data.access_token;
  // 提前 60 秒过期，避免边界问题
  tokenExpiresAt = now + Math.max(0, (data.expires_in || 3600) - 60) * 1000;

  return cachedToken;
}

/** =========================
 *  Optional: Password grant (pilot login)
 *  =========================
 *  如果 vAMSYS 不支持 password grant，就不要开 ENABLE_PASSWORD_GRANT
 *  未来更推荐 Authorization Code + PKCE（飞行员跳转授权）
 */
async function getPilotTokenByPassword(username, password) {
  assertEnv("VAMSYS_CLIENT_ID", CLIENT_ID);
  assertEnv("VAMSYS_CLIENT_SECRET", CLIENT_SECRET);

  const auth = `Basic ${b64(`${CLIENT_ID}:${CLIENT_SECRET}`)}`;

  const body = new URLSearchParams();
  body.set("grant_type", "password");
  body.set("username", username);
  body.set("password", password);
  // 如果需要 scope：
  // body.set("scope", process.env.VAMSYS_SCOPE || "");

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const txt = await r.text();
  if (!r.ok) {
    throw new Error(`Password token failed (${r.status}): ${txt}`);
  }
  return JSON.parse(txt); // {access_token, expires_in, refresh_token? ...}
}

/** =========================
 *  Healthcheck
 *  ========================= */
app.get("/", (req, res) => {
  res.send("OK");
});

/** =========================
 *  Debug endpoints
 *  ========================= */

// Raw passthrough for troubleshooting (client credentials)
app.get("/api/_debug/flights-raw", async (req, res) => {
  try {
    const token = await getClientToken();
    const r = await fetch(`${API_BASE}/flights`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const txt = await r.text();
    res.status(r.status).send(txt);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Show config (NO secrets)
app.get("/api/_debug/info", (req, res) => {
  res.json({
    apiBase: API_BASE,
    tokenUrl: TOKEN_URL,
    corsOrigin: CORS_ORIGIN,
    passwordGrantEnabled: ENABLE_PASSWORD_GRANT,
    hasClientId: Boolean(CLIENT_ID),
    hasClientSecret: Boolean(CLIENT_SECRET),
  });
});

/** =========================
 *  API for EFB frontend
 *  ========================= */

/**
 * GET /api/flights
 * - In phase 1: uses client-credentials token and returns flights list (raw or mapped)
 * - Later: change to "pilot token" so it returns pilot-specific flights
 */
app.get("/api/flights", async (req, res) => {
  try {
    const token = await getClientToken();

    const r = await fetch(`${API_BASE}/flights`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const txt = await r.text();
    res.status(r.status).send(txt);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * POST /api/flights/:flightId/events
 * - For now: demo endpoint that just accepts events from frontend
 * - You can later POST these into your own DB or vAMSYS if there is an endpoint
 */
app.post("/api/flights/:flightId/events", async (req, res) => {
  try {
    const { flightId } = req.params;
    const ev = req.body || {};

    // TODO: if vAMSYS has an endpoint to store ACARS/events, call it here.
    // For now, just echo back.
    res.json({
      ok: true,
      flightId,
      received: ev,
      note: "Stored nowhere yet (demo).",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * OPTIONAL: Pilot login via username/password (only if vAMSYS supports password grant)
 * POST /api/login
 * body: { username, password }
 * returns: { access_token, expires_in, ... } (NO storing on server)
 *
 * ⚠️如果你准备走“真正安全的方案”，我们下一步改成 Authorization Code + PKCE
 */
app.post("/api/login", async (req, res) => {
  try {
    if (!ENABLE_PASSWORD_GRANT) {
      return res.status(400).json({
        error:
          "Password grant disabled. Set ENABLE_PASSWORD_GRANT=1 only if your vAMSYS supports it.",
      });
    }

    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Missing username/password" });
    }

    const tok = await getPilotTokenByPassword(username, password);

    // IMPORTANT: do not log secrets
    res.json({
      access_token: tok.access_token,
      token_type: tok.token_type,
      expires_in: tok.expires_in,
      refresh_token: tok.refresh_token, // may be undefined
      scope: tok.scope,
    });
  } catch (e) {
    console.error(e);
    res.status(401).json({ error: String(e?.message || e) });
  }
});

/** =========================
 *  Start
 *  ========================= */
app.listen(PORT, () => {
  console.log(`va-efb-proxy listening on port ${PORT}`);
});
