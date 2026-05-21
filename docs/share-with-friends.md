# 友人にURLだけで共有する方法

このアプリは静的HTML/JSとして公開できます。友人はURLを開くだけで使えます。

## 何が最新化されるか

- チャンピオン、スキル、アイテム、ルーン、画像: 友人が開いた時にRiot Data Dragonから最新パッチを取得します。
- 手書き対面記事: `data/manual-matchups/index.json` と `data/manual-matchups/articles/` を更新してGitHubへpushした時に更新されます。

## GitHub Pagesで公開

1. GitHubに新しいリポジトリを作る。
2. このフォルダをリポジトリにpushする。
3. GitHubのリポジトリ画面で `Settings` -> `Pages` を開く。
4. `Source` を `GitHub Actions` にする。
5. `main` ブランチにpushすると、自動で公開される。

公開URLは通常この形です。

```text
https://<github-user>.github.io/<repo-name>/
```

## 共有しないもの

GitHub Pagesは `_site/` に作った公開用ファイルだけをアップロードします。公開する記事は `reviewed` のみです。現在は全29,412本を検証済みの `reviewed` として公開します。`work/`、`scripts/`、`prompts/`、巨大なローカル作業データは公開不要です。`.gitignore` に入っています。

## 更新方法

記事生成を進めた後:

```powershell
npm.cmd run validate:articles
npm.cmd run build:pages
git add index.html styles.css app.js data/manual-matchups data/manual-matchups.json docs .github package.json README.md scripts
git commit -m "Update matchup articles"
git push
```

push後、GitHub ActionsのPagesデプロイが完了すると友人のURLにも反映されます。

`data/manual-matchups.json` を巨大な単一JSONに戻してpushしないでください。GitHubの通常Git pushは100MB超のファイルで失敗し、ブラウザ起動時の全件読み込みも重くなります。
