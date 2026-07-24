const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const Database = require("better-sqlite3");
const Anthropic = require("@anthropic-ai/sdk");
const { retrieveContext } = require("./rag");

dotenv.config({ path: path.join(__dirname, ".env") });

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "chat.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
`);

const insertSession = db.prepare(
  `INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)`
);
const touchSession = db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`);
const getSession = db.prepare(`SELECT id FROM sessions WHERE id = ?`);
const insertMessage = db.prepare(
  `INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)`
);
const listMessages = db.prepare(
  `SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC`
);
const listRecentMessages = db.prepare(
  `SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?`
);

const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!anthropicKey) {
  console.warn("Warning: ANTHROPIC_API_KEY is missing. Chat will fail until .env is set.");
}

const anthropic = new Anthropic({ apiKey: anthropicKey || "missing" });

const SYSTEM_PROMPT = `You are Ningdan's homepage agent on ningdan.work.
Speak in a warm, concise, slightly playful voice — aligned with the site's tone.
Answer using ONLY the retrieved knowledge context when possible.
If you don't know something, say so briefly and suggest LinkedIn (https://www.linkedin.com/in/ningdan), email ningdanzzz@gmail.com, or escalate by phone at 628-688-7325.
Do not invent employers, titles, or projects that are not in the context.
The only employer in Ningdan's profile is Salesforce. Never claim Adobe or any other employer, past or present, unless it appears explicitly in the retrieved context.
Keep replies short (2–5 sentences) unless the user asks for depth.`;

function nowIso() {
  return new Date().toISOString();
}

function createSessionId() {
  return crypto.randomUUID();
}

function ensureSession(sessionId) {
  const id = sessionId && String(sessionId).trim() ? String(sessionId).trim() : createSessionId();
  const existing = getSession.get(id);
  const ts = nowIso();
  if (!existing) {
    insertSession.run(id, ts, ts);
  } else {
    touchSession.run(ts, id);
  }
  return id;
}

function historyForClaude(sessionId, limit = 16) {
  const rows = listRecentMessages.all(sessionId, limit).reverse();
  const cleaned = [];
  for (const row of rows) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const content = String(row.content || "").trim();
    if (!content) continue;
    if (cleaned.length && cleaned[cleaned.length - 1].role === row.role) {
      cleaned[cleaned.length - 1].content += `\n${content}`;
    } else {
      cleaned.push({ role: row.role, content });
    }
  }
  return cleaned;
}

function actionHint(action) {
  if (!action) return "";
  const map = {
    cv: "The visitor clicked View CV — prioritize career path and Salesforce design work.",
    salesforce: "The visitor clicked Agentic AI at Salesforce — prioritize Service Cloud / agentic work.",
    vibecoding: "The visitor clicked Vibecoding — prioritize side practice, craft, music, experiments.",
    about: "The visitor clicked About Me — prioritize personal bio; artwork media may appear in the UI separately.",
  };
  return map[action] || "";
}

function buildClaudeMessages({ message, action, sessionId }) {
  const { context, hits } = retrieveContext(
    [message, actionHint(action)].filter(Boolean).join("\n"),
    3
  );

  const history = historyForClaude(sessionId, 16);
  const prior = history.slice(0, -1);
  const userContent = [
    context
      ? `## Retrieved context\n${context}`
      : "## Retrieved context\n(No knowledge chunks matched; use general homepage agent guidance.)",
    actionHint(action) ? `\n## UI action\n${actionHint(action)}` : "",
    `\n## Visitor message\n${message}`,
  ].join("");

  return {
    hits,
    messages: [...prior, { role: "user", content: userContent }],
  };
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (typeof res.flush === "function") res.flush();
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasKey: Boolean(anthropicKey) });
});

app.get("/api/chat/:sessionId", (req, res) => {
  const session = getSession.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const messages = listMessages.all(req.params.sessionId);
  res.json({ sessionId: req.params.sessionId, messages });
});

app.post("/api/chat", async (req, res) => {
  const message = String((req.body && req.body.message) || "").trim();
  const action = req.body && req.body.action ? String(req.body.action) : null;

  if (!message) {
    res.status(400).json({ error: "Message is required" });
    return;
  }
  if (!anthropicKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
    return;
  }

  const sessionId = ensureSession(req.body && req.body.sessionId);
  const ts = nowIso();
  insertMessage.run(sessionId, "user", message, ts);
  touchSession.run(ts, sessionId);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (res.socket && typeof res.socket.setNoDelay === "function") {
    res.socket.setNoDelay(true);
  }
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(": connected\n\n");
  if (typeof res.flush === "function") res.flush();

  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  try {
    const { messages, hits } = buildClaudeMessages({ message, action, sessionId });
    writeSse(res, { type: "meta", sessionId, hits });
    console.log("chat stream start", sessionId, "turns", messages.length);

    const stream = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages,
      stream: true,
    });

    let reply = "";

    for await (const event of stream) {
      if (closed) break;
      if (
        event.type === "content_block_delta" &&
        event.delta &&
        event.delta.type === "text_delta" &&
        event.delta.text
      ) {
        reply += event.delta.text;
        writeSse(res, { type: "token", text: event.delta.text });
      }
    }

    console.log("chat stream end", sessionId, "chars", reply.length);

    reply = reply.trim() || "I’m here — ask me anything about Ningdan’s work.";

    const replyTs = nowIso();
    insertMessage.run(sessionId, "assistant", reply, replyTs);
    touchSession.run(replyTs, sessionId);

    if (!closed) {
      writeSse(res, { type: "done", sessionId, reply });
      res.end();
    }
  } catch (err) {
    console.error("chat stream error:", err && err.message ? err.message : err);
    if (!closed && !res.writableEnded) {
      writeSse(res, { type: "error", error: "Chat failed. Try again in a moment." });
      res.end();
    }
  }
});

app.use(express.static(ROOT, { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log(`ningdan.work chat server on http://localhost:${PORT}`);
});
