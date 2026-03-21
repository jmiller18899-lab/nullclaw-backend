// nullclaw REST bridge — Railway deployment
// Supports all 14 MCP connectors via Anthropic's MCP client beta

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

// Build MCP tool awareness block for system prompts
function buildMcpSystemBlock(mcpList) {
if (!mcpList || mcpList.length === 0) return "";
const descriptions = {
gmail: "gmail — Send emails, read inbox, create drafts, search messages. Use when asked to email anyone.",
gcal: "gcal — Read calendar events, create events, check availability. Use for scheduling or calendar questions.",
slack: "slack — Send messages to channels, read channels, search. Use when asked to post to or read Slack.",
notion: "notion — Create pages, search databases, read content. Use for Notion workspace tasks.",
canva: "canva — Create designs, search designs, manage brand kits. Use for design tasks.",
vercel: "vercel — Check deployments, get project info, manage domains. Use for deployment status.",
supabase: "supabase — Run SQL queries, manage databases, list tables. Use for database operations.",
linear: "linear — Create issues, search tickets, manage projects. Use for issue tracking.",
hubspot: "hubspot — Manage contacts, deals, CRM data. Use for CRM operations.",
cloudflare: "cloudflare — Manage Workers, KV, R2, DNS. Use for edge/infrastructure tasks.",
etlify: "netlify — Deploy sites, manage builds. Use for Netlify deployments.",
context7: "context7 — Look up live documentation for libraries and APIs. Use before implementing with external libraries.",
indeed: "indeed — Search jobs, get company data, manage resumes. Use for job-related queries.",
clawdy: "clawdy — Custom Clawdy Cloud operations.",
};
return `

## YOUR MCP TOOLS — ACTIVE AND READY

You have ${mcpList.length} real MCP (Model Context Protocol) server tools connected. These are NOT simulated. When you invoke them, real actions happen in the real world.

Connected tools: ${mcpList.map(s => s.name).join(", ")}

Tool reference:
${mcpList.map(s => "- " + (descriptions[s.name] || `${s.name} — MCP tool at ${s.url}`)).join("\n")}

CRITICAL RULES:

1. When the user asks you to do something that matches a tool, ALWAYS invoke it. Never say "I would do X" — actually do it.
1. Never simulate or pretend. Tool calls trigger real actions.
1. If a tool call fails, report the actual error honestly.
1. After completing a tool action, confirm exactly what happened with specifics.
1. If the user asks about something and a relevant tool exists, use the tool first rather than answering from general knowledge.
1. You may need to call tools multiple times or chain tool calls to fulfill a request.
   `;
}

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
    system: `You are nullclaw, a fully autonomous AI assistant runtime enhanced with Mission Control.` + buildMcpSystemBlock(mcpServers),
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

// ═══════════════════════════════════════════════════════════
//  SIMPLE /api/messages ENDPOINT (no pairing required)
//  Accepts mcp_servers from frontend and passes to Anthropic
// ═══════════════════════════════════════════════════════════
app.post("/api/messages", async (req, res) => {
if (!ANTHROPIC_KEY) {
return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server" });
}

const { messages, model, max_tokens, system, mcp_servers } = req.body || {};
if (!messages || !Array.isArray(messages)) {
return res.status(400).json({ error: "Missing messages array" });
}

console.log(`[api/messages] ${messages.length} msgs, model=${model || "default"}, mcp=${(mcp_servers || []).length} servers`);

try {
// Merge frontend-provided MCP servers with server-side token-authenticated ones
const serverMcp = getActiveMcpServers(); // from MCP_TOKEN_* env vars
const frontendMcp = (mcp_servers || []).map(s => ({
type: "url",
url:  s.url,
name: s.name,
// If server has a token for this service, attach it
…(serverMcp.find(sm => sm.name === s.name)?.authorization_token
? { authorization_token: serverMcp.find(sm => sm.name === s.name).authorization_token }
: {}),
}));

// Deduplicate: prefer server-side (has auth tokens) over frontend-only
const seenNames = new Set();
const allMcp = [];
for (const s of serverMcp) { allMcp.push(s); seenNames.add(s.name); }
for (const s of frontendMcp) { if (!seenNames.has(s.name)) { allMcp.push(s); seenNames.add(s.name); } }

const useModel = model || process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514";
const headers = {
  "Content-Type":      "application/json",
  "x-api-key":         ANTHROPIC_KEY,
  "anthropic-version": "2023-06-01",
};
// Only add MCP beta header if we have MCP servers
if (allMcp.length > 0) {
  headers["anthropic-beta"] = "mcp-client-2025-04-04";
}

const body = {
  model:      useModel,
  max_tokens: max_tokens || 4096,
  messages:   messages,
};

// Build enhanced system prompt with MCP tool awareness
const mcpBlock = buildMcpSystemBlock(allMcp);
const finalSystem = (system || "") + mcpBlock;
if (finalSystem) body.system = finalSystem;
if (allMcp.length > 0) body.mcp_servers = allMcp;

console.log(`[api/messages] calling Anthropic: model=${useModel}, mcp_servers=${allMcp.length} [${allMcp.map(s => s.name).join(", ")}]`);

const r = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});

const data = await r.json();

if (data.error) {
  console.error("[api/messages] Anthropic error:", data.error);
  return res.status(r.status || 500).json({
    error: data.error,
    mcp_servers_sent: allMcp.map(s => s.name),
  });
}

// Extract text from response (Anthropic resolves MCP tool loops server-side)
const textParts = (data.content || []).filter(b => b.type === "text").map(b => b.text);
const toolUses = (data.content || []).filter(b => b.type === "tool_use" || b.type === "mcp_tool_use");
const toolResults = (data.content || []).filter(b => b.type === "mcp_tool_result");

console.log(`[api/messages] response: ${textParts.length} text blocks, ${toolUses.length} tool calls, ${toolResults.length} tool results`);

return res.json({
  content:           data.content,
  model:             data.model,
  usage:             data.usage,
  stop_reason:       data.stop_reason,
  mcp_servers_used:  allMcp.map(s => s.name),
  _debug: {
    tool_calls:   toolUses.map(t => t.name || t.tool_name || "unknown"),
    tool_results: toolResults.length,
    text_blocks:  textParts.length,
  },
});

} catch (err) {
console.error("[api/messages] error:", err);
return res.status(500).json({ error: err.message });
}
});

// ── GET /health ──────────────────────────────────────────────
app.get("/health", (_, res) => res.json({
ok:              true,
version:         "2.1.0",
sessions:        sessions.size,
max_history:     MAX_HISTORY,
mcp_with_tokens: getActiveMcpServers().map(s => s.name),
mcp_registry:    MCP_REGISTRY.map(s => s.name),
anthropic_key:   ANTHROPIC_KEY ? "configured" : "MISSING",
}));

// ── GET / (root) ─────────────────────────────────────────────
app.get("/", (_, res) => res.json({
name:    "nullclaw-backend",
version: "2.1.0",
status:  "running",
endpoints: ["/health", "/pair", "/message", "/api/messages", "/switch-model", "/history"],
}));

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
const active = getActiveMcpServers().map(s => s.name);
console.log(`[nullclaw-proxy] Running on port ${PORT}`);
console.log(`[nullclaw-proxy] ALLOWED_ORIGIN: ${ALLOWED_ORIGIN}`);
console.log(`[nullclaw-proxy] active MCP tools: ${active.length ? active.join(", ") : "none — set MCP_TOKEN_* env vars"}`);
});