import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { readArticleIndex } from "./matchup-article-store.mjs";

const QUEUE_PATH = "data/matchup-queue.json";
const OUT_DIR = "work/matchup-production";
const DDRAGON_ROOT = "https://ddragon.leagueoflegends.com";

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
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

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function commandParts(envName, fallback) {
  const raw = process.env[envName] || fallback;
  return raw.split(" ").filter(Boolean);
}

function runCommand(command, args, input) {
  return new Promise((resolve, reject) => {
    const isWindowsCmd = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
    const spawnCommand = isWindowsCmd ? "cmd.exe" : command;
    const spawnArgs = isWindowsCmd ? ["/c", command, ...args] : args;
    const child = spawn(spawnCommand, spawnArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed with ${code}\n${stderr}`));
    });
    child.stdin.end(input);
  });
}

async function championDetail(version, id) {
  const data = await loadJson(`${DDRAGON_ROOT}/cdn/${version}/data/ja_JP/champion/${id}.json`);
  return data.data[id];
}

function compactChampion(detail) {
  return {
    id: detail.id,
    name: detail.name,
    title: detail.title,
    tags: detail.tags,
    passive: {
      name: detail.passive?.name,
      description: detail.passive?.description
    },
    spells: (detail.spells || []).map((spell, index) => ({
      key: ["Q", "W", "E", "R"][index],
      name: spell.name,
      description: spell.description
    }))
  };
}

function compactRunes(runes) {
  return runes.map((tree) => ({
    id: tree.id,
    name: tree.name,
    keystones: (tree.slots?.[0]?.runes || []).map((rune) => rune.name)
  }));
}

function compactItems(items) {
  return Object.values(items.data || {})
    .filter((item) => item.gold?.purchasable && item.maps?.["11"] !== false && !item.requiredChampion && Number(item.gold.total || 0) >= 900)
    .map((item) => ({
      name: item.name,
      gold: item.gold.total,
      tags: item.tags || [],
      stats: item.stats || {}
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildWriterPrompt({ basePrompt, entry, patch, playerDetail, enemyDetail, runes, items }) {
  return [
    basePrompt,
    "",
    "# Current Patch",
    patch,
    "",
    "# Current Rune Context",
    "Use only these rune path and keystone names when naming runes.",
    JSON.stringify(compactRunes(runes), null, 2),
    "",
    "# Current Item Context",
    "Use only these item names when naming items. If unsure, write stat-based advice instead of naming an item.",
    JSON.stringify(compactItems(items), null, 2),
    "",
    "# Matchup Entry",
    JSON.stringify(entry, null, 2),
    "",
    "# Player Champion",
    JSON.stringify(compactChampion(playerDetail), null, 2),
    "",
    "# Enemy Champion",
    JSON.stringify(compactChampion(enemyDetail), null, 2)
  ].join("\n");
}

function buildReviewerPrompt({ basePrompt, article, runes, items }) {
  return [
    basePrompt,
    "",
    "# Current Rune Context",
    JSON.stringify(compactRunes(runes), null, 2),
    "",
    "# Current Item Context",
    JSON.stringify(compactItems(items), null, 2),
    "",
    "# Article",
    JSON.stringify(article, null, 2)
  ].join("\n");
}

function csvArg(name) {
  const raw = argValue(name, "");
  return raw ? new Set(raw.split(",").map((value) => value.trim()).filter(Boolean)) : undefined;
}

function nextQueued(queue, manual, limit, players) {
  const written = new Set((manual.entries || []).map((article) => article.id));
  return queue.entries
    .filter((entry) => !written.has(entry.id))
    .filter((entry) => !players || players.has(entry.player))
    .slice(0, limit);
}

function tryParseJson(text) {
  let trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) trimmed = fenced[1].trim();
  if (!trimmed.startsWith("{")) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      trimmed = trimmed.slice(start, end + 1);
    }
  }
  return JSON.parse(trimmed);
}

const limit = Number(argValue("--limit", "10"));
const concurrency = Math.max(1, Number(argValue("--concurrency", "1")));
const dryRun = hasFlag("--dry-run");
const execute = hasFlag("--execute");
const skipReview = hasFlag("--skip-review");
const players = csvArg("--players");
const queue = await readJson(QUEUE_PATH);
const manual = await readArticleIndex();
const writerBase = await fs.readFile("prompts/codex-writer.md", "utf8");
const reviewerBase = await fs.readFile("prompts/gemini-reviewer.md", "utf8");
const entries = nextQueued(queue, manual, limit, players);
const currentRunes = await loadJson(`${DDRAGON_ROOT}/cdn/${queue.patch}/data/ja_JP/runesReforged.json`);
const currentItems = await loadJson(`${DDRAGON_ROOT}/cdn/${queue.patch}/data/ja_JP/item.json`);

await fs.mkdir(OUT_DIR, { recursive: true });

if (!entries.length) {
  console.log("no queued entries left");
  process.exit(0);
}

const codexParts = commandParts(
  "CODEX_CLI_CMD",
  "npx.cmd -y @openai/codex exec --skip-git-repo-check --sandbox read-only --output-schema schemas/matchup-article.schema.json"
);
const geminiParts = commandParts("GEMINI_CLI_CMD", "npx.cmd -y @google/gemini-cli");

async function produceEntry(entry) {
  const playerDetail = await championDetail(queue.patch, entry.player);
  const enemyDetail = await championDetail(queue.patch, entry.enemy);
  const writerPrompt = buildWriterPrompt({
    basePrompt: writerBase,
    entry,
    patch: queue.patch,
    playerDetail,
    enemyDetail,
    runes: currentRunes,
    items: currentItems
  });
  const writerPromptPath = path.join(OUT_DIR, `${entry.id}.writer.md`);
  await fs.writeFile(writerPromptPath, writerPrompt, "utf8");

  if (dryRun || !execute) {
    console.log(`prepared ${entry.id}`);
    console.log(`  writer prompt: ${writerPromptPath}`);
    console.log(`  codex command: ${codexParts.join(" ")} - < ${writerPromptPath}`);
    return;
  }

  const articlePath = path.join(OUT_DIR, `${entry.id}.article.json`);
  if (!(await exists(articlePath))) {
    const codexArgs = [...codexParts.slice(1), "--output-last-message", articlePath, "-"];
    await runCommand(codexParts[0], codexArgs, writerPrompt);
  }
  const article = tryParseJson(await fs.readFile(articlePath, "utf8"));
  await fs.writeFile(articlePath, `${JSON.stringify(article, null, 2)}\n`, "utf8");

  if (skipReview) {
    console.log(`wrote ${articlePath}: review skipped`);
    return;
  }

  const reviewerPrompt = buildReviewerPrompt({ basePrompt: reviewerBase, article, runes: currentRunes, items: currentItems });
  const reviewerPromptPath = path.join(OUT_DIR, `${entry.id}.reviewer.md`);
  await fs.writeFile(reviewerPromptPath, reviewerPrompt, "utf8");
  const reviewPath = path.join(OUT_DIR, `${entry.id}.review.json`);
  let review;
  if (await exists(reviewPath)) {
    review = tryParseJson(await fs.readFile(reviewPath, "utf8"));
  } else {
    const geminiResult = await runCommand(
      geminiParts[0],
      [...geminiParts.slice(1), "--prompt", "Review the article from stdin. Return JSON only.", "--output-format", "text"],
      reviewerPrompt
    );
    review = tryParseJson(geminiResult.stdout);
    await fs.writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  }
  console.log(`wrote ${articlePath} and ${reviewPath}: ${review.decision}`);
}

let cursor = 0;
let firstError;
const workerCount = Math.min(concurrency, entries.length);
console.log(`processing ${entries.length} entries with concurrency ${workerCount}`);

async function worker() {
  while (!firstError) {
    const entry = entries[cursor];
    cursor += 1;
    if (!entry) return;
    try {
      await produceEntry(entry);
    } catch (error) {
      firstError = error;
      return;
    }
  }
}

await Promise.all(Array.from({ length: workerCount }, () => worker()));
if (firstError) throw firstError;
