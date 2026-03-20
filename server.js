
// nullclaw REST bridge — Railway deployment
// Supports all 14 MCP connectors via Anthropic's MCP client beta
//
// Required env vars:
//   PAIRING_CODE, ANTHROPIC_API_KEY
//
// Optional env vars:
//   DEFAULT_MODEL, MAX_HISTORY
//
// Add one env var per MCP service you want active (all optional):
//   MCP_TOKEN_GMAIL, MCP_TOKEN_GCAL, MCP_TOKEN_SLACK, MCP_TOKEN_NOTION
//   MCP_TOKEN_CANVA, MCP_TOKEN_VERCEL, MCP_TOKEN_SUPABASE
//   MCP_TOKEN_HUBSPOT, MCP_TOKEN_LINEAR, MCP_TOKEN_CLOUDFLARE
//   MCP_TOKEN_NETLIFY, MCP_TOKEN_CONTEXT7, MCP_TOKEN_INDEED
//   MCP_TOKEN_CLAWDY

import express from "express";
import cors from "cors";
import crypto from "crypto";

const app  = express();
const PORT = process.env.PORT || 8080;

// ═══════════════════════════════════════════════════════════
//  FIX: Trust Railway's reverse proxy so express-rate-limit
//  can read X-Forwarded-For without crashing
// ═══════════════════════════════════════════════════════════
app.set("trust proxy", 1);

const PAIRING_CODE  = process.env.PAIRING_CODE     || "123456";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MAX_HISTORY   = parseInt(process.env.MAX_HISTORY || "40");
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// ── MCP server registry ──────────────────────────────────────
// Each entry: { name, url, envKey }
// Only included in API calls when the corresponding env var is set
const MCP_REGISTRY = [
{ name: "gmail",       url: "https://gmail.mcp.claude.com/mcp",          envKey: "MCP_TOKEN_GMAIL"      },
{ name: "gcal",        url: "https://gcal.mcp.claude.com/mcp",           envKey: "MCP_TOKEN_GCAL"       },
{ name: "slack",       url: "https://mcp.slack.com/mcp",                 envKey: "MCP_TOKEN_SLACK"      },
{ name: "notion",      url: "https://mcp.notion.com/mcp",                envKey: "MCP_TOKEN_NOTION"     },
{ name: "canva",       url: "https://mcp.canva.com/mcp",                 envKey: "MCP_TOKEN_CANVA"      },
{ name: "vercel",      url: "https://mcp.vercel.com",                    envKey: "MCP_TOKEN_VERCEL"     },
{ name: "supabase",    url: "https://mcp.supabase.com/mcp",              envKey: "MCP_TOKEN_SUPABASE"   },
{ name: "hubspot",     url: "https://mcp.hubspot.com/anthropic",         envKey: "MCP_TOKEN_HUBSPOT"    },
{ name: "linear",      url: "https://mcp.linear.app/mcp",                envKey: "MCP_TOKEN_LINEAR"     },
{ name: "cloudflare",  url: "https://bindings.mcp.cloudflare.com/mcp",   envKey: "MCP_TOKEN_CLOUDFLARE" },
{ name: "netlify",     url: "https://netlify-mcp.netlify.app/mcp",       envKey: "MCP_TOKEN_NETLIFY"    },
{ name: "context7",    url: "https://mcp.context7.com/mcp",              envKey: "MCP_TOKEN_CONTEXT7"   },
{ name: "indeed",      url: "https://mcp.indeed.com/claude/mcp",         envKey: "MCP_TOKEN_INDEED"     },
{ name: "clawdy",      url: "https://clawdycloud.com",                   envKey: "MCP_TOKEN_CLAWDY"     },
];

// Build active MCP server list from env vars
function getActiveMcpServers() {
return MCP_REGISTRY
.filter(s => process.env[s.envKey])
.map(s => ({
type:                "url",
url:                 s.url,
name:                s.name,
authorization_token: process.env[s.envKey],
}));
}

// ── Session store ────────────────────────────────────────────
// token -> { session_id, model, history, created, lastActive }
const sessions = new Map();

// Clean up stale sessions every 15 min
setInterval(() => {
const cutoff = Date.now() - 2 * 60 * 60 * 1000;
for (const [token, s] of sessions)
if (s.lastActive < cutoff) sessions.delete(token);
}, 15 * 60 * 1000);

// ── Middleware ───────────────────────────────────────────────
app.use(cors({
origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN.split(",").map(s => s.trim()),
methods: ["GET", "POST", "DELETE", "OPTIONS"],
allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// ── Simple rate limiter (no external deps) ───────────────────
const rateLimitMap = new Map();
const RATE_WINDOW = 60000; // 1 minute
const RATE_MAX = parseInt(process.env.RATE_LIMIT || "30");

function rateLimit(req, res, next) {
const ip = req.ip || req.connection.remoteAddress || "unknown";
const now = Date.now();
const entry = rateLimitMap.get(ip);
if (!entry || now - entry.start > RATE_WINDOW) {
rateLimitMap.set(ip, { start: now, count: 1 });
return next();
}
entry.count++;
if (entry.count > RATE_MAX) {
return res.status(429).json({ error: "Rate limited. Try again in a minute." });
}
return next();
}

app.use(rateLimit);

// Clean rate limit map every 5 min
setInterval(() => {
const cutoff = Date.now() - RATE_WINDOW;
for (const [ip, entry] of rateLimitMap)
if (entry.start < cutoff) rateLimitMap.delete(ip);
}, 5 * 60 * 1000);

// ── Helpers ──────────────────────────────────────────────────
const makeToken = () => crypto.randomBytes(24).toString("hex");

function getSession(req) {
const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
const session = token ? sessions.get(token) ?? null : null;
if (session) session.lastActive = Date.now();
return session;
}

function trimHistory(h) {
return h.length <= MAX_HISTORY ? h : h.slice(h.length - MAX_HISTORY);
}

// ── POST /pair ───────────────────────────────────────────────
app.post("/pair", (req, res) => {
const { session_id, pairing_code } = req.body || {};
if (pairing_code !== PAIRING_CODE) {
return res.status(401).json({ error: "Invalid pairing code" });
}
const token = makeToken();
sessions.set(token, {
session_id: session_id || "unknown",
model: process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514",
history: [],
created: Date.now(),
lastActive: Date.now(),
});
console.log(`[pair] session ${session_id} paired`);
return res.json({ access_token: token });
});

// ── POST /message ────────────────────────────────────────────
app.post("/message", async (req, res) => {
const session = getSession(req);
if (!session) return res.status(401).json({ error: "Invalid or expired token" });

const { content } = req.body || {};
if (!content) return res.status(400).json({ error: "Missing content" });

console.log(`[message] ${session.session_id}: ${content.slice(0, 80)}`);

if (!ANTHROPIC_KEY) {
return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server" });
}

session.history.push({ role: "user", content });

try {
const mcpServers = getActiveMcpServers();

const r = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type":      "application/json",
    "x-api-key":         ANTHROPIC_KEY,
    "anthropic-version": "2023-06-01",
    "anthropic-beta":    "mcp-client-2025-04-04",
  },
  body: JSON.stringify({
    model:      session.model,
    max_tokens: 4096,
    system: `You are nullclaw, a fully autonomous AI assistant runtime enhanced with Mission Control.

You have real MCP tools connected. IMPORTANT RULES:

- Always use your tools to take real actions. Never simulate or pretend.
- When asked to send an email, actually send it via the gmail tool.
- When asked to create a calendar event, use the gcal tool.
- When asked to message someone on Slack, use the slack tool.
- Confirm what you did after completing an action.
  Active tools: ${mcpServers.map(s => s.name).join(", ") || "none configured"}.`,
    messages:    session.history,
    ...(mcpServers.length > 0 && { mcp_servers: mcpServers }),
  }),
});

const d = await r.json();
if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));

// Extract text reply — Anthropic resolves the full MCP tool loop before returning
const reply = d.content
  ?.filter(b => b.type === "text")
  .map(b => b.text)
  .join("\n")
  || "Done.";

session.history.push({ role: "assistant", content: reply });
session.history = trimHistory(session.history);

return res.json({
  content: reply,
  history_length: session.history.length,
  tools_active: mcpServers.map(s => s.name),
});

} catch (err) {
  console.error("[message] error:", err);
  session.history.pop(); // roll back user turn on error
  return res.status(500).json({ error: err.message });
}
});

// ── POST /switch-model ───────────────────────────────────────
app.post("/switch-model", (req, res) => {
const session = getSession(req);
const { model } = req.body || {};
if (!model) return res.status(400).json({ error: "Missing model" });
if (session) session.model = model;
return res.json({ success: true, message: `Now using **${model}**` });
});

// ── DELETE /history ──────────────────────────────────────────
app.delete("/history", (req, res) => {
const session = getSession(req);
if (!session) return res.status(401).json({ error: "Invalid token" });
const cleared = session.history.length;
session.history = [];
return res.json({ success: true, cleared });
});

// ── GET /history ─────────────────────────────────────────────
app.get("/history", (req, res) => {
const session = getSession(req);
if (!session) return res.status(401).json({ error: "Invalid token" });
return res.json({ history: session.history, model: session.model });
});

// ── GET /health ──────────────────────────────────────────────
app.get("/health", (_, res) => res.json({
ok:           true,
sessions:     sessions.size,
max_history:  MAX_HISTORY,
tools_active: getActiveMcpServers().map(s => s.name),
}));

// ── GET / (root) ─────────────────────────────────────────────
app.get("/", (_, res) => res.json({
name:    "nullclaw-backend",
version: "2.0.0",
status:  "running",
endpoints: ["/health", "/pair", "/message", "/switch-model", "/history"],
}));

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
const active = getActiveMcpServers().map(s => s.name);
console.log(`[nullclaw-proxy] Running on port ${PORT}`);
console.log(`[nullclaw-proxy] ALLOWED_ORIGIN: ${ALLOWED_ORIGIN}`);
console.log(`[nullclaw-proxy] active MCP tools: ${active.length ? active.join(", ") : "none — set MCP_TOKEN_* env vars"}`);
});
