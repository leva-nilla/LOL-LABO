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
  if (hasTag(champion, "Marksman") || hasTag(champion, "Mage") || hasTag(champion, "Support")) return "レンジ";
  return "メレー";
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

function enemyLaneText(entry) {
  return (entry.enemyLanes || []).length ? entry.enemyLanes.map(laneLabel).join("・") : "別レーン";
}

function enemyMapCue(article, entry, enemy, offset = 0) {
  return pick(article, [
    `${enemy.name}が${enemyLaneText(entry)}から消えた時間`,
    `${enemyLaneText(entry)}側のミアが遅れた場面`,
    `${enemy.name}の移動先がまだ確定していない時間`,
    `${enemyLaneText(entry)}から川へ寄れるタイミング`
  ], offset);
}

function spellDescription(spell) {
  return stripHtml(spell?.description || spell?.tooltip || "");
}

function chooseSpell(detail, keywords, fallbackIndex = 0) {
  const spells = detail?.spells || [];
  return spells.find((spell) => keywords.some((keyword) => spellDescription(spell).includes(keyword))) ||
    spells[fallbackIndex] ||
    spells[0] ||
    { name: "主力スキル", key: "Q" };
}

function spellAt(detail, index, fallback) {
  return detail?.spells?.[index] || { name: fallback, key: ["Q", "W", "E", "R"][index] || "Q" };
}

function uniqueSpellNames(...spells) {
  return [...new Set(spells.map((spell) => spell?.name).filter(Boolean))];
}

function spellPair(spells, fallback = "主力スキル") {
  const names = uniqueSpellNames(...spells);
  if (names.length >= 2) return `${names[0]}と${names[1]}`;
  return names[0] || fallback;
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
    protect: chooseSpell(detail, ["シールド", "回復", "耐久", "ダメージを軽減", "無敵"], 1)
  };
}

function runeTreeByName(runes, name) {
  return runes.find((tree) => tree.name === name) || runes[0];
}

function keystoneIn(tree, preferred) {
  const keystones = tree?.slots?.[0]?.runes || [];
  return preferred.map((name) => keystones.find((rune) => rune.name === name)).find(Boolean) || keystones[0] || { name: "征服者" };
}

function runeChoice(article, player, enemy, runes) {
  const playerType = archetype(player);
  const supportEnchanter = article.lane === "SUP" && hasTag(player, "Support") && rangeProfile(player) === "レンジ";
  let mainName = "栄華";
  let subName = "不滅";
  let preferred = ["征服者", "プレスアタック", "フリートフットワーク"];

  if (supportEnchanter) {
    mainName = "魔道";
    subName = "天啓";
    preferred = ["エアリー召喚", "秘儀の彗星", "フェイズラッシュ"];
  } else if (playerType === "メイジ") {
    mainName = "魔道";
    subName = "天啓";
    preferred = ["秘儀の彗星", "エアリー召喚", "フェイズラッシュ"];
  } else if (playerType === "アサシン") {
    mainName = "覇道";
    subName = "栄華";
    preferred = ["電撃", "魂の収穫", "ヘイルブレード"];
  } else if (playerType === "タンク" || article.lane === "SUP") {
    mainName = article.lane === "SUP" ? "天啓" : "不滅";
    subName = article.lane === "SUP" ? "不滅" : "天啓";
    preferred = article.lane === "SUP" ? ["グレイシャルオーグメント", "解放の魔導書", "ファーストストライク"] : ["アフターショック", "不死者の握撃", "ガーディアン"];
  }

  const mainTree = runeTreeByName(runes, mainName);
  const subTree = runeTreeByName(runes, subName);
  const keystone = keystoneIn(mainTree, preferred);
  const enemyDamage = damageProfile(enemy);

  return {
    keystone: keystone.name,
    mainPath: mainTree.name,
    mainWhy: `${player.name}は${laneLabel(article.lane)}で${keystone.name}を軸に、${enemy.name}の${enemyDamage}の圧が強くなる前に短い交換だけを選ぶ。主要スキルを外した後に残るより、次の波まで体力を守る方が勝ちやすい。`,
    subPath: subTree.name,
    subWhy: `${subTree.name}は${enemy.name}相手に足りなくなりやすいレーン維持、耐久、仕掛け直しを補うため。火力だけに寄せるより、失敗した交換を一度受けられる形を作る。`
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
    "押されているレーンの奥へ入る"
  ];
  const repeatedSkillName = /([ァ-ヶー・＝！!A-Za-z0-9/]{2,30})(?:と|や)\1(?=(?:が|を|に|で|へ|から|、|。))/g;

  const reasons = [];
  if (rewriteDate && article.updatedAt === rewriteDate) reasons.push("rewrite-date");
  if (intoIs.test(text) || (englishSentence.test(text) && obviousEnglish.test(text))) reasons.push("english-mixed");
  if (chars < 1800 || chars > 3300) reasons.push("length-outlier");
  const signatureHits = signatures.filter((signature) => text.includes(signature));
  if (signatureHits.length >= 2) reasons.push("template-signature");
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
  return [...new Set(reasons)];
}

function laneOpener(article, entry, player, enemy, playerKit, enemyKit) {
  const direct = (entry.enemyLanes || []).includes(article.lane);
  const playerType = archetype(player);
  const enemyType = archetype(enemy);
  const playerRange = rangeProfile(player);
  const enemyRange = rangeProfile(enemy);
  const style = pick(article, ["距離管理", "先手の交換", "ウェーブ位置", "視界の置き方", "主要スキルの温存"], 1);

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
  if (!direct) {
    return `${player.name}${laneLabel(article.lane)}は、正面の相手だけでなく${enemyLaneText(entry)}から来る${enemy.name}の圧を考えて立つ対面。${playerRange}の${playerType}として${playerKit.poke.name}で先に波を触り、${enemyKit.move.name}が見えない時間は川側に深く出ない。`;
  }
  if (playerRange === "レンジ" && enemyRange === "メレー") {
    return `${player.name}${laneLabel(article.lane)}は、${enemy.name}が${enemyKit.move.name}で届く前に${playerKit.poke.name}で削り、追撃距離を残さない対面。射程差は前に立つ権利じゃなくて、相手の入りを一歩遅らせるために使う。`;
  }
  if (playerRange === "メレー" && enemyRange === "レンジ") {
    return `${player.name}${laneLabel(article.lane)}は、${enemy.name}の${enemyKit.poke.name}に削られながら、${enemyKit.cc.name}が落ちた瞬間だけ${playerKit.move.name}で入る対面。体力を先に失うと、勝てる窓もただ眺めるだけになる。`;
  }
  return `${player.name}${laneLabel(article.lane)}対${enemy.name}は、${playerKit.poke.name}と${enemyKit.cc.name}の有無で交換が決まる対面。${playerType}対${enemyType}なので、長く殴るか短く切るかを波ごとに決める。`;
}

function tradeAdvice(article, player, enemy, playerKit, enemyKit) {
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
        `${playerKit.protect.name}を自分の軽い被弾に使いすぎない。${enemy.name}が見えた時に味方ADCへ回せるかが、この対面の差になる。`,
        `味方ADCがフラッシュなしなら、${playerKit.protect.name}は先出ししない。${enemy.name}の${enemyKit.cc.name}を受けた直後に使える形を残す。`,
        `体力が少し削れただけで下がりすぎると、ボットの波を失う。${playerKit.protect.name}を残したまま、味方ADCが触れるラインだけ守る。`
      ], 23)
    ],
    JG: [
      pick(article, [
        `キャンプを捨てて${enemy.name}を追うより、${enemyKit.cc.name}が使われるレーンに先回りする。${playerKit.poke.name}は相手が細い通路へ入る瞬間に合わせる。`,
        `${enemy.name}の姿が見えたからといって、すぐ反対側のキャンプを捨てない。味方レーンの体力と押し引きが揃う時だけ、${playerKit.cc.name}で受ける。`,
        `序盤の接触は倒し切りよりテンポ差を見る。${enemy.name}が${enemyKit.move.name}を使った後なら、${playerKit.poke.name}で削って中立へ戻る選択も強い。`
      ], 31),
      pick(article, [
        `川でぶつかる前に味方レーナーの最初の一歩を見る。${enemy.name}の${enemyKit.move.name}が残るなら、孤立した1対1を長くしない。`,
        `${enemy.name}と同じ川へ入る時は、先に近いレーンの主導権を確認する。寄りが遅い側で戦うと、スキルの当たり外れ以前に人数で負ける。`,
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
        `${enemy.name}が消えた時は、キャンプを一つ諦める前に味方へ危険ピンを出す。先に情報を渡せれば、カウンターガンクの形も作れる。`
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
        `レベル1から3は味方ADCの横に立ち、${playerKit.poke.name}で敵ボットの前歩きを止める。${enemy.name}が正面にいない対面でも、川側の情報がない時は浅い位置だけ触る。`,
        `序盤はブッシュの主導権より、味方ADCが最初の3ウェーブを落とさない距離を優先する。${playerKit.cc.name}を使うなら、敵ボットの反撃距離まで計算する。`,
        `レベル2先行を狙う時は、${playerKit.poke.name}をミニオンにも使ってテンポを取る。${enemy.name}の位置が消えたら、前のブッシュ保持より退路を残す。`
      ], 51),
      preSix: pick(article, [
        `6前は川の浅い視界だけで足りる場面を選ぶ。${enemy.name}がマップから消えた時は、味方ADCが下がれる線を先に作る。`,
        `6前のワード更新は、味方ADCが安全にCSを取れる波で行う。${enemy.name}のミアが出た直後に一人で歩くと、戻る時間が足りない。`,
        `${enemyMapCue(article, entry, enemy, 52)}は、レーン中央より後ろから受ける。深い確認へ行くなら、味方ジャングルかADCの寄りを待つ。`
      ], 52),
      postSix: pick(article, [
        `6以降は${enemy.name}のRや${enemyKit.cc.name}がボットへ届く前提で、${playerKit.protect.name}を味方ADC用に残す。軽いハラスより受けの一手を優先する。`,
        `Rが絡む時間は、先に当てるより外させた後の返しを見る。${playerKit.cc.name}を残していれば、${enemy.name}の入りを一度止められる。`,
        `ドラゴン前は味方ADCを置き去りにして視界を取りに行かない。${enemy.name}の${enemyKit.move.name}が見えた後で、${playerKit.protect.name}を合わせる。`
      ], 53),
      wave: pick(article, [
        `ボットの波は味方ADCが触れる位置を保つ。押し切る時は敵ジャングルと${enemy.name}の位置が見えてからで、暗い川へ単独で長く残らない。`,
        `押し込む波では先にワード、引く波では味方ADCの横を優先する。${enemy.name}が寄れる時にサポートだけ前へ出ると、2v2の形が崩れる。`,
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

function itemPlan(article, player, enemy, playerKit) {
  const type = archetype(player);
  const enemyDamage = damageProfile(enemy);
  const statText = {
    マークスマン: "攻撃力、攻撃速度、クリティカル、ライフスティール",
    メイジ: "魔力、マナ、スキルヘイスト、魔法防御貫通",
    アサシン: "バースト火力、貫通、スキルヘイスト、移動速度",
    タンク: "体力、物理防御、魔法防御、行動妨害耐性",
    サポート: "視界、スキルヘイスト、体力、回復やシールド強化",
    ファイター: "攻撃力、体力、スキルヘイスト、相手に合わせた防御",
    汎用: "火力、体力、防御、スキルヘイスト"
  }[type] || "火力、体力、防御、スキルヘイスト";

  const firstBuy = article.lane === "SUP"
    ? `${player.name}サポートは視界、体力、マナ回復を優先する。${enemy.name}の圧が見える前にワードを置ける状態を作り、単独で深い場所へ入らない。`
    : article.lane === "JG"
      ? `${player.name}ジャングルはクリア速度と体力維持を優先する。最初の帰還では${playerKit.poke.name}の回転に関わる素材を買い、無理な1対1用の高額品へ急がない。`
      : `最初の買い物は${statText}を軽く伸ばす素材から。${enemy.name}の${enemyDamage}がきついなら、完成火力より先に靴や耐久の小物を挟む。`;

  return {
    firstBuy,
    coreReason: `${player.name}は${type}なので、${playerKit.poke.name}を当てた後にもう一度動ける${statText}を中心にする。${enemy.name}相手では一発の派手な火力より、次の交換に残れる買い物が大事。`,
    defensive: `${enemy.name}は${enemyDamage}の圧がある。先に落ちるなら、火力完成品を急ぐ前に${enemyDamage === "魔法寄り" ? "魔法防御と体力" : enemyDamage === "物理寄り" ? "物理防御と体力" : "体力と両方の防御"}を挟む。生きていないとスキルも撃てない。`,
    situational: `${enemy.name}が回復、シールド、突入、ポークのどれで試合を動かしているかを見る。対回復、対シールド、移動速度、視界、耐久のうち、一番負け筋を減らすものを選ぶ。`,
    whenBehind: `負けている時は高額完成品に直行しない。${player.name}が次の${laneLabel(article.lane)}戦で最低限生きて${playerKit.poke.name}を使えるように、安い耐久、靴、視界、ウェーブ処理を優先する。`
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
  const trades = tradeAdvice(article, player, enemy, playerKit, enemyKit);
  const opener = laneOpener(article, entry, player, enemy, playerKit, enemyKit);
  const enemyDamage = damageProfile(enemy);
  const direct = (entry.enemyLanes || []).includes(article.lane);
  const enemyTools = spellPair([enemyKit.cc, enemyKit.move, enemyKit.poke]);
  const playerTools = spellPair([playerKit.poke, playerKit.cc, playerKit.move]);
  const keepSkillPurpose = article.lane === "SUP"
    ? "味方保護かカウンターエンゲージに残すこと"
    : article.lane === "JG"
      ? "カウンターガンクかオブジェクト前の反撃に残すこと"
      : "逃げと反撃のどちらにも使えるよう残すこと";

  return {
    id: article.id,
    status: article.status || "reviewed",
    updatedAt: date,
    player: article.player,
    enemy: article.enemy,
    lane: article.lane,
    summary: `${opener} ${player.name}側は${playerKit.poke.name}を当てる前に、${enemy.name}の${enemyTools}が残っているかを見る。`,
    winCondition: direct
      ? pick(article, [
        `勝ち筋は${enemy.name}の${enemyKit.cc.name}を空振りさせた直後に、${player.name}の${playerTools}で短く体力差を作ること。倒し切れない時は波を整えて、次の交換まで相手の強い時間をやり過ごす。`,
        `${enemy.name}の${enemyTools}が落ちた時間にだけ強く触る。${player.name}は${playerKit.poke.name}で先に体力を削り、長引きそうなら波を押して次のターンへ逃がす。`,
        `勝つ形は、${enemy.name}の入りを一度外させてから${player.name}の${playerTools}を重ねること。最初の交換で倒せないなら、追撃よりリコールと視界へ変える。`
      ], 61)
      : pick(article, [
        `勝ち筋は${enemy.name}が${enemyLaneText(entry)}から動く前に情報を取り、${player.name}の${playerKit.cc.name}を${keepSkillPurpose}。正面のキルだけでなく、視界、リコール、オブジェクト前の立ち位置で差を作る。`,
        `${enemyMapCue(article, entry, enemy, 62)}を先に拾い、${player.name}は${playerKit.poke.name}で波を整える。${playerKit.cc.name}を残せていれば、寄られても一度は下がれる。`,
        `この組み合わせは正面の殴り合いより、${enemy.name}の移動を早く見るほど楽になる。${player.name}側は体力差より先に、川の視界と帰る時間を確保する。`
      ], 62),
    threatModel: [
      pick(article, [
        `${enemy.name}の${enemyKit.cc.name}を受けると、${player.name}が${playerKit.poke.name}で返す前に位置を固定されやすい。相手の射程や移動先を見てから前に出る。`,
        `${enemy.name}の${enemyTools}が残る時は、先に歩いた側が損をしやすい。${player.name}はミニオンの横から触って、直線で受けない。`,
        `${enemy.name}に先手を渡すと、${player.name}の${playerKit.cc.name}を反撃ではなく逃げに使わされる。仕掛ける前に相手の一手を吐かせる。`
      ], 63),
      pick(article, [
        `${enemy.name}は${enemyDamage}の${archetype(enemy)}。${enemyKit.poke.name}を続けて受けると、次の波でCSを取るだけでも危険になる。`,
        `${enemy.name}の火力は${enemyDamage}に寄る。防御を後回しにすると、${player.name}がスキルを返す前に体力だけ削られる。`,
        `${enemyKit.poke.name}を複数回受ける展開は避けたい。${player.name}側は一度下がってでも、次のミニオン波で仕切り直す方が安い。`
      ], 64),
      direct
        ? pick(article, [
          `${laneLabel(article.lane)}の直接対面ではミニオン数が多い側が強い。${enemy.name}本体だけ見て追うと、ミニオンと${enemyKit.cc.name}で交換が崩れる。`,
          `直接対面では、敵ミニオンが多い時の追撃が一番安い負け方。${enemy.name}を削っても、波が悪いならそこで止める。`,
          `${enemy.name}が下がった後も、ミニオンが残っているなら深追いしない。${player.name}は次のラストヒットを取れる位置で十分。`
        ], 65)
        : pick(article, [
          `${enemy.name}は${enemyLaneText(entry)}から現れる想定。マップに映っていない時は、勝っている場面でも川の奥へ深く入らない。`,
          `${enemyMapCue(article, entry, enemy, 66)}は、勝っているレーンでも前に出る理由にならない。先に浅い視界を置き、味方と同じ画面で動く。`,
          `${enemy.name}が見えていない時間は、CSを一つ落としても立ち位置を浅くする。捕まると、正面の有利まで一緒に消える。`
        ], 66)
    ],
    trading: trades,
    lanePlan: lanePlan(article, entry, player, enemy, playerKit, enemyKit),
    runes: runeChoice(article, player, enemy, runes),
    items: itemPlan(article, player, enemy, playerKit),
    skillshots: {
      hit: [
        `${player.name}の${playerKit.poke.name}は、${enemy.name}がCS、ワード、味方への追撃で足を止めた瞬間に合わせる。正面から何となく撃つより、退路に置く方が当たりやすい。`,
        `${spellPair([playerKit.cc, playerKit.move, playerKit.protect])}は味方のCC、壁際、ブッシュからの視界差に合わせる。${enemy.name}の${enemyKit.move.name}を見てから使うと、逃げ先を読みやすい。`,
        `${enemy.name}の${enemyKit.cc.name}がクールダウン中なら、${playerKit.poke.name}を当てた後に一歩だけ前へ出る。追いすぎると次の反撃が間に合う。`
      ],
      dodge: [
        `${enemy.name}の${enemyKit.cc.name}を最優先で見る。前後ではなく横へずれ、当たらなかった時だけ${player.name}の反撃を考える。`,
        `${enemyKit.poke.name}はミニオン、壁、狭い通路で避けにくくなる。射線が狭い場所に残らず、広い側へ歩いてから交換する。`,
        `低体力時は${enemy.name}のRや${enemyKit.move.name}を避けても、次の通常攻撃や追撃で落ちることがある。避ける前に、そもそも射程へ入らない。`
      ]
    },
    teamfights: [
      pick(article, [
        `${player.name}は最初に${enemy.name}へ突っ込むより、${enemy.name}が通る狭い場所へ${playerKit.cc.name}を残す。味方の後衛が安全なら、それだけで仕事になる。`,
        `${player.name}は集団戦の最初から全部を使わない。${enemy.name}が前へ出た瞬間に${playerKit.cc.name}を合わせると、味方の火力が置きやすい。`,
        `${enemy.name}が横から入る構図では、${player.name}は後衛の近くで待つ。先に${playerKit.poke.name}だけ当てて、相手の入り直しを遅らせる。`
      ], 81),
      pick(article, [
        `${enemy.name}の${enemyKit.cc.name}が見えたら、近い味方を守るか、外れた瞬間に${playerKit.poke.name}で反撃する。後衛だけを追うと足元が崩れる。`,
        `${enemy.name}の${enemyTools}が残る間は、後衛を置いて前へ走らない。外れた一瞬だけ、${player.name}の射程に入った相手を触る。`,
        `味方が捕まりそうな時は、キル回収より${playerKit.protect.name}とサモナースペルの交換を見る。${enemy.name}を倒せなくても、主力を守れば次を戦える。`
      ], 82),
      pick(article, [
        `オブジェクト前は視界を先に置き、${enemy.name}が暗い場所から入る角度を減らす。見えている相手なら、${playerKit.protect.name}やサモナースペルを合わせやすい。`,
        `ドラゴンやバロン前は、視界の深さより味方と同時に触れる場所を選ぶ。${enemy.name}が見えた後に${playerKit.cc.name}を置ける距離が目安。`,
        `狭い通路で始まる戦闘は、${enemy.name}の${enemyKit.cc.name}を先に見たい。${player.name}は壁際を避け、味方の後ろから反撃を重ねる。`
      ], 83)
    ],
    commonMistakes: [
      pick(article, [
        `${enemy.name}の${enemyKit.cc.name}が残っているのに、${player.name}の${playerKit.poke.name}だけを理由に前へ出ること。外した瞬間に交換が終わる。`,
        `${player.name}の当てたいスキルだけを見て、${enemy.name}の返しを数えないこと。${enemyTools}が残るなら、先に外させる時間が必要。`,
        `体力差が少しあるだけで追撃を伸ばすこと。${enemy.name}の${enemyKit.cc.name}が戻る前に切らないと、勝った交換がそのままデスになる。`
      ], 91),
      pick(article, [
        `負けているのに火力だけを買うこと。${enemy.name}の${enemyDamage}を一回耐えられないなら、次のスキルを撃つ時間もない。`,
        `不利なのに完成品だけを急ぐこと。${enemy.name}の${enemyDamage}を受ける試合なら、靴や耐久の小物で次の一回を生きる方が価値がある。`,
        `ビルドを勝っている時と同じにすること。${enemy.name}に先に触られるなら、${player.name}は火力より生存時間を買う必要がある。`
      ], 92),
      direct
        ? pick(article, [
          `ウェーブを見ずに${enemy.name}本体だけを追うこと。ミニオンが多い場所で勝とうとすると、体力が先に消える。`,
          `${enemy.name}が下がった瞬間に、敵ミニオンの中まで歩くこと。追うより波を押して、次のリコールを作る方が安定する。`,
          `相手本体の体力だけで判断すること。ミニオン数、スキルの戻り、味方の寄りが悪いなら、${player.name}はそこで止まる。`
        ], 93)
        : pick(article, [
          `${enemy.name}が見えていない時間に、深い視界を一人で更新しに行くこと。味方から離れすぎると、対面以前に捕まる。`,
          `${enemyMapCue(article, entry, enemy, 94)}に、前のめりなワード更新を重ねること。浅く置いて下がるだけで十分な場面も多い。`,
          `正面で勝っているからといって、川の暗い側まで一人で広げること。${enemy.name}が寄るだけで、作った有利が消える。`
        ], 94)
    ]
  };
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
const queue = await readJson(QUEUE_PATH);
const store = await readArticleStore();
const reasonsById = new Map();
const targets = [];

for (const article of store.articles || []) {
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
