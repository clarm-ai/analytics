#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// Usage: node scripts/generate_channel_insights.mjs <channelId>

// Load env from repo root
const ENV_PATHS = [path.resolve(process.cwd(), '../../.env'), path.resolve(process.cwd(), '../.env'), path.resolve(process.cwd(), '.env')];
for (const p of ENV_PATHS) { try { dotenv.config({ path: p }); } catch {} }

async function loadDiscord(channelId) {
  const dataDir = path.resolve(process.cwd(), 'public', 'data');
  const file = path.join(dataDir, `discord-${channelId}.json`);
  const raw = await fs.readFile(file, 'utf8');
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) return [];
  return arr;
}

function buildTranscript(messages, limitChars = 120000) {
  const lines = [];
  for (const m of messages) {
    const who = (m.author_display_name || m.author || m.author_id || 'user').toString().replace(/\s+/g, ' ');
    const text = (m.text || '').toString().replace(/\s+/g, ' ').trim();
    if (!text) continue;
    lines.push(`${who}: ${text}`);
    if (lines.join('\n').length > limitChars) break;
  }
  return lines.join('\n');
}

function coerceInsights(obj) {
  try {
    const topics = Array.isArray(obj.topics) ? obj.topics.filter((t) => t && t.topic && typeof t.count === 'number') : [];
    return {
      topics,
      seo_recommendations: Array.isArray(obj.seo_recommendations) ? obj.seo_recommendations.filter((x) => typeof x === 'string') : [],
      unanswered_questions: Array.isArray(obj.unanswered_questions) ? obj.unanswered_questions.filter((x) => typeof x === 'string') : [],
      action_plans: Array.isArray(obj.action_plans) ? obj.action_plans.filter((x) => typeof x === 'string') : [],
      seo_keywords: Array.isArray(obj.seo_keywords) ? obj.seo_keywords.filter((x) => typeof x === 'string') : [],
      seo_keyword_clusters: Array.isArray(obj.seo_keyword_clusters) ? obj.seo_keyword_clusters : undefined,
      seo_briefs: Array.isArray(obj.seo_briefs) ? obj.seo_briefs : undefined,
      seo_faqs: Array.isArray(obj.seo_faqs) ? obj.seo_faqs : undefined,
      seo_titles: Array.isArray(obj.seo_titles) ? obj.seo_titles : undefined,
      seo_tasks: Array.isArray(obj.seo_tasks) ? obj.seo_tasks : undefined,
    };
  } catch {
    return { topics: [], seo_recommendations: [], unanswered_questions: [], action_plans: [], seo_keywords: [] };
  }
}

function buildHeuristicInsights(messages) {
  const textAll = messages.map((m) => String(m.text || '')).join(' ');
  const tokens = textAll.toLowerCase().match(/[a-z0-9][a-z0-9\-]{2,}/g) || [];
  const stop = new Set(['the','and','that','this','with','from','have','your','into','about','there','their','them','they','will','would','could','should','what','when','where','which','then','than','just','like','code','does','need','been','also','some','more','such','here','into','http','https','www','com']);
  const freq = new Map();
  for (const t of tokens) { if (!stop.has(t) && t.length <= 24) freq.set(t, (freq.get(t) || 0) + 1); }
  const top = [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 20);
  const topics = top.slice(0, 10).map(([w,c]) => ({ topic: w, count: c }));
  const seo_keywords = top.map(([w]) => w);
  const unanswered_questions = messages
    .map((m) => String(m.text || ''))
    .filter((s) => s.includes('?') && s.length <= 180)
    .slice(0, 10);
  const action_plans = [
    'Improve documentation for most-asked topics',
    'Create quickstart addressing frequent setup questions',
    'Publish troubleshooting guide for common errors',
    'Add FAQs page from recent unanswered questions',
  ];
  const seo_recommendations = [
    'Target high-frequency keywords in docs and blog posts',
    'Add internal links between tutorials and API reference',
    'Create comparison content for adjacent tools',
  ];
  return { topics, seo_recommendations, unanswered_questions, action_plans, seo_keywords };
}

async function main() {
  const [channelId] = process.argv.slice(2);
  if (!channelId) {
    console.error('Usage: node scripts/generate_channel_insights.mjs <channelId>');
    process.exit(1);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Missing OPENAI_API_KEY in .env');
    process.exit(1);
  }

  const messages = await loadDiscord(channelId);
  const transcript = buildTranscript(messages);
  const system = [
    'You are an analytics assistant. Given Discord chat transcripts, output STRICT JSON only.',
    'Include topics, seo_recommendations, unanswered_questions, action_plans, seo_keywords, and optional clusters/briefs/faq/titles/tasks.',
    'Rules: title_tag<=60 chars, meta_description<=155, intent in {informational,commercial,navigational,transactional}.',
  ].join(' ');
  const user = 'Here is a transcript excerpt (author: message). Analyze it and respond with strict JSON only.\n\n' + transcript;

  async function runOnce(init) {
    const client = new OpenAI(init);
    return await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [ { role: 'system', content: system }, { role: 'user', content: user } ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 900,
    });
  }

  let resp;
  const orgCandidates = [
    process.env.OPENAI_ORG,
    process.env.OPENAI_ORGANIZATION,
    process.env.OPENAI_ORG_ID,
    process.env.OPENAI_ORGANIZATION_ID,
  ].filter(Boolean);
  const projectCandidates = [
    process.env.OPENAI_PROJECT,
    process.env.OPENAI_PROJECT_ID,
  ].filter(Boolean);

  // Try all org/project combinations, then try with none
  let tried = false;
  for (const org of (orgCandidates.length ? orgCandidates : [undefined])) {
    for (const project of (projectCandidates.length ? projectCandidates : [undefined])) {
      try {
        tried = true;
        resp = await runOnce({ apiKey, organization: org || undefined, project: project || undefined });
        throw new Error('__DONE__');
      } catch (e) {
        if (e && typeof e.message === 'string' && e.message === '__DONE__') break;
        // continue trying
      }
    }
    if (resp) break;
  }
  let parsed;
  try {
    if (!resp) {
      // Final fallback: no org/project
      resp = await runOnce({ apiKey });
    }
    const text = resp.choices?.[0]?.message?.content || '{}';
    parsed = coerceInsights(JSON.parse(text));
  } catch {
    parsed = buildHeuristicInsights(messages);
  }

  const outDir = path.resolve(process.cwd(), 'public', 'data');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `insights-${channelId}.json`);
  await fs.writeFile(outFile, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(`Wrote insights -> ${outFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });


