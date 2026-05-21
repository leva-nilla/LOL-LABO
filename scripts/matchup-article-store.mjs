import fs from "node:fs/promises";
import path from "node:path";

export const MANUAL_PATH = "data/manual-matchups.json";
export const SHARD_ROOT = "data/manual-matchups";
export const INDEX_PATH = `${SHARD_ROOT}/index.json`;

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function writeJson(file, value, { pretty = true } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const content = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  await fs.writeFile(file, `${content}\n`, "utf8");
}

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export function articleIdParts(id) {
  const match = String(id).match(/^(.+)-vs-(.+)-([A-Z]+)$/);
  if (!match) return undefined;
  return { player: match[1], enemy: match[2], lane: match[3] };
}

export function articlePathFor(articleOrId) {
  const id = typeof articleOrId === "string" ? articleOrId : articleOrId.id;
  const parts = articleIdParts(id);
  if (!parts) throw new Error(`${id || "unknown"} has invalid article id`);
  return `${SHARD_ROOT}/articles/${parts.player}/${id}.json`;
}

function laneCounts(entries) {
  const byLane = {};
  for (const lane of ["TOP", "JG", "MID", "ADC", "SUP"]) {
    byLane[lane] = entries.filter((entry) => entry.lane === lane).length;
  }
  return byLane;
}

export function buildArticleIndex({ articles, patch, targetArticleCount }) {
  const entries = articles
    .map((article) => ({
      id: article.id,
      player: article.player,
      enemy: article.enemy,
      lane: article.lane,
      status: article.status || "draft",
      updatedAt: article.updatedAt || "",
      path: articlePathFor(article)
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const reviewed = entries.filter((entry) => entry.status === "reviewed").length;
  const draft = entries.filter((entry) => entry.status === "draft").length;
  const archived = entries.filter((entry) => entry.status === "archived").length;
  return {
    schemaVersion: 2,
    patch,
    targetArticleCount,
    articleCount: entries.length,
    reviewed,
    draft,
    archived,
    coverage: { byLane: laneCounts(entries) },
    generatedAt: new Date().toISOString(),
    entries
  };
}

export async function readArticleStore(manualPath = MANUAL_PATH) {
  const manual = await readJson(manualPath);
  if (Array.isArray(manual.articles)) {
    return {
      format: "monolith",
      pointer: manual,
      index: buildArticleIndex({
        articles: manual.articles,
        patch: manual.patch,
        targetArticleCount: manual.targetArticleCount
      }),
      articles: manual.articles
    };
  }

  const indexPath = manual.indexPath || manual.index || INDEX_PATH;
  const index = await readJson(indexPath);
  const articles = [];
  for (const entry of index.entries || []) {
    articles.push(await readJson(entry.path));
  }
  return { format: "sharded", pointer: manual, index, articles };
}

export async function readArticleIndex(manualPath = MANUAL_PATH) {
  const manual = await readJson(manualPath);
  if (Array.isArray(manual.articles)) {
    return buildArticleIndex({
      articles: manual.articles,
      patch: manual.patch,
      targetArticleCount: manual.targetArticleCount
    });
  }
  return readJson(manual.indexPath || manual.index || INDEX_PATH);
}

export async function writeShardedArticleStore({ articles, patch, targetArticleCount, notes }) {
  const sorted = [...articles].sort((a, b) => a.id.localeCompare(b.id));
  await fs.rm(SHARD_ROOT, { recursive: true, force: true });
  await fs.mkdir(`${SHARD_ROOT}/articles`, { recursive: true });

  for (const article of sorted) {
    await writeJson(articlePathFor(article), article, { pretty: false });
  }

  const index = buildArticleIndex({ articles: sorted, patch, targetArticleCount });
  await writeJson(INDEX_PATH, index, { pretty: true });
  await writeJson(MANUAL_PATH, {
    schemaVersion: 2,
    patch,
    storage: "sharded",
    indexPath: INDEX_PATH,
    notes: notes || "Matchup articles are stored as sharded JSON files for GitHub Pages and lazy loading."
  }, { pretty: true });
  return index;
}
