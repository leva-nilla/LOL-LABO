import fs from "node:fs/promises";
import path from "node:path";

const DDRAGON_ROOT = "https://ddragon.leagueoflegends.com";
const DEFAULT_OUT = "data/matchup-queue.json";

const laneNames = ["TOP", "JG", "MID", "ADC", "SUP"];

const explicitLanes = {
  Aatrox: ["TOP"], Ahri: ["MID"], Akali: ["MID", "TOP"], Alistar: ["SUP"], Amumu: ["JG", "SUP"],
  Anivia: ["MID"], Annie: ["MID", "SUP"], Aphelios: ["ADC"], Ashe: ["ADC", "SUP"], AurelionSol: ["MID"],
  Azir: ["MID"], Bard: ["SUP"], Belveth: ["JG"], Blitzcrank: ["SUP"], Brand: ["SUP", "MID"],
  Braum: ["SUP"], Caitlyn: ["ADC"], Camille: ["TOP"], Corki: ["MID", "ADC"], Darius: ["TOP"],
  Diana: ["JG", "MID"], Draven: ["ADC"], Ekko: ["JG", "MID"], Elise: ["JG"], Evelynn: ["JG"],
  Ezreal: ["ADC"], Fiora: ["TOP"], Fizz: ["MID"], Galio: ["MID", "SUP"], Gangplank: ["TOP"],
  Garen: ["TOP"], Graves: ["JG"], Gwen: ["TOP", "JG"], Hecarim: ["JG"], Heimerdinger: ["MID", "SUP"],
  Irelia: ["TOP", "MID"], Ivern: ["JG"], Janna: ["SUP"], JarvanIV: ["JG"], Jax: ["TOP", "JG"],
  Jayce: ["TOP", "MID"], Jhin: ["ADC"], Jinx: ["ADC"], Kaisa: ["ADC"], Kalista: ["ADC"],
  Karma: ["SUP", "MID"], Karthus: ["JG", "MID"], Kassadin: ["MID"], Katarina: ["MID"], Kayle: ["TOP", "MID"],
  Kayn: ["JG"], Kennen: ["TOP"], Khazix: ["JG"], Kindred: ["JG"], Kled: ["TOP"],
  KogMaw: ["ADC"], Leblanc: ["MID"], LeeSin: ["JG"], Leona: ["SUP"], Lillia: ["JG", "TOP"],
  Lissandra: ["MID"], Lucian: ["ADC", "MID"], Lulu: ["SUP"], Lux: ["MID", "SUP"], Malphite: ["TOP"],
  Malzahar: ["MID"], Maokai: ["SUP", "JG", "TOP"], MasterYi: ["JG"], Milio: ["SUP"], MissFortune: ["ADC"],
  Mordekaiser: ["TOP"], Morgana: ["SUP", "JG"], Naafiri: ["MID"], Nami: ["SUP"], Nasus: ["TOP"],
  Nautilus: ["SUP"], Neeko: ["MID", "SUP"], Nidalee: ["JG"], Nilah: ["ADC"], Nocturne: ["JG"],
  Nunu: ["JG"], Olaf: ["TOP", "JG"], Orianna: ["MID"], Ornn: ["TOP"], Pantheon: ["TOP", "SUP", "MID"],
  Poppy: ["TOP", "JG", "SUP"], Pyke: ["SUP"], Qiyana: ["MID"], Quinn: ["TOP"], Rakan: ["SUP"],
  Rammus: ["JG"], RekSai: ["JG"], Rell: ["SUP"], Renata: ["SUP"], Renekton: ["TOP"],
  Rengar: ["JG", "TOP"], Riven: ["TOP"], Rumble: ["TOP", "MID"], Ryze: ["MID", "TOP"], Samira: ["ADC"],
  Sejuani: ["JG", "TOP"], Senna: ["SUP", "ADC"], Seraphine: ["SUP", "ADC", "MID"], Sett: ["TOP", "SUP"],
  Shaco: ["JG", "SUP"], Shen: ["TOP"], Shyvana: ["JG"], Singed: ["TOP"], Sion: ["TOP"],
  Sivir: ["ADC"], Skarner: ["JG"], Smolder: ["ADC"], Sona: ["SUP"], Soraka: ["SUP"],
  Swain: ["SUP", "MID"], Sylas: ["MID"], Syndra: ["MID"], TahmKench: ["TOP", "SUP"], Taliyah: ["JG", "MID"],
  Talon: ["MID", "JG"], Taric: ["SUP"], Teemo: ["TOP"], Thresh: ["SUP"], Tristana: ["ADC", "MID"],
  Trundle: ["JG", "TOP"], Tryndamere: ["TOP"], TwistedFate: ["MID"], Twitch: ["ADC", "SUP"], Udyr: ["JG"],
  Urgot: ["TOP"], Varus: ["ADC"], Vayne: ["ADC", "TOP"], Veigar: ["MID", "SUP"], Velkoz: ["MID", "SUP"],
  Vex: ["MID"], Vi: ["JG"], Viego: ["JG"], Viktor: ["MID"], Vladimir: ["MID", "TOP"],
  Volibear: ["TOP", "JG"], Warwick: ["JG", "TOP"], Xayah: ["ADC"], Xerath: ["MID", "SUP"], XinZhao: ["JG"],
  Yasuo: ["MID", "TOP"], Yone: ["MID", "TOP"], Yorick: ["TOP"], Yuumi: ["SUP"], Zac: ["JG", "TOP"],
  Zed: ["MID"], Zeri: ["ADC"], Ziggs: ["MID", "ADC"], Zilean: ["SUP", "MID"], Zoe: ["MID"], Zyra: ["SUP"],
};

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function inferLanes(champion) {
  if (explicitLanes[champion.id]) return explicitLanes[champion.id];
  const tags = champion.tags || [];
  const lanes = new Set();
  if (tags.includes("Marksman")) lanes.add("ADC");
  if (tags.includes("Support")) lanes.add("SUP");
  if (tags.includes("Mage") || tags.includes("Assassin")) lanes.add("MID");
  if (tags.includes("Fighter") || tags.includes("Tank")) lanes.add("TOP");
  if (tags.includes("Fighter") && champion.info?.defense >= 5) lanes.add("JG");
  return lanes.size ? [...lanes] : ["MID"];
}

function priorityFor(playerLanes, enemyLanes) {
  if (playerLanes.some((lane) => enemyLanes.includes(lane))) return 1;
  if (playerLanes.includes("MID") || playerLanes.includes("TOP") || playerLanes.includes("ADC")) return 2;
  return 3;
}

function makeEntry(player, enemy) {
  const playerLanes = inferLanes(player);
  const enemyLanes = inferLanes(enemy);
  const sharedLane = playerLanes.find((lane) => enemyLanes.includes(lane));
  const lane = sharedLane || playerLanes[0] || "MID";
  return {
    id: `${player.id}-vs-${enemy.id}-${lane}`,
    player: player.id,
    enemy: enemy.id,
    lane,
    playerLanes,
    enemyLanes,
    priority: priorityFor(playerLanes, enemyLanes),
    status: "queued"
  };
}

const out = argValue("--out", DEFAULT_OUT);
const versions = await loadJson(`${DDRAGON_ROOT}/api/versions.json`);
const version = versions[0];
const championData = await loadJson(`${DDRAGON_ROOT}/cdn/${version}/data/ja_JP/champion.json`);
const champions = Object.values(championData.data).sort((a, b) => a.id.localeCompare(b.id));
const entries = [];

for (const player of champions) {
  for (const enemy of champions) {
    if (player.id === enemy.id) continue;
    entries.push(makeEntry(player, enemy));
  }
}

entries.sort((a, b) => a.priority - b.priority || a.lane.localeCompare(b.lane) || a.player.localeCompare(b.player) || a.enemy.localeCompare(b.enemy));

const queue = {
  schemaVersion: 1,
  patch: version,
  championCount: champions.length,
  targetArticleCount: champions.length * (champions.length - 1),
  generatedAt: new Date().toISOString(),
  lanes: laneNames,
  entries
};

await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
console.log(`wrote ${entries.length} entries to ${out} for patch ${version}`);
