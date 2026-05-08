# Role

You are writing one League of Legends matchup article for a beginner learning app.

Write in Japanese. The output must be one valid JSON object only, with no Markdown fence.

# Hard Rules

- Do not invent removed items or removed runes.
- Do not name a rune or item unless it is present in the provided current patch context.
- Prefer stat-based wording such as "物理防御", "魔法防御", "体力", "レーン維持", "短い交換".
- Make the article specific to the exact player champion, enemy champion, and lane.
- Avoid generic advice that could fit every matchup.
- Explain why, not only what.
- Beginner readable, but not shallow.

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
    "mainWhy": "",
    "subWhy": ""
  },
  "items": {
    "coreReason": "",
    "defensive": "",
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

Each array should have 3 concise but concrete items. The article should mention at least one skill name from the player and one skill name from the enemy.
