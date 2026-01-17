import express from "express";
import fetch from "node-fetch";
import cors from "cors";

app.use(cors({
  origin: "*",
  allowedHeaders: ["Content-Type", "X-VA-User"],
}));


const app = express();
app.use(express.json());

const TOKEN_URL = "https://vamsys.io/oauth/token";
const API_BASE = "https://vamsys.io/api"; // 如果文档写的是 /api/v3 就改成 /api/v3

const CLIENT_ID = process.env.VAMSYS_CLIENT_ID;
const CLIENT_SECRET = process.env.VAMSYS_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error("Token error: " + t);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in - 60) * 1000;

  return cachedToken;
}
app.get("/api/_debug/flights-raw", async (req, res) => {
  try {
    const token = await getToken();
    const r = await fetch(`${API_BASE}/flights`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});


/* ===== Example: flights ===== */
app.get("/api/flights", async (req, res) => {
  try {
    const token = await getToken();
    const r = await fetch(`${API_BASE}/flights`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const txt = await r.text();
    res.status(r.status).send(txt);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* ===== health check ===== */
app.get("/", (req, res) => {
  res.send("VA EFB Proxy OK");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Proxy running on", port);
});
