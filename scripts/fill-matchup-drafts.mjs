import { readArticleStore, readJson, writeShardedArticleStore } from "./matchup-article-store.mjs";

const QUEUE_PATH = "data/matchup-queue.json";
const DDRAGON_ROOT = "https://ddragon.leagueoflegends.com";

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

function tagsOf(champion) {
  return champion?.tags || [];
}

function hasTag(champion, tag) {
  return tagsOf(champion).includes(tag);
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

function rangeProfile(champion) {
  if (hasTag(champion, "Marksman") || hasTag(champion, "Mage") || hasTag(champion, "Support")) return "レンジ";
  return "メレー";
}

function damageProfile(champion) {
  const info = champion?.info || {};
  if (Number(info.magic || 0) >= Number(info.attack || 0) + 2) return "AP寄り";
  if (Number(info.attack || 0) >= Number(info.magic || 0) + 2) return "AD寄り";
  return "ハイブリッド寄り";
}

function spellText(spell) {
  return stripHtml(spell?.description || spell?.tooltip || "").slice(0, 180);
}

function chooseSpell(detail, keywords) {
  const spells = detail?.spells || [];
  return spells.find((spell) => keywords.some((keyword) => spellText(spell).includes(keyword))) || spells[0] || { name: "主力スキル" };
}

function threatSpell(detail) {
  return chooseSpell(detail, ["スタン", "スネア", "ノック", "打ち上げ", "チャーム", "フィアー", "サイレンス", "スロウ", "移動不可", "引き寄せ", "ダッシュ", "ブリンク"]);
}

function pokeSpell(detail) {
  return chooseSpell(detail, ["魔法ダメージ", "物理ダメージ", "発射", "指定方向", "範囲", "爆発", "敵に命中", "ダメージを与え"]);
}

function laneLabel(lane) {
  return ({ TOP: "トップ", JG: "ジャングル", MID: "ミッド", ADC: "ADC", SUP: "サポート", ALL: "全レーン" })[lane] || lane;
}

function enemyLaneText(entry) {
  const lanes = entry.enemyLanes || [];
  return lanes.length ? lanes.map(laneLabel).join(" / ") : "別レーン";
}

function frameText(entry, player, enemy) {
  const direct = (entry.enemyLanes || []).includes(entry.lane);
  if (entry.lane === "JG") {
    return direct
      ? `${player.name}JG対${enemy.name}JGは、川とキャンプ順で先に動ける形を作る記事。`
      : `${player.name}JG側は、${enemy.name}を直接倒すより、${enemyLaneText(entry)}付近の視界と寄りで相手の合流を遅らせる記事。`;
  }
  if (entry.lane === "SUP" && !direct) {
    return `${player.name}SUP対${enemy.name}は、2v2の足元を崩さず、${enemyLaneText(entry)}から来る${enemy.name}の合流やテレポート後の入り方を視界で遅らせる記事。`;
  }
  if (!direct) {
    return `${player.name}${entry.lane}対${enemy.name}は、正面の殴り合いより${enemyLaneText(entry)}から来る圧を管理する記事。`;
  }
  return `${player.name}${entry.lane}対${enemy.name}${entry.lane}は、体力交換と主力スキルの有無を丁寧に見る記事。`;
}

function tradeWindow(player, enemy, playerDetail, enemyDetail) {
  const playerRange = rangeProfile(player);
  const enemyRange = rangeProfile(enemy);
  const ps = pokeSpell(playerDetail)?.name || "主力スキル";
  const es = threatSpell(enemyDetail)?.name || "重要スキル";
  if (playerRange === "レンジ" && enemyRange === "メレー") return `${ps}と通常攻撃で先に触り、${enemy.name}の「${es}」が届く前に一歩下がる。追撃すると射程差の価値が消える。`;
  if (playerRange === "メレー" && enemyRange === "レンジ") return `序盤は体力を守り、${enemy.name}の「${es}」が空振りした直後だけ${ps}で入る。削られてから走るのは遅い。`;
  return `${player.name}の「${ps}」を先に当てた時だけ短く交換する。${enemy.name}の「${es}」が残っているなら、長く立ち止まらない。`;
}

const runeProfiles = {
  マークスマン: { main: 8000, sub: 8300, preferred: ["プレスアタック", "フリートフットワーク", "リーサルテンポ"] },
  アサシン: { main: 8100, sub: 8000, preferred: ["電撃", "魂の収穫", "ヘイルブレード"] },
  メイジ: { main: 8200, sub: 8300, preferred: ["秘儀の彗星", "エアリー召喚", "フェイズラッシュ"] },
  タンク: { main: 8400, sub: 8300, preferred: ["不死者の握撃", "アフターショック", "ガーディアン"] },
  サポート: { main: 8300, sub: 8400, preferred: ["グレイシャルオーグメント", "解放の魔導書", "ファーストストライク"] },
  ファイター: { main: 8000, sub: 8400, preferred: ["征服者", "プレスアタック", "フリートフットワーク"] },
  汎用: { main: 8000, sub: 8400, preferred: ["征服者", "プレスアタック", "フリートフットワーク"] }
};

function runeChoice(champion, enemy, runesById) {
  const type = archetype(champion);
  const profile = runeProfiles[type] || runeProfiles.汎用;
  const mainTree = runesById.get(profile.main) || [...runesById.values()][0];
  const subTree = runesById.get(profile.sub) || [...runesById.values()].find((tree) => tree.id !== mainTree.id) || mainTree;
  const keystones = mainTree?.slots?.[0]?.runes || [];
  const keystone = profile.preferred.map((name) => keystones.find((rune) => rune.name === name)).find(Boolean) || keystones[0] || { name: "征服者" };
  const enemyDamage = damageProfile(enemy);
  return {
    keystone: keystone.name,
    mainPath: mainTree.name,
    mainWhy: `${champion.name}は${type}なので、${mainTree.name}で戦闘の形を作る。${enemy.name}の${enemyDamage}を受ける前に、${keystone.name}を活かせる交換だけ選ぶ。`,
    subPath: subTree.name,
    subWhy: `${subTree.name}は${enemy.name}相手に不足しやすい耐久、移動、レーン維持を補うため。火力だけに寄せると、最初の失敗を戻しにくい。`
  };
}

function itemPlan(champion, enemy, entry, playerDetail) {
  const type = archetype(champion);
  const spell = pokeSpell(playerDetail)?.name || "主力スキル";
  const enemyDamage = damageProfile(enemy);
  const stats = {
    マークスマン: "攻撃力、攻撃速度、クリティカル、ライフスティール",
    メイジ: "魔力、マナ、スキルヘイスト、魔法防御貫通",
    アサシン: "攻撃力または魔力、貫通、スキルヘイスト、移動速度",
    タンク: "体力、物理防御、魔法防御、行動妨害耐性",
    サポート: "サポート収入、視界、スキルヘイスト、体力または回復/シールド強化",
    ファイター: "攻撃力、体力、スキルヘイスト、相手に合わせた防御",
    汎用: "火力、体力、防御、スキルヘイスト"
  };
  const firstBuy = entry.lane === "SUP"
    ? `${champion.name}SUPは開始からサポート収入と視界を優先。最初の帰還では体力、マナ回復、スキルヘイストを見て、${enemy.name}に捕まる前にワードを置ける状態を作る。`
    : entry.lane === "JG"
      ? `${champion.name}JGはジャングル初期装備と回復を安定させる。最初の帰還ではクリア速度と${spell}の回転に関わる素材を優先し、無理な1v1用の高額品へ急がない。`
      : `最初の買い物は${champion.name}の${type}として必要な${stats[type] || stats.汎用}を軽く伸ばす素材から。${enemy.name}の圧が強い時は防御寄りの小物を混ぜる。`;
  return {
    firstBuy,
    coreReason: `${champion.name}は${type}なので、${spell}を当てた後に勝てる${stats[type] || stats.汎用}を中心にする。${enemy.name}相手では一回の派手な火力より、次の交換に残れる買い物が大事。`,
    defensive: `${enemy.name}は${enemyDamage}。先に落ちるなら、完成火力を急ぐ前に${enemyDamage === "AP寄り" ? "魔法防御と体力" : enemyDamage === "AD寄り" ? "物理防御と体力" : "体力と両方の防御"}を挟む。死んだらDPSも視界もない。`,
    situational: `${enemy.name}が回復、シールド、強い突入で試合を動かす時は、対回復、対シールド、移動速度、視界確保のどれが必要かを先に決める。名前より目的で買う。`,
    whenBehind: `負けている時は高額完成品に直行しない。${champion.name}が次の${laneLabel(entry.lane)}戦で最低限生きて${spell}を使えるように、安い耐久、靴、視界、ウェーブ処理を優先する。`
  };
}

function lanePlan(entry, player, enemy, playerDetail, enemyDetail) {
  const ps = pokeSpell(playerDetail)?.name || "主力スキル";
  const pt = threatSpell(playerDetail)?.name || ps;
  const es = threatSpell(enemyDetail)?.name || "重要スキル";
  const ep = pokeSpell(enemyDetail)?.name || es;
  const direct = (entry.enemyLanes || []).includes(entry.lane);
  if (entry.lane === "JG") {
    return {
      levels1to3: `${player.name}は最初の3レベルでクリアを崩さず、${pt}を使える状態で川に出る。${enemy.name}の${es}が早い介入に向くなら、味方が押される側へ先に寄る。`,
      preSix: `6前はキャンプ差より、${enemy.name}が見えない時間を短くすること。${ep}を受ける角度の川には一人で入らず、ピンとワードで味方を動かす。`,
      postSix: `6以降は${player.name}のRと${enemy.name}のRの先出し価値を比べる。敵が先に見えたら逆側の中立かカウンターガンクへ寄せ、同じ場所で遅れて始めない。`,
      wave: `味方レーンが先に押せる側でだけ長く戦う。押されているレーンの奥へ入ると、${enemy.name}より先に相手レーナーへ捕まる。`,
      recall: `リコールは大きい中立前に済ませる。体力が低いまま${enemy.name}のいる川へ戻ると、視界を置く前に仕事が終わる。`
    };
  }
  if (!direct) {
    if (entry.lane === "SUP") {
      return {
        levels1to3: `${player.name}SUPはまず味方ADCの横ラインを崩さず、敵ボット側のCCとダメージ交換を見る。${enemy.name}は正面対面ではないので、序盤から相手トップ側の話に寄せすぎない。`,
        preSix: `6前は川とトライブッシュの視界を切らさない。${enemy.name}がマップから消えた時は、深いワードより味方ADCが安全に下がれる位置を優先する。`,
        postSix: `6以降は${enemy.name}のRや${es}が集団戦へ混ざる前に、ピンとワードで入口を見せる。${player.name}の${pt}は味方ADCを守るために残す。`,
        wave: `ボットのウェーブは味方ADCが触れる位置を保つ。押し切る時は敵JGと${enemy.name}の位置が見えてからで、暗い川へ一人で入りすぎない。`,
        recall: `リコールはサポートアイテムのワード補充とドラゴン前に合わせる。低体力のまま居座ると、${enemy.name}本体より先にボット2v2で捕まる。`
      };
    }
    return {
      levels1to3: `${player.name}${entry.lane}は序盤、正面のCSや2v2を崩さず、${enemy.name}が${enemyLaneText(entry)}から来る前提で浅く立つ。${ps}を使い切った後に前へ残らない。`,
      preSix: `6前は${enemy.name}の${es}が見えていない時ほど押しすぎない。川側の視界がないなら、ウェーブを早く処理して中央か自陣側へ戻る。`,
      postSix: `6以降は${enemy.name}のRや${es}込みの介入を先に考える。${player.name}の${pt}は攻め切り用より、入られた瞬間の拒否に残す方が安定。`,
      wave: `ウェーブは無理に奥で止めず、自陣寄りから押し返せる形にする。${enemy.name}がマップに映った時だけ強く押して、視界かリコールへ変換する。`,
      recall: `低体力で居座ると${enemy.name}の寄りに合わせて回収される。大砲ウェーブか押し付け後に帰り、次の視界更新に間に合わせる。`
    };
  }
  return {
    levels1to3: `${player.name}は1から3で${ps}を雑に撃ち切らず、${enemy.name}の${es}を見てから短く返す。ミニオン数が負けている時は交換しない。`,
    preSix: `6前は${enemy.name}の${ep}を避けた直後が前に出る時間。${player.name}の${pt}を当てても、敵ミニオンが多いなら一発で切り上げる。`,
    postSix: `6以降は互いのRの有無でレーンが変わる。${enemy.name}の仕掛けが残る時は浅く、外した後だけ${player.name}のRや${pt}で主導権を取りに行く。`,
    wave: `基本は自陣寄りで薄く受け、${enemy.name}の主要スキルが落ちた波だけ押す。有利時は押し付けてワード、リコール、ロームに変える。`,
    recall: `体力が半分以下、フラッシュなし、${enemy.name}の${es}が残っている時は欲張らず帰る。少しのCSより次のデス回避の方が高い。`
  };
}

function buildArticle(entry, championById, detailById, runesById) {
  const player = championById.get(entry.player);
  const enemy = championById.get(entry.enemy);
  const playerDetail = detailById.get(entry.player);
  const enemyDetail = detailById.get(entry.enemy);
  const ps = pokeSpell(playerDetail)?.name || "主力スキル";
  const pt = threatSpell(playerDetail)?.name || ps;
  const es = threatSpell(enemyDetail)?.name || "重要スキル";
  const ep = pokeSpell(enemyDetail)?.name || es;
  const playerType = archetype(player);
  const enemyType = archetype(enemy);
  const direct = (entry.enemyLanes || []).includes(entry.lane);
  const trade = tradeWindow(player, enemy, playerDetail, enemyDetail);
  const winTarget = direct
    ? `${enemy.name}の${es}を外させた直後に${player.name}の${pt}か${ps}で短く勝つこと`
    : entry.lane === "SUP"
      ? `味方ADCを守りながら、${enemy.name}がボット側へ合流する入口を先に見せること`
      : `${enemy.name}の寄り道や集団戦の入口を視界で先に見て、${player.name}の${pt}を拒否か反撃に残すこと`;
  const hitSetup = entry.lane === "JG"
    ? `${player.name}の「${ps}」は${enemy.name}が川入口、ワード確認、味方レーンへの寄りで進路を固定した瞬間に撃つ。キャンプ中の無理な追撃より、入口で待つ方が当たりやすい。`
    : entry.lane === "SUP"
      ? `${player.name}の「${ps}」は敵ボットがCS、ワード、味方ADCへの追撃で足を止める瞬間に撃つ。${enemy.name}本人だけを追う記事ではない。`
      : `${player.name}の「${ps}」は${enemy.name}がCS、ワード、入口確認で足を止める瞬間に撃つ。何もない正面から撃つと横歩きで避けられる。`;
  const mistakeThree = direct
    ? `ウェーブを見ずに${enemy.name}本体だけを追うこと。ミニオンが多い場所で勝とうとすると、画面が灰色になる。`
    : entry.lane === "JG"
      ? `${enemy.name}が見えていない時間に、深い川や敵ジャングルへ一人で入ること。合流される前提で動かないなら、先に捕まる。`
      : `${enemy.name}が見えていない時間に、奥の視界へ一人で歩くこと。味方ADCから離れすぎると、ボット2v2の仕事も消える。`;
  return {
    id: entry.id,
    status: "draft",
    updatedAt: new Date().toISOString().slice(0, 10),
    player: entry.player,
    enemy: entry.enemy,
    lane: entry.lane,
    summary: `${frameText(entry, player, enemy)} ${player.name}は${playerType}、${enemy.name}は${enemyType}で${damageProfile(enemy)}。${ps}で先に形を作り、${enemy.name}の「${es}」が残る時間は深追いしない。`,
    winCondition: `勝ち筋は${winTarget}。${trade} ${laneLabel(entry.lane)}では派手なキルより、体力差、視界、リコール差を積む方が安定する。`,
    threatModel: [
      `${enemy.name}の「${es}」を受けると、${player.name}の${ps}で返す前に位置を固定されやすい。これが見えるまで前進を一段浅くする。`,
      `${enemy.name}は${damageProfile(enemy)}の${enemyType}。一度育つと${ep}から短時間で体力を削るので、防御を後回しにしすぎない。`,
      direct ? `${entry.lane}の直接対面ではミニオン数が多い側が強い。${enemy.name}だけ見て前に出ると、ミニオンと${es}で交換が壊れる。` : `${enemy.name}は${enemyLaneText(entry)}から現れる想定。マップに映っていない時は、勝っているレーンでも奥まで追わない。`
    ],
    trading: [
      trade,
      `${enemy.name}の「${es}」が落ちた直後だけ、${player.name}の「${ps}」から通常攻撃か味方の追撃につなげる。外したらすぐ下がる。`,
      `${player.name}の「${pt}」は先撃ちで当てるより、${enemy.name}が${ep}で動きを固定した瞬間に合わせる。焦るほど安い。`
    ],
    lanePlan: lanePlan(entry, player, enemy, playerDetail, enemyDetail),
    runes: runeChoice(player, enemy, runesById),
    items: itemPlan(player, enemy, entry, playerDetail),
    skillshots: {
      hit: [
        hitSetup,
        `${player.name}の「${pt}」は味方CC、壁際、ブッシュからの視界差に合わせる。${enemy.name}の移動先を先に置く感覚でいい。`,
        `${enemy.name}の「${es}」がクールダウン中なら、${ps}を当てた後に一歩だけ前へ出る。追いすぎると次の反撃が間に合う。`
      ],
      dodge: [
        `${enemy.name}の「${es}」を最優先で見る。前後ではなく横へずれ、当たらなかった時だけ${player.name}の反撃を考える。`,
        `${enemy.name}の「${ep}」はミニオンや壁際で避けにくくなる。射線が狭い場所に残らず、広い側へ歩いてから交換する。`,
        `低体力時は${enemy.name}のRや${es}を避けても次の通常攻撃で落ちることがある。避ける前に、そもそも射程へ入らない。`
      ]
    },
    teamfights: [
      `${player.name}は最初に${enemy.name}へ突っ込むより、${enemy.name}が入る入口へ${pt}を残す。味方の後衛が安全ならそれで仕事になる。`,
      `${enemy.name}の「${es}」が見えたら、近い味方を守るか、外れた瞬間に${ps}で反撃する。後衛だけを追うと足元が崩れる。`,
      `オブジェクト前は視界を先に置き、${enemy.name}が暗い場所から入る角度を減らす。見えている敵はまだまし、見えない敵が面倒。`
    ],
    commonMistakes: [
      `${enemy.name}の「${es}」が残っているのに、${player.name}の${ps}だけを理由に前へ出ること。外した瞬間に交換が終わる。`,
      `負けているのに火力だけを買うこと。${enemy.name}の${damageProfile(enemy)}を一回耐えられないなら、次のスキルを撃つ時間もない。`,
      mistakeThree
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

const targetArg = Number(argValue("--target", "0"));
const queue = await readJson(QUEUE_PATH);
const store = await readArticleStore();
const target = targetArg || queue.targetArticleCount;
const existing = store.articles || [];
const written = new Set(existing.map((article) => article.id));
const toAdd = queue.entries.filter((entry) => !written.has(entry.id)).slice(0, Math.max(0, target - existing.length));

if (!toAdd.length) {
  const index = await writeShardedArticleStore({
    articles: existing,
    patch: queue.patch,
    targetArticleCount: queue.targetArticleCount
  });
  console.log(`no drafts added; wrote sharded store with ${index.articleCount} article(s)`);
  process.exit(0);
}

const championData = await loadJson(`${DDRAGON_ROOT}/cdn/${queue.patch}/data/ja_JP/champion.json`);
const runeData = await loadJson(`${DDRAGON_ROOT}/cdn/${queue.patch}/data/ja_JP/runesReforged.json`);
const championById = new Map(Object.values(championData.data || {}).map((champion) => [champion.id, champion]));
const runesById = new Map(runeData.map((tree) => [tree.id, tree]));
const ids = [...new Set(toAdd.flatMap((entry) => [entry.player, entry.enemy]))];
const detailPairs = await mapLimit(ids, 16, async (id) => {
  const detail = await loadJson(`${DDRAGON_ROOT}/cdn/${queue.patch}/data/ja_JP/champion/${id}.json`);
  return [id, detail.data[id]];
});
const detailById = new Map(detailPairs);
const nextArticles = [...existing, ...toAdd.map((entry) => buildArticle(entry, championById, detailById, runesById))];
const index = await writeShardedArticleStore({
  articles: nextArticles,
  patch: queue.patch,
  targetArticleCount: queue.targetArticleCount
});

console.log(`added ${toAdd.length} draft article(s)`);
console.log(`written ${index.articleCount}/${index.targetArticleCount}, reviewed ${index.reviewed}, draft ${index.draft}`);
