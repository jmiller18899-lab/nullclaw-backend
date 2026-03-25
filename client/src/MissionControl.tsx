import { useState, useRef, useEffect } from "react";
import {
  Send, Settings, Zap, ChevronDown, ChevronUp,
  CheckSquare, Square, RotateCcw, Bot, MessageSquare,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface McpServer {
  name: string;
  url: string;
  description: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  agent?: string;
  mcpUsed?: string[];
  model?: string;
  error?: boolean;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MCP_SERVERS: McpServer[] = [
  { name: "gmail",       url: "https://gmail.mcp.claude.com/mcp",                          description: "Send emails, read inbox, create drafts" },
  { name: "gcal",        url: "https://gcal.mcp.claude.com/mcp",                           description: "Calendar events, scheduling" },
  { name: "slack",       url: "https://mcp.slack.com/mcp",                                 description: "Send messages, read channels" },
  { name: "notion",      url: "https://mcp.notion.com/mcp",                                description: "Create pages, search databases" },
  { name: "canva",       url: "https://mcp.canva.com/mcp",                                 description: "Create designs, manage brand kits" },
  { name: "vercel",      url: "https://mcp.vercel.com",                                    description: "Check deployments, manage domains" },
  { name: "supabase",    url: "https://mcp.supabase.com/mcp",                              description: "Run SQL, manage databases" },
  { name: "linear",      url: "https://mcp.linear.app/mcp",                                description: "Create issues, manage projects" },
  { name: "hubspot",     url: "https://mcp.hubspot.com/anthropic",                         description: "Manage contacts, deals, CRM" },
  { name: "cloudflare",  url: "https://bindings.mcp.cloudflare.com/mcp",                   description: "Workers, KV, R2, DNS" },
  { name: "netlify",     url: "https://netlify-mcp.netlify.app/mcp",                       description: "Deploy sites, manage builds" },
  { name: "indeed",      url: "https://mcp.indeed.com/claude/mcp",                         description: "Search jobs, company data" },
  { name: "context7",    url: "https://mcp.context7.com/mcp",                              description: "Live docs for libraries & APIs" },
  { name: "clawdy",      url: "https://clawdycloud.com",                                   description: "Custom Clawdy Cloud operations" },
  { name: "superpowers", url: "https://github.com/obra/superpowers",                       description: "Brainstorming, TDD, debugging" },
  { name: "composio",    url: "https://github.com/ComposioHQ/awesome-claude-plugins",      description: "500+ external apps & services" },
  { name: "agentteams",  url: "https://docs.anthropic.com",                                description: "Spawn parallel Claude agents" },
  { name: "skillcreator",url: "https://github.com/anthropics/claude-code/tree/main/plugins", description: "Create custom SKILL.md files" },
  { name: "ralphloop",   url: "https://github.com/anthropics/claude-code",                 description: "Autonomous iterative loop" },
];

const AGENTS = [
  { id: "chief",      label: "Chief of Staff",     color: "#7c3aed" },
  { id: "engineer",   label: "Engineering",         color: "#0ea5e9" },
  { id: "growth",     label: "Growth",              color: "#10b981" },
  { id: "content",    label: "Content",             color: "#f59e0b" },
  { id: "newsletter", label: "Newsletter",          color: "#ec4899" },
  { id: "journal",    label: "Journal",             color: "#6366f1" },
];

const MODELS = [
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
  "claude-haiku-4-5-20251001",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(content: ContentBlock[] | string): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n\n");
}

// ── Sub-components ────────────────────────────────────────────────────────────

function McpPanel({
  selected,
  onChange,
}: {
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);

  function toggle(name: string) {
    const next = new Set(selected);
    next.has(name) ? next.delete(name) : next.add(name);
    onChange(next);
  }

  function toggleAll() {
    if (selected.size === MCP_SERVERS.length) onChange(new Set());
    else onChange(new Set(MCP_SERVERS.map((s) => s.name)));
  }

  return (
    <div style={{ borderTop: "1px solid #2a2a3a", marginTop: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "10px 16px", background: "none",
          border: "none", color: "#a0a0c0", cursor: "pointer", fontSize: 13,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Zap size={14} />
          MCP Connectors ({selected.size}/{MCP_SERVERS.length})
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          <button
            onClick={toggleAll}
            style={{
              fontSize: 11, color: "#7c3aed", background: "none", border: "none",
              cursor: "pointer", marginBottom: 8, padding: "2px 4px",
            }}
          >
            {selected.size === MCP_SERVERS.length ? "Deselect all" : "Select all"}
          </button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {MCP_SERVERS.map((s) => {
              const on = selected.has(s.name);
              return (
                <button
                  key={s.name}
                  onClick={() => toggle(s.name)}
                  title={s.description}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 8px", background: on ? "#1a1a2e" : "transparent",
                    border: `1px solid ${on ? "#7c3aed55" : "#2a2a3a"}`,
                    borderRadius: 6, cursor: "pointer", color: on ? "#c4b5fd" : "#606080",
                    fontSize: 12, textAlign: "left",
                  }}
                >
                  {on ? <CheckSquare size={12} /> : <Square size={12} />}
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ChatBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        display: "flex", flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        marginBottom: 16,
      }}
    >
      {!isUser && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <Bot size={12} style={{ color: "#7c3aed" }} />
          <span style={{ fontSize: 11, color: "#606080" }}>
            {msg.agent ? `${msg.agent} agent` : "assistant"}
            {msg.model && ` · ${msg.model.split("-").slice(1, 3).join("-")}`}
          </span>
          {msg.mcpUsed && msg.mcpUsed.length > 0 && (
            <span style={{ fontSize: 11, color: "#7c3aed" }}>
              · MCP: {msg.mcpUsed.join(", ")}
            </span>
          )}
        </div>
      )}
      <div
        style={{
          maxWidth: "80%", padding: "10px 14px", borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          background: isUser ? "#3b1f6b" : msg.error ? "#3b1a1a" : "#16162a",
          color: msg.error ? "#f87171" : "#e2e2f0",
          fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
          border: `1px solid ${isUser ? "#5a2d9a" : msg.error ? "#7f1d1d" : "#2a2a3e"}`,
        }}
      >
        {msg.content}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function MissionControl() {
  const [tab, setTab] = useState<"chat" | "task">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedMcp, setSelectedMcp] = useState<Set<string>>(new Set());
  const [selectedAgent, setSelectedAgent] = useState("chief");
  const [model, setModel] = useState(MODELS[0]);
  const [proxyUrl, setProxyUrl] = useState(() => {
    const stored = localStorage.getItem("nullclaw_proxy_url");
    return stored || (window.location.hostname === "localhost" ? "" : window.location.origin);
  });
  const [showSettings, setShowSettings] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function saveSettings() {
    localStorage.setItem("nullclaw_proxy_url", proxyUrl);
    setShowSettings(false);
  }

  const base = proxyUrl.replace(/\/$/, "");

  async function sendChat() {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setLoading(true);

    try {
      const mcpList = Array.from(selectedMcp).map((n) => {
        const s = MCP_SERVERS.find((x) => x.name === n)!;
        return { name: s.name, url: s.url };
      });

      const res = await fetch(`${base}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          model,
          system: systemPrompt || undefined,
          mcp_servers: mcpList.length > 0 ? mcpList : undefined,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(typeof data.error === "object" ? data.error.message : data.error);

      const text = extractText(data.content || []);
      setMessages([
        ...history,
        {
          role: "assistant",
          content: text || "(no text response)",
          model: data.model,
          mcpUsed: data.mcp_servers_used,
        },
      ]);
    } catch (err) {
      setMessages([
        ...history,
        { role: "assistant", content: String(err), error: true },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function sendTask() {
    if (!input.trim() || loading) return;
    const task = input.trim();
    const userMsg: Message = { role: "user", content: task };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${base}/api/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, agent: selectedAgent, model }),
      });

      const data = await res.json();
      if (data.error) throw new Error(typeof data.error === "object" ? data.error.message : data.error);

      const text = extractText(data.content || []);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: text || "(no text response)",
          agent: data.agent,
          model: data.model,
          mcpUsed: data.mcp_servers_used,
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: String(err), error: true },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSend() {
    if (tab === "chat") sendChat();
    else sendTask();
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", height: "100vh",
        background: "#0d0d1a", color: "#e2e2f0", fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 20px", borderBottom: "1px solid #1e1e2e", flexShrink: 0,
          background: "#0a0a16",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Zap size={16} color="white" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.02em" }}>
            NullClaw <span style={{ color: "#7c3aed" }}>Mission Control</span>
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Tab switcher */}
          <div
            style={{
              display: "flex", background: "#1a1a2e", borderRadius: 8,
              padding: 3, border: "1px solid #2a2a3e",
            }}
          >
            {(["chat", "task"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer",
                  background: tab === t ? "#7c3aed" : "transparent",
                  color: tab === t ? "white" : "#606080", fontSize: 13, fontWeight: 500,
                }}
              >
                {t === "chat" ? <><MessageSquare size={12} style={{ display: "inline", marginRight: 4 }} />Chat</> : <><Bot size={12} style={{ display: "inline", marginRight: 4 }} />Task</>}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              background: showSettings ? "#1a1a2e" : "none", border: "1px solid",
              borderColor: showSettings ? "#7c3aed44" : "transparent",
              color: "#a0a0c0", cursor: "pointer", padding: 6, borderRadius: 8,
            }}
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar */}
        <aside
          style={{
            width: 220, borderRight: "1px solid #1e1e2e", flexShrink: 0,
            display: "flex", flexDirection: "column", overflowY: "auto",
            background: "#0a0a16",
          }}
        >
          {/* Settings panel */}
          {showSettings && (
            <div style={{ padding: 14, borderBottom: "1px solid #1e1e2e" }}>
              <div style={{ fontSize: 11, color: "#606080", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Settings</div>
              <label style={{ fontSize: 12, color: "#a0a0c0", display: "block", marginBottom: 4 }}>Proxy URL</label>
              <input
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="https://your-proxy.railway.app"
                style={{
                  width: "100%", padding: "6px 8px", background: "#16162a",
                  border: "1px solid #2a2a3e", borderRadius: 6, color: "#e2e2f0",
                  fontSize: 12, boxSizing: "border-box", marginBottom: 8,
                }}
              />
              <label style={{ fontSize: 12, color: "#a0a0c0", display: "block", marginBottom: 4 }}>System Prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Optional system prompt…"
                rows={3}
                style={{
                  width: "100%", padding: "6px 8px", background: "#16162a",
                  border: "1px solid #2a2a3e", borderRadius: 6, color: "#e2e2f0",
                  fontSize: 12, resize: "vertical", boxSizing: "border-box", marginBottom: 8,
                }}
              />
              <button
                onClick={saveSettings}
                style={{
                  width: "100%", padding: "7px", background: "#7c3aed",
                  border: "none", borderRadius: 6, color: "white",
                  fontSize: 12, cursor: "pointer", fontWeight: 600,
                }}
              >
                Save
              </button>
            </div>
          )}

          {/* Model */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e1e2e" }}>
            <div style={{ fontSize: 11, color: "#606080", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Model</div>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{
                width: "100%", padding: "6px 8px", background: "#16162a",
                border: "1px solid #2a2a3e", borderRadius: 6, color: "#e2e2f0",
                fontSize: 12, cursor: "pointer",
              }}
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>{m.split("-").slice(1, 3).join("-")}</option>
              ))}
            </select>
          </div>

          {/* Agent (task mode only) */}
          {tab === "task" && (
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e1e2e" }}>
              <div style={{ fontSize: 11, color: "#606080", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Agent</div>
              {AGENTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAgent(a.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "6px 8px", marginBottom: 3, background: selectedAgent === a.id ? "#1a1a2e" : "none",
                    border: `1px solid ${selectedAgent === a.id ? a.color + "55" : "transparent"}`,
                    borderRadius: 6, cursor: "pointer", color: selectedAgent === a.id ? "#e2e2f0" : "#606080",
                    fontSize: 12, textAlign: "left",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: a.color, flexShrink: 0 }} />
                  {a.label}
                </button>
              ))}
            </div>
          )}

          {/* MCP (chat mode only) */}
          {tab === "chat" && (
            <McpPanel selected={selectedMcp} onChange={setSelectedMcp} />
          )}
        </aside>

        {/* Main chat area */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            {messages.length === 0 && (
              <div
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", height: "100%", color: "#40405a", textAlign: "center",
                }}
              >
                <Zap size={40} style={{ marginBottom: 16, color: "#2a1a5e" }} />
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
                  {tab === "chat" ? "Start a conversation" : "Send a task"}
                </div>
                <div style={{ fontSize: 14, maxWidth: 340 }}>
                  {tab === "chat"
                    ? "Select MCP connectors in the sidebar and type your message below."
                    : "Choose an agent in the sidebar and describe the task you want completed."}
                </div>
                {tab === "task" && (
                  <div style={{ marginTop: 12, fontSize: 12, color: "#303050" }}>
                    Tasks automatically use all 19 MCP connectors.
                  </div>
                )}
              </div>
            )}
            {messages.map((msg, i) => (
              <ChatBubble key={i} msg={msg} />
            ))}
            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#606080", fontSize: 13 }}>
                <RotateCcw size={14} style={{ animation: "spin 1s linear infinite" }} />
                Thinking…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div
            style={{
              padding: "12px 20px 16px", borderTop: "1px solid #1e1e2e",
              background: "#0a0a16", flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex", gap: 10, alignItems: "flex-end",
                background: "#16162a", borderRadius: 12,
                border: "1px solid #2a2a3e", padding: "8px 12px",
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={tab === "chat" ? "Message… (Enter to send, Shift+Enter for newline)" : "Describe your task… (Enter to send)"}
                rows={1}
                disabled={loading}
                style={{
                  flex: 1, background: "none", border: "none", outline: "none",
                  color: "#e2e2f0", fontSize: 14, resize: "none", lineHeight: 1.5,
                  maxHeight: 160, overflowY: "auto", paddingTop: 2,
                }}
                onInput={(e) => {
                  const t = e.target as HTMLTextAreaElement;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 160) + "px";
                }}
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                style={{
                  background: loading || !input.trim() ? "#2a2a3e" : "#7c3aed",
                  border: "none", borderRadius: 8, color: "white", cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                  padding: "8px 10px", display: "flex", alignItems: "center", flexShrink: 0,
                  transition: "background 0.15s",
                }}
              >
                <Send size={16} />
              </button>
            </div>
            <div style={{ fontSize: 11, color: "#303050", marginTop: 6, textAlign: "center" }}>
              {tab === "chat" && selectedMcp.size > 0
                ? `${selectedMcp.size} MCP connector${selectedMcp.size > 1 ? "s" : ""} active`
                : tab === "task"
                ? `${AGENTS.find((a) => a.id === selectedAgent)?.label} · All 19 MCP connectors`
                : "No MCP connectors selected"}
            </div>
          </div>
        </main>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 3px; }
        select option { background: #16162a; }
      `}</style>
    </div>
  );
}
