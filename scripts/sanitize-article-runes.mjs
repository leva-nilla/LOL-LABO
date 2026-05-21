import { readArticleStore, readJson, writeShardedArticleStore } from "./matchup-article-store.mjs";

const QUEUE_PATH = "data/matchup-queue.json";
const DDRAGON_ROOT = "https://ddragon.leagueoflegends.com";

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function exactOrContained(value, validValues) {
  if (!value || typeof value !== "string") return value;
  if (validValues.has(value)) return value;
  const matches = [...validValues].filter((name) => value.includes(name));
  return matches.sort((a, b) => b.length - a.length)[0] || value;
}

const store = await readArticleStore();
const queue = await readJson(QUEUE_PATH);
const runes = await loadJson(`${DDRAGON_ROOT}/cdn/${queue.patch}/data/ja_JP/runesReforged.json`);
const paths = new Set(runes.map((tree) => tree.name));
const keystones = new Set(runes.flatMap((tree) => tree.slots?.[0]?.runes || []).map((rune) => rune.name));

let changed = 0;
for (const article of store.articles || []) {
  if (!article.runes) continue;
  for (const [field, validValues] of [
    ["keystone", keystones],
    ["mainPath", paths],
    ["subPath", paths]
  ]) {
    const next = exactOrContained(article.runes[field], validValues);
    if (next !== article.runes[field]) {
      article.runes[field] = next;
      changed += 1;
    }
  }
}

if (changed) {
  await writeShardedArticleStore({
    articles: store.articles,
    patch: queue.patch,
    targetArticleCount: queue.targetArticleCount
  });
}

console.log(`sanitized ${changed} rune field(s)`);
