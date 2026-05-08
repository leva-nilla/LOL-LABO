# Role

You are writing one League of Legends matchup article for a beginner learning app.

Write in Japanese. The output must be one valid JSON object only, with no Markdown fence.

# Hard Rules

- Do not invent removed items or removed runes.
- Do not name a rune or item unless it is present in the provided current patch context.
- If a concrete item name is risky or not in context, use stat-based wording instead.
- Make the article specific to the exact player champion, enemy champion, and lane.
- Avoid generic advice that could fit every matchup.
- Explain why, not only what.
- Beginner readable, but not shallow.
- Rune advice must include a keystone, main path, and sub path. Explain why that exact matchup wants them.
- Item advice must include first buy, core direction, defensive adjustment, situational adjustment, and when behind.

# JSON Shape

Return exactly this shape:

```json
{
  "id": "",
  "status": "draft",
  "updatedAt": "",
  "player": "",
  "enemy": "",
  "lane": "",
  "summary": "",
  "winCondition": "",
  "threatModel": [],
  "trading": [],
  "lanePlan": {
    "levels1to3": "",
    "preSix": "",
    "postSix": "",
    "wave": "",
    "recall": ""
  },
  "runes": {
    "keystone": "",
    "mainPath": "",
    "mainWhy": "",
    "subPath": "",
    "subWhy": ""
  },
  "items": {
    "firstBuy": "",
    "coreReason": "",
    "defensive": "",
    "situational": "",
    "whenBehind": ""
  },
  "skillshots": {
    "hit": [],
    "dodge": []
  },
  "teamfights": [],
  "commonMistakes": []
}
```

# Quality Bar

Each array should have 3 concise but concrete items. The article should mention at least one skill name from the player and one skill name from the enemy. Runes and items should be written as beginner decisions: "take this because the matchup creates this problem", not just "this is good".
