const DDRAGON_ROOT = "https://ddragon.leagueoflegends.com";
const LANES = ["ALL", "TOP", "JG", "MID", "ADC", "SUP"];
const TOPICS = [
  { id: "overview", label: "概要" },
  { id: "runes", label: "ルーン/キーストーン" },
  { id: "items", label: "アイテム購入" },
  { id: "laning", label: "レーン別の動き" },
  { id: "matchup", label: "マッチアップ対応" },
  { id: "mechanics", label: "スキルショット/ドッジ" },
  { id: "basics", label: "初心者知識" },
];

const laneNames = {
  ALL: "すべて",
  TOP: "トップ",
  JG: "ジャングル",
  MID: "ミッド",
  ADC: "ボット",
  SUP: "サポート",
};

const state = {
  version: "",
  champions: [],
  championDetails: new Map(),
  manualMatchups: [],
  items: [],
  runes: [],
  selectedChampionId: "",
  activeLane: "ALL",
  activeTopic: "overview",
  query: "",
  detailRenderToken: 0,
};

const els = {
  patchLabel: document.querySelector("#patchLabel"),
  championSearch: document.querySelector("#championSearch"),
  laneFilters: document.querySelector("#laneFilters"),
  topicNav: document.querySelector("#topicNav"),
  championCount: document.querySelector("#championCount"),
  championList: document.querySelector("#championList"),
  listMeta: document.querySelector("#listMeta"),
  championDetail: document.querySelector("#championDetail"),
  playerChampion: document.querySelector("#playerChampion"),
  enemyChampion: document.querySelector("#enemyChampion"),
  matchupLane: document.querySelector("#matchupLane"),
  matchupResult: document.querySelector("#matchupResult"),
  swapMatchup: document.querySelector("#swapMatchup"),
};

function stripHtml(text = "") {
  const div = document.createElement("div");
  div.innerHTML = text;
  return div.textContent || div.innerText || "";
}

function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, "");
}

function championIcon(champion) {
  return `${DDRAGON_ROOT}/cdn/${state.version}/img/champion/${champion.image.full}`;
}

function itemIcon(item) {
  return `${DDRAGON_ROOT}/cdn/${state.version}/img/item/${item.image.full}`;
}

function runeIcon(rune) {
  return `${DDRAGON_ROOT}/cdn/img/${rune.icon}`;
}

function tagsOf(champion) {
  return champion.tags || [];
}

function hasTag(champion, tag) {
  return tagsOf(champion).includes(tag);
}

function getChampion(id) {
  return state.champions.find((champion) => champion.id === id);
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function loadChampionDetail(id) {
  if (!id) return undefined;
  if (state.championDetails.has(id)) return state.championDetails.get(id);
  const data = await loadJson(`${DDRAGON_ROOT}/cdn/${state.version}/data/ja_JP/champion/${id}.json`);
  const detail = data.data[id];
  state.championDetails.set(id, detail);
  return detail;
}

async function loadManualMatchups() {
  try {
    const data = await loadJson("./data/manual-matchups.json");
    state.manualMatchups = Array.isArray(data.articles) ? data.articles : [];
  } catch {
    state.manualMatchups = [];
  }
}

function inferLanes(champion) {
  const lanes = new Set();
  const explicit = {
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

  (explicit[champion.id] || []).forEach((lane) => lanes.add(lane));
  if (hasTag(champion, "Marksman")) lanes.add("ADC");
  if (hasTag(champion, "Support")) lanes.add("SUP");
  if (hasTag(champion, "Mage") || hasTag(champion, "Assassin")) lanes.add("MID");
  if (hasTag(champion, "Fighter") || hasTag(champion, "Tank")) lanes.add("TOP");
  if (hasTag(champion, "Fighter") && champion.info.defense >= 5) lanes.add("JG");
  if (!lanes.size) lanes.add("MID");
  return [...lanes];
}

function damageProfile(champion) {
  if (champion.info.magic >= champion.info.attack + 2) return "AP寄り";
  if (champion.info.attack >= champion.info.magic + 2) return "AD寄り";
  return "ハイブリッド寄り";
}

function rangeProfile(champion) {
  if (hasTag(champion, "Marksman") || hasTag(champion, "Mage") || hasTag(champion, "Support")) return "レンジ";
  return "メレー";
}

function archetype(champion) {
  if (hasTag(champion, "Assassin")) return "アサシン";
  if (hasTag(champion, "Marksman")) return "マークスマン";
  if (hasTag(champion, "Mage")) return "メイジ";
  if (hasTag(champion, "Tank")) return "タンク";
  if (hasTag(champion, "Support")) return "サポート";
  if (hasTag(champion, "Fighter")) return "ファイター";
  return "汎用";
}

function winCondition(champion, detail) {
  const passive = detail?.passive?.name ? `パッシブ「${detail.passive.name}」` : "固有能力";
  const firstSpell = detail?.spells?.[0]?.name ? `Q系スキル「${detail.spells[0].name}」` : "主力スキル";
  const type = archetype(champion);
  const plans = {
    アサシン: `${firstSpell}や機動力で体力を削り、視界外から柔らかい敵を倒す。正面から長く殴り合うより、敵の主要スキルが落ちた瞬間を狙う。`,
    マークスマン: `${passive}と通常攻撃の射程を使い、安全な位置から継続火力を出す。序盤はCS、集団戦は近い敵を倒しながら前に進む。`,
    メイジ: `${firstSpell}を軸にウェーブと体力を削り、当たった時だけ前へ出る。外した直後は弱い時間なので距離を取り直す。`,
    タンク: `${passive}とCC/耐久を使って味方の前に立つ。レーンで大勝ちしなくても、集団戦で戦闘開始か味方保護ができれば価値が高い。`,
    サポート: `${firstSpell}を味方の動きに合わせ、ADCを守るか敵を捕まえる。ワードとロームで味方全体の選択肢を増やす。`,
    ファイター: `${passive}を活かして短い交換から体力差を作り、相手のスキルがない時間に長く戦う。`,
    汎用: `${firstSpell}を外した時は下がり、当てた時だけトレードする。ミニオン数と敵ジャングル位置を見て戦う。`,
  };
  return plans[type];
}

function spellText(spell) {
  return stripHtml(spell?.description || spell?.tooltip || "").replace(/\s+/g, " ").slice(0, 120);
}

function threatSpell(detail) {
  const spells = detail?.spells || [];
  const keywords = ["スタン", "スネア", "ノック", "チャーム", "フィアー", "サイレンス", "スロウ", "ダッシュ", "飛び"];
  return spells.find((spell) => keywords.some((keyword) => spellText(spell).includes(keyword))) || spells[0];
}

function pokeSpell(detail) {
  const spells = detail?.spells || [];
  const keywords = ["魔法ダメージ", "物理ダメージ", "発射", "指定方向", "範囲", "爆発"];
  return spells.find((spell) => keywords.some((keyword) => spellText(spell).includes(keyword))) || spells[0];
}

function runeTree(id) {
  return state.runes.find((tree) => tree.id === id);
}

function runeTreeName(id) {
  return runeTree(id)?.name || "現行ルーン";
}

function runeProfile(champion) {
  const type = archetype(champion);
  const profiles = {
    マークスマン: { main: 8000, subs: [8300, 8200], goal: "通常攻撃の回数と継続火力を伸ばす" },
    アサシン: { main: 8100, subs: [8000, 8200], goal: "短時間で倒し切る瞬間火力を伸ばす" },
    メイジ: { main: 8200, subs: [8300, 8100], goal: "スキル命中時の削りとマナ/回転率を伸ばす" },
    タンク: { main: 8400, subs: [8300, 8000], goal: "短い交換と集団戦での耐久を伸ばす" },
    サポート: { main: 8300, subs: [8400, 8200], goal: "味方保護、視界、仕掛けの安定感を伸ばす" },
    ファイター: { main: 8000, subs: [8400, 8300], goal: "長めの殴り合いとレーン維持を伸ばす" },
    汎用: { main: 8000, subs: [8400, 8300], goal: "戦闘とレーン維持を両立する" },
  };
  return profiles[type] || profiles.汎用;
}

function currentKeystones(champion) {
  const profile = runeProfile(champion);
  const tree = runeTree(profile.main);
  return tree?.slots?.[0]?.runes || [];
}

function runeAdvice(champion, detail) {
  const profile = runeProfile(champion);
  const keystones = currentKeystones(champion);
  const keystoneNames = keystones.map((rune) => rune.name).join(" / ");
  const spell = pokeSpell(detail)?.name || "主力スキル";
  return {
    mainPath: runeTreeName(profile.main),
    subPath: profile.subs.map(runeTreeName).join(" または "),
    keystoneNames,
    mainReason: `${champion.name}は${archetype(champion)}なので、メインパスは「${profile.goal}」ために選ぶ。${spell}を当てた後に続けて戦えるか、短く下がるかでキーストーンを選ぶ。`,
    subReason: `サブパスは対面で変える。レーンが苦しい時は維持や防御、勝てる時は火力や移動、ロームを助ける効果を優先する。表示候補はすべてData Dragon ${state.version}に存在するルーンのみ。`,
    shards: "シャードは相手の主ダメージに合わせる。AD相手は物理防御、AP相手は魔法防御、よく分からない時は体力寄りでデスを減らす。",
  };
}

function mapLegalItem(item) {
  return !item.maps || item.maps["11"] !== false;
}

function itemScore(item, champion) {
  const stats = item.stats || {};
  const itemTags = item.tags || [];
  const type = archetype(champion);
  let score = 0;
  if (type === "マークスマン") {
    if (stats.FlatPhysicalDamageMod) score += 2;
    if (stats.PercentAttackSpeedMod) score += 2;
    if (stats.FlatCritChanceMod) score += 3;
    if (itemTags.includes("LifeSteal")) score += 1;
  }
  if (type === "メイジ") {
    if (stats.FlatMagicDamageMod) score += 3;
    if (stats.FlatMPPoolMod) score += 1;
    if (itemTags.includes("SpellDamage")) score += 2;
  }
  if (type === "アサシン") {
    if (stats.FlatPhysicalDamageMod || stats.FlatMagicDamageMod) score += 2;
    if (itemTags.includes("ArmorPenetration") || itemTags.includes("MagicPenetration")) score += 3;
  }
  if (type === "タンク") {
    if (stats.FlatHPPoolMod) score += 2;
    if (stats.FlatArmorMod) score += 2;
    if (stats.FlatSpellBlockMod) score += 2;
  }
  if (type === "サポート") {
    if (itemTags.includes("GoldPer")) score += 3;
    if (itemTags.includes("Vision")) score += 2;
    if (stats.FlatHPPoolMod || stats.FlatMagicDamageMod) score += 1;
  }
  if (type === "ファイター") {
    if (stats.FlatPhysicalDamageMod) score += 2;
    if (stats.FlatHPPoolMod) score += 2;
    if (stats.FlatArmorMod || stats.FlatSpellBlockMod) score += 1;
  }
  return score;
}

function itemReason(item, champion, enemy) {
  const stats = item.stats || {};
  const reasons = [];
  if (stats.FlatPhysicalDamageMod) reasons.push(`${champion.name}のAD火力を伸ばす`);
  if (stats.FlatMagicDamageMod) reasons.push(`${champion.name}のスキル火力を伸ばす`);
  if (stats.PercentAttackSpeedMod) reasons.push("通常攻撃の回転を上げる");
  if (stats.FlatCritChanceMod) reasons.push("継続火力の伸びを作る");
  if (stats.FlatHPPoolMod) reasons.push("即死を防ぎ、前に残れる時間を増やす");
  if (stats.FlatArmorMod) reasons.push(`${enemy?.name || "AD相手"}の物理ダメージを受けやすくする`);
  if (stats.FlatSpellBlockMod) reasons.push(`${enemy?.name || "AP相手"}の魔法ダメージを受けやすくする`);
  return reasons.slice(0, 2).join("。") || stripHtml(item.plaintext || item.description).slice(0, 70);
}

function findItemsFor(champion) {
  return state.items
    .map((item) => ({ item, score: itemScore(item, champion) }))
    .filter(({ item, score }) => score > 0 && mapLegalItem(item) && item.gold?.purchasable && !item.requiredChampion && item.gold.total >= 900)
    .sort((a, b) => b.score - a.score || b.item.gold.total - a.item.gold.total)
    .slice(0, 8)
    .map(({ item }) => item);
}

function itemPlan(champion, enemy, detail) {
  const type = archetype(champion);
  const spell = pokeSpell(detail)?.name || "主力スキル";
  const enemyDamage = enemy ? damageProfile(enemy) : "";
  const statGoals = {
    マークスマン: ["攻撃力", "攻撃速度", "クリティカル", "ライフスティール"],
    メイジ: ["魔力", "マナ", "スキルヘイスト", "魔法防御貫通"],
    アサシン: ["攻撃力または魔力", "貫通", "スキルヘイスト", "移動速度"],
    タンク: ["体力", "物理防御", "魔法防御", "行動妨害耐性"],
    サポート: ["サポート用の収入", "視界", "スキルヘイスト", "体力/回復/シールド"],
    ファイター: ["攻撃力", "体力", "スキルヘイスト", "防御"],
    汎用: ["火力", "体力", "防御", "スキルヘイスト"],
  };
  const core = `${champion.name}は${type}なので、${spell}や通常攻撃で勝ち筋を作るためのステータスを優先する。候補欄にはData Dragon ${state.version}で購入可能なサモナーズリフト用アイテムだけを出す。`;
  const counter = enemy
    ? enemyDamage === "AP寄り"
      ? `${enemy.name}はAP寄り。レーンで倒されるなら魔法防御や体力のある候補を先に見る。`
      : enemyDamage === "AD寄り"
        ? `${enemy.name}はAD寄り。レーンで倒されるなら物理防御や体力のある候補を先に見る。`
        : `${enemy.name}は混合寄り。先に育ったダメージタイプに合わせて防御を寄せる。`
    : "対面のダメージタイプに合わせて、防御寄りの候補を挟む。";
  const behind = "負けている時は高い完成品を急がず、次の戦闘で死なない中間素材を優先する。買い物の目的を「火力を伸ばす」「死なない」「視界を取る」のどれかに決める。";
  return { stats: statGoals[type] || statGoals.汎用, core, counter, behind };
}

function itemText(item) {
  return stripHtml(`${item.name || ""} ${item.plaintext || ""} ${item.description || ""}`).toLowerCase();
}

function itemStat(item, key) {
  return Number(item.stats?.[key] || 0);
}

function itemHasTag(item, tag) {
  return (item.tags || []).includes(tag);
}

function itemHasAnyTag(item, tags) {
  return tags.some((tag) => itemHasTag(item, tag));
}

function isCurrentSummonersRiftItem(item) {
  return mapLegalItem(item) && item.gold?.purchasable && !item.requiredChampion && Number(item.gold.total || 0) >= 900;
}

function championItemProfile(champion) {
  const type = archetype(champion);
  const id = champion.id;
  const mageBot = new Set(["Ziggs", "Seraphine", "Karthus", "Swain", "Veigar", "Heimerdinger", "Brand", "Lux", "Velkoz", "Xerath"]);
  const apAssassins = new Set(["Akali", "Diana", "Ekko", "Evelynn", "Fizz", "Kassadin", "Katarina", "Leblanc"]);
  const onHitMarksmen = new Set(["Kaisa", "KogMaw", "Varus", "Vayne", "Kalista", "Twitch"]);
  const enchanters = new Set(["Janna", "Lulu", "Milio", "Nami", "Renata", "Sona", "Soraka", "Yuumi", "Seraphine"]);

  if (mageBot.has(id) || type === "メイジ") {
    return {
      kind: "ap",
      label: "APスキル型",
      stats: ["魔力", "スキルヘイスト", "マナまたはマナ回復", "魔法防御貫通"],
      core: "スキル命中で勝つため、ADやクリティカルではなく魔力・ヘイスト・魔法貫通を優先します。",
    };
  }
  if (type === "マークスマン") {
    return {
      kind: onHitMarksmen.has(id) ? "onhit" : "crit",
      label: onHitMarksmen.has(id) ? "通常攻撃/オンヒット型" : "クリティカルADC型",
      stats: onHitMarksmen.has(id)
        ? ["攻撃速度", "攻撃力", "通常攻撃時効果", "ライフスティールまたは耐久"]
        : ["攻撃力", "攻撃速度", "クリティカル", "ライフスティール"],
      core: onHitMarksmen.has(id)
        ? "通常攻撃を当て続ける型なので、攻撃速度と通常攻撃時効果を中心に見ます。"
        : "通常攻撃のDPSを伸ばす型なので、攻撃力・攻撃速度・クリティカルの噛み合いを見ます。",
    };
  }
  if (type === "アサシン") {
    const ap = apAssassins.has(id) || damageProfile(champion) === "AP寄り";
    return {
      kind: ap ? "apAssassin" : "adAssassin",
      label: ap ? "APアサシン型" : "ADアサシン型",
      stats: ap ? ["魔力", "魔法防御貫通", "スキルヘイスト", "移動速度"] : ["攻撃力", "脅威/物理防御貫通", "スキルヘイスト", "移動速度"],
      core: "短時間で倒し切る型なので、耐久だけのアイテムよりバーストに直結するステータスを優先します。",
    };
  }
  if (type === "タンク") {
    return {
      kind: "tank",
      label: "タンク型",
      stats: ["体力", "物理防御", "魔法防御", "行動妨害耐性"],
      core: "前に立つ役割なので、火力アイテムより相手の主ダメージに合う防御を優先します。",
    };
  }
  if (type === "サポート") {
    const enchanter = enchanters.has(id) || damageProfile(champion) === "AP寄り";
    return {
      kind: enchanter ? "enchanter" : "tankSupport",
      label: enchanter ? "エンチャンター/メイジサポート型" : "タンクサポート型",
      stats: enchanter ? ["サポート収入", "スキルヘイスト", "回復/シールド強化", "視界"] : ["サポート収入", "体力", "物理防御/魔法防御", "視界"],
      core: "サポートは収入と視界が役割に直結します。非サポート用の高額火力だけを急ぐと仕事が遅れます。",
    };
  }
  return {
    kind: "fighter",
    label: "ファイター型",
    stats: ["攻撃力", "体力", "スキルヘイスト", "相手に合わせた防御"],
    core: "殴り合いを続ける型なので、火力と耐久が両方伸びるアイテムを優先します。",
  };
}

function itemBucketScore(item, profile, enemy, bucket) {
  if (!isCurrentSummonersRiftItem(item)) return -Infinity;
  const tags = item.tags || [];
  const text = itemText(item);
  const isSupportOnly = itemHasAnyTag(item, ["GoldPer", "Vision"]);
  const isBoots = itemHasTag(item, "Boots");
  const ad = itemStat(item, "FlatPhysicalDamageMod");
  const ap = itemStat(item, "FlatMagicDamageMod");
  const as = itemStat(item, "PercentAttackSpeedMod");
  const crit = itemStat(item, "FlatCritChanceMod");
  const hp = itemStat(item, "FlatHPPoolMod");
  const armor = itemStat(item, "FlatArmorMod");
  const mr = itemStat(item, "FlatSpellBlockMod");
  const mana = itemStat(item, "FlatMPPoolMod");
  const hasteText = text.includes("スキルヘイスト") || text.includes("ability haste");
  const lifesteal = itemHasTag(item, "LifeSteal") || text.includes("ライフスティール");
  const pen = itemHasAnyTag(item, ["ArmorPenetration", "MagicPenetration"]) || text.includes("貫通") || text.includes("脅威");
  const antiHeal = text.includes("重傷") || text.includes("回復") || text.includes("heal");
  const antiShield = text.includes("シールド") || text.includes("shield");

  if (!["enchanter", "tankSupport"].includes(profile.kind) && isSupportOnly) return -Infinity;
  if (["crit", "onhit"].includes(profile.kind) && itemHasAnyTag(item, ["SpellDamage", "Mana"]) && !ad && !as && !crit) return -Infinity;
  if (["ap", "apAssassin", "enchanter"].includes(profile.kind) && (crit || itemHasTag(item, "CriticalStrike")) && !ap) return -Infinity;
  if (profile.kind === "adAssassin" && ap && !ad) return -Infinity;

  let score = 0;
  if (bucket === "defense") {
    const enemyDamage = enemy ? damageProfile(enemy) : "";
    if (enemyDamage === "AD寄り") score += armor * 0.08 + hp * 0.01;
    else if (enemyDamage === "AP寄り") score += mr * 0.1 + hp * 0.01;
    else score += armor * 0.04 + mr * 0.05 + hp * 0.01;
    if (score <= 0 && !isBoots) return -Infinity;
    return score + (isBoots ? 1 : 0);
  }

  if (bucket === "situational") {
    if (antiHeal) score += 5;
    if (antiShield) score += 4;
    if (lifesteal) score += 2;
    if (pen) score += 2;
    if (isBoots) score += 2;
    if (score <= 0) return -Infinity;
    return score;
  }

  switch (profile.kind) {
    case "crit":
      score += ad * 0.05 + as * 18 + crit * 40 + (lifesteal ? 2 : 0);
      if (!ad && !as && !crit) return -Infinity;
      break;
    case "onhit":
      score += ad * 0.04 + as * 24 + crit * 12 + (lifesteal ? 2 : 0) + (text.includes("通常攻撃") || text.includes("on-hit") ? 5 : 0);
      if (!ad && !as && !text.includes("通常攻撃")) return -Infinity;
      break;
    case "ap":
      score += ap * 0.07 + mana * 0.003 + (hasteText ? 2 : 0) + (pen ? 3 : 0);
      if (!ap && !pen) return -Infinity;
      break;
    case "apAssassin":
      score += ap * 0.08 + (pen ? 4 : 0) + (hasteText ? 2 : 0);
      if (!ap && !pen) return -Infinity;
      break;
    case "adAssassin":
      score += ad * 0.07 + (pen ? 5 : 0) + (hasteText ? 2 : 0);
      if (!ad && !pen) return -Infinity;
      break;
    case "tank":
      score += hp * 0.01 + armor * 0.06 + mr * 0.07 + (text.includes("行動妨害") ? 2 : 0);
      if (!hp && !armor && !mr) return -Infinity;
      break;
    case "enchanter":
      score += (isSupportOnly ? 4 : 0) + ap * 0.04 + (hasteText ? 2 : 0) + (text.includes("回復") || text.includes("シールド") ? 3 : 0);
      if (!isSupportOnly && !ap && !hasteText) return -Infinity;
      break;
    case "tankSupport":
      score += (isSupportOnly ? 4 : 0) + hp * 0.01 + armor * 0.05 + mr * 0.06 + (hasteText ? 1 : 0);
      if (!isSupportOnly && !hp && !armor && !mr) return -Infinity;
      break;
    default:
      score += ad * 0.05 + hp * 0.01 + armor * 0.03 + mr * 0.03 + (hasteText ? 2 : 0);
      if (!ad && !hp && !armor && !mr) return -Infinity;
  }
  return score + Math.min(Number(item.gold.total || 0) / 3500, 1);
}

function rankedItems(profile, enemy, bucket, limit) {
  return state.items
    .map((item) => ({ item, score: itemBucketScore(item, profile, enemy, bucket) }))
    .filter(({ score }) => Number.isFinite(score) && score > 0)
    .sort((a, b) => b.score - a.score || b.item.gold.total - a.item.gold.total)
    .slice(0, limit)
    .map(({ item }) => item);
}

function findItemGroups(champion, enemy) {
  const profile = championItemProfile(champion);
  return {
    profile,
    core: rankedItems(profile, enemy, "core", 5),
    defense: rankedItems(profile, enemy, "defense", 4),
    situational: rankedItems(profile, enemy, "situational", 4),
  };
}

function itemReasonByProfile(item, champion, enemy, bucket = "core", profile = championItemProfile(champion)) {
  const stats = [];
  if (itemStat(item, "FlatPhysicalDamageMod")) stats.push("攻撃力");
  if (itemStat(item, "FlatMagicDamageMod")) stats.push("魔力");
  if (itemStat(item, "PercentAttackSpeedMod")) stats.push("攻撃速度");
  if (itemStat(item, "FlatCritChanceMod")) stats.push("クリティカル");
  if (itemStat(item, "FlatHPPoolMod")) stats.push("体力");
  if (itemStat(item, "FlatArmorMod")) stats.push("物理防御");
  if (itemStat(item, "FlatSpellBlockMod")) stats.push("魔法防御");
  const text = itemText(item);
  if (text.includes("重傷")) stats.push("重傷");
  if (text.includes("シールド")) stats.push("シールド対策");
  if (itemHasAnyTag(item, ["GoldPer", "Vision"])) stats.push("サポート収入/視界");
  if (itemHasTag(item, "Boots")) stats.push("移動速度");
  const target = bucket === "defense" && enemy ? `${enemy.name}の${damageProfile(enemy)}に合わせる` : profile.label;
  return `${target}: ${stats.slice(0, 3).join("・") || stripHtml(item.plaintext || item.description).slice(0, 36)}を買う理由にする`;
}

function renderItemGroup(title, items, champion, enemy, bucket, profile) {
  if (!items.length) {
    return `<section class="info-card"><h3>${title}</h3><p>この条件では明確な候補を絞れません。ショップでは${profile.stats.join("・")}を優先して確認してください。</p></section>`;
  }
  return `<section class="info-card"><h3>${title}</h3><div class="item-grid">${items
    .map((item) => assetChip(itemIcon(item), item.name, `${item.gold.total}G: ${itemReasonByProfile(item, champion, enemy, bucket, profile)}`))
    .join("")}</div></section>`;
}

function renderItemGroups(groups, champion, enemy) {
  return [
    renderItemGroup("コア候補", groups.core, champion, enemy, "core", groups.profile),
    renderItemGroup("対面に合わせる防御候補", groups.defense, champion, enemy, "defense", groups.profile),
    renderItemGroup("状況対応候補", groups.situational, champion, enemy, "situational", groups.profile),
  ].join("");
}

function itemPlanByProfile(champion, enemy, detail) {
  const profile = championItemProfile(champion);
  const spell = pokeSpell(detail)?.name || "主力スキル";
  const enemyDamage = enemy ? damageProfile(enemy) : "";
  const core = `${champion.name}は${profile.label}として見ます。${profile.core} ${spell}や通常攻撃で勝つ形に合うステータスだけを候補化し、サポート専用・逆ダメージ系・削除済みアイテムを混ぜないようにしています。`;
  const counter = enemy
    ? `${enemy.name}は${enemyDamage}です。レーンで先に倒されるなら、完成火力を急ぐ前に${enemyDamage === "AP寄り" ? "魔法防御" : enemyDamage === "AD寄り" ? "物理防御" : "体力と両防御"}を含む候補を見ます。`
    : "対面を選ぶと、AD/AP傾向に合わせた防御候補を切り替えます。";
  const behind = "負けている時は高額完成品を無理に急がず、次の戦闘で死なない中間素材、靴、視界、対回復/対シールドなど目的が明確な買い物を優先します。";
  return { stats: profile.stats, core, counter, behind };
}

function laneAdvice(champion, lane, detail) {
  const type = archetype(champion);
  const profile = rangeProfile(champion);
  const laneKey = lane === "ALL" ? inferLanes(champion)[0] : lane;
  const spell = pokeSpell(detail);
  const threat = threatSpell(detail);
  const identity = `${champion.name}は${type}。${spell?.name || "主力スキル"}で作った有利を、${threat?.name || "重要スキル"}の当て方や温存で広げる。${winCondition(champion, detail)}`;
  const rangeLine =
    profile === "レンジ"
      ? "レンジなので、相手のラストヒット動作に合わせて短く触る。反撃スキルの射程内に残らない。"
      : "メレーなので、相手の主力スキルを先に使わせてから入る。敵ミニオンが多い場所では長く戦わない。";
  const laneLines = {
    TOP: ["長いレーンなので、押しすぎるとガンクで死にやすい。川かトライブッシュの視界を先に置く。", "大砲ウェーブを押し付けてからリコールすると、経験値を失いにくい。"],
    JG: ["最初は確実なフルクリアか、味方CCがあるレーンへのガンクに絞る。", `${threat?.name || "CC/移動スキル"}がある時だけ強気に入り、ない時は無理なガンクをしない。`],
    MID: ["ウェーブを先に押せた時だけロームを見る。押されている時のロームはCSとタワーを失う。", "両側からガンクが来るので、敵ジャングルが見えない時は中央より後ろに立つ。"],
    ADC: ["サポートと同じ横ラインに立つ。孤立すると2人分のスキルを受ける。", "集団戦は後衛を無理に狙わず、一番近い敵を安全に殴る。"],
    SUP: ["2レベル先行、敵の重要スキル空振り、味方ジャングル接近を仕掛けの合図にする。", "ADCが安全にCSを取れる時だけ、川やミッドに動く。"],
  };
  return [identity, rangeLine, ...(laneLines[laneKey] || laneLines.MID)];
}

function skillPlan(player, enemy, lane, playerDetail, enemyDetail) {
  const playerRange = rangeProfile(player);
  const enemyRange = rangeProfile(enemy);
  const enemyType = archetype(enemy);
  const playerPoke = pokeSpell(playerDetail);
  const playerThreat = threatSpell(playerDetail);
  const enemyThreat = threatSpell(enemyDetail);
  const enemyPoke = pokeSpell(enemyDetail);
  const aiming =
    enemyRange === "メレー"
      ? `${enemy.name}がCSを取りに前へ出る瞬間、${playerPoke?.name || playerThreat?.name || "主力スキル"}を置き気味に使う。近づかれてから撃つより、接近前の通り道に合わせる。`
      : `${enemy.name}は横移動で避けやすい。${playerPoke?.name || "スキルショット"}は敵がCSを取る瞬間、壁際、味方CCの直後に撃つ。`;
  const dodging =
    enemyThreat?.name
      ? `${enemy.name}の「${enemyThreat.name}」を最優先で見る。これを避けるか使わせた後に、${player.name}の${playerThreat?.name || "反撃スキル"}で短く返す。`
      : enemyType === "メイジ"
        ? `${enemy.name}の長射程スキルは横に避ける。前後移動だけだと射線に残るので、撃たせてから前に出る。`
        : `${enemy.name}の主要スキルが見えたら、反撃より距離を優先する。`;
  const laneNote =
    lane === "ADC" || lane === "SUP"
      ? "ボットは2対2なので、敵サポートのCCと敵ADCの追撃をセットで考える。片方だけ見ていると負ける。"
      : lane === "JG"
        ? "ジャングルでは壁とブッシュで射線が変わる。狭い入口では避けにくいので先に視界を取る。"
        : "ソロレーンではミニオン数が多い側が有利。スキルを避けても敵ミニオンの中で殴り続けない。";
  const playerNote =
    playerRange === "レンジ"
      ? `${player.name}は射程を活かし、${playerPoke?.name || "スキル"}を撃った後に一歩下がる。スキル後の硬直で前に残らない。`
      : `${player.name}は入る前の1回目を避けることが重要。避けてから${playerThreat?.name || "主力スキル"}で短く入ると勝ちやすい。`;
  return { aiming, dodging, laneNote, playerNote, enemyPokeName: enemyPoke?.name };
}

function matchupAdvice(player, enemy, lane, playerDetail, enemyDetail) {
  const playerRange = rangeProfile(player);
  const enemyRange = rangeProfile(enemy);
  const playerType = archetype(player);
  const enemyType = archetype(enemy);
  const enemyDamage = damageProfile(enemy);
  const playerLanes = inferLanes(player);
  const enemyLanes = inferLanes(enemy);
  const skill = skillPlan(player, enemy, lane, playerDetail, enemyDetail);
  const laneFit = playerLanes.includes(lane) ? "選択レーンとの相性は自然" : `${player.name}は通常${playerLanes.map((l) => laneNames[l]).join(" / ")}寄り`;
  const rangeTrade =
    playerRange === "レンジ" && enemyRange === "メレー"
      ? "射程差で短く触る。ただし接近スキルが残っている時は追撃しない。"
      : playerRange === "メレー" && enemyRange === "レンジ"
        ? "序盤は体力を守る。相手の主力スキルが外れた直後だけ入る。"
        : "主力スキルを先に当てた側が勝ちやすい。外したら下がる。";
  const typeTrade =
    playerType === "アサシン" && enemyType === "マークスマン"
      ? "レベル6、視界外、敵フラッシュなしがキル条件。正面から歩くと逃げられる。"
      : playerType === "メイジ" && enemyType === "アサシン"
        ? "ウェーブを早く処理し、横から入られない位置に立つ。接近スキル後が反撃時間。"
        : `${playerType}対${enemyType}なので、${player.name}の得意な戦闘時間に寄せる。`;
  const item = itemPlan(player, enemy, playerDetail).counter;
  const wave =
    lane === "JG"
      ? "勝てない1v1を避け、味方レーンが先に寄れる側で戦う。"
      : "不利なら自タワー手前で止める。有利なら押し付けてリコール、ワード、ロームに変換する。";
  return { laneFit, rangeTrade, typeTrade, item, wave, enemyLanes, enemyDamage, skill };
}

function manualMatchupFor(playerId, enemyId, lane) {
  return state.manualMatchups.find((article) => {
    const samePair = article.player === playerId && article.enemy === enemyId;
    const sameLane = article.lane === lane || article.lane === "ALL";
    return samePair && sameLane && article.status !== "archived";
  });
}

function manualCoverageText() {
  const total = state.champions.length ? state.champions.length * (state.champions.length - 1) : 0;
  const reviewed = state.manualMatchups.filter((article) => article.status === "reviewed").length;
  const draft = state.manualMatchups.filter((article) => article.status === "draft").length;
  return `手書き記事 ${reviewed}/${total}本、下書き ${draft}本`;
}

function listItems(lines = []) {
  return lines.map((line) => `<li>${line}</li>`).join("");
}

function manualArticleCards(article) {
  if (!article) return "";
  return `
    <div class="manual-banner">
      <strong>手書き攻略記事</strong>
      <span>${article.id} / ${article.status} / ${article.updatedAt || "no date"}</span>
    </div>
    <div class="card-grid">
      <section class="info-card"><h3>要約</h3><p>${article.summary}</p></section>
      <section class="info-card"><h3>勝ち筋</h3><p>${article.winCondition}</p></section>
      <section class="info-card"><h3>警戒すること</h3><ul>${listItems(article.threatModel)}</ul></section>
      <section class="info-card"><h3>トレード</h3><ul>${listItems(article.trading)}</ul></section>
      <section class="info-card"><h3>レーン進行</h3><ol><li>${article.lanePlan?.levels1to3 || ""}</li><li>${article.lanePlan?.preSix || ""}</li><li>${article.lanePlan?.postSix || ""}</li><li>${article.lanePlan?.wave || ""}</li><li>${article.lanePlan?.recall || ""}</li></ol></section>
      <section class="info-card"><h3>ルーン基準</h3><p><strong>${article.runes?.keystone || ""}</strong> / ${article.runes?.mainPath || ""} + ${article.runes?.subPath || ""}</p><p>${article.runes?.mainWhy || ""}</p><p>${article.runes?.subWhy || ""}</p></section>
      <section class="info-card"><h3>アイテム基準</h3><p>${article.items?.firstBuy || ""}</p><p>${article.items?.coreReason || ""}</p><p>${article.items?.defensive || ""}</p><p>${article.items?.situational || ""}</p><p>${article.items?.whenBehind || ""}</p></section>
      <section class="info-card"><h3>ミス</h3><ul>${listItems(article.commonMistakes)}</ul></section>
    </div>
  `;
}

function manualMechanicsCards(article) {
  if (!article) return "";
  return `
    <div class="manual-banner">
      <strong>手書きスキル対応</strong>
      <span>${article.id}</span>
    </div>
    <div class="card-grid">
      <section class="info-card"><h3>当て方</h3><ul>${listItems(article.skillshots?.hit)}</ul></section>
      <section class="info-card"><h3>避け方</h3><ul>${listItems(article.skillshots?.dodge)}</ul></section>
      <section class="info-card"><h3>集団戦</h3><ul>${listItems(article.teamfights)}</ul></section>
      <section class="info-card"><h3>復習ポイント</h3><ul>${listItems(article.commonMistakes)}</ul></section>
    </div>
  `;
}

function beginnerKnowledge(champion, detail) {
  return [
    "CSは初心者が最初に伸ばしやすい勝率要素。10分で60CSを最初の目標にする。",
    "デスを減らす基準は、敵ジャングル不明、敵レベル先行、敵完成品あり、味方が寄れない、のどれかがある時に前へ出ないこと。",
    "ワードは敵が来てから置くものではなく、来る前に置いて逃げ道を作るもの。",
    "リコールは大砲ウェーブ前、押し付け後、オブジェクト前に行うと損が少ない。",
    `${champion.name}では「${winCondition(champion, detail)}」を毎試合の目的にする。`,
  ];
}

function filteredChampions() {
  return state.champions.filter((champion) => {
    const matchesLane = state.activeLane === "ALL" || inferLanes(champion).includes(state.activeLane);
    const q = normalize(state.query);
    const matchesQuery = !q || normalize(`${champion.id}${champion.name}${champion.title}`).includes(q);
    return matchesLane && matchesQuery;
  });
}

function renderFilters() {
  els.laneFilters.innerHTML = LANES.map(
    (lane) => `<button type="button" data-lane="${lane}" class="${state.activeLane === lane ? "active" : ""}">${laneNames[lane]}</button>`,
  ).join("");
  els.topicNav.innerHTML = TOPICS.map(
    (topic) => `<button type="button" data-topic="${topic.id}" class="${state.activeTopic === topic.id ? "active" : ""}">${topic.label}</button>`,
  ).join("");
}

function renderChampionList() {
  const champions = filteredChampions();
  els.championCount.textContent = `${state.champions.length}体`;
  els.listMeta.textContent = `${champions.length}体表示`;
  els.championList.innerHTML = champions
    .map((champion) => {
      const lanes = inferLanes(champion).slice(0, 2).map((lane) => laneNames[lane]).join(" / ");
      return `<button class="champion-row ${champion.id === state.selectedChampionId ? "active" : ""}" data-champion="${champion.id}">
        <img src="${championIcon(champion)}" alt="${champion.name}" loading="lazy" />
        <span class="champion-name">
          <strong>${champion.name}</strong>
          <span>${champion.title}</span>
        </span>
        <span class="pill">${lanes}</span>
      </button>`;
    })
    .join("");
}

function renderSelects() {
  const options = state.champions.map((champion) => `<option value="${champion.id}">${champion.name}</option>`).join("");
  els.playerChampion.innerHTML = options;
  els.enemyChampion.innerHTML = options;
  els.matchupLane.innerHTML = LANES.filter((lane) => lane !== "ALL")
    .map((lane) => `<option value="${lane}">${laneNames[lane]}</option>`)
    .join("");
  els.playerChampion.value = state.selectedChampionId || state.champions[0]?.id;
  els.enemyChampion.value = state.champions.find((champion) => champion.id !== els.playerChampion.value)?.id || state.champions[0]?.id;
  els.matchupLane.value = inferLanes(getChampion(els.playerChampion.value))[0] || "MID";
}

async function renderMatchup() {
  const player = getChampion(els.playerChampion.value);
  const enemy = getChampion(els.enemyChampion.value);
  if (!player || !enemy) return;
  const lane = els.matchupLane.value;
  const [playerDetail, enemyDetail] = await Promise.all([loadChampionDetail(player.id), loadChampionDetail(enemy.id)]);
  const advice = matchupAdvice(player, enemy, lane, playerDetail, enemyDetail);
  const manualArticle = manualMatchupFor(player.id, enemy.id, lane);
  if (manualArticle) {
    els.matchupResult.innerHTML = `
      <div class="insight"><b>手書き攻略</b><p>${manualArticle.summary}</p></div>
      <div class="insight"><b>勝ち筋</b><p>${manualArticle.winCondition}</p></div>
      <div class="insight"><b>警戒</b><ul>${listItems(manualArticle.threatModel?.slice(0, 2))}</ul></div>
      <div class="insight"><b>避け方</b><ul>${listItems(manualArticle.skillshots?.dodge?.slice(0, 2))}</ul></div>
    `;
    return;
  }
  els.matchupResult.innerHTML = `
    <div class="insight"><b>勝ち筋</b><p>${advice.laneFit}。${advice.rangeTrade} ${advice.typeTrade}</p></div>
    <div class="insight"><b>購入基準</b><p>${enemy.name}は${damageProfile(enemy)}。${advice.item}</p></div>
    <div class="insight"><b>ウェーブ/寄り</b><p>${advice.wave}</p></div>
    <div class="insight"><b>スキル対応</b><p>${advice.skill.dodging}</p></div>
  `;
}

function assetChip(img, title, subtitle) {
  return `<div class="asset-chip"><img src="${img}" alt="${title}" /><span><strong>${title}</strong><span>${subtitle}</span></span></div>`;
}

function renderLoadingDetail(champion) {
  els.championDetail.innerHTML = `
    <div class="empty-state">
      <h2>${champion.name}</h2>
      <p>スキル情報を読み込んでいます。</p>
    </div>
  `;
}

async function renderDetail() {
  const champion = getChampion(state.selectedChampionId);
  if (!champion) return;
  const token = ++state.detailRenderToken;
  renderLoadingDetail(champion);

  const selectedEnemy = getChampion(els.enemyChampion.value) || state.champions.find((c) => c.id !== champion.id);
  const [detail, enemyDetail] = await Promise.all([
    loadChampionDetail(champion.id),
    selectedEnemy ? loadChampionDetail(selectedEnemy.id) : Promise.resolve(undefined),
  ]);
  if (token !== state.detailRenderToken) return;

  const lanes = inferLanes(champion);
  const selectedLane = state.activeLane === "ALL" ? lanes[0] : state.activeLane;
  const rune = runeAdvice(champion, detail);
  const runes = currentKeystones(champion);
  const itemGroups = findItemGroups(champion, selectedEnemy);
  const matchup = selectedEnemy ? matchupAdvice(champion, selectedEnemy, selectedLane, detail, enemyDetail) : null;
  const manualArticle = selectedEnemy ? manualMatchupFor(champion.id, selectedEnemy.id, selectedLane) : null;
  const plan = itemPlanByProfile(champion, selectedEnemy, detail);
  const spells = detail?.spells || [];
  const passiveText = stripHtml(detail?.passive?.description || "").slice(0, 150);

  const spellCards = [
    detail?.passive ? `<section class="info-card"><h3>P: ${detail.passive.name}</h3><p>${passiveText}</p></section>` : "",
    ...spells.map((spell, index) => `<section class="info-card"><h3>${["Q", "W", "E", "R"][index]}: ${spell.name}</h3><p>${spellText(spell)}</p></section>`),
  ].join("");

  const itemCards = renderItemGroups(itemGroups, champion, selectedEnemy);

  const bodies = {
    overview: `
      <div class="card-grid">
        <section class="info-card"><h3>個別攻略メモ</h3><p>${champion.name}は${damageProfile(champion)}の${rangeProfile(champion)}${archetype(champion)}。${winCondition(champion, detail)}</p></section>
        <section class="info-card"><h3>初心者が見る基準</h3><ul><li>主レーン: ${lanes.map((lane) => laneNames[lane]).join(" / ")}</li><li>難易度: ${champion.info.difficulty}/10。難しいほど、まずデスを減らす。</li><li>戦う合図: 敵スキル空振り、ミニオン数有利、味方が寄れる、のどれか。</li></ul></section>
      </div>
      <section class="info-card"><h3>スキル別の読み方</h3><div class="card-grid">${spellCards}</div></section>
    `,
    runes: `
      <div class="card-grid">
        <section class="info-card"><h3>メインパス</h3><p><strong>${rune.mainPath}</strong></p><p>${rune.mainReason}</p></section>
        <section class="info-card"><h3>現行キーストーン候補</h3><p>${rune.keystoneNames || "候補を取得できませんでした"}</p><p>ここに出る名前はData Dragon ${state.version}から取得した現行ルーンのみです。</p></section>
        <section class="info-card"><h3>サブパス</h3><p><strong>${rune.subPath}</strong></p><p>${rune.subReason}</p></section>
        <section class="info-card"><h3>シャード</h3><p>${rune.shards}</p></section>
      </div>
      <section class="info-card"><h3>候補キーストーン</h3><div class="rune-grid">${runes.map((r) => assetChip(runeIcon(r), r.name, `${stripHtml(r.shortDesc).slice(0, 58)}...`)).join("")}</div></section>
    `,
    items: `
      <div class="card-grid">
        <section class="info-card"><h3>購入理由</h3><p>${plan.core}</p><p>${plan.counter}</p></section>
        <section class="info-card"><h3>負けている時</h3><p>${plan.behind}</p></section>
        <section class="info-card"><h3>見るステータス</h3><ul>${plan.stats.map((stat) => `<li>${stat}</li>`).join("")}</ul></section>
        <section class="info-card"><h3>混入防止</h3><p>候補アイテムは現在読み込んだData Dragonの購入可能アイテムだけです。削除済みアイテム名を手書き表示せず、チャンピオンの型に合わないサポート専用・逆ダメージ系・防御専用候補も除外します。</p></section>
      </div>
      <div class="card-grid">${itemCards}</div>
    `,
    laning: `
      <section class="info-card"><h3>${laneNames[selectedLane]}での${champion.name}の動き</h3><ol>${laneAdvice(champion, selectedLane, detail).map((line) => `<li>${line}</li>`).join("")}</ol></section>
      <section class="info-card"><h3>特徴を活かす考え方</h3><p>${winCondition(champion, detail)}</p></section>
    `,
    matchup: manualArticle
      ? manualArticleCards(manualArticle)
      : matchup
      ? `
      <div class="card-grid">
        <section class="info-card"><h3>${selectedEnemy.name}を見る順番</h3><ol><li>射程: ${champion.name}は${rangeProfile(champion)}、${selectedEnemy.name}は${rangeProfile(selectedEnemy)}。</li><li>タイプ: ${archetype(champion)}対${archetype(selectedEnemy)}。</li><li>ダメージ: ${selectedEnemy.name}は${damageProfile(selectedEnemy)}。</li><li>主警戒: ${threatSpell(enemyDetail)?.name || "主力スキル"}。</li></ol></section>
        <section class="info-card"><h3>レーンの戦い方</h3><p>${matchup.rangeTrade} ${matchup.typeTrade}</p></section>
        <section class="info-card"><h3>買い物対応</h3><p>${matchup.item}</p></section>
        <section class="info-card"><h3>不利時の処理</h3><p>${matchup.wave}</p></section>
      </div>`
      : "",
    mechanics: manualArticle
      ? manualMechanicsCards(manualArticle)
      : matchup
      ? `
      <div class="card-grid">
        <section class="info-card"><h3>${selectedEnemy.name}に当てる</h3><p>${matchup.skill.aiming}</p></section>
        <section class="info-card"><h3>${selectedEnemy.name}を避ける</h3><p>${matchup.skill.dodging}</p></section>
        <section class="info-card"><h3>${champion.name}側の注意</h3><p>${matchup.skill.playerNote}</p></section>
        <section class="info-card"><h3>${laneNames[selectedLane]}の注意</h3><p>${matchup.skill.laneNote}</p></section>
      </div>`
      : "",
    basics: `
      <section class="info-card"><h3>初心者が覚えるべき知識</h3><ol>${beginnerKnowledge(champion, detail).map((line) => `<li>${line}</li>`).join("")}</ol></section>
      <section class="info-card"><h3>試合中チェック</h3><ul><li>敵ジャングルはどちら側にいるか。</li><li>次のオブジェクトは何秒後か。</li><li>今は押すべきか、引くべきか。</li><li>次に買うアイテムは何の問題を解決するか。</li></ul></section>
    `,
  };

  els.championDetail.innerHTML = `
    <div class="detail-hero">
      <div class="hero-title">
        <img class="hero-icon" src="${championIcon(champion)}" alt="${champion.name}" />
        <div>
          <h2>${champion.name}</h2>
          <p class="small-note">${champion.title}</p>
          <div class="tagline">${tagsOf(champion).map((tag) => `<span class="pill">${tag}</span>`).join("")}${lanes.map((lane) => `<span class="pill">${laneNames[lane]}</span>`).join("")}</div>
        </div>
      </div>
      <span class="pill">${damageProfile(champion)} / ${rangeProfile(champion)} / ${archetype(champion)}</span>
    </div>
    <div class="tabs">${TOPICS.map((topic) => `<button type="button" data-topic="${topic.id}" class="${state.activeTopic === topic.id ? "active" : ""}">${topic.label}</button>`).join("")}</div>
    <div class="topic-body">${bodies[state.activeTopic]}</div>
    <p class="source-note">チャンピオン、スキル、アイテム、ルーン、画像はRiot Data Dragon ${state.version}から取得。アイテム名とルーン名は現行Data Dragon由来のみを表示します。手書き記事がある対面は記事本文を優先表示し、未執筆対面はスキル名・属性・レーン・相手タイプから下書きを生成します。${manualCoverageText()}</p>
  `;
}

function bindEvents() {
  els.championSearch.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderChampionList();
  });
  els.laneFilters.addEventListener("click", (event) => {
    const lane = event.target.closest("button")?.dataset.lane;
    if (!lane) return;
    state.activeLane = lane;
    renderFilters();
    renderChampionList();
    renderDetail();
  });
  els.topicNav.addEventListener("click", (event) => {
    const topic = event.target.closest("button")?.dataset.topic;
    if (!topic) return;
    state.activeTopic = topic;
    renderFilters();
    renderDetail();
  });
  els.championList.addEventListener("click", (event) => {
    const id = event.target.closest("button")?.dataset.champion;
    if (!id) return;
    state.selectedChampionId = id;
    els.playerChampion.value = id;
    renderChampionList();
    renderDetail();
    renderMatchup();
  });
  els.championDetail.addEventListener("click", (event) => {
    const topic = event.target.closest("button")?.dataset.topic;
    if (!topic) return;
    state.activeTopic = topic;
    renderFilters();
    renderDetail();
  });
  [els.playerChampion, els.enemyChampion, els.matchupLane].forEach((el) => {
    el.addEventListener("change", () => {
      if (el === els.playerChampion) state.selectedChampionId = els.playerChampion.value;
      renderChampionList();
      renderDetail();
      renderMatchup();
    });
  });
  els.swapMatchup.addEventListener("click", () => {
    const player = els.playerChampion.value;
    els.playerChampion.value = els.enemyChampion.value;
    els.enemyChampion.value = player;
    state.selectedChampionId = els.playerChampion.value;
    renderChampionList();
    renderDetail();
    renderMatchup();
  });
}

async function init() {
  bindEvents();
  renderFilters();
  try {
    const versions = await loadJson(`${DDRAGON_ROOT}/api/versions.json`);
    state.version = versions[0];
    els.patchLabel.textContent = `Patch ${state.version}`;
    const [championData, itemData, runeData] = await Promise.all([
      loadJson(`${DDRAGON_ROOT}/cdn/${state.version}/data/ja_JP/champion.json`),
      loadJson(`${DDRAGON_ROOT}/cdn/${state.version}/data/ja_JP/item.json`),
      loadJson(`${DDRAGON_ROOT}/cdn/${state.version}/data/ja_JP/runesReforged.json`),
    ]);
    await loadManualMatchups();
    state.champions = Object.values(championData.data).sort((a, b) => a.name.localeCompare(b.name, "ja"));
    state.items = Object.values(itemData.data).filter((item) => mapLegalItem(item));
    state.runes = runeData;
    state.selectedChampionId = state.champions[0]?.id || "";
    renderSelects();
    renderChampionList();
    renderDetail();
    renderMatchup();
  } catch (error) {
    els.championDetail.innerHTML = `<div class="error"><strong>データを読み込めませんでした。</strong><p>${error.message}</p><p>インターネット接続、またはRiot Data Dragonへのアクセスを確認してください。</p></div>`;
    els.patchLabel.textContent = "読み込み失敗";
  }
}

init();
