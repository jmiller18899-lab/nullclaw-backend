// NullClaw Mission Control Proxy v3.0.0
// Railway backend with MCP connector support
//
// Endpoints:
//   GET  /             - Service info
//   GET  /health       - Health check
//   POST /api/messages - Proxy to Anthropic with MCP tools
//
// Required env vars:  ANTHROPIC_API_KEY
// Optional env vars:  ALLOWED_ORIGIN, PORT, DEFAULT_MODEL

import express from “express”;
import cors from “cors”;

const app = express();
const PORT = process.env.PORT || 8080;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || “*”;
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || “claude-sonnet-4-20250514”;

// Railway reverse proxy fix
app.set(“trust proxy”, 1);

// ── CORS ──
app.use(cors({
origin: ALLOWED_ORIGIN === “*” ? true : ALLOWED_ORIGIN.split(”,”).map(s => s.trim()),
methods: [“GET”, “POST”, “OPTIONS”],
allowedHeaders: [“Content-Type”, “Authorization”],
}));
app.use(express.json({ limit: “2mb” }));

// ── Simple rate limiter (no external deps) ──
const rateMap = new Map();
const RATE_WINDOW = 60000;
const RATE_MAX = 30;
app.use((req, res, next) => {
const ip = req.ip || “unknown”;
const now = Date.now();
const entry = rateMap.get(ip);
if (!entry || now - entry.start > RATE_WINDOW) {
rateMap.set(ip, { start: now, count: 1 });
return next();
}
if (++entry.count > RATE_MAX) return res.status(429).json({ error: “Rate limited” });
next();
});
setInterval(() => {
const cutoff = Date.now() - RATE_WINDOW;
for (const [ip, e] of rateMap) if (e.start < cutoff) rateMap.delete(ip);
}, 300000);

// ── MCP tool descriptions for system prompt injection ──
const MCP_DESCRIPTIONS = {
gmail:       “gmail — Send emails, read inbox, create drafts, search messages. Use when asked to email anyone.”,
gcal:        “gcal — Read calendar events, create events, check availability. Use for scheduling or calendar questions.”,
slack:       “slack — Send messages, read channels, search. Use when asked to post to or read Slack.”,
notion:      “notion — Create pages, search databases, read content. Use for Notion workspace tasks.”,
canva:       “canva — Create designs, search designs, manage brand kits. Use for design tasks.”,
vercel:      “vercel — Check deployments, get project info, manage domains. Use for deployment status.”,
supabase:    “supabase — Run SQL queries, manage databases, list tables. Use for database operations.”,
linear:      “linear — Create issues, search tickets, manage projects. Use for issue tracking.”,
hubspot:     “hubspot — Manage contacts, deals, CRM data. Use for CRM operations.”,
cloudflare:  “cloudflare — Manage Workers, KV, R2, DNS. Use for edge/infrastructure tasks.”,
netlify:     “netlify — Deploy sites, manage builds. Use for Netlify deployments.”,
context7:    “context7 — Look up live docs for libraries and APIs. Use before implementing with external libraries.”,
indeed:      “indeed — Search jobs, get company data, manage resumes. Use for job-related queries.”,
clawdy:      “clawdy — Custom Clawdy Cloud operations and integrations.”,
superpowers: “superpowers — Brainstorming, TDD, writing plans, subagent-driven development, git worktrees, systematic debugging. Use for structured engineering workflows.”,
composio:    “composio — Connect to 500+ external apps and services (GitHub, Jira, Asana, Salesforce, etc). Use when the user needs an integration not covered by other tools.”,
agentteams:  “agentteams — Spawn parallel Claude agents that work simultaneously on different subtasks. Use for complex multi-step projects that benefit from parallel execution.”,
skillcreator:“skillcreator — Create, refine, and evaluate custom SKILL.md files with frontmatter, workflows, and output formats. Use when the user wants to build a new skill.”,
ralphloop:   “ralphloop — Autonomous iterative loop: plan, implement, test, review, fix, repeat until complete. Use when given a complex task that needs multiple passes to get right.”,
};

function buildMcpSystemBlock(mcpList) {
if (!mcpList || mcpList.length === 0) return “”;
return `

## YOUR MCP TOOLS — ACTIVE AND READY

You have ${mcpList.length} real MCP (Model Context Protocol) server tools connected. These are NOT simulated. When you invoke them, real actions happen.

Connected: ${mcpList.map(s => s.name).join(”, “)}

Tool reference:
${mcpList.map(s => “- “ + (MCP_DESCRIPTIONS[s.name] || `${s.name} — MCP tool at ${s.url}`)).join(”\n”)}

RULES:

1. When the user asks you to do something that matches a tool, ALWAYS invoke it. Never say “I would” — actually do it.
1. Never simulate. Tool calls trigger real actions.
1. If a tool fails, report the actual error.
1. After a tool action, confirm exactly what happened with specifics.
1. Use tools before answering from general knowledge when relevant.
1. Chain multiple tool calls if needed to fulfill the request.
   `;
   }

// ═══════════════════════════════════════════════════════
//  POST /api/messages — Main proxy endpoint with MCP
// ═══════════════════════════════════════════════════════
app.post(”/api/messages”, async (req, res) => {
if (!ANTHROPIC_KEY) {
return res.status(500).json({ error: “ANTHROPIC_API_KEY not configured” });
}

const { messages, model, max_tokens, system, mcp_servers } = req.body || {};
if (!messages || !Array.isArray(messages)) {
return res.status(400).json({ error: “Missing messages array” });
}

const mcpList = (mcp_servers || []).map(s => ({
type: “url”,
url: s.url,
name: s.name,
}));

const useModel = model || DEFAULT_MODEL;

// Build headers
const headers = {
“Content-Type”: “application/json”,
“x-api-key”: ANTHROPIC_KEY,
“anthropic-version”: “2023-06-01”,
};
if (mcpList.length > 0) {
headers[“anthropic-beta”] = “mcp-client-2025-04-04”;
}

// Build system prompt with MCP tool awareness
const mcpBlock = buildMcpSystemBlock(mcpList);
const finalSystem = (system || “”) + mcpBlock;

// Build request body
const body = {
model: useModel,
max_tokens: max_tokens || 4096,
messages,
};
if (finalSystem) body.system = finalSystem;
if (mcpList.length > 0) body.mcp_servers = mcpList;

console.log(`[api/messages] ${messages.length} msgs, model=${useModel}, mcp=${mcpList.length} [${mcpList.map(s => s.name).join(",")}]`);

try {
const r = await fetch(“https://api.anthropic.com/v1/messages”, {
method: “POST”,
headers,
body: JSON.stringify(body),
});

```
const data = await r.json();

if (data.error) {
  console.error("[api/messages] Anthropic error:", data.error);
  return res.status(r.status || 500).json({
    error: data.error,
    mcp_servers_sent: mcpList.map(s => s.name),
  });
}

// Parse response
const textParts = (data.content || []).filter(b => b.type === "text").map(b => b.text);
const toolUses = (data.content || []).filter(b => b.type === "tool_use" || b.type === "mcp_tool_use");
const toolResults = (data.content || []).filter(b => b.type === "mcp_tool_result");

console.log(`[api/messages] response: ${textParts.length} text, ${toolUses.length} tool calls, ${toolResults.length} tool results`);

return res.json({
  content: data.content,
  model: data.model,
  usage: data.usage,
  stop_reason: data.stop_reason,
  mcp_servers_used: mcpList.map(s => s.name),
  _debug: {
    tool_calls: toolUses.map(t => t.name || t.tool_name || "unknown"),
    tool_results: toolResults.length,
    text_blocks: textParts.length,
  },
});
```

} catch (err) {
console.error(”[api/messages] error:”, err);
return res.status(500).json({ error: err.message });
}
});

// ── GET /health ──
app.get(”/health”, (_, res) => res.json({
status: “ok”,
version: “3.0.0”,
anthropic_key: ANTHROPIC_KEY ? “configured” : “MISSING”,
mcp_support: true,
mcp_beta: “mcp-client-2025-04-04”,
}));

// ── GET / ──
app.get(”/”, (_, res) => res.json({
service: “NullClaw Mission Control Proxy”,
version: “3.0.0”,
endpoints: {
health: “GET /health”,
messages: “POST /api/messages”,
},
mcp_support: true,
}));

// ── Start ──
app.listen(PORT, () => {
console.log(`[nullclaw-proxy] v3.0.0 running on port ${PORT}`);
console.log(`[nullclaw-proxy] ALLOWED_ORIGIN: ${ALLOWED_ORIGIN}`);
console.log(`[nullclaw-proxy] MCP beta: mcp-client-2025-04-04`);
console.log(`[nullclaw-proxy] ANTHROPIC_API_KEY: ${ANTHROPIC_KEY ? "set" : "MISSING"}`);
});
