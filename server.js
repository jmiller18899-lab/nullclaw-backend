// NullClaw Mission Control Proxy v3.1.0
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 8080;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514";
const AIS_ENDPOINT = process.env.AIS_ENDPOINT || "https://ais-dev-7xnr44njbt4rpm3lehtujx-7265454192.us-west2.run.app";

app.set("trust proxy", 1);
app.use(cors({ origin: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "2mb" }));

const MCP_DESCRIPTIONS = {
  gmail: "gmail — Send emails, read inbox, create drafts, search messages.",
  gcal: "gcal — Read calendar events, create events, check availability.",
  slack: "slack — Send messages, read channels, search.",
  notion: "notion — Create pages, search databases, read content.",
  canva: "canva — Create designs, search designs, manage brand kits.",
  vercel: "vercel — Check deployments, get project info, manage domains.",
  supabase: "supabase — Run SQL queries, manage databases, list tables.",
  linear: "linear — Create issues, search tickets, manage projects.",
  hubspot: "hubspot — Manage contacts, deals, CRM data.",
  cloudflare: "cloudflare — Manage Workers, KV, R2, DNS.",
  netlify: "netlify — Deploy sites, manage builds.",
  context7: "context7 — Look up live docs for libraries and APIs.",
  indeed: "indeed — Search jobs, get company data, manage resumes.",
  clawdy: "clawdy — Custom Clawdy Cloud operations.",
  superpowers: "superpowers — Brainstorming, TDD, subagent dev, systematic debugging.",
  composio: "composio — Connect to 500+ external apps and services.",
  agentteams: "agentteams — Spawn parallel Claude agents for subtasks.",
  skillcreator: "skillcreator — Create and evaluate custom SKILL.md files.",
  ralphloop: "ralphloop — Autonomous iterative loop until task is complete.",
};

// All 19 MCP server URLs
const ALL_MCP_SERVERS = [
  { type: "url", url: "https://gmail.mcp.claude.com/mcp", name: "gmail" },
  { type: "url", url: "https://gcal.mcp.claude.com/mcp", name: "gcal" },
  { type: "url", url: "https://mcp.slack.com/mcp", name: "slack" },
  { type: "url", url: "https://mcp.notion.com/mcp", name: "notion" },
  { type: "url", url: "https://mcp.canva.com/mcp", name: "canva" },
  { type: "url", url: "https://mcp.vercel.com", name: "vercel" },
  { type: "url", url: "https://mcp.supabase.com/mcp", name: "supabase" },
  { type: "url", url: "https://mcp.linear.app/mcp", name: "linear" },
  { type: "url", url: "https://mcp.hubspot.com/anthropic", name: "hubspot" },
  { type: "url", url: "https://bindings.mcp.cloudflare.com/mcp", name: "cloudflare" },
  { type: "url", url: "https://netlify-mcp.netlify.app/mcp", name: "netlify" },
  { type: "url", url: "https://mcp.indeed.com/claude/mcp", name: "indeed" },
  { type: "url", url: "https://mcp.context7.com/mcp", name: "context7" },
  { type: "url", url: "https://clawdycloud.com", name: "clawdy" },
  { type: "url", url: "https://github.com/obra/superpowers", name: "superpowers" },
  { type: "url", url: "https://github.com/ComposioHQ/awesome-claude-plugins", name: "composio" },
  { type: "url", url: "https://docs.anthropic.com", name: "agentteams" },
  { type: "url", url: "https://github.com/anthropics/claude-code/tree/main/plugins", name: "skillcreator" },
  { type: "url", url: "https://github.com/anthropics/claude-code", name: "ralphloop" },
];

function buildMcpBlock(list) {
  if (!list || list.length === 0) return "";
  const lines = list.map(s => "- " + (MCP_DESCRIPTIONS[s.name] || s.name));
  return "\n\nYOU HAVE " + list.length + " MCP TOOLS CONNECTED. These are real, not simulated.\nConnected: " + list.map(s => s.name).join(", ") + "\n\n" + lines.join("\n") + "\n\nRULES: Always invoke tools when relevant. Never simulate. Report real errors. Confirm actions with specifics. Use tools before general knowledge. Chain calls if needed.\n";
}

// Shared function to call Anthropic with MCP
async function callAnthropic({ messages, system, model, max_tokens, mcp_servers }) {
  const mcpList = mcp_servers || [];
  const useModel = model || DEFAULT_MODEL;
  const headers = { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" };
  if (mcpList.length > 0) headers["anthropic-beta"] = "mcp-client-2025-04-04";

  const body = { model: useModel, max_tokens: max_tokens || 4096, messages };
  const finalSystem = (system || "") + buildMcpBlock(mcpList);
  if (finalSystem) body.system = finalSystem;
  if (mcpList.length > 0) body.mcp_servers = mcpList;

  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
  const data = await r.json();
  if (data.error) throw { status: r.status, error: data.error };

  const toolUses = (data.content || []).filter(b => b.type === "tool_use" || b.type === "mcp_tool_use");
  const toolResults = (data.content || []).filter(b => b.type === "mcp_tool_result");

  return {
    content: data.content,
    model: data.model,
    usage: data.usage,
    stop_reason: data.stop_reason,
    mcp_servers_used: mcpList.map(s => s.name),
    _debug: { tool_calls: toolUses.map(t => t.name || "unknown"), tool_results: toolResults.length },
  };
}

// ═══════════════════════════════════════════════════════
//  POST /api/messages — Frontend proxy (MCP from client)
// ═══════════════════════════════════════════════════════
app.post("/api/messages", async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  const { messages, model, max_tokens, system, mcp_servers } = req.body || {};
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Missing messages array" });

  const mcpList = (mcp_servers || []).map(s => ({ type: "url", url: s.url, name: s.name }));
  console.log("[api/messages] " + messages.length + " msgs, mcp=" + mcpList.length);

  try {
    const result = await callAnthropic({ messages, system, model, max_tokens, mcp_servers: mcpList });
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.error || err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  POST /api/task — AI Studio passthrough
//  Accepts a task from AI Studio, runs it through
//  Anthropic with all 19 MCP connectors, returns result.
//
//  Body: { task: "string", agent?: "chief|engineer|...",
//          context?: "extra context", model?: "..." }
//  Or:   { messages: [...], system?: "...", model?: "..." }
// ═══════════════════════════════════════════════════════
const AGENT_SYSTEMS = {
  chief: "You are the Chief of Staff — the central coordinator of a team of narrow AI agents. Route tasks, coordinate across agents, provide strategic oversight.",
  content: "You are the Content Agent — focused on YouTube content creation, scripts, thumbnails, competitor analysis, and content calendars.",
  newsletter: "You are the Newsletter Agent — focused on email newsletters, subject line optimization, audience segmentation, and A/B testing.",
  growth: "You are the Growth Agent — focused on MRR growth, churn reduction, funnel optimization, pricing strategy, and growth experiments.",
  engineer: "You are the Engineering Agent — focused on code review, architecture, bug triage, sprint planning, TDD, and shipping features.",
  journal: "You are the Journal Agent — focused on capturing decisions, daily logging, meeting summaries, and building a knowledge base for the team.",
};

app.post("/api/task", async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const { task, agent, context, messages, system, model, max_tokens, mcp_servers } = req.body || {};

  // Support both simple task string and full messages array
  let finalMessages;
  let finalSystem;

  if (messages && Array.isArray(messages)) {
    finalMessages = messages;
    finalSystem = system || "";
  } else if (task) {
    finalMessages = [{ role: "user", content: context ? (context + "\n\nTask: " + task) : task }];
    finalSystem = AGENT_SYSTEMS[agent] || AGENT_SYSTEMS.chief;
  } else {
    return res.status(400).json({ error: "Missing 'task' string or 'messages' array" });
  }

  // Use provided MCP servers or default to all 19
  const mcpList = mcp_servers ? mcp_servers.map(s => ({ type: "url", url: s.url, name: s.name })) : ALL_MCP_SERVERS;

  console.log("[api/task] agent=" + (agent || "chief") + ", mcp=" + mcpList.length + ", task=" + (task || "custom messages").slice(0, 80));

  try {
    const result = await callAnthropic({ messages: finalMessages, system: finalSystem, model, max_tokens, mcp_servers: mcpList });
    return res.json({ ...result, agent: agent || "chief", source: "ai-studio-task" });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.error || err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  POST /api/relay — Relay TO AI Studio from MC
//  Forwards a request from Mission Control to AI Studio
// ═══════════════════════════════════════════════════════
app.post("/api/relay", async (req, res) => {
  const { prompt, endpoint } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  const target = endpoint || AIS_ENDPOINT;
  console.log("[api/relay] forwarding to AI Studio: " + target);

  try {
    const r = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await r.json();
    return res.json({ source: "ai-studio", response: data });
  } catch (err) {
    return res.status(500).json({ error: "AI Studio relay failed: " + err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  GET endpoints
// ═══════════════════════════════════════════════════════
app.get("/health", (_, res) => res.json({
  status: "ok", version: "3.1.0",
  anthropic_key: ANTHROPIC_KEY ? "configured" : "MISSING",
  mcp_support: true, mcp_connectors: 19,
  ais_endpoint: AIS_ENDPOINT,
}));

app.get("/", (_, res) => res.json({
  service: "NullClaw Mission Control Proxy", version: "3.1.0",
  endpoints: {
    health: "GET /health",
    messages: "POST /api/messages — Frontend chat with MCP (client sends connectors)",
    task: "POST /api/task — AI Studio passthrough (auto-includes all 19 MCP connectors)",
    relay: "POST /api/relay — Forward prompt to AI Studio endpoint",
  },
  mcp_support: true, mcp_connectors: 19,
}));

// ─── Hermes proxy: /api/hermes → Hermes /v1/chat/completions ──
app.post('/api/hermes', async (req, res) => {
  const hermesUrl = req.headers['x-ic-url'] || 'https://hermes-agent-production-61e5.up.railway.app';
  try {
    const response = await fetch(hermesUrl.replace(/\/$/, '') + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const rawText = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(rawText);
  } catch (err) {
    console.error('[hermes-proxy] Fetch error:', err.message);
    res.status(502).json({ error: `Hermes proxy failed: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log("[nullclaw-proxy] v3.1.0 on port " + PORT);
  console.log("[nullclaw-proxy] AIS_ENDPOINT: " + AIS_ENDPOINT);
  console.log("[nullclaw-proxy] MCP connectors: 19");
  console.log("[nullclaw-proxy] ANTHROPIC_API_KEY: " + (ANTHROPIC_KEY ? "set" : "MISSING"));
});

