import fs from "node:fs/promises";

const ARTICLE_PATH = "data/manual-matchups.json";
const QUEUE_PATH = "data/matchup-queue.json";

const requiredStringFields = [
  "id",
  "status",
  "player",
  "enemy",
  "lane",
  "summary",
  "winCondition"
];

const requiredArrayFields = [
  "threatModel",
  "trading",
  "teamfights",
  "commonMistakes"
];

const forbiddenRuneOrItemNames = [
  "リーサルテンポ",
  "ミシック",
  "神話級",
  "ゴアドリンカー",
  "ディヴァイン サンダラー",
  "クラーケン スレイヤーを神話",
  "イモータル シールドボウを神話"
];

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

function collectText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(collectText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(collectText).join("\n");
  return "";
}

function assertArticle(article, ids, errors) {
  for (const field of requiredStringFields) {
    if (!article[field] || typeof article[field] !== "string") errors.push(`${article.id || "unknown"} missing string field ${field}`);
  }
  for (const field of requiredArrayFields) {
    if (!Array.isArray(article[field]) || article[field].length === 0) errors.push(`${article.id || "unknown"} missing non-empty array field ${field}`);
  }
  for (const field of ["levels1to3", "preSix", "postSix", "wave", "recall"]) {
    if (!article.lanePlan?.[field]) errors.push(`${article.id} missing lanePlan.${field}`);
  }
  for (const field of ["mainWhy", "subWhy"]) {
    if (!article.runes?.[field]) errors.push(`${article.id} missing runes.${field}`);
  }
  for (const field of ["coreReason", "defensive", "whenBehind"]) {
    if (!article.items?.[field]) errors.push(`${article.id} missing items.${field}`);
  }
  for (const field of ["hit", "dodge"]) {
    if (!Array.isArray(article.skillshots?.[field]) || article.skillshots[field].length === 0) errors.push(`${article.id} missing skillshots.${field}`);
  }
  if (article.player === article.enemy) errors.push(`${article.id} player and enemy are identical`);
  if (ids.has(article.id)) errors.push(`duplicate article id ${article.id}`);
  ids.add(article.id);

  const text = collectText(article);
  for (const forbidden of forbiddenRuneOrItemNames) {
    if (text.includes(forbidden)) errors.push(`${article.id} contains patch-risk term: ${forbidden}`);
  }
}

const manual = await readJson(ARTICLE_PATH);
let queue;
try {
  queue = await readJson(QUEUE_PATH);
} catch {
  queue = undefined;
}

const errors = [];
const ids = new Set();
const articles = Array.isArray(manual.articles) ? manual.articles : [];

for (const article of articles) assertArticle(article, ids, errors);

if (queue) {
  const queueIds = new Set(queue.entries.map((entry) => entry.id));
  for (const article of articles) {
    if (!queueIds.has(article.id)) errors.push(`${article.id} is not present in matchup queue`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

const reviewed = articles.filter((article) => article.status === "reviewed").length;
const draft = articles.filter((article) => article.status === "draft").length;
console.log(`valid articles: ${articles.length}, reviewed: ${reviewed}, draft: ${draft}`);
