import fs from "node:fs/promises";

const ARTICLE_PATH = "data/manual-matchups.json";
const QUEUE_PATH = "data/matchup-queue.json";
const DDRAGON_ROOT = "https://ddragon.leagueoflegends.com";

const requiredStringFields = ["id", "status", "player", "enemy", "lane", "summary", "winCondition"];
const requiredArrayFields = ["threatModel", "trading", "teamfights", "commonMistakes"];
const lanePlanFields = ["levels1to3", "preSix", "postSix", "wave", "recall"];
const runeFields = ["keystone", "mainPath", "mainWhy", "subPath", "subWhy"];
const itemFields = ["firstBuy", "coreReason", "defensive", "situational", "whenBehind"];
const skillshotFields = ["hit", "dodge"];

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

function assertArticle(article, ids, queueIds, runeNames, errors) {
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

  if (article.player === article.enemy) errors.push(`${article.id} player and enemy are identical`);
  if (ids.has(article.id)) errors.push(`duplicate article id ${article.id}`);
  ids.add(article.id);
  if (queueIds && !queueIds.has(article.id)) errors.push(`${article.id} is not present in matchup queue`);

  if (article.runes?.mainPath && !runeNames.paths.has(article.runes.mainPath)) errors.push(`${article.id} has unknown mainPath: ${article.runes.mainPath}`);
  if (article.runes?.subPath && !runeNames.paths.has(article.runes.subPath)) errors.push(`${article.id} has unknown subPath: ${article.runes.subPath}`);
  if (article.runes?.keystone && !runeNames.keystones.has(article.runes.keystone)) errors.push(`${article.id} has unknown keystone: ${article.runes.keystone}`);

  const text = collectText(article);
  if (!text.includes(article.player) && !text.includes(article.enemy)) {
    errors.push(`${article.id} is too generic: article text does not mention player or enemy id/name`);
  }
}

const manual = await readJson(ARTICLE_PATH);
let queue;
try {
  queue = await readJson(QUEUE_PATH);
} catch {
  queue = undefined;
}

const patch = queue?.patch || manual.patch;
if (!patch) throw new Error("cannot determine patch for article validation");

const runes = await loadJson(`${DDRAGON_ROOT}/cdn/${patch}/data/ja_JP/runesReforged.json`);
const runeNames = runeContext(runes);
const queueIds = queue ? new Set(queue.entries.map((entry) => entry.id)) : undefined;
const errors = [];
const ids = new Set();
const articles = Array.isArray(manual.articles) ? manual.articles : [];

for (const article of articles) assertArticle(article, ids, queueIds, runeNames, errors);

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

const reviewed = articles.filter((article) => article.status === "reviewed").length;
const draft = articles.filter((article) => article.status === "draft").length;
console.log(`valid articles: ${articles.length}, reviewed: ${reviewed}, draft: ${draft}`);
