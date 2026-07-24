const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const { SYSTEM_PROMPT, buildClaudeMessages } = require("../chatCore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const body = req.body || {};
  const message = String(body.message || "").trim();
  const action = body.action ? String(body.action) : null;
  const history = Array.isArray(body.history) ? body.history : [];
  const sessionId =
    (body.sessionId && String(body.sessionId).trim()) || crypto.randomUUID();

  if (!message) {
    res.status(400).json({ error: "Message is required" });
    return;
  }
  if (!anthropicKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(": connected\n\n");

  const writeSse = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const { messages, hits } = buildClaudeMessages({ message, action, history });
    writeSse({ type: "meta", sessionId, hits });

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
        writeSse({ type: "token", text: event.delta.text });
      }
    }

    reply = reply.trim() || "I’m here — ask me anything about Ningdan’s work.";
    if (!closed) {
      writeSse({ type: "done", sessionId, reply });
      res.end();
    }
  } catch (err) {
    console.error("chat stream error:", err && err.message ? err.message : err);
    if (!closed && !res.writableEnded) {
      writeSse({ type: "error", error: "Chat failed. Try again in a moment." });
      res.end();
    }
  }
};

module.exports.config = {
  maxDuration: 60,
};
