# CLAUDE.md

## 發版（release PR → Dokploy）

**一般 PR merge 進 `main` 不會部署，merge release PR 才會**——也就是改了 `package.json#version` 的 PR。
那次 push 時 `.github/workflows/release.yml` 看到版號 X.Y.Z 還沒有 `vX.Y.Z` tag，就跑測試、build image
（tag `:X.Y.Z`、`:X.Y`、`:latest`、`:<sha>`，推到 ghcr）、打 Dokploy webhook，成功後才在該 commit 打上
`vX.Y.Z` 當作「已上線」的紀錄。版號已經有 tag 的 push（例如只改了 dependencies）會被跳過。部署失敗就修好原因、
手動重跑 workflow（`workflow_dispatch`）；因為還沒打 tag，會再試一次。不要手動推 `v*` tag。

deploy job 跑在 GitHub Environment **`production`**：要審核者（目前是 @noracami）在 Actions run 裡核准才會執行，
而且只有 main 能部署。`DOKPLOY_WEBHOOK` 是這個 environment 的 secret，不是 repo 的，其他 workflow 讀不到。

**什麼時候該提議發版（agent）**——只提議，不要自己動手：

- 剛 merge 了一個改到遊戲行為或伺服器（`server.js`、`lib/`、`web/`）的 PR；
- 使用者要求部署或上線；
- session 開始時 `git log $(git describe --tags --match 'v*' --abbrev=0)..origin/main --oneline -- server.js lib web package.json Dockerfile` 不是空的（提一次就好）。

**沒有使用者同意，絕對不要 merge release PR**——merge 就是部署到正式站。

**步驟：**

1. 找出還沒發的 PR：上一個 tag 之後 merge 的 PR。
   ```sh
   LAST=$(git describe --tags --match 'v*' --abbrev=0)
   git log --merges --first-parent "$LAST"..origin/main --format='%s'   # "Merge pull request #N …"
   gh pr view <N> --json title,files                                   # 逐一看
   ```
2. 決定版號：有新功能 → minor，只有修正 → patch。1.0 之前，不相容的改變也只升 minor。沒有值得發的就不發。
   這個 repo 的 PR 標題不是 conventional commits，要看 PR 內容判斷。
3. 開 branch，改 `package.json#version`（`npm version X.Y.Z --no-git-tag-version`，連同 `package-lock.json`），
   在 `CHANGELOG.md` 最上面加一節——**一個 PR 一行**，分「新功能」／「修正」，連結 PR：
   `* <PR 標題> ([#N](https://github.com/lathyrus-odoratus/msn-mine/pull/N))`。以 PR 為單位，不要看 commit：
   用 merge commit 時同一個改動在 `git log` 會出現兩次。
4. 開 PR，標題 `發版 X.Y.Z`，只含版號與 CHANGELOG。不要在功能 PR 裡順便改版號：改版號的那個 PR 就是發版。
5. merge 後就會部署。確認 *Release* run 成功、`vX.Y.Z` 有打上、`https://mineduel.miao-bao.cc/healthz` 回 200。

回滾：在 Dokploy 把 image 改成之前的 `:X.Y.Z` 再 redeploy。**版號打過 tag 就不再重用。**

部署會重啟伺服器：所有 WebSocket 斷線，**進行中的房間全部消失**（房間在記憶體裡，斷線重連也救不回來）。
挑沒人在玩的時候發版。
