import fs from "node:fs/promises";
import path from "node:path";

const WORK_DIR = "work/matchup-production";
const MANUAL_PATH = "data/manual-matchups.json";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function validateArticleShape(article) {
  const required = ["id", "player", "enemy", "lane", "summary", "winCondition", "threatModel", "trading", "lanePlan", "runes", "items", "skillshots", "teamfights", "commonMistakes"];
  for (const field of required) {
    if (article[field] === undefined || article[field] === null) throw new Error(`${article.id || "unknown"} missing ${field}`);
  }
}

function idParts(id) {
  const match = String(id).match(/^(.+)-vs-(.+)-([A-Z]+)$/);
  if (!match) throw new Error(`${id || "unknown"} has invalid article id`);
  return { player: match[1], enemy: match[2], lane: match[3] };
}

function reviewStatus(review) {
  if (!review) return "draft";
  return review.decision === "accept" ? "reviewed" : "draft";
}

const dryRun = hasFlag("--dry-run");
const publishUnreviewed = hasFlag("--publish-unreviewed");
const onlyId = argValue("--id", "");
const manual = await readJson(MANUAL_PATH);
const byId = new Map((manual.articles || []).map((article) => [article.id, article]));
const files = await fs.readdir(WORK_DIR);
const articleFiles = files
  .filter((file) => file.endsWith(".article.json"))
  .filter((file) => !onlyId || file === `${onlyId}.article.json`);

let merged = 0;
let skipped = 0;

for (const file of articleFiles) {
  const articlePath = path.join(WORK_DIR, file);
  const article = await readJson(articlePath);
  validateArticleShape(article);
  const reviewPath = path.join(WORK_DIR, file.replace(".article.json", ".review.json"));
  const review = (await exists(reviewPath)) ? await readJson(reviewPath) : undefined;
  const status = publishUnreviewed ? "reviewed" : reviewStatus(review);
  const parts = idParts(article.id);
  const normalized = {
    ...article,
    player: parts.player,
    enemy: parts.enemy,
    lane: parts.lane,
    status,
    updatedAt: article.updatedAt || new Date().toISOString().slice(0, 10)
  };

  if (byId.has(normalized.id) && !hasFlag("--replace")) {
    skipped += 1;
    continue;
  }
  byId.set(normalized.id, normalized);
  merged += 1;
}

const next = {
  ...manual,
  articles: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
};

if (!dryRun) {
  await fs.writeFile(MANUAL_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

console.log(`${dryRun ? "would merge" : "merged"} ${merged} article(s), skipped ${skipped}`);
