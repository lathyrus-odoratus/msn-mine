# Changelog

## 0.1.0 (2026-10-14)

第一個用 release 流程發的版本（之前都是 push main 直接部署到 GKE）。

### 修正

* Postgres 重試後仍連不上就退出，不再降級成記憶體模式；部署改到 Dokploy ([#1](https://github.com/lathyrus-odoratus/msn-mine/pull/1))
