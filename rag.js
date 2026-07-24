const fs = require("fs");
const path = require("path");

const KNOWLEDGE_DIR = path.join(__dirname, "knowledge");

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s+/#.-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function loadKnowledgeChunks() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return [];

  const files = fs
    .readdirSync(KNOWLEDGE_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort();

  const chunks = [];

  for (const file of files) {
    const full = path.join(KNOWLEDGE_DIR, file);
    const raw = fs.readFileSync(full, "utf8");
    const parts = raw.split(/\n(?=##\s+)/);

    parts.forEach((part, index) => {
      const text = part.trim();
      if (!text) return;
      const headingMatch = text.match(/^##\s+(.+)$/m);
      const title = headingMatch ? headingMatch[1].trim() : path.basename(file, ".md");
      chunks.push({
        id: `${file}#${index}`,
        source: file,
        title,
        text,
        tokens: new Set(tokenize(`${title} ${text}`)),
      });
    });
  }

  return chunks;
}

let cachedChunks = null;

function getChunks() {
  if (!cachedChunks) cachedChunks = loadKnowledgeChunks();
  return cachedChunks;
}

function reloadKnowledge() {
  cachedChunks = loadKnowledgeChunks();
  return cachedChunks.length;
}

/** Simple keyword-overlap RAG — top K markdown sections */
function retrieveContext(query, limit = 3) {
  const chunks = getChunks();
  if (!chunks.length) return { context: "", hits: [] };

  const queryTokens = tokenize(query);
  if (!queryTokens.length) {
    const fallback = chunks.slice(0, limit);
    return {
      context: fallback.map((c) => `### ${c.title}\n${c.text}`).join("\n\n"),
      hits: fallback.map((c) => ({ id: c.id, title: c.title, score: 0 })),
    };
  }

  const scored = chunks
    .map((chunk) => {
      let score = 0;
      for (const token of queryTokens) {
        if (chunk.tokens.has(token)) score += 1;
        if (chunk.title.toLowerCase().includes(token)) score += 1.5;
      }
      return { chunk, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const selected = (scored.length ? scored : chunks.map((chunk) => ({ chunk, score: 0 })))
    .slice(0, limit)
    .map((row) => row.chunk);

  return {
    context: selected.map((c) => `### ${c.title} (${c.source})\n${c.text}`).join("\n\n"),
    hits: selected.map((c, i) => ({
      id: c.id,
      title: c.title,
      score: scored[i] ? scored[i].score : 0,
    })),
  };
}

module.exports = {
  retrieveContext,
  reloadKnowledge,
  getChunks,
};
