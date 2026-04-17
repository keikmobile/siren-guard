# Siren Guard

アクセス回数・滞在時間の二軸でサイトをブロックする Chrome 拡張機能。

「1日3回まで」「1日10分まで」のように上限を設定し、どちらか超過すると blocked.html にリダイレクトする。
新しいタブを開くとルール一覧が表示される。外部サービス不使用・完全ローカル動作。

---

## インストール

1. `chrome://extensions/` を開く
2. 右上「デベロッパーモード」をオン
3. 「パッケージ化されていない拡張機能を読み込む」→ このフォルダを選択

---

## 使い方

新しいタブを開くとルール一覧が表示される。拡張機能アイコンのポップアップからも同じ操作が可能。

- **ルール追加**: ドメイン（例: `x.com`）と1日の上限回数を入力して「ルールを追加」
- **カウント確認**: 各ルールに `アクセス数 / 上限回数 · 滞在時間 / 10分` を表示
- **ルール削除**: ✕ ボタン（当日追加したルールは 🔒 表示となり翌日まで変更不可）
- **エクスポート**: 「エクスポート」ボタンでルールと衝動ログをまとめて `siren-guard-export.json` としてダウンロード
- **インポート**: 「インポート」ボタンでJSONファイルを選択、既存データにマージ（重複はスキップ）

アクセス回数・滞在時間のどちらかが上限に達すると、そのサイトへのアクセスはブロックページにリダイレクトされる。カウントは日本時間の深夜0時にリセット。

ブロックページでは「なぜ開こうとしたか」を記録でき（衝動ログ）、**10分後**に解除ボタンが有効になる。理由を記録すると残り時間が **30秒** に短縮される。解除は1回使い切り。

---

## 技術仕様

- Manifest V3 / service worker
- `webNavigation.onCommitted` でナビゲーションを検知し `tabs.update()` でリダイレクト
- 滞在時間は `tabs` / `windows` イベントで計測。service worker が kill されてもアラーム（1分周期）とストレージ永続化で継続計測
- 新しいタブを `newtab.html` でオーバーライド（`chrome_url_overrides`）
- データはすべて `chrome.storage.local`（外部送信なし）
- Safari 対応準備済み（`const ext = typeof browser !== "undefined" ? browser : chrome`）
- ブロックページ（`blocked.html`）では衝動ログ入力・クールダウンタイマー・1回解除機能を提供

### データ構造

```js
// ルール
{ rules: [{ domain: "x.com", dailyLimit: 3, cooldownMinutes: 10, lockUntil: "ISO timestamp | null" }] }

// アクセスログ（日付ごと・古い日付は自動削除）
{ accessLog: { "2026-04-15": { "x.com": 2 } } }

// 滞在時間ログ（秒・日付ごと・古い日付は自動削除）
{ timeLog: { "2026-04-15": { "x.com": 320 } } }

// セッション開始時刻（タブIDごと・SW再起動後も継続計測するためストレージ永続化）
{ sessionStartTimes: { "123": { domain: "x.com", startTime: 1744123456789 } } }

// 衝動ログ（ブロックページでの入力記録）
{ intentLog: [{ timestamp: "2026-04-15T14:32:00+09:00", domain: "x.com", reason: "なんとなく気になった" }] }

// ブロック開始時刻（クールダウン計算用・当日分のみ保持）
{ blockedAt: { "x.com": { date: "2026-04-15", time: "ISO timestamp" } } }

// 解除バイパス（1回使い切り）
{ bypasses: { "x.com": { date: "2026-04-15", grantedAt: "ISO timestamp" } } }
```

---

## Safari への変換（将来）

```sh
xcrun safari-web-extension-converter siren-guard/
```
