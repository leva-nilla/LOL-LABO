import { readArticleStore, readJson, writeShardedArticleStore } from "./matchup-article-store.mjs";

const QUEUE_PATH = "data/matchup-queue.json";
const DDRAGON_ROOT = "https://ddragon.leagueoflegends.com";
const targetFields = ["firstBuy", "coreReason", "defensive", "situational", "whenBehind"];

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

let championNames = new Map();

function nameOf(id) {
  return championNames.get(id) || id;
}

function laneText(article) {
  return {
    TOP: "トップ",
    JG: "ジャングル",
    MID: "ミッド",
    ADC: "ボット",
    SUP: "サポート"
  }[article.lane] || article.lane || "レーン";
}

function replacement(article, field) {
  const player = nameOf(article.player) || "プレイヤー側";
  const enemy = nameOf(article.enemy) || "相手側";
  const lane = laneText(article);
  if (field === "firstBuy") {
    return `${player}側の最初の買い物は、${enemy}相手に${lane}で先に倒されないことを基準にする。削られるなら体力や耐久、押し負けるならウェーブ処理、短い交換で勝てるなら火力やスキル回転を優先する。`;
  }
  if (field === "coreReason") {
    return `${player}の勝ち筋を伸ばすため、コアは火力だけでなく射程、スキル回転、継続戦闘のどれが${enemy}相手に必要かで選ぶ。当てて勝つのか、避けて長く戦うのかを先に決める。`;
  }
  if (field === "defensive") {
    return `${enemy}の主なダメージやCCで先に倒される時は、いったん耐久の小物や靴で受ける時間を作る。物理が痛いなら物理防御、魔法が痛いなら魔法防御、混ざるなら体力を重く見る。`;
  }
  if (field === "situational") {
    return `${enemy}が回復、シールド、CC、ポークのどれで試合を動かしているかを見て、対回復、対シールド、移動速度、耐久、視界のうち一番負けを減らすものを買う。`;
  }
  if (field === "whenBehind") {
    return `負けている時は高額な完成品だけを目指さず、次のウェーブを取れる安い素材、靴、防御、視界につながる買い物を優先する。${enemy}にもう一度倒されないことが最初の目標。`;
  }
  return String(article.items?.[field] ?? "");
}

function runeMainWhy(article) {
  const player = nameOf(article.player) || "プレイヤー側";
  const enemy = nameOf(article.enemy) || "相手側";
  const mainPath = article.runes?.mainPath || "選んだメインパス";
  const keystone = article.runes?.keystone || "キーストーン";
  return `${player}は${mainPath}でレーンの交換と集団戦の役割を安定させる。${enemy}相手には、${keystone}を活かせる短い交換だけを選び、主要スキルを外した後は無理に前へ残らない。`;
}

function supportRune(article) {
  const player = nameOf(article.player);
  const enemy = nameOf(article.enemy);
  const enchanters = new Set(["Janna", "Lulu", "Milio", "Nami", "Renata", "Sona", "Soraka", "Yuumi", "Seraphine", "Karma"]);
  if (enchanters.has(article.player)) {
    return {
      keystone: "エアリー召喚",
      mainPath: "魔道",
      mainWhy: `${player}SUPは味方保護と短いポークを両方見る。${enemy}相手ではエアリー召喚でシールドや小さな交換を安定させ、危ない入口には本体で深く立たない。`,
      subPath: "天啓",
      subWhy: `天啓はレーン維持、サモナースペル、視界更新の余裕を作るため。${enemy}の合流前に味方ADCを守れる位置を保つ。`
    };
  }
  return undefined;
}

function supportItems(article) {
  const player = nameOf(article.player);
  const enemy = nameOf(article.enemy);
  const enchanters = new Set(["Janna", "Lulu", "Milio", "Nami", "Renata", "Sona", "Soraka", "Yuumi", "Seraphine", "Karma"]);
  if (enchanters.has(article.player)) {
    return {
      firstBuy: `${player}SUPはサポート収入、マナ回復、視界を優先する。${enemy}が合流する前に味方ADCへ寄れる位置を取り、無理な単独ワードで本体を落とさない。`,
      coreReason: `${player}は味方保護が主役。回復、シールド、スキルヘイスト、視界を伸ばし、${enemy}の入りに合わせて味方ADCが一歩下がれる時間を作る。`,
      defensive: `${enemy}の合流で先に捕まるなら、体力、移動速度、視界更新を優先する。自分が落ちる買い物より、味方ADCを守って次のスキルを回せる買い物が大事。`,
      situational: `${enemy}の回復やシールドが重い時は対策を考え、突入が重い時は移動速度と視界を増やす。味方ADCが一番困っている原因を一つだけ減らす。`,
      whenBehind: `負けている時は高額な魔力完成品へ逃げない。サポート収入、ワード、安い耐久、スキルヘイストで、次のドラゴン前に味方を守る準備をする。`
    };
  }
  return undefined;
}

function supportPatch(article) {
  if (article.lane !== "SUP") return false;
  const player = nameOf(article.player);
  const enemy = nameOf(article.enemy);
  let changed = false;
  if (
    article.summary?.includes("中盤のローム、視界、集団戦") ||
    article.summary?.includes("レーン正面より")
  ) {
    article.summary = `${player}SUP対${enemy}は、2v2の足元を崩さず、${enemy}が別レーンから合流する入口を視界で遅らせる記事。味方ADCの横ラインを保ち、単独で深いワードへ行かない。`;
    changed = true;
  }
  if (article.winCondition?.includes("寄り道や集団戦の入口")) {
    article.winCondition = `勝ち筋は味方ADCを守りながら、${enemy}がボット側へ合流する入口を先に見せること。${player}の主要スキルはキル狙いだけでなく、敵の入りを止めるために残す。`;
    changed = true;
  }
  if (article.lanePlan?.levels1to3?.includes("トップから来る前提")) {
    article.lanePlan = {
      levels1to3: `${player}SUPはまず味方ADCの横ラインを崩さず、敵ボット側のCCとダメージ交換を見る。${enemy}は正面対面ではないので、序盤から相手トップ側の話に寄せすぎない。`,
      preSix: `6前は川とトライブッシュの視界を切らさない。${enemy}がマップから消えた時は、深いワードより味方ADCが安全に下がれる位置を優先する。`,
      postSix: `6以降は${enemy}のRや合流を先に考える。${player}の主要スキルは味方ADCを守るために残す。`,
      wave: `ボットのウェーブは味方ADCが触れる位置を保つ。押し切る時は敵JGと${enemy}の位置が見えてからで、暗い川へ一人で入りすぎない。`,
      recall: `リコールはサポートアイテムのワード補充とドラゴン前に合わせる。低体力のまま居座ると、${enemy}本体より先にボット2v2で捕まる。`
    };
    changed = true;
  }
  if (article.skillshots?.hit?.[0]?.includes("CS、ワード、入口確認")) {
    article.skillshots.hit[0] = `${player}の主力スキルは敵ボットがCS、ワード、味方ADCへの追撃で足を止める瞬間に合わせる。${enemy}本人だけを追う記事ではない。`;
    changed = true;
  }
  if (article.commonMistakes?.some((line) => line.includes("奥の視界やプレート"))) {
    article.commonMistakes = article.commonMistakes.map((line) =>
      line.includes("奥の視界やプレート")
        ? `${enemy}が見えていない時間に、奥の視界へ一人で歩くこと。味方ADCから離れすぎると、ボット2v2の仕事も消える。`
        : line
    );
    changed = true;
  }
  if (
    article.skillshots?.dodge?.some((line) => line.includes("サイフォンストライク") || line.includes("滅魂の一撃") || line.includes("死の呪縛"))
  ) {
    article.skillshots.dodge = [
      `${enemy}の合流が見えていない時は、川入口やトライブッシュの視界を先に確認する。スキルを避けるより、暗い場所へ入らない方が大事。`,
      `味方ADCから離れすぎると、敵ボットのCCと${enemy}の合流を同時に受ける。横ラインを保って、逃げ道を残す。`,
      `低体力のままワードを置きに行かない。${enemy}本体に触られる前に、ボット2v2で捕まって終わる。`
    ];
    changed = true;
  }
  const runes = supportRune(article);
  if (runes && (article.player === "Yuumi" || article.runes?.keystone === "秘儀の彗星")) {
    article.runes = runes;
    changed = true;
  }
  const items = supportItems(article);
  if (items && (article.player === "Yuumi" || article.items?.coreReason?.includes("魔法防御貫通"))) {
    article.items = items;
    changed = true;
  }
  return changed;
}

function junglePatch(article) {
  if (article.lane !== "JG") return false;
  const player = nameOf(article.player);
  const enemy = nameOf(article.enemy);
  let changed = false;
  if (article.summary?.includes("レーン対面として倒す記事")) {
    article.summary = `${player}JG側は、${enemy}を直接倒すより、相手の合流を川と入口の視界で遅らせる記事。キャンプ順を崩さず、味方が先に寄れる場所だけで戦う。`;
    changed = true;
  }
  if (article.skillshots?.hit?.[0]?.includes("CS、ワード、入口確認")) {
    article.skillshots.hit[0] = `${player}の主力スキルは${enemy}が川入口、ワード確認、味方レーンへの寄りで進路を固定した瞬間に使う。キャンプ中の無理な追撃より、入口で待つ方が当たりやすい。`;
    changed = true;
  }
  if (article.commonMistakes?.some((line) => line.includes("奥の視界やプレート"))) {
    article.commonMistakes = article.commonMistakes.map((line) =>
      line.includes("奥の視界やプレート")
        ? `${enemy}が見えていない時間に、深い川や敵ジャングルへ一人で入ること。合流される前提で動かないなら、先に捕まる。`
        : line
    );
    changed = true;
  }
  return changed;
}

function suspicious(value) {
  const text = String(value ?? "");
  return (
    /\?{3,}/.test(text) ||
    text.includes("\uFFFD") ||
    text.includes("自分のチャンピオン") ||
    text.includes("対面チャンピオン") ||
    text.includes("次の数分で何に困るか") ||
    text.includes("敵チーム全体を見る") ||
    /に対して「.+に対して何を防ぐか」/.test(text) ||
    /に対して「/.test(text) ||
    /だけでなく.+以外の脅威も確認する/.test(text) ||
    /以外の脅威も確認する/.test(text) ||
    text.includes("完成品を急がず防御寄りの中間素材や靴を挟む")
  );
}

function cleanString(value, article) {
  return String(value)
    .replaceAll(article.player || "", nameOf(article.player))
    .replaceAll(article.enemy || "", nameOf(article.enemy))
    .replaceAll("自分のチャンピオン", nameOf(article.player) || "プレイヤー側")
    .replaceAll("対面チャンピオン", nameOf(article.enemy) || "相手側")
    .replaceAll("敵チーム全体を見る", `${nameOf(article.enemy) || "相手側"}以外の脅威も確認する`)
    .replaceAll("次の数分で何に困るか", `${nameOf(article.enemy) || "相手側"}に対して何を防ぐか`);
}

function cleanValue(value, article) {
  if (typeof value === "string") return cleanString(value, article);
  if (Array.isArray(value)) return value.map((item) => cleanValue(item, article));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cleanValue(nested, article)]));
  }
  return value;
}

const queue = await readJson(QUEUE_PATH);
const championData = await loadJson(`${DDRAGON_ROOT}/cdn/${queue.patch}/data/ja_JP/champion.json`);
championNames = new Map(Object.values(championData.data || {}).map((champion) => [champion.id, champion.name]));
const store = await readArticleStore();
let fixed = 0;

for (const article of store.articles || []) {
  const before = JSON.stringify(article);
  const stable = {
    id: article.id,
    player: article.player,
    enemy: article.enemy,
    lane: article.lane,
    status: article.status
  };
  const cleaned = cleanValue(article, article);
  Object.assign(article, cleaned);
  Object.assign(article, stable);
  supportPatch(article);
  junglePatch(article);

  article.items ||= {};
  for (const field of targetFields) {
    if (suspicious(article.items[field])) article.items[field] = replacement(article, field);
  }
  if (suspicious(article.runes?.mainWhy)) {
    article.runes ||= {};
    article.runes.mainWhy = runeMainWhy(article);
  }

  if (JSON.stringify(article) !== before) fixed += 1;
}

await writeShardedArticleStore({
  articles: store.articles,
  patch: queue.patch,
  targetArticleCount: queue.targetArticleCount
});

console.log(`repaired ${fixed} article(s)`);
