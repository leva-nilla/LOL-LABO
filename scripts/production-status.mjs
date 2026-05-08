import fs from "node:fs/promises";

const queue = JSON.parse(await fs.readFile("data/matchup-queue.json", "utf8"));
const manual = JSON.parse(await fs.readFile("data/manual-matchups.json", "utf8"));

const articles = manual.articles || [];
const reviewed = articles.filter((article) => article.status === "reviewed").length;
const draft = articles.filter((article) => article.status === "draft").length;
const archived = articles.filter((article) => article.status === "archived").length;
const writtenIds = new Set(articles.map((article) => article.id));
const remaining = queue.entries.filter((entry) => !writtenIds.has(entry.id)).length;
const byLane = {};

for (const lane of ["TOP", "JG", "MID", "ADC", "SUP"]) {
  byLane[lane] = {
    queue: queue.entries.filter((entry) => entry.lane === lane).length,
    written: articles.filter((article) => article.lane === lane).length
  };
}

console.log(JSON.stringify({
  patch: queue.patch,
  target: queue.targetArticleCount,
  written: articles.length,
  reviewed,
  draft,
  archived,
  remaining,
  byLane
}, null, 2));
