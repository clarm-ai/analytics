#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const DISCORD_JSON = path.join(DATA_DIR, "discord-1288403910284935182.json");
const TOPIC_INDEX_JSON = path.join(DATA_DIR, "topic_index.json");
const EXAMPLES_INDEX_JSON = path.join(DATA_DIR, "examples_index.json");

function normalize(str) {
  return (str || "").toString().toLowerCase();
}

function parseDateOrId(msg) {
  // Prefer timestamp; fallback to message_id numeric ordering
  const ts = msg.timestamp ? Date.parse(msg.timestamp) : NaN;
  if (!Number.isNaN(ts)) return ts;
  try {
    return Number(BigInt(msg.message_id || 0));
  } catch {
    return 0;
  }
}

function uniqueBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

async function loadMessages() {
  const raw = await fs.readFile(DISCORD_JSON, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  throw new Error("Discord JSON is not an array");
}

async function loadExistingTopics() {
  try {
    const raw = await fs.readFile(TOPIC_INDEX_JSON, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.topics)) return parsed.topics.map((t) => t.topic);
  } catch {}
  return [
    "Better Auth Integration",
    "OAuth Issues",
    "Database and ORM Concerns",
    "User Roles and Permissions",
    "Email Verification",
    "Session Management",
    "CORS Issues",
    "Stripe Plugin",
    "Documentation Gaps",
    "Multi-Tenancy",
  ];
}

function keywordsForTopic(topic) {
  const t = normalize(topic);
  if (t.includes("oauth")) return ["oauth", "provider", "callback", "redirect", "scope", "token", "github", "google"];
  if (t.includes("database") || t.includes("orm")) return ["db", "database", "orm", "drizzle", "prisma", "sql", "migration", "schema"];
  if (t.includes("roles") || t.includes("permissions")) return ["role", "permission", "rbac", "admin", "policy"];
  if (t.includes("email")) return ["email", "verify", "verification", "magic link", "otp", "code"];
  if (t.includes("session")) return ["session", "cookie", "jwt", "refresh", "invalidate", "expiry", "token"];
  if (t.includes("cors")) return ["cors", "origin", "preflight", "header", "headers"];
  if (t.includes("stripe")) return ["stripe", "billing", "checkout", "payment", "webhook"];
  if (t.includes("documentation") || t.includes("docs")) return ["docs", "documentation", "guide", "readme", "example", "missing"];
  if (t.includes("multi") || t.includes("tenant") || t.includes("tenancy")) return ["tenant", "multitenant", "multi tenancy", "org", "workspace", "team", "account"];
  // Better Auth Integration (default)
  return ["better auth", "integration", "setup", "next", "drizzle", "neon", "trpc", "adapter", "authjs"];
}

function messageMatches(msg, kws) {
  const text = normalize(msg.text);
  if (!text) return false;
  return kws.some((kw) => text.includes(kw));
}

function pickForTopic(messages, topic, count = 10) {
  const kws = keywordsForTopic(topic);
  const matched = messages.filter((m) => messageMatches(m, kws));
  // Sort by recency
  matched.sort((a, b) => parseDateOrId(b) - parseDateOrId(a));
  const picked = matched.slice(0, count);
  return picked;
}

function slimMessage(m) {
  return {
    message_id: String(m.message_id || ""),
    author_id: m.author_id || m.author,
    author_display_name: m.author_display_name || m.author,
    author_avatar_url: m.author_avatar_url,
    timestamp: m.timestamp,
    text: m.text,
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
  };
}

async function main() {
  const messages = await loadMessages();
  const topics = await loadExistingTopics();
  const DEFAULT_COUNT = 10;

  const topicIndex = [];
  const examplesIndex = {};

  for (const topic of topics) {
    const picked = uniqueBy(pickForTopic(messages, topic, DEFAULT_COUNT), (m) => String(m.message_id || "")).filter((m) => m && m.message_id);
    const ids = picked.map((m) => String(m.message_id));
    topicIndex.push({ topic, count: ids.length, example_ids: ids });
    examplesIndex[topic] = picked.map(slimMessage);
  }

  const topicPayload = { topics: topicIndex };
  await fs.writeFile(TOPIC_INDEX_JSON, JSON.stringify(topicPayload, null, 2) + "\n", "utf8");
  await fs.writeFile(EXAMPLES_INDEX_JSON, JSON.stringify(examplesIndex, null, 2) + "\n", "utf8");

  console.log(`Wrote ${TOPIC_INDEX_JSON}`);
  console.log(`Wrote ${EXAMPLES_INDEX_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


