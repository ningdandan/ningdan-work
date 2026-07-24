const { retrieveContext } = require("./rag");

const SYSTEM_PROMPT = `You are Ningdan's homepage agent on ningdan.work.
Speak in a warm, concise, slightly playful voice — aligned with the site's tone.
Answer using ONLY the retrieved knowledge context when possible.
If you don't know something, say so briefly and suggest LinkedIn (https://www.linkedin.com/in/ningdan), email ningdanzzz@gmail.com, or escalate by phone at 628-688-7325.
Do not invent employers, titles, or projects that are not in the context.
The only employer in Ningdan's profile is Salesforce. Never claim Adobe or any other employer, past or present, unless it appears explicitly in the retrieved context.
Keep replies short (2–5 sentences) unless the user asks for depth.`;

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

function normalizeHistory(raw, limit = 16) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  for (const row of raw) {
    if (!row || (row.role !== "user" && row.role !== "assistant")) continue;
    const content = String(row.content || "").trim();
    if (!content) continue;
    if (cleaned.length && cleaned[cleaned.length - 1].role === row.role) {
      cleaned[cleaned.length - 1].content += `\n${content}`;
    } else {
      cleaned.push({ role: row.role, content });
    }
  }
  return cleaned.slice(-limit);
}

function buildClaudeMessages({ message, action, history }) {
  const { context, hits } = retrieveContext(
    [message, actionHint(action)].filter(Boolean).join("\n"),
    3
  );

  const prior = normalizeHistory(history, 16);
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

module.exports = {
  SYSTEM_PROMPT,
  actionHint,
  normalizeHistory,
  buildClaudeMessages,
};
