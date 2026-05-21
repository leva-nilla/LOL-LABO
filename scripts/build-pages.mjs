import fs from "node:fs/promises";
import path from "node:path";

const OUT_DIR = "_site";
const files = ["index.html", "styles.css", "app.js", "data/manual-matchups.json"];

async function copyFile(file) {
  await fs.mkdir(path.join(OUT_DIR, path.dirname(file)), { recursive: true });
  await fs.copyFile(file, path.join(OUT_DIR, file));
}

await fs.rm(OUT_DIR, { recursive: true, force: true });
await fs.mkdir(OUT_DIR, { recursive: true });

for (const file of files) await copyFile(file);
const sourceIndex = JSON.parse(await fs.readFile("data/manual-matchups/index.json", "utf8"));
const entries = sourceIndex.entries.filter((entry) => entry.status === "reviewed");
const publicIndex = {
  ...sourceIndex,
  articleCount: entries.length,
  reviewed: entries.length,
  draft: 0,
  archived: 0,
  generatedAt: new Date().toISOString(),
  coverage: {
    byLane: Object.fromEntries(["TOP", "JG", "MID", "ADC", "SUP"].map((lane) => [lane, entries.filter((entry) => entry.lane === lane).length]))
  },
  entries
};

await fs.mkdir(path.join(OUT_DIR, "data/manual-matchups/articles"), { recursive: true });
await fs.writeFile(path.join(OUT_DIR, "data/manual-matchups/index.json"), `${JSON.stringify(publicIndex, null, 2)}\n`, "utf8");
for (const entry of entries) {
  await fs.mkdir(path.dirname(path.join(OUT_DIR, entry.path)), { recursive: true });
  await fs.copyFile(entry.path, path.join(OUT_DIR, entry.path));
}

await fs.writeFile(path.join(OUT_DIR, ".nojekyll"), "", "utf8");
console.log(`built ${OUT_DIR} with ${entries.length} reviewed article(s)`);
