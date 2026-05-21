import fs from "node:fs/promises";
import { readArticleStore } from "./matchup-article-store.mjs";

const QUEUE_PATH = "data/matchup-queue.json";
const DDRAGON_ROOT = "https://ddragon.leagueoflegends.com";

const requiredStringFields = ["id", "status", "player", "enemy", "lane", "summary", "winCondition"];
const requiredArrayFields = ["threatModel", "trading", "teamfights", "commonMistakes"];
const lanePlanFields = ["levels1to3", "preSix", "postSix", "wave", "recall"];
const runeFields = ["keystone", "mainPath", "mainWhy", "subPath", "subWhy"];
const itemFields = ["firstBuy", "coreReason", "defensive", "situational", "whenBehind"];
const skillshotFields = ["hit", "dodge"];
const forbiddenPatterns = [
  /\?{3,}/,
  /\uFFFD/,
  /自分のチャンピオン/,
  /対面チャンピオン/,
  /次の数分で何に困るか/,
  /敵チーム全体を見る/
];

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function collectText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(collectText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(collectText).join("\n");
  return "";
}

function short(value, minLength = 20) {
  return typeof value !== "string" || value.trim().length < minLength;
}

function runeContext(runes) {
  const paths = new Set();
  const keystones = new Set();
  for (const tree of runes) {
    paths.add(tree.name);
    for (const rune of tree.slots?.[0]?.runes || []) keystones.add(rune.name);
  }
  return { paths, keystones };
}

function articleIdParts(id) {
  const match = String(id).match(/^(.+)-vs-(.+)-([A-Z]+)$/);
  if (!match) return undefined;
  return { player: match[1], enemy: match[2], lane: match[3] };
}

function assertArticle(article, ids, queueIds, runeNames, championNames, errors) {
  for (const field of requiredStringFields) {
    if (!article[field] || typeof article[field] !== "string") errors.push(`${article.id || "unknown"} missing string field ${field}`);
  }
  for (const field of requiredArrayFields) {
    if (!Array.isArray(article[field]) || article[field].length < 3) errors.push(`${article.id || "unknown"} needs at least 3 ${field}`);
  }
  for (const field of lanePlanFields) {
    if (short(article.lanePlan?.[field], 30)) errors.push(`${article.id} needs detailed lanePlan.${field}`);
  }
  for (const field of runeFields) {
    if (short(article.runes?.[field], field.endsWith("Why") ? 30 : 2)) errors.push(`${article.id} needs runes.${field}`);
  }
  for (const field of itemFields) {
    if (short(article.items?.[field], 30)) errors.push(`${article.id} needs items.${field}`);
  }
  for (const field of skillshotFields) {
    if (!Array.isArray(article.skillshots?.[field]) || article.skillshots[field].length < 3) errors.push(`${article.id} needs 3 skillshots.${field}`);
  }

  const parts = articleIdParts(article.id);
  if (!parts) {
    errors.push(`${article.id || "unknown"} has invalid id format`);
  } else {
    if (article.player !== parts.player) errors.push(`${article.id} player must be champion id ${parts.player}, got ${article.player}`);
    if (article.enemy !== parts.enemy) errors.push(`${article.id} enemy must be champion id ${parts.enemy}, got ${article.enemy}`);
    if (article.lane !== parts.lane) errors.push(`${article.id} lane must match id lane ${parts.lane}, got ${article.lane}`);
  }

  if (article.player === article.enemy) errors.push(`${article.id} player and enemy are identical`);
  if (ids.has(article.id)) errors.push(`duplicate article id ${article.id}`);
  ids.add(article.id);
  if (queueIds && !queueIds.has(article.id)) errors.push(`${article.id} is not present in matchup queue`);

  if (article.runes?.mainPath && !runeNames.paths.has(article.runes.mainPath)) errors.push(`${article.id} has unknown mainPath: ${article.runes.mainPath}`);
  if (article.runes?.subPath && !runeNames.paths.has(article.runes.subPath)) errors.push(`${article.id} has unknown subPath: ${article.runes.subPath}`);
  if (article.runes?.keystone && !runeNames.keystones.has(article.runes.keystone)) errors.push(`${article.id} has unknown keystone: ${article.runes.keystone}`);

  if (parts) {
    const text = collectText(article);
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(text)) errors.push(`${article.id} contains forbidden generic or corrupt text: ${pattern}`);
    }
    const playerName = championNames.get(parts.player) || parts.player;
    const enemyName = championNames.get(parts.enemy) || parts.enemy;
    if (!text.includes(parts.player) && !text.includes(playerName)) {
      errors.push(`${article.id} is too generic: article text does not mention player`);
    }
    if (!text.includes(parts.enemy) && !text.includes(enemyName)) {
      errors.push(`${article.id} is too generic: article text does not mention enemy`);
    }
  }
}

const store = await readArticleStore();
let queue;
try {
  queue = await readJson(QUEUE_PATH);
} catch {
  queue = undefined;
}

const patch = queue?.patch || store.index?.patch || store.pointer?.patch;
if (!patch) throw new Error("cannot determine patch for article validation");

const runes = await loadJson(`${DDRAGON_ROOT}/cdn/${patch}/data/ja_JP/runesReforged.json`);
const champions = await loadJson(`${DDRAGON_ROOT}/cdn/${patch}/data/ja_JP/champion.json`);
const runeNames = runeContext(runes);
const championNames = new Map(Object.values(champions.data || {}).map((champion) => [champion.id, champion.name]));
const queueIds = queue ? new Set(queue.entries.map((entry) => entry.id)) : undefined;
const errors = [];
const ids = new Set();
const articles = Array.isArray(store.articles) ? store.articles : [];

for (const article of articles) assertArticle(article, ids, queueIds, runeNames, championNames, errors);

if (store.index?.articleCount !== undefined && store.index.articleCount !== articles.length) {
  errors.push(`article index count ${store.index.articleCount} does not match loaded article count ${articles.length}`);
}
if (queue?.targetArticleCount !== undefined && articles.length !== queue.targetArticleCount) {
  errors.push(`article count ${articles.length} does not match target ${queue.targetArticleCount}`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

const reviewed = articles.filter((article) => article.status === "reviewed").length;
const draft = articles.filter((article) => article.status === "draft").length;
console.log(`valid articles: ${articles.length}, reviewed: ${reviewed}, draft: ${draft}`);
