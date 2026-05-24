import { readArticleStore, readJson, writeShardedArticleStore } from "./matchup-article-store.mjs";

const QUEUE_PATH = "data/matchup-queue.json";
const DDRAGON_ROOT = "https://ddragon.leagueoflegends.com";
const DEFAULT_DATE = "2026-05-24";

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<br\s*\/?>(\s*)/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function collectText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(collectText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(collectText).join("\n");
  return "";
}

function articleBodyText(article) {
  return [
    article.summary,
    article.winCondition,
    ...(article.threatModel || []),
    ...(article.trading || []),
    ...Object.values(article.lanePlan || {}),
    ...Object.values(article.runes || {}),
    ...Object.values(article.items || {}),
    ...(article.skillshots?.hit || []),
    ...(article.skillshots?.dodge || []),
    ...(article.teamfights || []),
    ...(article.commonMistakes || [])
  ].join("\n");
}

function stableNumber(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick(article, values, offset = 0) {
  return values[(stableNumber(article.id) + offset) % values.length];
}

function tagsOf(champion) {
  return champion?.tags || [];
}

function hasTag(champion, tag) {
  return tagsOf(champion).includes(tag);
}

function archetype(champion) {
  if (hasTag(champion, "Marksman")) return "マークスマン";
  if (hasTag(champion, "Assassin")) return "アサシン";
  if (hasTag(champion, "Mage")) return "メイジ";
  if (hasTag(champion, "Tank")) return "タンク";
  if (hasTag(champion, "Support")) return "サポート";
  if (hasTag(champion, "Fighter")) return "ファイター";
  return "汎用";
}

function rangeProfile(champion) {
  const attackRange = Number(champion?.stats?.attackrange || 0);
  if (attackRange >= 500) return "レンジ";
  if (attackRange > 0 && attackRange < 500) return "メレー";
  if (hasTag(champion, "Marksman") || hasTag(champion, "Mage")) return "レンジ";
  return "メレー";
}

function supportStyle(champion) {
  const id = champion?.id || champion?.key || champion?.name || "";
  const enchanters = new Set(["Yuumi", "Soraka", "Sona", "Janna", "Lulu", "Nami", "Milio", "Renata", "Karma", "Seraphine"]);
  const mageSupports = new Set(["Brand", "Zyra", "Velkoz", "Xerath", "Lux", "Morgana", "Hwei", "Neeko", "Swain", "Zilean"]);
  if (hasTag(champion, "Tank")) return "タンクエンゲージ";
  if (hasTag(champion, "Fighter")) return "近接エンゲージ";
  if (enchanters.has(id)) return "エンチャンター";
  if (mageSupports.has(id)) return "メイジサポート";
  if (hasTag(champion, "Mage")) return "メイジサポート";
  if (hasTag(champion, "Support") && rangeProfile(champion) === "レンジ") return "エンチャンター";
  return "ユーティリティ";
}

function damageProfile(champion) {
  const info = champion?.info || {};
  if (Number(info.magic || 0) >= Number(info.attack || 0) + 2) return "魔法寄り";
  if (Number(info.attack || 0) >= Number(info.magic || 0) + 2) return "物理寄り";
  return "混合寄り";
}

function laneLabel(lane) {
  return ({ TOP: "トップ", JG: "ジャングル", MID: "ミッド", ADC: "ボット", SUP: "サポート" })[lane] || lane;
}

function laneRole(lane) {
  return ({ TOP: "サイドレーン", JG: "ジャングル", MID: "中央レーン", ADC: "ボットレーン", SUP: "ボット側サポート" })[lane] || "レーン";
}

function adcAnchor(article, offset = 0) {
  return pick(article, [
    "味方ADCの近く",
    "ADCが下がれる斜め後ろ",
    "味方キャリーの肩側",
    "ボット側の安全なライン",
    "味方ADCと同じ退路"
  ], offset);
}

function shortVision(article, offset = 0) {
  return pick(article, [
    "入口手前の情報",
    "安全なワード一つ",
    "自陣寄りの確認",
    "帰れる距離の視界",
    "通路入口の情報"
  ], offset);
}

function riskyWard(article, offset = 0) {
  return pick(article, [
    "奥側の視界",
    "敵陣側の確認",
    "帰れない視界更新",
    "深すぎる確認",
    "一人での川奥チェック"
  ], offset);
}

function expensiveDamageBuy(article, offset = 0) {
  return pick(article, [
    "高い火力完成品",
    "重い火力装備",
    "攻めの完成品",
    "値段の重いダメージ装備",
    "倒すためだけの買い物"
  ], offset);
}

function warningCall(article, offset = 0) {
  return pick(article, [
    "下がるピン",
    "ミア共有",
    "退却の合図",
    "川側注意の合図",
    "味方への警告"
  ], offset);
}

function smallPressure(article, offset = 0) {
  return pick(article, [
    "小さな削り",
    "軽い前歩き",
    "一回の牽制",
    "短いハラス",
    "浅い交換"
  ], offset);
}

function supportItemStats(article, offset = 0) {
  return pick(article, [
    "ワード数、耐久、スキル回転",
    "体力、移動速度、ワード補充",
    "マナ維持、ヘイスト、帰れる足",
    "サポートクエストの進行と防御小物",
    "味方を守るための体力とクールダウン"
  ], offset);
}

function damageOnlyBuy(article, offset = 0) {
  return pick(article, [
    "ダメージ寄りの素材だけ",
    "ダメージ部品だけ",
    "攻めの素材だけ",
    "クリア速度だけ",
    "倒すための部品だけ"
  ], offset);
}

function disengageResource(article, lane, player, enemy, offset = 0) {
  const playerName = player?.name || "こちら";
  const enemyName = enemy?.name || "相手";
  const generic = [
    `${enemyName}が映った瞬間に交換を切り、${playerName}の体力と逃げ札を残す`,
    `${enemyName}が見えた時点で下がり、次の波に戻れる体力を残す`,
    `${playerName}は追う時間を短くして、フラッシュと体力を次の入りへ残す`,
    `一回止めたら下がり、${playerName}のサモナーを次の接触用に守る`,
    `${enemyName}を倒し切れない追撃より、帰れる位置と体力を優先する`
  ];
  const jungle = [
    `${enemyName}が映った瞬間に体力、スマイト、逃げ札を残す`,
    `取り切りより、${playerName}が次の川へ戻れる体力とスマイトを残す`,
    `${playerName}は追う方向を変え、スマイトとフラッシュを次の中立へ温存する`,
    `${enemyName}が映ったら長追いせず、体力を残して反対側へ逃がす`,
    `キル確認より、${playerName}が次のオブジェクトに触れる状態を守る`
  ];
  return pick(article, lane === "JG" ? jungle : generic, offset);
}

function ultimateDodgePlan(article, lane, player, enemy, enemyKit, offset = 0) {
  const enemyName = enemy?.name || "相手";
  const playerName = player?.name || "こちら";
  const rLabel = spellLabel(enemyKit.r);
  const jungle = [
    `${enemyName}の${rLabel}がある時間は、入口の手前で止まる。取り切りより、${playerName}が次の川へ戻れる体力を残す。`,
    `R絡みの時間は、避けた後の体力差まで見る。味方の寄りがないなら、${playerName}は中立を触り切らず先に引く。`,
    `${rLabel}が残るなら、スマイト勝負へ直行しない。${playerName}は一度広い側へ引いてから入り直す。`,
    `${enemyName}のRを避けても、川の体力差で中立を失うことがある。味方が寄れないなら早めに手放す。`,
    `Rの時間は中立の残り体力より退路を見る。${playerName}が落ちなければ反対側で損を返せる。`
  ];
  const support = [
    `${enemyName}の${rLabel}がある時間は、避けた後の追撃まで見る。${playerName}は最初から届かない位置で味方ADCを守る。`,
    `R絡みの時間は反応で勝とうとしない。${playerName}は味方ADCの退路を先に空ける。`,
    `${rLabel}が見えないなら、${playerName}は川側のブッシュに残らず味方ADCの逃げ先へ戻る。`,
    `${enemyName}のRを避けても、敵ボットの追撃が残る。${playerName}は守る対象から離れない。`,
    `Rの時間は視界を取り切るより、味方ADCがフラッシュを残せる距離を優先する。`
  ];
  const solo = [
    `${enemyName}の${rLabel}がある時間は、避けた後の追撃まで見る。${playerName}は最初から届かない位置で波を取る。`,
    `R絡みの時間は反撃より生存。${playerName}は次の波を受けられる体力を残す。`,
    `${rLabel}が見えていない時は、タワー前でも長居しない。${enemyName}のミアが解けてから押し返す。`,
    `${enemyName}のRを避けても終わりではない。${playerName}はフラッシュか返し札を残して下がる。`,
    `Rの時間は一発避ける自信より、そもそも届かない距離で待つ方が安い。`
  ];
  return pick(article, lane === "JG" ? jungle : lane === "SUP" ? support : solo, offset);
}

function riverNumbersWarning(article, offset = 0) {
  return pick(article, [
    "寄りが遅い側で戦うと、人数差で先に壊れる",
    "近いレーンが動けないなら、スキル精度より人数差が先に出る",
    "押されている側の川は、当てても続かない戦いになりやすい",
    "味方の一歩が遅い時は、命中より撤退判断が高い",
    "レーン主導権がない側で粘ると、入口を塞がれて終わる"
  ], offset);
}

function behindJungleItem(article, offset = 0) {
  return pick(article, [
    "後ろからは中立の取り切りより、入口を見てカウンターガンクを受ける買い物",
    "遅れている時は取り切り性能より、入口を見て帰れる靴と耐久",
    "不利なら中立勝負の火力より、ワードを置いて反対側へ逃がせる買い方",
    "後ろからはスマイト勝負に寄せず、体力と視界で事故を減らす買い物",
    "負けている時は狭い川を受け直すための耐久とコントロールワード"
  ], offset);
}

function jungleInvadeMistake(article, offset = 0) {
  return pick(article, [
    "目先のキャンプより、体力とスマイトを残して受け直す方が高い",
    "一つのキャンプでスマイトと体力を捨てると、次の中立まで失う",
    "深く残るより、体力を守って次の川で受け直す方がまし",
    "取れそうな中立より、帰れる体力とスマイトを残す判断が先",
    "遅れた侵入を続けると、キャンプより大きいテンポを失う"
  ], offset);
}

function enemyLaneText(entry) {
  return (entry.enemyLanes || []).length ? entry.enemyLanes.map(laneLabel).join("・") : "別レーン";
}

function isBotLane(lane) {
  return lane === "ADC" || lane === "SUP";
}

function isDirectMatchup(article, entry) {
  const enemyLanes = entry?.enemyLanes || [];
  if (enemyLanes.includes(article.lane)) return true;
  return isBotLane(article.lane) && enemyLanes.some(isBotLane);
}

function enemyMapCue(article, entry, enemy, offset = 0) {
  return pick(article, [
    `${enemy.name}が${enemyLaneText(entry)}から消えた時間`,
    `${enemyLaneText(entry)}側のミアが遅れた場面`,
    `${enemy.name}の移動先がまだ確定していない時間`,
    `${enemyLaneText(entry)}から川へ寄れるタイミング`
  ], offset);
}

function primaryEnemyLane(entry) {
  return entry.enemyLanes?.[0] || "JG";
}

function roamTiming(article, entry, enemy, enemyKit, offset = 0) {
  const source = primaryEnemyLane(entry);
  const bySource = {
    TOP: [
      `${enemy.name}がトップの大きい波を押し切って川側へ消えた直後`,
      `${enemy.name}がトップでリコールせず姿を隠し、${spellLabel(enemyKit.move)}を残している時間`,
      `トップ側のミアが出た後、${enemy.name}の${spellLabel(enemyKit.cc)}がまだ見えていない場面`
    ],
    JG: [
      `${enemy.name}が2周目のキャンプ後に川へ出られる時間`,
      `ドラゴンやヴォイドグラブ前に${enemy.name}の${spellLabel(enemyKit.move)}が見えていない時間`,
      `${enemy.name}がワードに映らず、${spellLabel(enemyKit.cc)}から先に触れる位置へ入れる場面`
    ],
    MID: [
      `${enemy.name}がミッドの波を押してからサイドへ消えた直後`,
      `${enemy.name}がレベル6前後で${spellLabel(enemyKit.r)}を持ち、川へ寄れる時間`,
      `ミッドのミアが遅れて、${enemy.name}の${spellLabel(enemyKit.cc)}がサイドで使われていない場面`
    ],
    ADC: [
      `${enemy.name}がボットの波を押し切り、サポートと一緒に川へ歩ける時間`,
      `${enemy.name}がリコールせずレーンから消え、${spellLabel(enemyKit.poke)}で先に削れる位置へ寄る場面`,
      `ボット側の押し込み後に${enemy.name}の${spellLabel(enemyKit.move)}が残っている時間`
    ],
    SUP: [
      `${enemy.name}がボットの視界から消えて、先に川へワードを置ける時間`,
      `${enemy.name}がADCを一人にして、${spellLabel(enemyKit.cc)}からロームを始められる場面`,
      `サポートのミアが遅れ、${enemy.name}の${spellLabel(enemyKit.move)}がまだ見えていない時間`
    ]
  };
  return pick(article, bySource[source] || bySource.JG, offset);
}

function roamVision(article, entry, enemy, offset = 0) {
  const source = primaryEnemyLane(entry);
  const bySource = {
    TOP: ["川上側の浅いブッシュ", "ヘラルド側の入口", "自陣寄りの三角導線"],
    JG: ["川の入口", "自陣ジャングルの曲がり角", "次の中立へ向かう通路"],
    MID: ["川中央の浅いワード", "ラプター横の入口", "ミッドからサイドへ出る通路"],
    ADC: ["川下側の入口", "ドラゴン前の入口", "ボットからミッドへ上がる通路"],
    SUP: ["川下側の入口", "ドラゴン前の手前ワード", "敵サポートが最初に触るブッシュ"]
  };
  const spot = pick(article, bySource[source] || bySource.JG, offset);
  return `${spot}を先に確認する`;
}

function roamVisionSpot(article, entry, enemy, offset = 0) {
  return roamVision(article, entry, enemy, offset).replace(/を先に確認する$/, "");
}

function microCue(article, entry, player, enemy, playerKit, enemyKit, offset = 0) {
  const focus = pick(article, [
    roamVisionSpot(article, entry, enemy, offset + 1),
    shortVision(article, offset + 2),
    riskyWard(article, offset + 3),
    adcAnchor(article, offset + 4),
    laneActionNoun(article.lane),
    `${enemyLaneText(entry)}側のミア`,
    "相手の移動線",
    "敵CCの射程",
    "自分の後隙",
    "味方の寄り",
    "次のリコール",
    "川の出口",
    "低い体力"
  ], offset);
  const action = pick(article, [
    "一度だけ確認し",
    "浅く見て",
    "ピンで共有し",
    "触る前に止め",
    "味方側へ戻し",
    "長く追わず",
    "先に数え",
    "帰り道へ残し",
    "一拍待ち",
    "波より優先し",
    "中立前に整え"
  ], offset + 17);
  const result = pick(article, [
    "退路を残す",
    "反撃を受ける",
    "人数差を避ける",
    "次の波へ戻る",
    "中立前に立て直す",
    "味方のフラッシュを残す",
    "リコールを間に合わせる",
    "深追いを消す",
    "視界更新を短くする",
    "体力差を守る",
    "スマイトを温存する"
  ], offset + 31);
  return `${focus}を${action}、${result}`;
}

function playerRoamResponse(article, player, enemy, playerKit, enemyKit, offset = 0) {
  const response = responseSpellFor(article, player, playerKit);
  if (article.lane === "JG") {
    return pick(article, [
      `${player.name}は${spellLabel(response)}を先に撃たず、${enemy.name}の${spellLabel(enemyKit.move)}が見えた後のカウンターガンクに残す`,
      `${player.name}はキャンプを切り上げ、${enemy.name}の${spellLabel(enemyKit.cc)}が届く川の線から一歩外れる`,
      `${player.name}はスマイトや${spellLabel(response)}を中立の取り切りだけに使わず、味方の退路を作る札として残す`
    ], offset);
  }
  if (article.lane === "SUP") {
    return pick(article, [
      `${player.name}は味方ADCへ下がるピンを出し、${spellLabel(response)}を${enemy.name}の最初の入りに合わせる`,
      `${player.name}は${riskyWard(article, offset + 1)}を止め、${enemy.name}の${spellLabel(enemyKit.cc)}が届く線から味方ADCを外す`,
      `${player.name}は${spellLabel(playerKit.protect)}かサモナースペルを味方ADCの退路用に残し、${enemy.name}の最初の入りを受けてから返す`
    ], offset);
  }
  return pick(article, [
    `${player.name}は${spellLabel(response)}を先に撃たず、${enemy.name}の${spellLabel(enemyKit.move)}が見えた後の足止めに残す`,
    `${player.name}は${spellLabel(playerKit.poke)}で波だけ触り、${enemy.name}の${spellLabel(enemyKit.cc)}が届く線から一歩下がる`,
    `${player.name}は${spellLabel(playerKit.protect)}かサモナースペルを味方の退路用に残し、${enemy.name}の最初の入りを受けてから返す`
  ], offset);
}

function spellDescription(spell) {
  return stripHtml(spell?.description || spell?.tooltip || "");
}

function chooseSpell(detail, keywords, fallbackIndex = 0) {
  const spells = (detail?.spells || []).map((spell, index) => ({ ...spell, name: displaySpellName(spell), key: ["Q", "W", "E", "R"][index] || "Q" }));
  return spells.find((spell) => keywords.some((keyword) => spellDescription(spell).includes(keyword))) ||
    spells[fallbackIndex] ||
    spells[0] ||
    { name: "主力スキル", key: "Q" };
}

function chooseSpellPreferred(detail, keywords, preferredIndexes, fallbackIndex = 0) {
  const spells = (detail?.spells || []).map((spell, index) => ({ ...spell, name: displaySpellName(spell), key: ["Q", "W", "E", "R"][index] || "Q" }));
  for (const index of preferredIndexes) {
    const spell = spells[index];
    if (spell && keywords.some((keyword) => spellDescription(spell).includes(keyword))) return spell;
  }
  return chooseSpell(detail, keywords, fallbackIndex);
}

function spellAt(detail, index, fallback) {
  const key = ["Q", "W", "E", "R"][index] || "Q";
  const spell = detail?.spells?.[index];
  return spell ? { ...spell, name: displaySpellName(spell), key } : { name: fallback, key };
}

function displaySpellName(spell) {
  return String(spell?.name || "主力スキル").replace(/^[「｢『"']+|[」｣』"']+$/g, "");
}

function spellLabel(spell) {
  return spell?.key ? `${spell.key}「${displaySpellName(spell)}」` : displaySpellName(spell);
}

function uniqueSpellNames(...spells) {
  return [...new Set(spells.map(displaySpellName).filter(Boolean))];
}

function uniqueSpellLabels(...spells) {
  const seen = new Set();
  const labels = [];
  for (const spell of spells) {
    const name = displaySpellName(spell);
    if (!name || name === "主力スキル" || seen.has(name)) continue;
    seen.add(name);
    labels.push(spellLabel(spell));
  }
  return labels;
}

function spellAlternatives(spells, fallback = "サモナースペル") {
  const labels = uniqueSpellLabels(...spells);
  if (labels.length >= 2) return `${labels[0]}か${labels[1]}`;
  if (labels.length === 1) return fallback && fallback !== labels[0] ? `${labels[0]}か${fallback}` : labels[0];
  return fallback;
}

function spellPair(spells, fallback = "主力スキル") {
  const names = uniqueSpellNames(...spells);
  if (names.length >= 2) return `${names[0]}と${names[1]}`;
  return names[0] || fallback;
}

function alternateSpell(baseSpell, candidates) {
  const baseName = baseSpell?.name;
  return candidates.find((spell) => spell?.name && spell.name !== baseName) || candidates.find(Boolean) || baseSpell;
}

function responseSpell(playerKit) {
  return playerKit.cc || playerKit.protect || playerKit.move || playerKit.poke;
}

function responseSpellFor(article, player, playerKit) {
  const style = article.lane === "SUP" ? supportStyle(player) : "";
  if (style === "エンチャンター") return playerKit.protect || playerKit.cc || playerKit.move || playerKit.poke;
  if (style === "メイジサポート") return playerKit.cc || playerKit.protect || playerKit.poke || playerKit.move;
  if (style === "タンクエンゲージ" || style === "近接エンゲージ") return playerKit.cc || playerKit.move || playerKit.protect || playerKit.poke;
  if (article.lane === "JG") return playerKit.cc || playerKit.move || playerKit.protect || playerKit.poke;
  return responseSpell(playerKit);
}

function laneActionNoun(lane) {
  return lane === "JG" ? "キャンプと中立" : lane === "SUP" ? "味方ADCのCS位置" : "ミニオン波";
}

function playerRoamSetup(article, entry, player, enemy, playerKit, enemyKit, offset = 0) {
  const response = responseSpellFor(article, player, playerKit);
  const responseLabel = spellLabel(response);
  const pokeLabel = spellLabel(playerKit.poke);
  const holdResponse = response?.name === playerKit.poke?.name ? "返し札" : responseLabel;
  if (article.lane === "JG") {
    return pick(article, [
      `${player.name}側は${spellLabel(playerKit.poke)}をキャンプ処理だけで使い切らず、${roamVision(article, entry, enemy, offset + 1)}まで見てから次の中立へ触る`,
      `${player.name}側はキャンプを一つ早く切り上げ、${spellLabel(response)}を${enemy.name}の${spellLabel(enemyKit.move)}後のカウンターガンクに残す`,
      `${player.name}側は${enemy.name}が映るまで深い侵入を止め、${spellLabel(response)}とスマイトを退路側に残す`
    ], offset);
  }
  if (article.lane === "SUP") {
    return pick(article, [
      `${player.name}側は味方ADCへ${warningCall(article, offset)}を先に出し、${responseLabel}を${enemy.name}の最初の入りに残す`,
      `${player.name}側は${riskyWard(article, offset + 1)}を諦め、${roamVision(article, entry, enemy, offset + 1)}だけで止めて味方ADCの退路を守る`,
      `${player.name}側は${pokeLabel}で敵ボットの前歩きを短く止め、${holdResponse}は逃げと反撃に残す`
    ], offset);
  }
  return pick(article, [
    `${player.name}側は${pokeLabel}で波を切り、${holdResponse}を逃げと反撃に残す`,
    `${player.name}側は${laneActionNoun(article.lane)}を自陣寄りで受け、${spellLabel(response)}を${enemy.name}の入りに合わせる`,
    `${player.name}側は押し切る前に${roamVision(article, entry, enemy, offset + 1)}だけ確認し、${spellLabel(response)}を温存する`
  ], offset);
}

function kit(detail) {
  return {
    q: spellAt(detail, 0, "Q"),
    w: spellAt(detail, 1, "W"),
    e: spellAt(detail, 2, "E"),
    r: spellAt(detail, 3, "R"),
    poke: chooseSpell(detail, ["ダメージ", "発射", "範囲", "敵に命中", "通常攻撃", "魔法ダメージ", "物理ダメージ"], 0),
    cc: chooseSpell(detail, ["スタン", "スネア", "ノック", "打ち上げ", "チャーム", "フィアー", "サイレンス", "スロウ", "移動不可", "引き寄せ"], 2),
    move: chooseSpell(detail, ["ダッシュ", "ブリンク", "移動速度", "飛び", "跳躍", "突進"], 2),
    protect: chooseSpellPreferred(detail, ["シールド", "回復", "耐久", "ダメージを軽減", "対象指定不可", "無敵"], [2, 1, 3, 0], 1)
  };
}

function runeTreeByName(runes, name) {
  return runes.find((tree) => tree.name === name) || runes[0];
}

function keystoneIn(tree, preferred) {
  const keystones = tree?.slots?.[0]?.runes || [];
  return preferred.map((name) => keystones.find((rune) => rune.name === name)).find(Boolean) || keystones[0] || { name: "征服者" };
}

function runeChoice(article, entry, player, enemy, playerKit, enemyKit, runes) {
  const playerType = archetype(player);
  const supportKind = article.lane === "SUP" ? supportStyle(player) : "";
  let mainName = "栄華";
  let subName = "不滅";
  let preferred = ["征服者", "プレスアタック", "フリートフットワーク"];

  if (supportKind === "タンクエンゲージ") {
    mainName = "不滅";
    subName = "天啓";
    preferred = ["アフターショック", "ガーディアン", "不死者の握撃"];
  } else if (supportKind === "近接エンゲージ") {
    mainName = "天啓";
    subName = "不滅";
    preferred = ["グレイシャルオーグメント", "解放の魔導書", "ファーストストライク"];
  } else if (supportKind === "エンチャンター") {
    mainName = "魔道";
    subName = "天啓";
    preferred = ["エアリー召喚", "秘儀の彗星", "フェイズラッシュ"];
  } else if (supportKind === "メイジサポート") {
    mainName = "魔道";
    subName = "覇道";
    preferred = ["秘儀の彗星", "エアリー召喚", "フェイズラッシュ"];
  } else if (playerType === "メイジ") {
    mainName = "魔道";
    subName = "天啓";
    preferred = ["秘儀の彗星", "エアリー召喚", "フェイズラッシュ"];
  } else if (playerType === "アサシン") {
    mainName = "覇道";
    subName = "栄華";
    preferred = ["電撃", "魂の収穫", "ヘイルブレード"];
  } else if (playerType === "タンク") {
    mainName = "不滅";
    subName = "天啓";
    preferred = ["アフターショック", "不死者の握撃", "ガーディアン"];
  } else if (article.lane === "SUP") {
    mainName = "天啓";
    subName = "不滅";
    preferred = ["グレイシャルオーグメント", "解放の魔導書", "ファーストストライク"];
  }

  const mainTree = runeTreeByName(runes, mainName);
  const subTree = runeTreeByName(runes, subName);
  const keystone = keystoneIn(mainTree, preferred);
  const enemyDamage = damageProfile(enemy);
  const direct = isDirectMatchup(article, entry);
  const response = responseSpellFor(article, player, playerKit);

  const mainWhy = direct
    ? pick(article, [
      `${player.name}は${laneLabel(article.lane)}で${keystone.name}を軸に、${spellLabel(playerKit.poke)}を当てた後だけ短く踏み込む。${enemy.name}の${spellLabel(enemyKit.cc)}が残る時は、ダメージより先に${spellLabel(response)}で返せる距離を守る。`,
      `${keystone.name}は${player.name}が${spellLabel(playerKit.poke)}から交換を始める時に価値が出る。${enemy.name}の${spellLabel(enemyKit.move)}を見ずに追うと、ルーンより立ち位置の負けが先に出る。`,
      `${enemy.name}の${enemyDamage}を受け続ける対面なので、${player.name}は${keystone.name}で一回の交換を伸ばしすぎない。${spellLabel(playerKit.cc)}が外れた波は下がって、次の仕掛けに回す。`
    ], 71)
    : article.lane === "JG"
      ? pick(article, [
        `${keystone.name}は${player.name}が川で長く殴るためではなく、${spellLabel(playerKit.poke)}を残してカウンターガンクへ入るために使う。${roamTiming(article, entry, enemy, enemyKit, 71)}は先にピンを出す。`,
        `${player.name}は${keystone.name}でクリアと小競り合いを支えつつ、${enemy.name}の${spellLabel(enemyKit.cc)}が見えるまで${spellLabel(response)}を温存する。川の先入りを無理に買わない。`,
        `${enemy.name}が${enemyLaneText(entry)}から寄る試合では、${keystone.name}より先に体力管理が勝ち筋になる。${player.name}は${spellLabel(playerKit.poke)}でキャンプを切り上げ、寄れない川を捨てる。`
      ], 71)
      : article.lane === "SUP"
        ? pick(article, [
          `${player.name}は${keystone.name}を味方ADCの受けに使う。${enemy.name}の${spellLabel(enemyKit.cc)}が見えない時間は、${spellLabel(response)}を前のめりなハラスに使わない。`,
          `${keystone.name}は${player.name}がボットの短い交換を整えるための軸。${roamTiming(article, entry, enemy, enemyKit, 71)}は、${riskyWard(article, 71)}より${adcAnchor(article, 71)}へ戻る。`,
          `${enemy.name}の${enemyDamage}がボットへ届く前提で、${player.name}は${keystone.name}と${spellLabel(playerKit.protect)}を受けに回す。ロームが見えない時ほど先出ししない。`
        ], 71)
        : pick(article, [
          `${player.name}は${keystone.name}でレーンを支えつつ、${enemy.name}の${spellLabel(enemyKit.move)}が見えた後にだけ${spellLabel(response)}を返す。ミア中の交換は短く切る。`,
          `${keystone.name}は${spellLabel(playerKit.poke)}で波を触れる時に安定する。${roamTiming(article, entry, enemy, enemyKit, 71)}なら、${enemy.name}を探さず${shortVision(article, 71)}までで止める。`,
          `${enemy.name}の${spellLabel(enemyKit.cc)}を受ける位置では、${keystone.name}の火力より帰り道が大事。${player.name}は${spellLabel(playerKit.cc)}を逃げにも使える形で残す。`
        ], 71);

  const subWhy = direct
    ? pick(article, [
      `${subTree.name}は${enemy.name}の${spellLabel(enemyKit.poke)}を受けた後の立て直し用。${player.name}が${spellLabel(response)}を残せるなら、負け交換を一回で終わらせやすい。`,
      `${subTree.name}で欲しいのは、${enemy.name}の${spellLabel(enemyKit.cc)}を避けた後にもう一度レーンへ残る余裕。火力だけに寄せると、次の波で前に出られない。`,
      `${enemy.name}の${enemyDamage}が重い時ほど、${subTree.name}で耐久か維持を足す。${player.name}は${spellLabel(playerKit.poke)}を撃つ前に、受けた後の体力を残したい。`
    ], 72)
    : pick(article, [
      `${subTree.name}はロームを受けた後のリコール、視界、耐久を補う枠。${enemy.name}の${spellLabel(enemyKit.move)}が見えない時間に、${player.name}が${microCue(article, entry, player, enemy, playerKit, enemyKit, 72)}。`,
      `${subTree.name}では${player.name}が${roamVision(article, entry, enemy, 72)}まで行って戻れる体力を重視する。${spellLabel(response)}を温存できるなら、寄られても試合が壊れにくい。`,
      `${enemy.name}のミアが出る試合では、${subTree.name}でレーン維持か移動を足す。${player.name}は${spellLabel(playerKit.poke)}で最低限処理し、深い確認へ一人で行かない。`
    ], 72);

  return {
    keystone: keystone.name,
    mainPath: mainTree.name,
    mainWhy,
    subPath: subTree.name,
    subWhy
  };
}

function targetReasons(article) {
  const text = articleBodyText(article);
  const chars = text.length;
  const rewriteDate = argValue("--rewrite-date", "");
  const englishSentence = /\b(is|are|can|will|when|after|before|because|without|through|unless|targeted|spacing|matters|dangerous|comfortably|standing|support|damage|trade|wave|push|level|wins|answer|use|keep)\b/i;
  const obviousEnglish = /[A-Za-z]{3,} [A-Za-z]{2,} [A-Za-z]{2,}/;
  const intoIs = /\binto\b[^。\n]{0,100}\bis\b/i;
  const signatures = [
    "見えている敵はまだまし",
    "名前より目的で買う",
    "画面が灰色になる",
    "次のデス回避",
    "最初の失敗を戻しにくい",
    "入口で待つ方が当たりやすい",
    "何もない正面から撃つ",
    "派手なキルより",
    "直接倒すより",
    "別レーンから",
    "合流する入口",
    "奥の視界へ一人で歩く",
    "奥の視界や敵陣入口へ一人で歩く",
    "トライブッシュと川入口を薄く見る",
    "味方ADCを下げるピン",
    "自分の小さなハラスで全部吐かない",
    "入口で待つと当たりやすい",
    "川で会った時は味方レーンの寄り",
    "相手が寄りたいレーンの逃げ道",
    "味方レーンが先に押せる側だけ",
    "押されているレーンの奥へ入る",
    "次の波まで体力",
    "生きていないとスキルも撃てない",
    "高額完成品に直行しない",
    "回復、シールド、突入、ポーク",
    "一番負け筋",
    "軽いハラス",
    "ローム到着前"
  ];
  const repeatedSkillName = /([ァ-ヶー・＝！!A-Za-z0-9/]{2,30})(?:と|や)\1(?=(?:が|を|に|で|へ|から|、|。))/g;
  const repeatedSkillLabelSentence = text
    .split(/[。\n]/)
    .some((sentence) => {
      const labels = [...sentence.matchAll(/[QWER]「[^」]{1,40}」/g)].map((match) => match[0]);
      return labels.some((label, index) => labels.indexOf(label) !== index);
    });

  const reasons = [];
  if (rewriteDate && article.updatedAt === rewriteDate) reasons.push("rewrite-date");
  if (intoIs.test(text) || (englishSentence.test(text) && obviousEnglish.test(text))) reasons.push("english-mixed");
  if (chars < 1800 || chars > 4000) reasons.push("length-outlier");
  const signatureHits = signatures.filter((signature) => text.includes(signature));
  if (article.updatedAt === DEFAULT_DATE && signatureHits.length >= 2) reasons.push("template-signature");
  if ((article.lane === "SUP" || article.lane === "JG") && (
    text.includes("別レーンから") ||
    text.includes("合流する入口") ||
    text.includes("視界で遅らせる") ||
    text.includes("直接倒すより") ||
    text.includes("入口で待つ") ||
    text.includes("味方ADCを下げるピン") ||
    text.includes("川で会った時は味方レーンの寄り") ||
    text.includes("相手が寄りたいレーンの逃げ道")
  )) {
    reasons.push("sup-jg-template");
  }
  const repeatedSkillHits = [...text.matchAll(repeatedSkillName)].filter((match) => match[1] !== "AA");
  if (repeatedSkillHits.length) reasons.push("repeated-skill-name");
  if (article.updatedAt === DEFAULT_DATE && repeatedSkillLabelSentence) reasons.push("repeated-skill-label-sentence");
  return [...new Set(reasons)];
}

function laneOpener(article, entry, player, enemy, playerKit, enemyKit) {
  const direct = isDirectMatchup(article, entry);
  const playerType = archetype(player);
  const enemyType = archetype(enemy);
  const playerRange = rangeProfile(player);
  const enemyRange = rangeProfile(enemy);
  const style = pick(article, ["距離管理", "先手の交換", "ウェーブ位置", "視界の置き方", "返し札の温存"], 1);
  const response = responseSpellFor(article, player, playerKit);

  if (!direct) {
    return pick(article, [
      `${player.name}${laneLabel(article.lane)}は、${enemyLaneText(entry)}から来る${enemy.name}のロームを読む警戒記事で、${microCue(article, entry, player, enemy, playerKit, enemyKit, 101)}。${roamTiming(article, entry, enemy, enemyKit, 101)}に先に触られると、正面の有利まで消える。`,
      `${player.name}側は正面対面より、${enemy.name}が${enemyLaneText(entry)}から消えた後の最初の10秒を管理し、${microCue(article, entry, player, enemy, playerKit, enemyKit, 102)}。${roamVision(article, entry, enemy, 102)}までで止めて、${spellLabel(response)}を返しに残す。`,
      `${player.name}${laneLabel(article.lane)}では、${enemy.name}本体と殴り合うより到着前の${laneActionNoun(article.lane)}、視界、退路が大事で、${microCue(article, entry, player, enemy, playerKit, enemyKit, 103)}。${roamTiming(article, entry, enemy, enemyKit, 103)}は、欲張って前に残らない。`
    ], 100);
  }

  if (article.lane === "JG") {
    return pick(article, [
      `${player.name}ジャングルは、${enemy.name}の${enemyKit.cc.name}が絡むガンク角を先に潰して、${playerKit.poke.name}をクリアだけで雑に使い切らない試合。${style}を崩すと、相手の${enemyType}らしい入り方に合わせられる。`,
      `${player.name}ジャングルでは、${enemy.name}が先に川へ触る前にレーンの押し引きを見る。${playerKit.cc.name}を残して動くと、${enemyKit.move.name}から始まる小競り合いを止めやすい。`,
      `${player.name}側はフルクリアの速さだけでなく、${enemy.name}が触りたい川とサイドレーンを読んで先に立つ。${playerKit.poke.name}を残したまま入れる時間を作るのが肝。`
    ], 11);
  }
  if (article.lane === "SUP") {
    const laneEnemy = direct ? "ボット2v2の正面" : `${enemyLaneText(entry)}からボット側へ来る圧`;
    return pick(article, [
      `${player.name}サポートは、${laneEnemy}を見ながら味方ADCがCSを取れる距離を作る対面。${spellPair([playerKit.cc, playerKit.protect, playerKit.move])}を先に吐き切ると、${enemy.name}の${enemyKit.cc.name}に合わせる札がなくなる。`,
      `${player.name}側は、${enemy.name}が絡む時間だけ前後の幅を狭くしてボットの被弾を減らす。${playerKit.cc.name}は開始だけでなく、味方ADCの退路を作るためにも残す。`,
      `${player.name}サポートでは、${enemy.name}の位置情報が薄い時ほどレーン中央に寄りすぎない。${playerKit.protect.name}とワードを同時に使う時間を作れると、2v2の崩れ方がかなり減る。`
    ], 13);
  }
  if (playerRange === "レンジ" && enemyRange === "メレー") {
    return `${player.name}${laneLabel(article.lane)}は、${enemy.name}が${enemyKit.move.name}で届く前に${playerKit.poke.name}で削り、追撃距離を残さない対面。射程差は前に立つ権利じゃなくて、相手の入りを一歩遅らせるために使う。`;
  }
  if (playerRange === "メレー" && enemyRange === "レンジ") {
    return `${player.name}${laneLabel(article.lane)}は、${enemy.name}の${enemyKit.poke.name}に削られながら、${enemyKit.cc.name}が落ちた瞬間だけ${playerKit.move.name}で入る対面。体力を先に失うと、勝てる窓もただ眺めるだけになる。`;
  }
  return `${player.name}${laneLabel(article.lane)}対${enemy.name}は、${playerKit.poke.name}と${enemyKit.cc.name}の有無で交換が決まる対面。${playerType}対${enemyType}なので、長く殴るか短く切るかを波ごとに決める。`;
}

function tradeAdvice(article, entry, player, enemy, playerKit, enemyKit) {
  const direct = isDirectMatchup(article, entry);
  const response = responseSpellFor(article, player, playerKit);
  if (!direct) {
    if (article.lane === "JG") {
      return [
        `${roamTiming(article, entry, enemy, enemyKit, 111)}は、侵入を始める合図じゃなく下がる合図。${playerRoamResponse(article, player, enemy, playerKit, enemyKit, 112)}。`,
        pick(article, [
          `${enemy.name}の${spellLabel(enemyKit.cc)}が見えない間、${player.name}は${spellLabel(playerKit.poke)}を最後のキャンプ処理に使い切らない。${roamVision(article, entry, enemy, 113)}で入口を切り、寄れないなら反対側の中立へ逃がす。`,
          `${enemy.name}の位置が消えたら、${player.name}は${spellLabel(playerKit.poke)}をクリア加速ではなく遭遇戦の余白に回す。${roamVision(article, entry, enemy, 114)}までで止め、味方の寄りが薄いなら中立を捨てる。`,
          `${spellLabel(enemyKit.cc)}が未確認なら、${player.name}はキャンプ一つより${spellLabel(playerKit.poke)}の温存を優先する。${enemy.name}が見え直すまで深い入口へ入らない。`
        ], 113),
        pick(article, [
          `${enemy.name}が姿を出してから、${player.name}は${spellAlternatives([response, playerKit.move])}で一度だけ反撃する。${disengageResource(article, "JG", player, enemy, 113)}。`,
          `${enemy.name}が川に映るまでは、${player.name}の${spellLabel(response)}は追撃用ではなく帰り道用。見えた後に短く止めて、スマイトを残したまま離れる。`,
          `${enemy.name}の入りを確認してから、${player.name}は${spellLabel(response)}を合わせ、${microCue(article, entry, player, enemy, playerKit, enemyKit, 114)}。先撃ちせず、味方が寄る方向へ引ける距離で終える。`
        ], 114)
      ];
    }
    if (article.lane === "SUP") {
      return [
        `${roamTiming(article, entry, enemy, enemyKit, 111)}は、前へ仕掛ける合図じゃなく味方ADCを下げる合図。${playerRoamResponse(article, player, enemy, playerKit, enemyKit, 112)}。`,
        `${enemy.name}の${spellLabel(enemyKit.cc)}が見えていない間は、${player.name}の${spellLabel(playerKit.poke)}をブッシュの確認だけで捨てず、${microCue(article, entry, player, enemy, playerKit, enemyKit, 113)}。${roamVision(article, entry, enemy, 113)}までで止め、${riskyWard(article, 113)}は味方の寄りがある時だけ。`,
        pick(article, [
          `${enemy.name}が姿を出してから、${player.name}は${spellAlternatives([response, playerKit.protect])}で味方ADCの退路を作る。${disengageResource(article, "SUP", player, enemy, 113)}。`,
          `${enemy.name}が川から見えるまでは、${player.name}の${spellLabel(response)}を前歩きに使わない。映った瞬間に味方ADC側へ戻すための札として残す。`,
          `${enemy.name}の入りを確認した後で、${player.name}は${spellLabel(response)}を合わせる。味方ADCを追わせず、下がる線を先に作る。`
        ], 114)
      ];
    }
    return [
      `${roamTiming(article, entry, enemy, enemyKit, 111)}は、交換を始める合図じゃなく下がる合図。${playerRoamResponse(article, player, enemy, playerKit, enemyKit, 112)}。`,
      pick(article, [
        `${enemy.name}の${spellLabel(enemyKit.cc)}が見えない間、${player.name}は${spellLabel(playerKit.poke)}を本体狙いではなく波整理に使う。押し切ったら${roamVision(article, entry, enemy, 113)}までで止める。`,
        `${enemy.name}の位置が薄いなら、${player.name}は体力交換より先に波を消す。${spellLabel(playerKit.poke)}を使った後は、視界を一つ確認してすぐ戻る。`,
        `${spellLabel(enemyKit.cc)}が未確認の時間は、${player.name}が敵本体へ歩くほど損をする。波処理だけ済ませて、${enemy.name}が見えるまで距離を置く。`
      ], 113),
      pick(article, [
        `${enemy.name}が姿を出してから、${player.name}は${spellAlternatives([response, playerKit.move])}で一度だけ返す。${disengageResource(article, article.lane, player, enemy, 113)}。`,
        `${enemy.name}が見え直す前の反撃は短くしない。${player.name}は${spellLabel(response)}を逃げにも使える距離で構え、追撃を切る。`,
        `${enemy.name}の入りを確認してから、${player.name}は${spellLabel(response)}を合わせ、${microCue(article, entry, player, enemy, playerKit, enemyKit, 114)}。倒し切る判断より、次の波へ戻れる位置を優先する。`
      ], 114)
    ];
  }

  const styles = {
    TOP: [
      `${enemy.name}の${enemyKit.cc.name}を見てから、${playerKit.poke.name}と通常攻撃で一回だけ返す。長く残るとミニオンと次のスキルで損をする。`,
      `サイドの長いレーンでは、${playerKit.move.name}を攻めに使う前に帰り道を確認する。${enemy.name}の${enemyKit.move.name}が残っている時は深追いしない。`,
      `${enemy.name}がラストヒットで足を止めた瞬間に${playerKit.poke.name}を置く。相手が引いたら追わず、ウェーブ位置を整える。`
    ],
    MID: [
      `${playerKit.poke.name}でミニオンと${enemy.name}を同時に触れる角度だけ狙う。${enemyKit.cc.name}が残る時に本体へ歩くと、ロームどころかリコールもできない。`,
      `中央レーンは短いので、削った後は視界か横移動へ変換する。${enemy.name}を倒し切れないなら、${playerKit.cc.name}を防御用に残す。`,
      `${enemy.name}が${enemyKit.poke.name}をウェーブに使った直後が前に出る時間。外した直後にもう一歩出る癖は、だいたい安いデスになる。`
    ],
    ADC: [
      `ボットでは敵サポートの位置も交換条件。${enemy.name}へ${playerKit.poke.name}を当てても、横のCCが残るなら一発で切る。`,
      `${enemy.name}がCSに集中した瞬間に短く触り、味方サポートが追える距離だけ前に出る。孤立して殴り続けると、2v2の形が壊れる。`,
      `押し切る時は${playerKit.poke.name}をウェーブにも使う。${enemyKit.cc.name}を受ける位置でタワー前に居座らない。`
    ],
    SUP: [
      pick(article, [
        `${playerKit.cc.name}はキル開始だけでなく、${enemy.name}の${enemyKit.move.name}や敵ボットの前歩きを止めるために残す。先に撃つほど味方ADCが怖くなる。`,
        `${playerKit.cc.name}を当てに行く前に、味方ADCが次の通常攻撃を入れられる位置か見る。${enemy.name}の${enemyKit.cc.name}が残るなら、当てても深追いは短く切る。`,
        `${enemy.name}が横から見えた時は、攻めの一手より味方ADCの逃げ道を先に作る。${playerKit.cc.name}を温存したまま下がらせるだけでも交換は勝ち寄りになる。`
      ], 21),
      pick(article, [
        `相手がワードを触る、CSに寄る、味方ADCへ踏み込む瞬間だけ${playerKit.poke.name}を合わせる。空撃ちすると、次の入りを止める圧が消える。`,
        `${enemy.name}が見えていない時は、ブッシュ確認のためだけに${playerKit.poke.name}を捨てない。敵ボットが前へ出た瞬間に合わせる方が、味方の追撃も間に合う。`,
        `ハラスは敵ADCの足が止まる時だけでいい。${playerKit.poke.name}をレーン中央へ雑に置くと、${enemy.name}が寄った時の返しが薄くなる。`
      ], 22),
      pick(article, [
        `${playerKit.protect.name}を自分の小さい被弾に使いすぎない。${enemy.name}が見えた時に味方ADCへ回せるかが、この対面の差になる。`,
        `味方ADCがフラッシュなしなら、${playerKit.protect.name}は先出ししない。${enemy.name}の${enemyKit.cc.name}を受けた直後に使える形を残す。`,
        `体力が少し削れただけで下がりすぎると、ボットの波を失う。${playerKit.protect.name}を残したまま、味方ADCが触れるラインだけ守る。`
      ], 23)
    ],
    JG: [
      pick(article, [
        `キャンプを捨てて${enemy.name}を追うより、${enemyKit.cc.name}が使われるレーンに先回りする。${playerKit.poke.name}は相手が細い通路へ入る瞬間に合わせる。`,
        `${enemy.name}の姿が見えたからといって、すぐ反対側のキャンプを捨てない。味方レーンの体力と押し引きが揃う時だけ、${playerKit.cc.name}で受ける。`,
        `序盤の接触はキル確認よりテンポ差を見る。${enemy.name}が${enemyKit.move.name}を使った後なら、${playerKit.poke.name}で削って中立へ戻る選択も強い。`
      ], 31),
      pick(article, [
        `川でぶつかる前に味方レーナーの最初の一歩を見る。${enemy.name}の${enemyKit.move.name}が残るなら、孤立した1対1を長くしない。`,
        `${enemy.name}と同じ川へ入る時は、先に近いレーンの主導権を確認する。${riverNumbersWarning(article, 32)}。`,
        `スカトルや中立を触る時は、${enemy.name}の${enemyKit.cc.name}を避ける広さを残す。壁際に詰められる形なら、一度キャンプへ戻る。`
      ], 32),
      pick(article, [
        `ガンクは${enemy.name}本人を探すより、相手が寄りたいレーンの退路へ${playerKit.cc.name}を置く。遅らせるだけでも十分仕事になる。`,
        `${enemy.name}が先に動いた時は、同じ場所へ遅れて寄るより反対側の視界とキャンプを取る。無理に追うとテンポだけ失う。`,
        `味方が押しているレーンでは、キルより相手ジャングルの通り道を消す。${playerKit.poke.name}を残して待てると、${enemy.name}の入りを鈍らせられる。`
      ], 33)
    ]
  };
  return styles[article.lane] || styles.MID;
}

function lanePlan(article, entry, player, enemy, playerKit, enemyKit) {
  const direct = isDirectMatchup(article, entry);
  const response = responseSpellFor(article, player, playerKit);
  if (!direct) {
    if (article.lane === "JG") {
      return {
        levels1to3: pick(article, [
          `最初の数分はフルクリアを崩しすぎない。${enemy.name}の最初のロームより、${player.name}が体力を残して${roamVision(article, entry, enemy, 121)}時間を作る。`,
          `序盤は深い侵入より、${enemyLaneText(entry)}側のミアを早く読む。${enemy.name}が見えない時は${spellLabel(response)}を使い切らず、川の出口を残す。`,
          `レベル3まではキャンプ数と体力を優先する。${spellLabel(enemyKit.cc)}が刺さるレーンだけ早めに見ると、遅れたカウンターガンクを減らせる。`
        ], 120),
        preSix: pick(article, [
          `6前は${roamTiming(article, entry, enemy, enemyKit, 131)}を危険時間にする。見えない間は侵入をやめ、${playerRoamResponse(article, player, enemy, playerKit, enemyKit, 132)}。`,
          `${enemyLaneText(entry)}側のミアが遅れたら、キャンプ継続より一度ピンを出す。${player.name}は${spellLabel(playerKit.poke)}を残し、川側へ体を出しすぎない。`,
          `中立前の接触は、近いレーンが先に動ける時だけ受ける。${enemy.name}の${spellLabel(enemyKit.move)}が残るなら、狭い入口で長く戦わない。`
        ], 130),
        postSix: pick(article, [
          `6以降は${enemy.name}の${spellLabel(enemyKit.r)}がロームの起点。Rが見えていない時は、${player.name}の${spellLabel(response)}かフラッシュを守りに使える距離で受ける。`,
          `レベル6後は${enemy.name}が画面外から川へ来る前提でルートを組む。${spellLabel(enemyKit.r)}が落ちた直後だけ、${player.name}は強く視界を戻す。`,
          `${enemy.name}のRが絡む時間は、${player.name}が中立を取り切るより生存を優先する。${spellLabel(enemyKit.cc)}を避けたら、追うより味方と同じ方向へ下がって次の中立を待つ。`
        ], 140),
        wave: pick(article, [
          `サイドの波が動く時は、寄れる味方を基準にルートを変える。${enemy.name}本体だけ追うと、次のオブジェクト準備が遅れる。`,
          `味方が押している時だけ深い視界を取りに行く。押されているなら、${enemy.name}を探すよりタワー下の受けを助ける。`,
          `中立を触る前に、近いレーンの主導権を見る。${riverNumbersWarning(article, 150)}。`
        ], 150),
        recall: pick(article, [
          `リコールは${enemy.name}が${enemyLaneText(entry)}に映った後か、次の中立が出る前に合わせる。低体力で残ると${spellLabel(enemyKit.move)}から拾われる。`,
          `${enemy.name}のミア中にキャンプを欲張るより、半テンポ早く帰ってワードを買い直す。次のロームで${spellLabel(response)}を残せる状態の方が価値が高い。`,
          `買い物前に無理にもう一キャンプ触らない。${roamTiming(article, entry, enemy, enemyKit, 161)}なら、CS数よりリコール完了と次の視界が勝ち筋になる。`
        ], 160)
      };
    }
    if (article.lane === "SUP") {
      return {
        levels1to3: pick(article, [
          `レベル1から3は、${enemy.name}の最初のロームより味方ADCの足元を崩さない。${spellLabel(playerKit.poke)}で敵ボットの前歩きを止め、${roamVisionSpot(article, entry, enemy, 121)}だけ確認する。`,
          `序盤は深い視界を取りに行くより、${enemyLaneText(entry)}側のミアを早く読む。${enemy.name}が見えない時は${spellLabel(response)}を使い切らず、味方ADCの退路を残す。`,
          `最初の数分は合流が遅い代わりに情報が薄い。${player.name}はブッシュ主導権を少し捨てても、${spellLabel(enemyKit.cc)}の射程へ味方ADCを入れない。`
        ], 120),
        preSix: pick(article, [
          `6前は${roamTiming(article, entry, enemy, enemyKit, 131)}を危険時間にする。見えない間は前のめりな交換をやめ、${playerRoamResponse(article, player, enemy, playerKit, enemyKit, 132)}。`,
          `6前の返しは、${enemy.name}の${spellLabel(enemyKit.move)}が見えた後でいい。先に${spellLabel(response)}を撃つと、寄られた時に味方ADCを逃がす札がなくなる。`,
          `${enemyLaneText(entry)}側のミアが遅れたら、ウェーブを押すより一度ピンを出す。${player.name}は${adcAnchor(article, 130)}へ戻り、川側へ体を出しすぎない。`
        ], 130),
        postSix: pick(article, [
          `6以降は${enemy.name}の${spellLabel(enemyKit.r)}がロームの起点。Rが見えていない時は、${player.name}の${spellLabel(playerKit.protect)}かフラッシュを味方ADC用に残す。`,
          `レベル6後は${enemy.name}が画面外から来る前提で立つ。${spellLabel(enemyKit.r)}が落ちた直後だけ、${player.name}は深めの視界を戻す。`,
          `${enemy.name}のRが絡む時間は、${player.name}がキル確認より味方ADCの生存を優先する。${spellLabel(enemyKit.cc)}を避けたら、追うより同じ方向へ下がって次の波を取る。`
        ], 140),
        wave: pick(article, [
          `ボットの波は味方ADCが触れる位置で保つ。押し切る時も${roamVision(article, entry, enemy, 151)}までで止め、${enemy.name}のミアが解けるまで暗い川に残らない。`,
          `大きい波を押すなら、先に${enemyLaneText(entry)}側の位置情報を取る。${enemy.name}が消えている時の${riskyWard(article, 150)}は、${spellLabel(enemyKit.cc)}一発で台無しになる。`,
          `引く波では${adcAnchor(article, 151)}、押す波では${shortVision(article, 151)}だけ置く。${player.name}はワードを理由に川へ入りすぎず、${spellLabel(response)}を帰り道に残す。`
        ], 150),
        recall: pick(article, [
          `リコールは${enemy.name}が${enemyLaneText(entry)}に映った後か、味方ADCと一緒に合わせる。低体力で片方だけ残ると${spellLabel(enemyKit.move)}から拾われる。`,
          `${enemy.name}のミア中に居座るより、半テンポ早く帰ってワードを買い直す。次のロームで${spellLabel(playerKit.protect)}を残せる状態の方が価値が高い。`,
          `買い物前に無理にもう一波付き合わない。${roamTiming(article, entry, enemy, enemyKit, 161)}なら、CS数よりリコール完了と次の視界が勝ち筋になる。`
        ], 160)
      };
    }
    return {
      levels1to3: pick(article, [
        `レベル1から3は、${enemy.name}の最初のロームより自分の波を崩さない。${spellLabel(playerKit.poke)}で押し返せる形を作り、${roamVisionSpot(article, entry, enemy, 121)}だけ確認する。`,
        `序盤は深い視界を取りに行くより、${enemyLaneText(entry)}側のミアを早く読む。${enemy.name}が見えない時は${spellLabel(playerKit.cc)}を使い切らず、退路を残す。`,
        `最初の数分は合流が遅い代わりに情報が薄い。${player.name}はラストヒットを少し捨てても、${spellLabel(enemyKit.cc)}の射程へ先に入らない。`
      ], 120),
      preSix: pick(article, [
        `6前は${roamTiming(article, entry, enemy, enemyKit, 131)}を危険時間にする。見えない間は前のめりな交換をやめ、${playerRoamResponse(article, player, enemy, playerKit, enemyKit, 132)}。`,
        `6前の返しは、${enemy.name}の${spellLabel(enemyKit.move)}が見えた後でいい。先に${spellLabel(playerKit.cc)}を撃つと、寄られた時に味方を逃がす札がなくなる。`,
        `${enemyLaneText(entry)}側のミアが遅れたら、ウェーブを押すより一度ピンを出す。${player.name}は${spellLabel(playerKit.poke)}で最低限処理して、川側へ体を出しすぎない。`
      ], 130),
      postSix: pick(article, [
        `6以降は${enemy.name}の${spellLabel(enemyKit.r)}がロームの起点。Rが見えていない時は、${player.name}の${spellLabel(playerKit.protect)}かフラッシュを守りに使える距離で受ける。`,
        `レベル6後は${enemy.name}が画面外から来る前提で立つ。${spellLabel(enemyKit.r)}が落ちた直後だけ、${player.name}の${spellLabel(playerKit.poke)}で強く波を押して視界を戻す。`,
        `${enemy.name}のRが絡む時間は、${player.name}がキル確認より生存を優先する。${spellLabel(enemyKit.cc)}を避けたら、追うより味方と同じ方向へ下がって次の波を取る。`
      ], 140),
      wave: pick(article, [
        `波は自陣寄りで受けられる形が安全。押し切る時も${roamVision(article, entry, enemy, 151)}までで止め、${enemy.name}のミアが解けるまでタワー前に長居しない。`,
        `大きい波を押すなら、先に${enemyLaneText(entry)}側の位置情報を取る。${enemy.name}が消えている時のタワープレート欲張りは、${spellLabel(enemyKit.cc)}一発で台無しになる。`,
        `引く波ではCSを守り、押す波では${shortVision(article, 151)}だけ置く。${player.name}は波を理由に川へ入りすぎず、${spellLabel(playerKit.move)}を帰り道に残す。`
      ], 150),
      recall: pick(article, [
        `リコールは${enemy.name}が${enemyLaneText(entry)}に映った後か、味方が先に視界を取った後に合わせる。低体力で残ると${spellLabel(enemyKit.move)}から拾われる。`,
        `${enemy.name}のミア中に居座るより、半テンポ早く帰ってワードを買い直す。次のロームで${spellLabel(playerKit.protect)}を残せる状態の方が価値が高い。`,
        `買い物前に無理にもう一波触らない。${roamTiming(article, entry, enemy, enemyKit, 161)}なら、CS数よりリコール完了と次の視界が勝ち筋になる。`
      ], 160)
    };
  }

  if (article.lane === "JG") {
    return {
      levels1to3: pick(article, [
        `最初の3レベルはクリアを崩さず、${spellPair([playerKit.poke, playerKit.cc, playerKit.move])}が使えるタイミングで川を見る。${enemy.name}の${enemyKit.move.name}が早いなら、押されるレーン側に寄れるルートを選ぶ。`,
        `1周目は強引な侵入より、${playerKit.poke.name}を残してスカトル前の体力を保つ。${enemy.name}が早く顔を出すなら、近いレーンへ寄れるキャンプ順にする。`,
        `レベル3まではキャンプ数と体力を優先する。${enemy.name}の${enemyKit.cc.name}が刺さるレーンだけ早めに見ると、無駄な追跡を減らせる。`
      ], 41),
      preSix: pick(article, [
        `6前は${enemy.name}の位置が見えない時間を短くする。押し込まれている川へ深く入るより、浅いワードとピンで${enemyKit.cc.name}の角度を消す。`,
        `6前の小競り合いは、近いレーンが先に動ける時だけ受ける。${enemy.name}の${enemyKit.move.name}が残るなら、広い場所で当たり直す。`,
        `${enemy.name}が消えた時は、キャンプを一つ諦める前に味方へ${warningCall(article, 42)}を出す。先に情報を渡せれば、カウンターガンクの形も作れる。`
      ], 42),
      postSix: pick(article, [
        `6以降は互いのRの先出し価値を見る。${enemy.name}が先に動いたら、逆側の中立、カウンターガンク、視界取りへ切り替える。`,
        `6以降は${enemy.name}のRが残る時間を正面から受けない。味方のCCが見えてから${playerKit.cc.name}を重ねる方が、無理な先入りより安定する。`,
        `ドラゴン前はRの有無をピンで揃える。${enemy.name}が先に川を取ったら、裏から挟むか反対側の中立へ変えて損を小さくする。`
      ], 43),
      wave: pick(article, [
        `レーンの主導権がある側で長く戦う。押されている味方の奥まで踏み込むと、${enemy.name}より先に相手レーナーのCCで捕まる。`,
        `味方が押している時だけ深い視界を取りに行く。波が自陣へ来ているなら、${enemy.name}を探すよりタワー下の受けを助ける。`,
        `サイドの波が大きく動く時は、先に寄れる味方を基準にルートを変える。${enemy.name}本体だけ追うと、次のオブジェクト準備が遅れる。`
      ], 44),
      recall: pick(article, [
        `リコールはドラゴン、ヘラルド、ヴォイドグラブ前に合わせる。低体力で川へ戻ると、視界を置く前に${enemy.name}の仕掛けを受ける。`,
        `買い物は次の中立が出る40秒前までに済ませる。${enemy.name}より遅れて戻ると、最初のワード位置から負ける。`,
        `体力が半分を切ったら、キャンプ一つより帰還を優先する。${enemy.name}に川の先入りを許しても、買い直してからなら取り返しやすい。`
      ], 45)
    };
  }
  if (article.lane === "SUP") {
    return {
      levels1to3: pick(article, [
        `レベル1から3は${adcAnchor(article, 51)}に立ち、${playerKit.poke.name}で敵ボットの前歩きを止める。${enemy.name}へ触る時も、味方ADCが次のCSを取れる距離から外れない。`,
        `序盤はブッシュの主導権より、味方ADCが最初の3ウェーブを落とさない距離を優先する。${playerKit.cc.name}を使うなら、${enemy.name}と敵サポートの反撃距離まで計算する。`,
        `レベル2先行を狙う時は、${playerKit.poke.name}をミニオンにも使ってテンポを取る。${enemy.name}の${enemyKit.move.name}が残るなら、前のブッシュ保持より退路を残す。`
      ], 51),
      preSix: pick(article, [
        `6前は${shortVision(article, 52)}だけで足りる場面を選ぶ。${enemy.name}の${enemyKit.cc.name}が残る時は、味方ADCが下がれる線を先に作る。`,
        `6前のワード更新は、味方ADCが安全にCSを取れる波で行う。${enemy.name}がレーン中央から消えた直後に一人で歩くと、戻る時間が足りない。`,
        `${enemy.name}がブッシュ側へ寄る時間は、レーン中央より後ろから受ける。深い確認へ行くなら、味方ジャングルかADCの寄りを待つ。`
      ], 52),
      postSix: pick(article, [
        `6以降は${enemy.name}のRや${enemyKit.cc.name}がボットで届く前提で、${spellLabel(response)}を味方ADCの受けに残す。${smallPressure(article, 53)}より受けの一手を優先する。`,
        `${enemy.name}のRが絡む時間は、${player.name}が先に当てるより外させた後の返しを見る。${playerKit.cc.name}を残していれば、入りを一度止められる。`,
        `ドラゴン前は味方ADCを置き去りにして視界を取りに行かない。${enemy.name}の${enemyKit.move.name}が見えた後で、${spellLabel(response)}を合わせる。`
      ], 53),
      wave: pick(article, [
        `ボットの波は味方ADCが触れる位置を保つ。押し切る時は敵ジャングルと${enemy.name}の位置が見えてからで、暗い川へ単独で長く残らない。`,
        `押し込む波では先にワード、引く波では${adcAnchor(article, 54)}を優先する。${enemy.name}が寄れる時にサポートだけ前へ出ると、2v2の形が崩れる。`,
        `タワー前で受ける時は、${playerKit.cc.name}を敵サポートではなく敵ADCの踏み込みに合わせる。波を守れれば、次のリコールで視界を戻せる。`
      ], 54),
      recall: pick(article, [
        `帰る時はワード補充とドラゴン前の時間を合わせる。低体力で居座ると、${enemy.name}本体より先にボット2v2のCCで捕まる。`,
        `リコールは味方ADCとずらしすぎない。${enemy.name}が消えている時に片方だけ残ると、視界差より人数差で崩れる。`,
        `補充ワードを買った後は、最初に深さではなく置ける安全距離を見る。${enemy.name}の${enemyKit.cc.name}を受ける位置なら、浅くても十分。`
      ], 55)
    };
  }
  return {
    levels1to3: `レベル1から3は${playerKit.poke.name}をラストヒットと牽制に使い、${enemy.name}の${enemyKit.cc.name}が届く距離を覚える。ミニオンが多い時は勝てる交換でも一段浅くする。`,
    preSix: `6前は${enemyKit.poke.name}を避けた直後だけ前に出る。${playerKit.cc.name}を外したら、次の波まで無理に体力を取り返そうとしない。`,
    postSix: `6以降は互いのRの有無で立ち位置を変える。${enemy.name}のRが残る時は浅く、落ちた後だけ${spellPair([playerKit.move, playerKit.cc, playerKit.poke])}で強く触る。`,
    wave: `${laneRole(article.lane)}では自陣寄りから押し返せる波が一番扱いやすい。有利な時だけ押し付けて、ワード、リコール、横移動に変える。`,
    recall: `体力が半分以下、フラッシュなし、${enemy.name}の${enemyKit.cc.name}が残っている時は欲張らない。少しのCSより次のデス回避の方が高い。`
  };
}

function nonDirectItemFirstBuy(article, entry, player, enemy, enemyKit) {
  if (article.lane === "JG") {
    return pick(article, [
      `${player.name}ジャングルの最初の買い物は、${enemy.name}のロームに合わせて川へ入り直せることを基準にする。靴、体力、コントロールワード、クリア速度のどれかを足して、${spellLabel(enemyKit.cc)}を受ける前にルートを変えられる状態を作る。`,
      `${enemy.name}が${enemyLaneText(entry)}から消える試合では、${damageOnlyBuy(article, 201)}に寄せない。最初の帰還で移動速度かコントロールワードを足し、${roamVision(article, entry, enemy, 201)}余裕を買う。`,
      `序盤の買い物は次の中立へ先に入るための準備。${enemy.name}の${spellLabel(enemyKit.move)}が見えない時間でも、体力を残して川を横切れる素材を優先する。`
    ], 200);
  }
  if (article.lane === "SUP") {
    return pick(article, [
      `${player.name}サポートの最初の買い物は、味方ADCを下げながら視界を戻せることを基準にする。体力、マナ回復、ワード、移動速度を足して、${enemy.name}の${spellLabel(enemyKit.cc)}を深い位置で受けない。`,
      `${enemy.name}のロームが怖い時は、火力より補充ワードと耐久を先に見る。${roamVision(article, entry, enemy, 201)}だけで止められる買い物なら十分。`,
      `買い物で欲しいのは一人で奥へ入る強さじゃない。${enemy.name}が消えた時に${adcAnchor(article, 200)}へ戻れる体力とワードを買う。`
    ], 200);
  }
  return pick(article, [
    `${player.name}側の最初の買い物は、${enemy.name}のロームを一度受けても崩れないことを基準にする。靴、体力、視界、ウェーブ処理のどれかを足して、${spellLabel(enemyKit.cc)}を受ける前に下がれる状態を作る。`,
    `${enemy.name}が${enemyLaneText(entry)}から消える試合では、${expensiveDamageBuy(article, 200)}へ急ぎすぎない。押し返す素材か靴を挟み、${roamVision(article, entry, enemy, 201)}時間を作る。`,
    `最初の帰還では、次のロームを受ける体力と波処理を買う。${enemy.name}の${spellLabel(enemyKit.move)}が残るなら、少しの火力より下がれる足の方が価値がある。`
  ], 200);
}

function nonDirectItemCoreReason(article, entry, player, enemy, playerKit, statText) {
  if (article.lane === "JG") {
    return pick(article, [
      `${player.name}は${statText}が欲しいが、この組み合わせでは先に${enemy.name}のロームへ遅れないことが大事。クリアを保ちながら、${shortVision(article, 210)}と川への入り直しを買う。`,
      `${player.name}の買い物はキャンプ速度だけでなく、${enemy.name}が消えた時に川へ戻れる体力とワードを足す。`,
      `${enemy.name}が先に動く試合では、${player.name}はクリア速度、靴、コントロールワードのどれかを補って次の川へ遅れない。`,
      `${player.name}は${statText}を伸ばしたいが、ここでは入口確認へ戻れる足と体力も買う。${enemy.name}のミア中に長く川へ残らない。`,
      `${enemy.name}が動く時間を受けるため、${player.name}はキャンプ処理を保ちながら視界を置き直せる素材を優先する。`
    ], 210);
  }
  if (article.lane === "SUP") {
    return `${player.name}は${statText}が欲しいが、この組み合わせではADCから離れて深く歩かない形を優先する。${supportItemStats(article, 211)}を買って、${enemy.name}が消えた時の退路を残す。`;
  }
  return `${player.name}は${statText}が欲しいが、この組み合わせでは先に${enemy.name}のロームを受ける時間を減らす。${spellLabel(playerKit.poke)}で波を処理できる素材と、${shortVision(article, 210)}を置く余裕を優先する。`;
}

function defensiveItemReason(article, entry, player, enemy, playerKit, enemyKit, enemyDamage, direct) {
  const response = responseSpellFor(article, player, playerKit);
  const enemyFallback = spellLabel(enemyKit.cc || enemyKit.move || enemyKit.r || enemyKit.q);
  const enemyBurst = spellAlternatives([enemyKit.poke, enemyKit.r], enemyFallback);
  if (!direct && article.lane === "JG") {
    return pick(article, [
      `${enemy.name}の${spellLabel(enemyKit.cc)}から川で捕まるなら、${enemyDamage === "魔法寄り" ? "魔法防御と体力" : enemyDamage === "物理寄り" ? "物理防御と体力" : "体力と両耐性"}を少し挟む。${player.name}が${spellLabel(response)}を返す前に落ちる買い方はしない。`,
      `次の中立で${enemy.name}の${spellLabel(enemyKit.move)}を受けそうなら、火力素材より靴と耐久を優先する。${player.name}はスマイトを押す前に生きて川から出る必要がある。`,
      `${roamTiming(article, entry, enemy, enemyKit, 231)}に寄られる試合では、${player.name}の買い物は一回耐える形でいい。${spellLabel(playerKit.poke)}を撃てる体力が残れば反対側へ逃がせる。`
    ], 231);
  }
  if (!direct && article.lane === "SUP") {
    return pick(article, [
      `${enemy.name}の${spellLabel(enemyKit.cc)}がボットへ届く試合では、${player.name}は体力と移動速度を先に見る。${spellLabel(response)}を使う前に落ちるなら視界も守れない。`,
      `味方ADCを守るなら、${enemy.name}の${spellLabel(enemyKit.move)}後に一歩戻れる耐久がいる。${player.name}は火力素材よりワード補充と生存を優先する。`,
      `${roamTiming(article, entry, enemy, enemyKit, 231)}が続くなら、${player.name}は小さい被弾で帰らされない買い物にする。${spellLabel(playerKit.protect)}を味方ADCへ残せる体力が基準。`
    ], 231);
  }
  if (!direct) {
    return pick(article, [
      `${enemy.name}の${spellLabel(enemyKit.cc)}をロームで受けるなら、${player.name}は${enemyDamage === "魔法寄り" ? "魔法防御" : enemyDamage === "物理寄り" ? "物理防御" : "体力"}を少し足す。${spellLabel(response)}を使う時間を買うための防御。`,
      `${roamTiming(article, entry, enemy, enemyKit, 231)}に体力が低いなら、${expensiveDamageBuy(article, 231)}より靴と耐久を挟む。${player.name}は${spellLabel(playerKit.poke)}で波を処理して下がれるだけで十分。`,
      `${enemy.name}の${spellLabel(enemyKit.move)}が見えない時間は、耐久不足がそのままデスになる。${player.name}は${shortVision(article, 231)}へ行く前に、一回受ける買い物を済ませる。`
    ], 231);
  }
  return pick(article, [
    `${enemy.name}の${enemyBurst}で先に削られるなら、${enemyDamage === "魔法寄り" ? "魔法防御と体力" : enemyDamage === "物理寄り" ? "物理防御と体力" : "体力と両耐性"}を挟む。${player.name}が${spellLabel(response)}を返せる体力が最低ライン。`,
    `${enemy.name}の${spellLabel(enemyKit.cc)}を一度受けても下がれるように、靴か耐久の小物を早めに見る。${player.name}は火力完成より、次の交換で立っていることを優先する。`,
    `負けている時は${enemy.name}の${enemyDamage}に合わせて防御を混ぜる。${player.name}の${spellLabel(playerKit.poke)}が強くても、先に落ちるなら交換にならない。`
  ], 231);
}

function situationalItemReason(article, entry, player, enemy, playerKit, enemyKit, direct) {
  const response = responseSpellFor(article, player, playerKit);
  const responseLabel = response?.name === playerKit.poke?.name ? "返し札" : spellLabel(response);
  if (!direct && article.lane === "JG") {
    return pick(article, [
      `${enemy.name}の${spellLabel(enemyKit.move)}で川に先入りされるなら、靴、コントロールワード、耐久を優先する。${player.name}は${spellLabel(response)}をカウンターガンクへ残せる買い物に寄せる。`,
      `${roamVision(article, entry, enemy, 241)}役が足りないなら、火力素材より視界を買う。${enemy.name}の${spellLabel(enemyKit.cc)}を見てから中立に触れるだけで事故は減る。`,
      `味方が寄れない試合では、${player.name}は強引な1対1用の買い物をしない。${enemy.name}の${spellLabel(enemyKit.r)}がある時間を避ける移動速度と視界を足す。`
    ], 241);
  }
  if (!direct && article.lane === "SUP") {
    return pick(article, [
      `${enemy.name}の${spellLabel(enemyKit.cc)}がボットへ向くなら、${player.name}は補充ワード、靴、耐久を先に見る。${spellLabel(response)}を味方ADCの退路へ残すための買い物。`,
      `${roamVision(article, entry, enemy, 241)}だけで止める試合では、深い視界用の欲張りより帰れる足を買う。${enemy.name}の${spellLabel(enemyKit.move)}が見えない間は前に残らない。`,
      `敵の回復やシールド対策は、${enemy.name}の${spellLabel(enemyKit.r)}で集団戦が伸びる時だけ急ぐ。まず${player.name}が${adcAnchor(article, 241)}へ戻れるワードと耐久を整える。`
    ], 241);
  }
  if (!direct) {
    return pick(article, [
      `${enemy.name}が${enemyLaneText(entry)}から消える試合では、${player.name}は靴、視界、波処理を優先する。${spellLabel(playerKit.poke)}で押して、${responseLabel}を逃げに残せる形がいい。`,
      `${roamTiming(article, entry, enemy, enemyKit, 241)}が怖いなら、対策品は火力より生存寄り。${enemy.name}の${spellLabel(enemyKit.cc)}を見てから下がれる買い物を選ぶ。`,
      `${enemy.name}のロームが続くなら、${player.name}は回復阻害や対シールドより先に${shortVision(article, 241)}を維持する。${spellLabel(enemyKit.move)}を見た後に帰れる足があるかを見る。`
    ], 241);
  }
  return pick(article, [
    `${enemy.name}の${spellLabel(enemyKit.cc)}が交換の起点なら、靴や耐久を早めに見る。${player.name}は${spellLabel(playerKit.poke)}を当てた後、${responseLabel}で帰れる形を買う。`,
    `${enemy.name}の回復、シールド、突入のうち、実際に試合を動かしている要素へ合わせる。${spellLabel(enemyKit.r)}が強い時間は、火力より耐える小物が先。`,
    `${player.name}が${spellLabel(playerKit.cc)}を当てても倒し切れないなら、次の交換用に移動速度、耐久、対回復を選ぶ。${enemy.name}の${spellLabel(enemyKit.move)}が戻る前に退ける買い物がいい。`
  ], 241);
}

function behindItemReason(article, entry, player, enemy, playerKit, enemyKit, direct) {
  const response = responseSpellFor(article, player, playerKit);
  if (!direct && article.lane === "JG") {
    return pick(article, [
      `負けている時は、${player.name}が次の川で${spellLabel(response)}を一回返せる体力を買う。キャンプ速度だけを追うより、${enemy.name}の${spellLabel(enemyKit.cc)}を受けた後に逃げられる方が高い。`,
      `${enemy.name}が先に川へ入る試合では、${player.name}は靴、耐久、コントロールワードで損を小さくする。${spellLabel(playerKit.poke)}を撃ってから反対側へ逃がす形を作る。`,
      `${behindJungleItem(article, 251)}。${enemy.name}の${spellLabel(enemyKit.move)}が見えない時に長く川へ残らない。`
    ], 251);
  }
  if (!direct && article.lane === "SUP") {
    return pick(article, [
      `負けている時は、${player.name}が${adcAnchor(article, 251)}で${spellLabel(response)}を一回返せる耐久を買う。${enemy.name}の${spellLabel(enemyKit.cc)}を受ける深さまで一人で行かない。`,
      `${enemy.name}のロームで崩れているなら、買うのは奥へ進む強さではなく、${shortVision(article, 251)}を見て${adcAnchor(article, 252)}へ戻る足。${spellLabel(playerKit.protect)}を退路に残す。`,
      `後ろからの${player.name}はキル用の火力より、ワード補充、靴、体力で帰る位置を守る。${enemy.name}の${spellLabel(enemyKit.move)}が見えたら、前ではなく横に戻る。`
    ], 251);
  }
  if (!direct) {
    return pick(article, [
      `負けている時は、${player.name}が${spellLabel(playerKit.poke)}で波を触って下がれる買い物を優先する。${enemy.name}の${spellLabel(enemyKit.cc)}を受ける距離で視界を欲張らない。`,
      `${roamTiming(article, entry, enemy, enemyKit, 251)}が続くなら、${expensiveDamageBuy(article, 251)}より靴、体力、${shortVision(article, 252)}を先に見る。${spellLabel(response)}を残して戻れるだけでレーンは残る。`,
      `後ろからは${enemy.name}を倒すより、ローム一回を空振りさせる買い物。${player.name}は${roamVision(article, entry, enemy, 251)}だけ置き、次の波へ戻る。`
    ], 251);
  }
  return pick(article, [
    `負けている時は、${player.name}が${spellLabel(response)}を押す前に落ちない買い物へ寄せる。${enemy.name}の${spellLabel(enemyKit.cc)}を受けた後に一歩下がれるかが基準。`,
    `${enemy.name}の${spellLabel(enemyKit.r)}で先に倒されるなら、${expensiveDamageBuy(article, 251)}より靴と耐久を挟む。${player.name}は${spellLabel(playerKit.poke)}を安全に撃てる距離を買う。`,
    `後ろからは長い追撃を捨てる。${player.name}が${spellLabel(playerKit.cc)}を一回当てて帰れる買い物なら、次の交換まで試合を残せる。`
  ], 251);
}

function itemPlan(article, entry, player, enemy, playerKit, enemyKit) {
  const type = article.lane === "SUP" ? "サポート" : archetype(player);
  const supportKind = article.lane === "SUP" ? supportStyle(player) : "";
  const enemyDamage = damageProfile(enemy);
  const direct = isDirectMatchup(article, entry);
  const statText = {
    マークスマン: "攻撃力、攻撃速度、クリティカル、ライフスティール",
    メイジ: "魔力、マナ、スキルヘイスト、魔法防御貫通",
    アサシン: "バースト火力、貫通、スキルヘイスト、移動速度",
    タンク: "体力、物理防御、魔法防御、行動妨害耐性",
    サポート: "ワード補充、スキルヘイスト、体力、回復やシールド強化",
    ファイター: "攻撃力、体力、スキルヘイスト、相手に合わせた防御",
    汎用: "火力、体力、防御、スキルヘイスト"
  }[type] || "火力、体力、防御、スキルヘイスト";
  const supportStatText = ({
    エンチャンター: "ワード補充、スキルヘイスト、マナ回復、回復やシールド強化",
    メイジサポート: "ワード補充、スキルヘイスト、魔力、マナ回復",
    タンクエンゲージ: "視界、体力、スキルヘイスト、行動妨害耐性",
    近接エンゲージ: "視界、体力、スキルヘイスト、移動速度",
    ユーティリティ: "ワード補充、スキルヘイスト、体力、味方を守るための余裕"
  })[supportKind];
  const itemStats = article.lane === "SUP" ? supportStatText || statText : statText;

  const firstBuy = !direct
    ? nonDirectItemFirstBuy(article, entry, player, enemy, enemyKit)
    : article.lane === "SUP"
    ? `${player.name}サポートは視界、体力、マナ回復を優先する。${enemy.name}の圧が見える前にワードを置ける状態を作り、単独で深い場所へ入らない。`
    : article.lane === "JG"
      ? `${player.name}ジャングルはクリア速度と体力維持を優先する。最初の帰還では${playerKit.poke.name}の回転に関わる素材を買い、無理な1対1用の高額品へ急がない。`
    : `最初の買い物は${itemStats}を軽く伸ばす素材から。${enemy.name}の${enemyDamage}がきついなら、${expensiveDamageBuy(article, 1)}より先に靴や耐久の小物を挟む。`;
  const defensive = defensiveItemReason(article, entry, player, enemy, playerKit, enemyKit, enemyDamage, direct);
  const situational = situationalItemReason(article, entry, player, enemy, playerKit, enemyKit, direct);
  const whenBehind = behindItemReason(article, entry, player, enemy, playerKit, enemyKit, direct);

  return {
    firstBuy,
    coreReason: direct
      ? pick(article, [
        `${player.name}は${type}なので、${playerKit.poke.name}を当てた後にもう一度動ける${itemStats}を中心にする。${enemy.name}相手では、一回殴って終わる火力より次の交換まで残れる買い物が大事。`,
        `${player.name}の買い物は${itemStats}を軸にする。${enemy.name}へ触った後に下がれない装備より、二度目の仕掛けへ体力を残せる形がいい。`,
        `${enemy.name}相手は最初の一撃だけ伸ばしても続かない。${player.name}は${itemStats}を足して、${spellLabel(playerKit.poke)}後の立て直しまで買う。`
      ], 260)
      : nonDirectItemCoreReason(article, entry, player, enemy, playerKit, itemStats),
    defensive,
    situational,
    whenBehind
  };
}

function roamThreatModel(article, entry, player, enemy, playerKit, enemyKit) {
  const response = responseSpellFor(article, player, playerKit);
  if (article.lane === "JG") {
    return [
      pick(article, [
        `${roamTiming(article, entry, enemy, enemyKit, 181)}に${enemy.name}が見えないなら、川の先入りを諦める。${player.name}はキャンプを早く切り上げ、${spellLabel(response)}をカウンターガンクに残す。`,
        `${enemy.name}がワードに映らず、${spellLabel(enemyKit.cc)}から先に触れる位置へ入れる場面では、${player.name}は中立へ直行しない。先に近いレーンの体力と寄りを確認する。`,
        `${enemyLaneText(entry)}側のミアが遅れたら、${enemy.name}の${spellLabel(enemyKit.move)}を見てから川へ入る。暗い入口で会うと、スマイトを押す前に体力を削られる。`
      ], 181),
      pick(article, [
        `${enemy.name}の${spellLabel(enemyKit.r)}がある時間は、合流後の追撃が伸びる。${player.name}はフラッシュか${spellLabel(response)}を中立の取り切りだけに使い切らない。`,
        `ドラゴンやヴォイドグラブ前に${spellLabel(enemyKit.r)}が見えていないなら、${player.name}は先にピンを出す。味方が寄れない形で触る中立は、ほぼ餌になる。`,
        `${enemy.name}がRを持つ時間は、浅いワードで十分な場面が増える。${player.name}は深い侵入より、反対側キャンプの回収で損を小さくする。`
      ], 182),
      pick(article, [
        `${enemyLaneText(entry)}側のミアを見落として深い視界へ行くと、人数差で崩れる。${roamVision(article, entry, enemy, 183)}だけで止め、味方の寄りが出てから次へ進む。`,
        `${enemy.name}が消えている時の一人侵入は、カウンターガンクの札を捨てる動き。${player.name}は入口を一つ確認したら、味方側へ戻る。`,
        `正面で勝てそうでも、${enemy.name}の位置がない間は長く殴らない。中立の体力より、味方が先に動けるかを優先する。`
      ], 183)
    ];
  }
  if (article.lane === "SUP") {
    return [
      pick(article, [
        `${roamTiming(article, entry, enemy, enemyKit, 181)}に${enemy.name}が見えないなら、味方ADCを先に下げる。${player.name}は${spellLabel(response)}を前の仕掛けではなく退路作りに残す。`,
        `${enemy.name}が${enemyLaneText(entry)}から消えた時、${riskyWard(article, 181)}へ歩くのが一番安い負け方。${player.name}は${adcAnchor(article, 181)}へ戻り、${spellLabel(enemyKit.cc)}の線を外す。`,
        `サポート側は視界を取りたい時間ほど危ない。${enemy.name}の${spellLabel(enemyKit.move)}が見えないなら、${player.name}はブッシュ保持より下がるピンを優先する。`
      ], 181),
      pick(article, [
        `${enemy.name}の${spellLabel(enemyKit.r)}がある時間は、合流後の追撃が伸びる。${player.name}は${spellLabel(playerKit.protect)}かフラッシュを味方ADCのために残す。`,
        `レベル6後は${enemy.name}のRが画面外から届く前提で立つ。${player.name}は${smallPressure(article, 182)}より、味方ADCが逃げる一歩を作る。`,
        `R絡みの時間に先に仕掛けるなら、敵ボットの反撃まで見る。${enemy.name}が見えないまま入ると、勝った2v2が人数差で壊れる。`
      ], 182),
      pick(article, [
        `${enemyLaneText(entry)}側のミアを見落として深い視界へ行くと、正面の対面に勝っていても人数差で崩れる。${roamVision(article, entry, enemy, 183)}だけで止める。`,
        `ワード更新は味方ADCが安全にCSを取れる波だけ。${enemy.name}が消えた直後は、置く場所の深さより帰れる距離を見る。`,
        `味方ADCがフラッシュなしなら、${enemy.name}のミア中に川へ一人で出ない。${player.name}が横にいるだけで、最初の入りを一回遅らせられる。`
      ], 183)
    ];
  }
  return [
    pick(article, [
      `${roamTiming(article, entry, enemy, enemyKit, 181)}に${enemy.name}が見えないと、${spellLabel(enemyKit.cc)}から先に捕まる。${player.name}は川側ではなく自陣寄りに体を置く。`,
      `${enemy.name}が${enemyLaneText(entry)}から消えた直後は、前のミニオンより退路を見る。${spellLabel(enemyKit.move)}が残るなら、${player.name}は横の川入口から離れる。`,
      `${spellLabel(enemyKit.cc)}がサイドで使われていない場面では、${enemy.name}の姿がないだけで危険時間。${player.name}は押し切る前に足を止める。`
    ], 181),
    pick(article, [
      `${enemy.name}の${spellLabel(enemyKit.r)}がある時間は、合流後の追撃が伸びる。Rが見えるまで${spellLabel(response)}かフラッシュを使い切らない。`,
      `レベル6前後は${enemy.name}の${spellLabel(enemyKit.r)}を前提に立つ。${player.name}はキル確認より、Rを見てから下がれる距離を残す。`,
      `${enemy.name}がRを持つ時間は、一回避けても次の追撃が来る。${player.name}は反撃札を全部吐かず、味方側へ斜めに下がる。`
    ], 182),
    pick(article, [
      `${enemyLaneText(entry)}側のミアを見落として深い視界へ行くと、正面の対面に勝っていても人数差で崩れる。${roamVision(article, entry, enemy, 183)}だけで止める。`,
      `押し切った後にもう一歩川へ出る時が危ない。${enemy.name}が映るまでは、${player.name}は${shortVision(article, 183)}とピンだけで十分。`,
      `${enemy.name}の位置がないままタワー前に残ると、帰る距離が長すぎる。ミアが解けるまで、次の一波より体力を優先する。`
    ], 183)
  ];
}

function roamSkillshots(article, entry, player, enemy, playerKit, enemyKit) {
  const response = responseSpellFor(article, player, playerKit);
  if (article.lane === "JG") {
    return {
      hit: [
        pick(article, [
          `${player.name}の${spellLabel(playerKit.poke)}は、ロームが見える前のキャンプ処理と入口確認に使う。${enemy.name}が画面に入ってから慌てて撃つより、先に体力を残して川へ戻る方が強い。`,
          `${spellLabel(playerKit.poke)}は中立を急ぐためだけに使わない。${roamTiming(article, entry, enemy, enemyKit, 191)}なら、入口へ置いて${enemy.name}の進路を遅らせる。`,
          `川へ出る前に${spellLabel(playerKit.poke)}で小さいモンスターを片付ける。途中で${enemy.name}が見えたら、キャンプ継続より味方側へ下がる。`
        ], 191),
        pick(article, [
          `${spellLabel(response)}は${enemy.name}の${spellLabel(enemyKit.move)}を見てから合わせる。先に撃つと、${spellLabel(enemyKit.cc)}で入られた時にカウンターガンクの札がない。`,
          `${enemy.name}が${spellLabel(enemyKit.cc)}を見せるまでは、${player.name}は${spellLabel(response)}を温存する。味方が捕まった瞬間に止める方が、無理な先入りより安い。`,
          `${spellLabel(response)}は逃げにも反撃にも使う札。${enemy.name}の移動スキルが残る間は、当てに行くより通路を塞ぐ意識で置く。`
        ], 192),
        pick(article, [
          `${roamTiming(article, entry, enemy, enemyKit, 193)}なら、中立の取り切りより退路を優先する。${player.name}は味方側へ寄りながら反撃角を作る。`,
          `${enemy.name}が見えない時間に狭い壁際へ寄らない。${player.name}は広い側で${spellLabel(response)}を構え、当たらなくても逃げ道を残す。`,
          `味方レーンが先に動ける時だけ、${player.name}は${spellLabel(response)}で受ける。寄りが遅いなら、反対側の中立に変えて損を切る。`
        ], 193)
      ],
      dodge: [
        pick(article, [
          `${enemy.name}の${spellLabel(enemyKit.cc)}はロームの最初の合図。${player.name}は避ける方向を考える前に、川の入口から一歩外れて射線を消す。`,
          `${roamTiming(article, entry, enemy, enemyKit, 194)}は、${player.name}が壁際の中立を長く触らない時間。広い側へ引いてからスマイト判断をする。`,
          `${enemy.name}が暗い場所から入るなら、${player.name}は避けるより先にピンを出す。${spellLabel(enemyKit.cc)}の線を味方にも見せるだけで事故が減る。`,
          `${player.name}は${roamVision(article, entry, enemy, 197)}までで止める。${spellLabel(enemyKit.cc)}を見てから中立へ戻ると、カウンターガンクの形を残せる。`,
          `${spellLabel(enemyKit.cc)}がまだ見えていないなら、${player.name}は${spellLabel(response)}を先に吐かない。避けた後に味方側へ逃がす札として数える。`
        ], 194),
        pick(article, [
          `${spellLabel(enemyKit.poke)}を一発受けた後に中立へ戻らない。次の${spellLabel(enemyKit.move)}で距離を詰められる前に、味方側へ下がる。`,
          `${enemy.name}の${spellLabel(enemyKit.move)}が残る時は、横へ避けた後の追撃まで見る。${player.name}はキャンプより体力を守る。`,
          `一発避けても、${enemy.name}がまだ${spellLabel(enemyKit.move)}を持っているなら勝ちじゃない。視界が薄い側へ追わず、広い通路へ戻る。`
        ], 195),
        pick(article, [
          ultimateDodgePlan(article, "JG", player, enemy, enemyKit, 196),
          ultimateDodgePlan(article, "JG", player, enemy, enemyKit, 197),
          `${spellLabel(enemyKit.r)}が見えていない時は、川の中央で足を止めない。視界を一つ置いて、次のキャンプへ戻る判断も持つ。`
        ], 196)
      ]
    };
  }
  if (article.lane === "SUP") {
    return {
      hit: [
        pick(article, [
          `${player.name}の${spellLabel(playerKit.poke)}は、ロームが見える前に敵ボットの前歩きを止めるために使う。${enemy.name}が画面に入ってから撃つより、味方ADCの退路を先に作る。`,
          `${spellLabel(playerKit.poke)}はブッシュの確認だけで捨てない。${roamTiming(article, entry, enemy, enemyKit, 191)}なら、敵ボットが前に出た瞬間へ残す。`,
          `味方ADCがCSを取る瞬間だけ${spellLabel(playerKit.poke)}を合わせる。${enemy.name}のミア中に空撃ちすると、下がる圧が消える。`
        ], 191),
        pick(article, [
          `${spellLabel(response)}は${enemy.name}の${spellLabel(enemyKit.move)}を見てから合わせる。先に撃つと、${spellLabel(enemyKit.cc)}で入られた時に味方ADCを守る札がない。`,
          `${enemy.name}が見えるまでは、${player.name}の${spellLabel(response)}を開始ではなく受けに回す。味方ADCが下がる一歩を作れれば十分。`,
          `${spellLabel(response)}を使うなら、味方ADCが追える距離だけ。${enemy.name}の${spellLabel(enemyKit.cc)}が残る時は、深追いを切る。`
        ], 192),
        pick(article, [
          `${roamTiming(article, entry, enemy, enemyKit, 193)}なら、前へ踏むより味方ADCの足元へ戻る。${player.name}は逃げ道を塞がれない角度で反撃する。`,
          `${enemy.name}が見えていない時の深いブッシュ取りはしない。${player.name}は下がりながら${spellLabel(response)}を構え、最初の入りだけ止める。`,
          `敵ボットが前に出た瞬間だけ、${player.name}は${spellLabel(response)}で短く返す。ローム本体が見えたら追撃より退路を優先する。`
        ], 193)
      ],
      dodge: [
        pick(article, [
          `${enemy.name}の${spellLabel(enemyKit.cc)}はロームの最初の合図。${player.name}は横へ避けるより、先に川側から味方ADCを離す。`,
          `${spellLabel(enemyKit.cc)}の線が見えたら、${player.name}だけ避けても足りない。味方ADCの移動先を開ける位置へ下がる。`,
          `${enemy.name}が暗い川から来るなら、${player.name}は避けるより先にピン。敵ボットの前歩きと${spellLabel(enemyKit.cc)}を同時に受けない。`,
          `${roamTiming(article, entry, enemy, enemyKit, 194)}は、${player.name}がブッシュを取り返す時間じゃない。${spellLabel(response)}を味方ADCの退路へ回す。`,
          `${player.name}は${roamVision(article, entry, enemy, 197)}までで止める。${spellLabel(enemyKit.cc)}を見てから下がれば、味方ADCのフラッシュを残しやすい。`
        ], 194),
        pick(article, [
          `${spellLabel(enemyKit.poke)}を一発受けた後にブッシュへ戻らない。次の${spellLabel(enemyKit.move)}で距離を詰められる前に、味方ADC側へ下がる。`,
          `${enemy.name}の${spellLabel(enemyKit.move)}が残る時は、視界を置き切る欲を捨てる。${player.name}は帰り道を先に確保する。`,
          `一発避けても、敵ボットのCCが残るなら勝ちじゃない。${player.name}は${adcAnchor(article, 195)}へ戻って次の入りを待つ。`
        ], 195),
        pick(article, [
          ultimateDodgePlan(article, "SUP", player, enemy, enemyKit, 196),
          `R絡みの時間は、${smallPressure(article, 196)}より生存。${player.name}は${spellLabel(playerKit.protect)}を自分の小さい被弾に使い切らない。`,
          `${spellLabel(enemyKit.r)}が見えていない時は、川側のブッシュに長く残らない。浅いワードだけ置いて味方ADCへ戻る。`
        ], 196)
      ]
    };
  }
  return {
    hit: [
      pick(article, [
        `${player.name}の${spellLabel(playerKit.poke)}は、ロームが見える前の波処理に使う。${enemy.name}が画面に入ってから撃つより、到着前にミニオンを減らして退路を作る方が強い。`,
        `${spellLabel(playerKit.poke)}は敵本体よりミニオン波へ先に使う。${roamTiming(article, entry, enemy, enemyKit, 191)}なら、押し切ってすぐ下がる準備をする。`,
        `ローム警戒中の${spellLabel(playerKit.poke)}は、キル狙いより波を薄くするための札。${enemy.name}が見えた瞬間に逃げ道が残る形を作る。`
      ], 191),
      pick(article, [
        `${spellLabel(response)}は${enemy.name}の${spellLabel(enemyKit.move)}を見てから合わせる。先に撃つと、${spellLabel(enemyKit.cc)}で入られた時に止めるものがない。`,
        `${enemy.name}の入りが見えるまでは、${player.name}の${spellLabel(response)}を温存する。最初の移動を受けてから足止めする方が事故が少ない。`,
        `${spellLabel(response)}を先に吐くなら、${enemy.name}がミニマップに映っている時だけ。見えていない時間は、逃げ札として数える。`
      ], 192),
      pick(article, [
        `${roamTiming(article, entry, enemy, enemyKit, 193)}なら、当てに行くより足元へ置く。${player.name}は逃げ道を塞がれない角度で反撃する。`,
        `${enemy.name}が画面に入った後は、深追いの命中より短い足止め。${player.name}は味方側へ動きながら返す。`,
        `相手が見えた瞬間に全部撃たない。${player.name}は一つ目を避け、二つ目の入りへ${spellLabel(response)}を合わせる。`
      ], 193)
    ],
    dodge: [
      pick(article, [
        `${enemy.name}の${spellLabel(enemyKit.cc)}はロームの最初の合図。${player.name}は横へ避けるより、先に川側から離れて射線そのものを消す。`,
        `${spellLabel(enemyKit.cc)}を避ける前に、そもそも届く線へ立たない。${player.name}は川側ではなく自陣側のミニオン横で受ける。`,
        `${enemy.name}が暗い入口から来るなら、${player.name}は反応で避けるよりミアの時点で下がる。${spellLabel(enemyKit.cc)}の射線を作らせない。`,
        `${roamTiming(article, entry, enemy, enemyKit, 194)}は、${player.name}が前のミニオンを取りに行く時間じゃない。${spellLabel(response)}を残して斜め後ろへ下がる。`,
        `${player.name}は${roamVision(article, entry, enemy, 197)}までで止める。${spellLabel(enemyKit.cc)}を見てからなら、波を捨てても次を受けられる。`
      ], 194),
      pick(article, [
        `${spellLabel(enemyKit.poke)}を一発受けた後に居座らない。次の${spellLabel(enemyKit.move)}で距離を詰められる前に、味方側へ下がる。`,
        `${enemy.name}の${spellLabel(enemyKit.move)}が残る時は、横へ避けた後の追撃まで見る。${player.name}は次の波より体力を守る。`,
        `一発避けても、${enemy.name}がまだ${spellLabel(enemyKit.move)}を持っているなら勝ちじゃない。追うより自陣側へ戻る。`
      ], 195),
      pick(article, [
        ultimateDodgePlan(article, article.lane, player, enemy, enemyKit, 196),
        `R絡みの時間は、避けた後に反撃しようとしすぎない。${player.name}はフラッシュか${spellLabel(response)}を残して次の波へ逃がす。`,
        `${spellLabel(enemyKit.r)}が見えていない時は、タワー前でも長居しない。${enemy.name}のミアが解けてから、押し返す。`
      ], 196)
    ]
  };
}

function directFightSurface(article) {
  return ({
    TOP: "サイドの長いレーン",
    JG: "川と中立前の狭い通路",
    MID: "ミッド横の短い川入口",
    ADC: "ボット2v2のミニオン横",
    SUP: "ADCの退路とブッシュ前"
  })[article.lane] || "レーン中央";
}

function directSpacingCue(article, player, enemy, playerKit, enemyKit, offset = 0) {
  const playerRange = rangeProfile(player);
  const enemyRange = rangeProfile(enemy);
  const response = responseSpellFor(article, player, playerKit);
  const nextAction = response?.name === playerKit.poke?.name ? "次の一手" : `次の${spellLabel(playerKit.poke)}`;
  if (playerRange === "レンジ" && enemyRange === "メレー") {
    return pick(article, [
      `${enemy.name}の${spellLabel(enemyKit.move)}が届く一歩手前で${spellLabel(playerKit.poke)}を置き、近づかれたら追撃せず下がる`,
      `${enemy.name}がCSへ踏み込む瞬間だけ${spellLabel(playerKit.poke)}を入れ、${spellLabel(enemyKit.cc)}が残る間は足を止めない`,
      `${enemy.name}の入りを見てから${spellLabel(response)}を返し、射程差を長い殴り合いではなく短い拒否に使う`
    ], offset);
  }
  if (playerRange === "メレー" && enemyRange === "レンジ") {
    return pick(article, [
      `${enemy.name}の${spellLabel(enemyKit.poke)}を避けた直後だけ前に出て、${spellLabel(playerKit.move)}で届く距離を作る`,
      `${enemy.name}の${spellLabel(enemyKit.cc)}が残る間は我慢し、落ちた瞬間に${spellLabel(playerKit.poke)}と通常攻撃で短く切る`,
      `削られた体力を一度に取り返そうとせず、${spellLabel(playerKit.cc)}が当たる角度までミニオン横で待つ`
    ], offset);
  }
  return pick(article, [
    `${enemy.name}の${spellLabel(enemyKit.cc)}を見てから${spellLabel(response)}を返し、${nextAction}まで長居しない`,
    `${spellLabel(playerKit.poke)}と${spellLabel(enemyKit.poke)}の交換を一回で切り、ミニオン数が悪い時は追わない`,
    `${enemy.name}が${spellLabel(enemyKit.move)}を使った後だけ前へ出て、戻り道へ${spellLabel(playerKit.cc)}を置く`
  ], offset);
}

function teamfightPlan(article, entry, player, enemy, playerKit, enemyKit, direct) {
  const response = responseSpellFor(article, player, playerKit);
  if (!direct && article.lane === "JG") {
    return [
      pick(article, [
        `ドラゴン前は${enemy.name}の${spellLabel(enemyKit.cc)}が見えるまで、${player.name}は中立を触り切らない。${spellLabel(response)}を味方の退路に残す。`,
        `${enemy.name}が${enemyLaneText(entry)}から消えたままなら、${player.name}は${roamVision(article, entry, enemy, 301)}。中立に触るのは近い味方が先に動ける時だけ。`,
        pick(article, [
          `集団戦前は${enemy.name}本体を追うより、${spellLabel(enemyKit.move)}で入る通路へ${spellLabel(playerKit.cc)}を残す。${player.name}が入口を一秒止めれば、味方の火力が先に届く。`,
          `${enemy.name}が通路から入る形では、${player.name}は追撃より${spellLabel(playerKit.cc)}の置き場所を優先する。止めた瞬間に味方が殴れる距離を残す。`,
          `${spellLabel(enemyKit.move)}の通り道を塞げるなら、${player.name}は${enemy.name}本体を深追いしない。味方の火力が届く手前で構える方が強い。`
        ], 300)
      ], 300),
      pick(article, [
        `${enemy.name}の${spellLabel(enemyKit.r)}が残る時間は、スマイト勝負より先に人数差を見る。${player.name}は${spellLabel(response)}を退路に残し、落ちて中立も視界も失う形を避ける。`,
        `R絡みの戦闘では、${player.name}は最初の一手を避けてから${spellLabel(playerKit.poke)}を返す。入り口で受けると後衛が追撃される。`,
        `${enemy.name}が横から来る構図では、${player.name}は後衛の反対側へ走らない。近い味方を守れる距離で${spellLabel(response)}を構える。`
      ], 301),
      pick(article, [
        `${enemy.name}に先手を取られているなら、${player.name}は中立を五分で触らない。${roamVision(article, entry, enemy, 302)}だけで止め、${spellLabel(playerKit.poke)}を残して反対側のキャンプか視界へ逃がす。`,
        `味方が先に押せる時だけ、${player.name}は${spellLabel(playerKit.cc)}で入口を塞ぐ。押されている時は一歩引いてカウンターガンクを見る。`,
        `${enemy.name}が見えた後の深追いはしない。${spellLabel(enemyKit.cc)}が落ちた瞬間だけ触り、次の中立準備へ戻す。`
      ], 302)
    ];
  }
  if (!direct && article.lane === "SUP") {
    return [
      pick(article, [
        `ドラゴン前はADCから離れて視界へ行かない。${enemy.name}の${spellLabel(enemyKit.cc)}が見えるまで、${player.name}は${spellLabel(response)}を退路用に残す。`,
        `${enemy.name}が${enemyLaneText(entry)}から消えたら、${player.name}は${riskyWard(article, 301)}より${adcAnchor(article, 301)}を優先する。${spellLabel(response)}で最初の入りを止めれば集団戦は始め直せる。`,
        `集団戦前の役目は${enemy.name}を倒すことより、${spellLabel(enemyKit.move)}で入る角度を味方に見せること。${spellLabel(playerKit.protect)}を小さい被弾に使い切らない。`
      ], 300),
      pick(article, [
        `${enemy.name}の${spellLabel(enemyKit.r)}がある時間は、味方ADCのフラッシュを守る立ち位置にする。${player.name}だけ前で避けても意味が薄い。`,
        `R絡みの戦闘では、${player.name}は先に仕掛けず、${enemy.name}の一手目を見てから${spellLabel(response)}を返す。`,
        `${enemy.name}が横から入る構図では、${player.name}は後衛の近くに戻る。${spellLabel(response)}を退路作りへ回す方が追撃より価値が高い。`
      ], 301),
      pick(article, [
        `視界が負けている時は、${player.name}が${roamVision(article, entry, enemy, 302)}だけで止める。${enemy.name}のミア中に視界確認で奥へ歩くと、ボット2v2以前に捕まる。`,
        `味方ADCが体力を削られているなら、${player.name}はワードより帰れる位置を作る。${enemy.name}の${spellLabel(enemyKit.cc)}を受ける距離に残らない。`,
        `勝っている時ほど深追いを切る。${enemy.name}が見えないなら、${spellLabel(playerKit.poke)}で前歩きだけ止めてオブジェクトへ戻る。`
      ], 302)
    ];
  }
  if (!direct) {
    return [
      pick(article, [
        `集団戦前は${enemy.name}が${enemyLaneText(entry)}から消えた時間を先に見る。${player.name}は${spellLabel(response)}を逃げ札として残してから前に出る。`,
        `${enemy.name}の${spellLabel(enemyKit.cc)}が見えていないなら、${player.name}は横の川入口へ寄りすぎない。${spellLabel(playerKit.poke)}は波か通路に使う。`,
        `味方が先に押せる時だけ${player.name}は${roamVision(article, entry, enemy, 301)}まで進む。見えない${enemy.name}を探しに行く動きはしない。`
      ], 300),
      pick(article, [
        `${enemy.name}の${spellLabel(enemyKit.r)}がある時間は、最初の一発を避けても終わりじゃない。${player.name}はフラッシュか${spellLabel(response)}を二手目に残す。`,
        `R絡みの戦闘では、${player.name}はキル確認より味方側へ下がる線を優先する。${enemy.name}が画面外なら、${spellLabel(response)}を残して追撃は短く切る。`,
        `${enemy.name}が横から来るなら、${player.name}は後衛の近くで受ける。${spellLabel(playerKit.cc)}を入口に置ける距離が目安。`
      ], 301),
      pick(article, [
        `勝っている時でも、${enemy.name}のミア中に一人で視界を広げない。${player.name}は浅いワードとピンだけで十分な場面を選ぶ。`,
        `負けている時は、先に当てるより外させる。${enemy.name}の${spellLabel(enemyKit.move)}を見てから${spellLabel(playerKit.poke)}で返す。`,
        `${enemy.name}の姿が見えた後だけ、${player.name}は味方と同じ方向へ前に出る。別方向へ追うとローム警戒の意味が消える。`
      ], 302)
    ];
  }
  return [
    pick(article, [
      `${directFightSurface(article)}では、${enemy.name}の${spellLabel(enemyKit.cc)}が見えるまで${player.name}は返し札を使い切らない。${spellLabel(response)}を二手目に残す。`,
      `${enemy.name}が${spellLabel(enemyKit.move)}で入る構図なら、${player.name}は後衛の横へ寄る。先に${spellLabel(playerKit.poke)}だけ当てて、戻り道を作る。`,
      `集団戦の入り口では、${directSpacingCue(article, player, enemy, playerKit, enemyKit, 303)}。キル確認より、相手の強い一手を空振りさせる。`
    ], 300),
    pick(article, [
      `${enemy.name}の${spellLabel(enemyKit.r)}が残る時は、${player.name}のフラッシュや${spellLabel(playerKit.protect)}を小さい被弾に使わない。Rを見てから返す。`,
      `Rが落ちた直後だけ、${player.name}は${spellLabel(playerKit.poke)}で強く触る。残っている時間に正面から始めると、勝った交換も崩れる。`,
      `${enemy.name}のRを避けた後も、次の${spellLabel(enemyKit.cc)}までは油断しない。${player.name}は味方の火力が届く距離で止まる。`
    ], 301),
    pick(article, [
      `オブジェクト前は${enemy.name}の得意な入口を避ける。${player.name}は${spellLabel(playerKit.cc)}を暗い場所へ先撃ちせず、見えた相手に合わせる。`,
      `味方が捕まりそうな時はキル回収より退路を作る。${enemy.name}を倒せなくても、${spellLabel(response)}で主力を守れば次を戦える。`,
      `勝っている時ほど追い切らない。${enemy.name}の${spellLabel(enemyKit.move)}が戻る前に交換を切り、次の視界へ変える。`
    ], 302)
  ];
}

function commonMistakePlan(article, entry, player, enemy, playerKit, enemyKit, direct, enemyDamage) {
  const response = responseSpellFor(article, player, playerKit);
  if (!direct && article.lane === "JG") {
    return [
      pick(article, [
        `${enemy.name}が見えていないのに、${player.name}が中立を取り切るためだけに${spellLabel(response)}を使うこと。次のカウンターガンクで止める札がなくなる。`,
        `${enemy.name}の位置がない時間に、${player.name}がスマイト前の処理へ${spellLabel(response)}を吐き切ること。味方が寄られた瞬間に入口を止められない。`,
        `${enemy.name}が川に映る前から、${player.name}が中立優先で${spellLabel(response)}を落とすこと。取れても次の反撃で体力と視界を失う。`
      ], 311),
      `${roamTiming(article, entry, enemy, enemyKit, 311)}に深い侵入を続けること。${jungleInvadeMistake(article, 311)}。`,
      `負けているのに${damageOnlyBuy(article, 311)}を急ぐこと。${enemy.name}の${enemyDamage}を一回耐えられないなら、${player.name}は${spellLabel(playerKit.poke)}を撃つ前に視界で落ちる。`
    ];
  }
  if (!direct && article.lane === "SUP") {
    return [
      pick(article, [
        `${enemy.name}のミア中に、${player.name}がADCから離れて${riskyWard(article, 311)}へ行くこと。人数確認の前に孤立して捕まる。`,
        `${enemy.name}が見えないまま、${player.name}が奥の視界を一人で取り返すこと。味方ADCの横へ戻る前に人数差で潰される。`,
        `${enemy.name}の合流が読めるのに、${player.name}がワード更新を欲張ること。浅い確認と下がるピンだけで済む場面を選べていない。`
      ], 311),
      `返し札を${smallPressure(article, 312)}で先に使い切ること。${enemy.name}の${spellLabel(enemyKit.cc)}を受けた時に退路がない。`,
      `勝っている2v2の感覚で${player.name}が前に残ること。${roamTiming(article, entry, enemy, enemyKit, 312)}は、${spellLabel(playerKit.poke)}で仕掛ける時間ではなく下げる合図。`
    ];
  }
  if (!direct) {
    return [
      pick(article, [
        `${enemy.name}が見えていない時間に、${player.name}が前のミニオンだけを見て残ること。${spellLabel(enemyKit.cc)}が届く線ならCSより体力。`,
        `${enemy.name}のミアが遅れた時、${player.name}が大砲ミニオンだけを理由にレーン中央へ残ること。退路が消えるなら一枚捨てていい。`,
        `${enemy.name}が川へ出られる波で、${player.name}が足を止めてラストヒットを追うこと。見えていないCCの射線に立たない。`
      ], 311),
      `${spellLabel(response)}を先に吐いてから視界を取りに行くこと。${enemy.name}の${spellLabel(enemyKit.move)}を見た後に残っていないと逃げられない。`,
      `${roamTiming(article, entry, enemy, enemyKit, 312)}を、交換開始の合図と勘違いすること。${player.name}は${spellLabel(playerKit.poke)}を波に使い、ピン、${shortVision(article, 312)}、リコールで勝ちを残す。`
    ];
  }
  return [
    `${enemy.name}の${spellLabel(enemyKit.cc)}が残っているのに、${player.name}の${spellLabel(playerKit.poke)}だけを理由に前へ出ること。外した瞬間に交換が終わる。`,
    `${directSpacingCue(article, player, enemy, playerKit, enemyKit, 313)}。この形を作る前に体力差だけで追撃すること。${enemy.name}の返しが戻る前に切る。`,
    pick(article, [
      `負けているのに高い完成品へ直行すること。${enemy.name}の${enemyDamage}を一回耐えられないなら、次の交換まで立てない。`,
      `不利なのに攻めの買い物だけで返そうとすること。${enemy.name}の${enemyDamage}を受けた後に下がれないなら、スキルを撃つ前に落ちる。`,
      `耐える小物を飛ばして完成品を急ぐこと。${enemy.name}の一手を受ける体力がないなら、反撃の形まで届かない。`
    ], 314)
  ];
}

function contextualizeSentence(article, player, enemy, sentence) {
  const value = sentence.trim();
  if (!value) return value;
  if (value.length < 8) return value;
  const hasPlayer = value.includes(player.name);
  const hasEnemy = value.includes(enemy.name);
  if (hasPlayer && hasEnemy) return value;
  if (hasPlayer) {
    const enemyPrefixes = [
      `${enemy.name}相手では、`,
      `${enemy.name}が見えている間は、`,
      `${enemy.name}の圧があるので、`,
      `この${enemy.name}戦では、`,
      `相手が${enemy.name}なら、`
    ];
    return `${pick(article, enemyPrefixes, stableNumber(value))}${value}`;
  }
  if (hasEnemy) {
    const playerPrefixes = [
      `${player.name}側では、`,
      `${laneLabel(article.lane)}の${player.name}は、`,
      `${player.name}視点では、`,
      `${player.name}が受ける時は、`,
      `${player.name}で見るなら、`
    ];
    return `${pick(article, playerPrefixes, stableNumber(value))}${value}`;
  }
  const prefixes = [
    `${player.name}対${enemy.name}では、`,
    `${enemy.name}相手の${player.name}は、`,
    `${laneLabel(article.lane)}の${player.name}対${enemy.name}は、`,
    `${enemy.name}が絡む時間の${player.name}は、`,
    `${player.name}視点の${enemy.name}戦では、`
  ];
  return `${pick(article, prefixes, stableNumber(value))}${value}`;
}

function contextualizeText(article, player, enemy, text) {
  if (typeof text !== "string") return text;
  return text
    .split("。")
    .map((sentence) => contextualizeSentence(article, player, enemy, sentence))
    .filter(Boolean)
    .join("。");
}

function contextualizeContent(article, player, enemy) {
  return {
    ...article,
    summary: contextualizeText(article, player, enemy, article.summary),
    winCondition: contextualizeText(article, player, enemy, article.winCondition),
    threatModel: (article.threatModel || []).map((line) => contextualizeText(article, player, enemy, line)),
    trading: (article.trading || []).map((line) => contextualizeText(article, player, enemy, line)),
    lanePlan: Object.fromEntries(Object.entries(article.lanePlan || {}).map(([key, value]) => [key, contextualizeText(article, player, enemy, value)])),
    runes: Object.fromEntries(Object.entries(article.runes || {}).map(([key, value]) => [key, key.endsWith("Why") ? contextualizeText(article, player, enemy, value) : value])),
    items: Object.fromEntries(Object.entries(article.items || {}).map(([key, value]) => [key, contextualizeText(article, player, enemy, value)])),
    skillshots: {
      hit: (article.skillshots?.hit || []).map((line) => contextualizeText(article, player, enemy, line)),
      dodge: (article.skillshots?.dodge || []).map((line) => contextualizeText(article, player, enemy, line))
    },
    teamfights: (article.teamfights || []).map((line) => contextualizeText(article, player, enemy, line)),
    commonMistakes: (article.commonMistakes || []).map((line) => contextualizeText(article, player, enemy, line))
  };
}

function buildReplacement(article, entry, championById, detailById, runes, date) {
  const player = championById.get(article.player);
  const enemy = championById.get(article.enemy);
  const playerDetail = detailById.get(article.player);
  const enemyDetail = detailById.get(article.enemy);
  if (!player || !enemy || !playerDetail || !enemyDetail || !entry) return article;

  const playerKit = kit(playerDetail);
  const enemyKit = kit(enemyDetail);
  const trades = tradeAdvice(article, entry, player, enemy, playerKit, enemyKit);
  const opener = laneOpener(article, entry, player, enemy, playerKit, enemyKit);
  const enemyDamage = damageProfile(enemy);
  const direct = isDirectMatchup(article, entry);
  const enemyTools = spellPair([enemyKit.cc, enemyKit.move, enemyKit.poke]);
  const playerTools = spellPair([playerKit.poke, playerKit.cc, playerKit.move]);
  const keepSkillPurpose = article.lane === "SUP"
    ? "味方保護かカウンターエンゲージに残すこと"
    : article.lane === "JG"
      ? "カウンターガンクかオブジェクト前の反撃に残すこと"
      : "逃げと反撃のどちらにも使えるよう残すこと";

  const replacement = {
    id: article.id,
    status: article.status || "reviewed",
    updatedAt: date,
    player: article.player,
    enemy: article.enemy,
    lane: article.lane,
    summary: direct
      ? `${opener} ${player.name}側は${spellLabel(playerKit.poke)}を当てる前に、${enemy.name}の${enemyTools}が残っているかを見る。`
      : `${opener} ${roamTiming(article, entry, enemy, enemyKit, 171)}なら、${playerRoamSetup(article, entry, player, enemy, playerKit, enemyKit, 172)}。`,
    winCondition: direct
      ? pick(article, [
        `勝ち筋は${enemy.name}の${enemyKit.cc.name}を空振りさせた直後に、${player.name}の${playerTools}で短く体力差を作ること。倒し切れない時は波を整えて、次の交換まで相手の強い時間をやり過ごす。`,
        `${enemy.name}の${enemyTools}が落ちた時間にだけ強く触る。${player.name}は${playerKit.poke.name}で先に体力を削り、長引きそうなら波を押して次のターンへ逃がす。`,
        `勝つ形は、${enemy.name}の入りを一度外させてから${player.name}の${playerTools}を重ねること。最初の交換で倒せないなら、追撃よりリコールと視界へ変える。`
      ], 61)
      : pick(article, [
        `勝ち筋は${enemy.name}が${enemyLaneText(entry)}から動く前に情報を取り、${player.name}の${spellLabel(playerKit.cc)}を${keepSkillPurpose}。${spellLabel(enemyKit.move)}の到着を見てから下がれば、正面の有利を失わずに済む。`,
        pick(article, [
          `${roamTiming(article, entry, enemy, enemyKit, 62)}を先に拾い、${playerRoamSetup(article, entry, player, enemy, playerKit, enemyKit, 64)}。${enemy.name}に寄られても、${player.name}は一度下がれる距離を残す。`,
          `${enemy.name}が消える前に情報を取り、${playerRoamSetup(article, entry, player, enemy, playerKit, enemyKit, 65)}。退路が残る位置で止めれば、正面の有利を渡しにくい。`,
          `${roamTiming(article, entry, enemy, enemyKit, 66)}を危険時間にして、${player.name}は先に味方側へ戻る線を作る。${enemy.name}の到着を受けても一回で終わらない形にする。`
        ], 62),
        `この組み合わせは正面の殴り合いより、${enemy.name}の移動を早く見るほど楽になる。${player.name}側は${roamVision(article, entry, enemy, 63)}だけで欲張りを止め、帰る時間を確保する。`
      ], 62),
    threatModel: direct
      ? [
        pick(article, [
          `${enemy.name}の${spellLabel(enemyKit.cc)}を受けると、${player.name}が${spellLabel(playerKit.poke)}で返す前に位置を固定されやすい。相手の射程や移動先を見てから前に出る。`,
          `${enemy.name}の${enemyTools}が残る時は、先に歩いた側が損をしやすい。${player.name}はミニオンの横から触って、直線で受けない。`,
          `${enemy.name}に先手を渡すと、${player.name}の${spellLabel(playerKit.cc)}を反撃ではなく逃げに使わされる。仕掛ける前に相手の一手を吐かせる。`
        ], 63),
        pick(article, [
          `${enemy.name}は${enemyDamage}の${archetype(enemy)}。${spellLabel(enemyKit.poke)}を続けて受けると、次の波でCSを取るだけでも危険になる。`,
          `${enemy.name}の火力は${enemyDamage}に寄る。防御を後回しにすると、${player.name}がスキルを返す前に体力だけ削られる。`,
          `${spellLabel(enemyKit.poke)}を複数回受ける展開は避けたい。${player.name}側は一度下がってでも、次のミニオン波で仕切り直す方が安い。`
        ], 64),
        pick(article, [
          `${laneLabel(article.lane)}の直接対面ではミニオン数が多い側が強い。${enemy.name}本体だけ見て追うと、ミニオンと${spellLabel(enemyKit.cc)}で交換が崩れる。`,
          `直接対面では、敵ミニオンが多い時の追撃が一番安い負け方。${enemy.name}を削っても、波が悪いならそこで止める。`,
          `${enemy.name}が下がった後も、ミニオンが残っているなら深追いしない。${player.name}は次のラストヒットを取れる位置で十分。`
        ], 65)
      ]
      : roamThreatModel(article, entry, player, enemy, playerKit, enemyKit),
    trading: trades,
    lanePlan: lanePlan(article, entry, player, enemy, playerKit, enemyKit),
    runes: runeChoice(article, entry, player, enemy, playerKit, enemyKit, runes),
    items: itemPlan(article, entry, player, enemy, playerKit, enemyKit),
    skillshots: direct
      ? {
        hit: [
          `${player.name}の${spellLabel(playerKit.poke)}は、${enemy.name}がCS、ワード、味方への追撃で足を止めた瞬間に合わせる。正面へ雑に撃つより、退路に置く方が当たりやすい。`,
          `${spellPair([playerKit.cc, playerKit.move, playerKit.protect])}は味方のCC、壁際、ブッシュからの視界差に合わせる。${enemy.name}の${spellLabel(enemyKit.move)}を見てから使うと、逃げ先を読みやすい。`,
          `${enemy.name}の${spellLabel(enemyKit.cc)}がクールダウン中なら、${spellLabel(playerKit.poke)}を当てた後に一歩だけ前へ出る。追いすぎると次の反撃が間に合う。`
        ],
        dodge: [
          `${enemy.name}の${spellLabel(enemyKit.cc)}を最優先で見る。前後ではなく横へずれ、当たらなかった時だけ${player.name}の反撃を考える。`,
          `${spellLabel(enemyKit.poke)}はミニオン、壁、狭い通路で避けにくくなる。射線が狭い場所に残らず、広い側へ歩いてから交換する。`,
          `低体力時は${enemy.name}の${spellAlternatives([enemyKit.r, enemyKit.move])}を避けても、次の通常攻撃や追撃で落ちることがある。避ける前に、そもそも射程へ入らない。`
        ]
      }
      : roamSkillshots(article, entry, player, enemy, playerKit, enemyKit),
    teamfights: teamfightPlan(article, entry, player, enemy, playerKit, enemyKit, direct),
    commonMistakes: commonMistakePlan(article, entry, player, enemy, playerKit, enemyKit, direct, enemyDamage)
  };
  return contextualizeContent(replacement, player, enemy);
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

const dryRun = hasFlag("--dry-run");
const date = argValue("--date", DEFAULT_DATE);
const rewriteDateFilter = argValue("--rewrite-date", "");
const onlyRewriteDate = hasFlag("--only-rewrite-date");
const queue = await readJson(QUEUE_PATH);
const store = await readArticleStore();
const reasonsById = new Map();
const targets = [];

for (const article of store.articles || []) {
  if (onlyRewriteDate && rewriteDateFilter && article.updatedAt !== rewriteDateFilter) continue;
  const reasons = targetReasons(article);
  if (reasons.length) {
    reasonsById.set(article.id, reasons);
    targets.push(article);
  }
}

const currentRunes = await loadJson(`${DDRAGON_ROOT}/cdn/${queue.patch}/data/ja_JP/runesReforged.json`);
const championData = await loadJson(`${DDRAGON_ROOT}/cdn/${queue.patch}/data/ja_JP/champion.json`);
const championById = new Map(Object.values(championData.data || {}).map((champion) => [champion.id, champion]));
const targetChampionIds = [...new Set(targets.flatMap((article) => [article.player, article.enemy]))];
const details = await mapLimit(targetChampionIds, 12, async (id) => {
  const detail = await loadJson(`${DDRAGON_ROOT}/cdn/${queue.patch}/data/ja_JP/champion/${id}.json`);
  return [id, detail.data[id]];
});
const detailById = new Map(details);
const queueById = new Map(queue.entries.map((entry) => [entry.id, entry]));
const nextArticles = [];
const reasonCounts = {};
let rewritten = 0;

for (const article of store.articles || []) {
  const reasons = reasonsById.get(article.id);
  if (!reasons) {
    nextArticles.push(article);
    continue;
  }
  for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  nextArticles.push(buildReplacement(article, queueById.get(article.id), championById, detailById, currentRunes, date));
  rewritten += 1;
}

console.log(JSON.stringify({
  dryRun,
  rewritten,
  reasonCounts,
  examples: targets.slice(0, 20).map((article) => ({ id: article.id, reasons: reasonsById.get(article.id) }))
}, null, 2));

if (!dryRun) {
  await writeShardedArticleStore({
    articles: nextArticles,
    patch: queue.patch,
    targetArticleCount: queue.targetArticleCount
  });
}
