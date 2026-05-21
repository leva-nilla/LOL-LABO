import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { readArticleIndex } from "./matchup-article-store.mjs";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${code}`));
    });
  });
}

async function mergeAndValidate() {
  const mergeArgs = ["scripts/merge-produced-articles.mjs"];
  if (publishUnreviewed) mergeArgs.push("--publish-unreviewed");
  await run("node", mergeArgs);
  await run("node", ["scripts/sanitize-article-runes.mjs"]);
  await run("node", ["scripts/validate-matchup-articles.mjs"]);
}

async function status() {
  const queue = JSON.parse(await fs.readFile("data/matchup-queue.json", "utf8"));
  const manual = await readArticleIndex();
  const written = new Set((manual.entries || []).map((article) => article.id));
  return {
    target: queue.targetArticleCount,
    written: written.size,
    remaining: queue.entries.filter((entry) => !written.has(entry.id)).length
  };
}

const batchSize = Number(argValue("--batch-size", "25"));
const maxBatches = Number(argValue("--max-batches", "1"));
const maxMinutes = Number(argValue("--max-minutes", "0"));
const concurrency = Math.max(1, Number(argValue("--concurrency", "1")));
const skipReview = hasFlag("--skip-review");
const publishUnreviewed = hasFlag("--publish-unreviewed");
const players = argValue("--players", "");
const startedAt = Date.now();

for (let batch = 1; batch <= maxBatches; batch += 1) {
  if (maxMinutes > 0 && Date.now() - startedAt >= maxMinutes * 60 * 1000) {
    console.log(`time limit reached after ${maxMinutes} minute(s)`);
    break;
  }
  const before = await status();
  if (before.remaining === 0) {
    console.log("production complete");
    break;
  }
  console.log(`batch ${batch}/${maxBatches}: ${before.written}/${before.target} written, ${before.remaining} remaining`);
  try {
    const produceArgs = [
      "scripts/produce-matchup-batch.mjs",
      "--limit",
      String(batchSize),
      "--execute",
      "--concurrency",
      String(concurrency)
    ];
    if (skipReview) produceArgs.push("--skip-review");
    if (players) produceArgs.push("--players", players);
    await run("node", produceArgs);
  } catch (error) {
    console.error(error.message);
    console.error("production batch stopped early; merging completed article files before exiting");
    await mergeAndValidate();
    process.exitCode = 1;
    break;
  }
  await mergeAndValidate();
}

const after = await status();
console.log(`done: ${after.written}/${after.target} written, ${after.remaining} remaining`);
