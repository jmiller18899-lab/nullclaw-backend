// NullClaw Mission Control Proxy v3.0.0
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 8080;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514";

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

function buildMcpBlock(list) {
  if (!list || list.length === 0) return "";
  const lines = list.map(s => "- " + (MCP_DESCRIPTIONS[s.name] || s.name));
  return "\n\nYOU HAVE " + list.length + " MCP TOOLS CONNECTED. These are real, not simulated.\nConnected: " + list.map(s => s.name).join(", ") + "\n\n" + lines.join("\n") + "\n\nRULES: Always invoke tools when relevant. Never simulate. Report real errors. Confirm actions with specifics. Use tools before general knowledge. Chain calls if needed.\n";
}

app.post("/api/messages", async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const { messages, model, max_tokens, system, mcp_servers } = req.body || {};
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Missing messages array" });

  const mcpList = (mcp_servers || []).map(s => ({ type: "url", url: s.url, name: s.name }));
  const useModel = model || DEFAULT_MODEL;
  const headers = { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" };
  if (mcpList.length > 0) headers["anthropic-beta"] = "mcp-client-2025-04-04";

  const body = { model: useModel, max_tokens: max_tokens || 4096, messages };
  const finalSystem = (system || "") + buildMcpBlock(mcpList);
  if (finalSystem) body.system = finalSystem;
  if (mcpList.length > 0) body.mcp_servers = mcpList;

  console.log("[api/messages] " + messages.length + " msgs, mcp=" + mcpList.length);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
    const data = await r.json();
    if (data.error) return res.status(r.status || 500).json({ error: data.error });

    const toolUses = (data.content || []).filter(b => b.type === "tool_use" || b.type === "mcp_tool_use");
    const toolResults = (data.content || []).filter(b => b.type === "mcp_tool_result");

    return res.json({
      content: data.content,
      model: data.model,
      usage: data.usage,
      stop_reason: data.stop_reason,
      mcp_servers_used: mcpList.map(s => s.name),
      _debug: { tool_calls: toolUses.map(t => t.name || "unknown"), tool_results: toolResults.length },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_, res) => res.json({ status: "ok", version: "3.0.0", anthropic_key: ANTHROPIC_KEY ? "configured" : "MISSING", mcp_support: true }));
app.get("/", (_, res) => res.json({ service: "NullClaw Mission Control Proxy", version: "3.0.0", endpoints: { health: "GET /health", messages: "POST /api/messages" }, mcp_support: true }));

app.listen(PORT, () => console.log("[nullclaw-proxy] v3.0.0 on port " + PORT));

