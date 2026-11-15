# 下載版本資料更新

GitHub Actions 每小時的第 7、22、37、52 分鐘查詢所有工具的最新 Release，產生 `releases.json` 並部署整個網站。推送至 master 或手動執行也會更新。排程可能延遲；公開 repo 連續 60 天沒有活動時，GitHub 可能停用排程。

## 第一次啟用

1. 提交並推送這些檔案。
2. 到 repository 的 Settings → Pages → Build and deployment，將 Source 改成 **GitHub Actions**。
3. 到 Actions → **Update releases and deploy Pages** → **Run workflow**，選 master 後執行。
4. 確認 build、deploy 都成功，再檢查首頁與 `https://codemee.github.io/releases.json`。

不需要新增個人權杖或 Secrets。查詢使用 Actions 自動提供的 GITHUB_TOKEN，僅在執行期間使用。發布權限僅授予 deploy 工作。

## 平常使用

- 發布工具新版後，等待下一輪排程，或手動 Run workflow 立即查詢並部署。
- 網頁每次開啟、重新整理及開啟期間每 15 分鐘讀取本站 releases.json，不直接呼叫 GitHub API。
- 畫面上的時間是該工具最後成功向 GitHub 確認的時間，並非訪客重新整理的時間。超過 45 分鐘未確認會顯示提醒。
- 某款工具查詢失敗時，保留上次部署的資料與確認時間；若前次網站資料也無法取得，則使用 repo 中的初始資料。
- 更新只存在部署產物中，不會每 15 分鐘提交一次到 master。
- 本機預覽讀取 repo 的初始資料，不會自動觸發 Actions。

## 測試

使用 Node.js 24 或更新版本：

```sh
node --test tests/*.test.cjs tests/*.test.mjs
```
