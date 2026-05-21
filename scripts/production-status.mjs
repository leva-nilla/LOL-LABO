import fs from "node:fs/promises";
import { readArticleIndex } from "./matchup-article-store.mjs";

const queue = JSON.parse(await fs.readFile("data/matchup-queue.json", "utf8"));
const index = await readArticleIndex();

const entries = index.entries || [];
const reviewed = entries.filter((article) => article.status === "reviewed").length;
const draft = entries.filter((article) => article.status === "draft").length;
const archived = entries.filter((article) => article.status === "archived").length;
const writtenIds = new Set(entries.map((article) => article.id));
const remaining = queue.entries.filter((entry) => !writtenIds.has(entry.id)).length;
const byLane = {};

for (const lane of ["TOP", "JG", "MID", "ADC", "SUP"]) {
  byLane[lane] = {
    queue: queue.entries.filter((entry) => entry.lane === lane).length,
    written: entries.filter((article) => article.lane === lane).length
  };
}

console.log(JSON.stringify({
  patch: queue.patch,
  target: queue.targetArticleCount,
  written: entries.length,
  reviewed,
  draft,
  archived,
  remaining,
  byLane
}, null, 2));
