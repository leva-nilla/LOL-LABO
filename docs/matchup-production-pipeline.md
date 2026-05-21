# Matchup Production Pipeline

This pipeline maintains the sharded matchup article store for 29,412 reviewed matchup articles. The small `data/manual-matchups.json` file points to `data/manual-matchups/index.json`; article bodies live under `data/manual-matchups/articles/`.

## Commands

Generate the full queue:

```powershell
npm.cmd run queue
```

Validate current articles:

```powershell
npm.cmd run validate:articles
```

Check progress:

```powershell
npm.cmd run status
```

Fill missing draft articles and write the sharded store:

```powershell
npm.cmd run fill:drafts
npm.cmd run repair:articles
```

Prepare the next 10 writer prompts without calling any AI CLI:

```powershell
npm.cmd run batch:dry
```

The dry run writes prompts to:

```text
work/matchup-production/
```

## CLI Commands

Defaults:

```text
Codex: npx.cmd -y @openai/codex exec --skip-git-repo-check --sandbox read-only --output-schema schemas/matchup-article.schema.json
Gemini: npx.cmd -y @google/gemini-cli
```

Override them when needed:

```powershell
$env:CODEX_CLI_CMD = "npx.cmd -y @openai/codex exec --skip-git-repo-check --sandbox read-only --output-schema schemas/matchup-article.schema.json"
$env:GEMINI_CLI_CMD = "npx.cmd -y @google/gemini-cli"
```

## Execution Mode

The orchestrator supports `--execute`, but keep the first real run tiny:

```powershell
node scripts/produce-matchup-batch.mjs --limit 1 --execute
```

Expected loop:

1. Codex CLI writes one article JSON object.
2. Gemini CLI reviews it with a short `--prompt` and the article/review context on stdin.
3. A human or a later fixer step applies required changes.
4. Merge generated outputs into the sharded article store.
5. `validate-matchup-articles.mjs` gates the merged article database.

Merge outputs into the sharded store:

```powershell
npm.cmd run merge:dry
npm.cmd run merge
npm.cmd run validate:articles
```

Do not run all 29,412 in one batch until JSON parsing, review quality, rate limits, and costs are understood.

Run resumable batches:

```powershell
npm.cmd run produce:loop -- --batch-size 25 --max-batches 1
```

To continue, run the same command again. The writer skips existing article outputs, and merge skips already-written article IDs unless `--replace` is used.

## Patch Safety

Manual articles should avoid hard-coding item/rune names. The app already shows live item/rune candidates from Data Dragon. Articles should discuss item/rune logic rather than fixed names unless verified for the current patch.
