import fs from "node:fs";

const manualPath = "data/manual-matchups.json";
const fields = ["firstBuy", "coreReason", "defensive", "situational", "whenBehind"];

function isSuspicious(value) {
  const text = String(value ?? "");
  const questionCount = (text.match(/\?/g) || []).length;
  return questionCount >= 3 || text.includes("\uFFFD") || text.includes("???");
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
  const player = article.player || "自分のチャンピオン";
  const enemy = article.enemy || "対面チャンピオン";
  const lane = laneText(article);

  if (field === "firstBuy") {
    return `${player}側の最初の買い物は、${enemy}に対して「次の数分で何に困るか」を基準に決める。${lane}でCSを取る前に削られるなら体力や耐久、押し負けて動けないならウェーブ処理、短い交換で勝てるなら火力やスキル回転を優先する。`;
  }
  if (field === "coreReason") {
    return `${player}の勝ち筋を伸ばすため、コアは火力だけでなく射程、スキル回転、継続戦闘のどれが${enemy}相手に必要かで選ぶ。初心者は「当てて勝つ」のか「避けて長く戦う」のかを先に決めると迷いにくい。`;
  }
  if (field === "defensive") {
    return `${enemy}の主なダメージやCCで先に倒される時は、完成品を急がず防御寄りの中間素材や靴を挟む。物理が痛いなら物理防御、魔法が痛いなら魔法防御、どちらも受けるなら体力を重く見る。`;
  }
  if (field === "situational") {
    return `状況対応は${enemy}だけでなく敵チーム全体を見る。回復が多い、シールドが厚い、CCで捕まる、ポークで削られるなど、今いちばん負けにつながっている原因を一つ選び、それを減らす効果やステータスを買う。`;
  }
  if (field === "whenBehind") {
    return `負けている時は高額な完成品だけを目指さず、次のウェーブを取れる安い素材、靴、防御、視界につながる買い物を優先する。${enemy}にもう一度倒されないことが最初の目標。`;
  }
  return String(article.items?.[field] ?? "");
}

const manual = JSON.parse(fs.readFileSync(manualPath, "utf8"));
let fixed = 0;

for (const article of manual.articles || []) {
  article.items ||= {};
  for (const field of fields) {
    if (isSuspicious(article.items[field])) {
      article.items[field] = replacement(article, field);
      fixed += 1;
    }
  }
}

fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`, "utf8");
console.log(`fixed ${fixed} item fields`);
