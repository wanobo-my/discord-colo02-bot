# colo2号 — 音楽ボランティア color の Discord bot

訪問コンサートの日程調整・フォーラム投稿の管理・活動記録の回収を自動化する bot です。

TypeScript / discord.js で書かれ、Koyeb 上で常駐しています。データの保存先は Google スプレッドシートと Google ドライブです。

---

## 📋 現場メンバーの方へ

### 曲目リストの送り方

> **コンサート終了後に colo2号 が送る「活動記録フォームのお願い」メッセージに、返信する形で曲目リストの画像を送るだけです。**
> ✅ が付いたら保存完了。Google アカウントは不要です。

- 送り方：メッセージを**長押し** →「**返信**」→ 画像を添付して送信
- 複数枚まとめて送れます
- 画像と PDF に対応しています（動画は対象外です）
- 送り直したいときは、もう一度同じように送ってください

送られた画像は自動で Google ドライブに保存され、活動記録フォームの回答にもリンクが載ります。

### うまくいかないとき

| 症状 | 確認すること |
|---|---|
| ✅ が付かない | **返信**になっていますか？ 画像を貼っただけでは保存されません |
| ✅ が付かない | 返信先は colo2号 のメッセージですか？ 他の人のメッセージではありません |
| 「対象外のファイル」と返ってきた | 動画や zip は対象外です。画像か PDF を送ってください |

---

## 機能

### スラッシュコマンド

| コマンド | 内容 |
|---|---|
| `/schedule create` | 日程調整シートを作成し、回答依頼を投稿。締切に応じた自動リマインドも登録する |
| `/schedule check` | 未回答者へリマインドを送る |
| `/schedule finish` | 回答を集計して投稿する |
| `/schedule cancel` | 登録済みの自動リマインド・集計を停止する |
| `/concert create` | コンサート予定のフォーラム投稿を作成する |
| `/concert update` | 投稿内容・参加者・写真ポリシー・ステータスを更新する |
| `/readme check` | 指定メッセージの既読状況を確認する |
| `/readme remind` | 未読者へ DM でリマインドする |
| `/hello` | ランダムな言語で挨拶を返す |

### 自動処理（cron / Asia-Tokyo）

| タイミング | 内容 |
|---|---|
| 10 分ごと | ヘルスチェック（Koyeb での常駐維持） |
| 毎時 0 分 | 自動リマインドジョブの巡回、**曲目リスト URL の回答シート反映** |
| 毎月 1 日 9:00 | 今月のコンサート予定を通知 |
| 毎月 28 日 20:00 | スプレッドシート更新のリマインド |
| 毎日 16:00 | 当日コンサートの自動終了処理（タグ更新・活動記録フォーム投稿・写真アルバムスレッド作成） |

### 曲目リストの自動保存

コンサートスレッドで、bot の案内メッセージへ**返信**された画像を Google ドライブへ保存します。

```
{指定フォルダ}/#記録_曲目リスト/{年}/{実施日}_{施設名}_{連番}.{拡張子}
例) #記録_曲目リスト/2026/2026-07-28_八事福祉会（八事苑デイサービスセンター）_01.jpg
```

- 保存後、活動記録フォームの回答シート（I 列）へ URL を書き戻します
- 実施日・施設名は `ConcertThreads` シートをスレッド ID で引いて取得します（スレッド名のパースは予備手段）
- 処理済みメッセージには ✅ を付け、二重保存を防ぎます

---

## セットアップ（開発者向け）

```bash
npm install
cp <どこかに保管している .env> .env   # .env は Git 管理外
npm start          # bot を起動
npm test           # オフラインテスト（Discord / Drive に接続しません）
npm run typecheck  # 型チェック
```

ビルド工程はありません。`tsx` で TypeScript を直接実行しています。

### ファイル構成

```
src/
  index.ts                      起動・cron・イベントリスナー
  commands/                     スラッシュコマンド
  services/
    concertService.ts           ConcertThreads シートの読み書き
    reminderJobs.ts             ReminderJobs シートの読み書き
    setlistNaming.ts            曲目リストの命名・判定（純粋関数／テスト対象）
    setlistCollector.ts         曲目リストの検知とアップロード
    setlistSheetLink.ts         回答シートへの URL 書き戻し
  utils/
    googleSheets.ts             Sheets / Drive（サービスアカウント方式）
    googleDrive.ts              Drive（OAuth 方式・曲目リスト専用）
    date.ts                     JST 日付処理
scripts/                        運用・検証用スクリプト（後述）
tests/                          オフラインテスト
docs/                           セットアップ・検証手順
```

### 運用・検証用スクリプト

いずれも `npx tsx scripts/<ファイル名>` で実行します。

| スクリプト | 用途 |
|---|---|
| `get-refresh-token.ts` | Drive 用リフレッシュトークンの取得（一回限り） |
| `test-drive-upload.ts` | Drive 書き込みの動作確認（テストファイルを作成します） |
| `check-setlist-sheet-link.ts` | 回答シートへの反映を確認。既定は dry-run、`--write` で実行 |
| `post-setlist-anchor.ts` | 曲目リストの案内メッセージだけを投稿（検証用） |
| `reprocess-setlist-message.ts` | 指定メッセージの回収処理をやり直す |
| `find-channel-ids.ts` | チャンネル ID・フォーラムタグ ID を調べる（読み取りのみ） |

---

## 環境変数

`.env`（ローカル）と Koyeb の Environment variables の両方に設定します。
**値は公開リポジトリに含めないでください。**

### Discord

| 変数 | 内容 |
|---|---|
| `DISCORD_TOKEN` | bot トークン（Developer Portal → Bot） |
| `CLIENT_ID` | アプリケーション ID（Developer Portal → General Information） |
| `CONCERT_FORUM_CHANNEL_ID` | コンサート計画フォーラムのチャンネル ID |
| `CONCERT_TAG_PLANNED_ID` / `CONCERT_TAG_DONE_ID` | 「予定」「終了」タグの ID |
| `NOTIFY_CHANNEL_ID` | 月初のコンサート予定通知の投稿先 |

ID は `npx tsx scripts/find-channel-ids.ts` で調べられます（Discord の開発者モードは不要）。

### Google（サービスアカウント方式・スプレッドシート用）

| 変数 | 内容 |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | サービスアカウントのアドレス |
| `GOOGLE_PRIVATE_KEY` | サービスアカウントの秘密鍵 |
| `GOOGLE_SPREADSHEET_ID` | 接続確認用 |
| `REMINDER_SPREADSHEET_ID` | `ReminderJobs` / `ConcertThreads` の保存先 |
| `REMINDER_JOBS_SHEET_NAME` | 既定 `ReminderJobs` |
| `CONCERT_THREADS_SHEET_NAME` | 既定 `ConcertThreads` |
| `ACTIVITY_RESPONSE_SPREADSHEET_ID` | 活動記録フォームの回答スプレッドシート |
| `ACTIVITY_RESPONSE_SHEET_NAME` | 既定 `フォームの回答 1` |

**扱うスプレッドシートは、すべてサービスアカウントに編集権限で共有してください。**

### Google（OAuth 方式・Drive 用）

| 変数 | 内容 |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth クライアント |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | リフレッシュトークン |
| `SETLIST_ROOT_FOLDER_ID` | 曲目リストを置く親フォルダの ID |

取得手順は **[docs/setlist-drive-setup.md](docs/setlist-drive-setup.md)** を参照してください。

### その他

| 変数 | 内容 |
|---|---|
| `GAS_API_URL` / `SCHEDULE_SHEET_URL` | Google Apps Script 連携 |
| `ACTIVITY_FORM_URL` | 活動記録フォームの URL（未設定ならコード内の既定値） |
| `PORT` / `HEALTH_CHECK_URL` | ヘルスチェック用 |
| `SETLIST_MODE` | `off`（既定）/ `dryrun` / `on`。曲目リスト機能の動作モード |
| `LOCAL_DEV` | **ローカル検証専用。本番には設定しないこと**（後述） |

---

## Bot 権限と Gateway Intents

### Gateway Intents

Developer Portal → Bot → Privileged Gateway Intents で以下を有効にします。

| Intent | 用途 |
|---|---|
| `Guilds` | 基本 |
| `Guild Messages` | メッセージの受信 |
| **`Message Content`** | **添付ファイルの取得に必須**（特権 Intent） |
| `Guild Message Reactions` | ✅ による処理済み判定 |
| **`Server Members`** | 既読管理・メンバー情報（特権 Intent） |

`Message Content` と `Server Members` は特権 Intent です。ポータル上でトグルを有効にしないと、コードで指定しても接続できません。

### Bot 権限

- チャンネルの閲覧 / メッセージ送信 / メッセージ履歴の閲覧
- 公開スレッドの作成、スレッドでのメッセージ送信
- リアクションの追加
- フォーラムタグの適用（`Manage Threads` 相当）

---

## 運用

### デプロイ

`main` ブランチへの push を Koyeb が検知して自動デプロイします。

**`main` へ直接 push しないでください。** 作業ブランチ → Pull Request → マージという流れにし、マージのタイミングで意図的にデプロイします。

環境変数を変更した場合、**Save だけでは反映されません。** 次のデプロイ時に適用されます。

### ローカルでの検証

本番 bot が動いたままローカルでも起動すると、**同じ bot が二重に動きます。** リアクションが 2 回付く、定期処理が 2 回走る、スラッシュコマンドの応答が競合して落ちる、といった問題が起きます。

これを防ぐため、ローカル起動時は `.env` に以下を設定します。

```
LOCAL_DEV=true
```

このとき cron・メンション反応・インタラクション処理が無効になります（曲目リストの検知は動きます）。

> ⚠️ **`LOCAL_DEV` を Koyeb に設定しないでください。** 本番の定期処理とスラッシュコマンドがすべて止まります。

> ⚠️ 本番の `SETLIST_MODE` が `on` の状態でローカル bot を起動すると、**両方が画像をアップロードして重複します。** 曲目リスト機能を検証する場合は、`scripts/` のスクリプトを使うか、本番側を一時的に止めてください。

### リフレッシュトークンの再発行

Drive への保存が `invalid_grant` で失敗するようになった場合、リフレッシュトークンが失効しています。

1. `.env` に `GOOGLE_OAUTH_CLIENT_ID` と `GOOGLE_OAUTH_CLIENT_SECRET` があることを確認
2. 取得スクリプトを実行

```bash
npx tsx scripts/get-refresh-token.ts
```

3. 表示された URL をブラウザで開き、**Drive の持ち主のアカウント**で許可する
4. 表示された `GOOGLE_OAUTH_REFRESH_TOKEN=...` を `.env` と Koyeb の両方に設定
5. Koyeb を再デプロイ

> **トークンが表示されない場合**：既に許可済みのため再発行されていません。
> Google アカウントの[サードパーティ製アプリとの連携](https://myaccount.google.com/connections)から
> このアプリのアクセス権を削除し、もう一度実行してください。

> **1 週間ほどで繰り返し失効する場合**：OAuth 同意画面が「テスト」のままです。
> 「本番環境」に公開してからトークンを取り直してください。詳細は
> [docs/setlist-drive-setup.md](docs/setlist-drive-setup.md) のステップ3 を参照。

---

## よくある失敗と対処

### 曲目リストが保存されない

| ログ / 症状 | 原因 | 対処 |
|---|---|---|
| 何も出ない | 返信になっていない | 画像を貼っただけでは検知しません |
| 何も出ない | 返信先が bot の案内メッセージでない | 「曲目リスト」を含む bot のメッセージへの返信のみ対象です |
| 何も出ない | 対象フォーラム外 | `CONCERT_FORUM_CHANNEL_ID` 配下のスレッドのみ対象です |
| `回収モード: off` | `SETLIST_MODE` 未設定 | `on` を設定して再デプロイ |
| `CONCERT_FORUM_CHANNEL_ID が未設定` | 環境変数不足 | 設定して再デプロイ |
| `環境変数が未設定のため Drive に接続できません` | OAuth 系 4 変数の不足 | 設定して再デプロイ |
| `invalid_grant` | トークン失効 | 上記「リフレッシュトークンの再発行」 |
| `File not found` | フォルダ ID の誤り／認可アカウント違い | `SETLIST_ROOT_FOLDER_ID` と認可アカウントを確認 |
| `storageQuotaExceeded` | Drive の空き容量不足 | 不要ファイルを削除（ゴミ箱も空にする） |

### 実施日・施設名が特定できない

| ログ | 意味 |
|---|---|
| `取得元: ConcertThreads シート` | 正常。シートから取得できています |
| `取得元: スレッド名のパース` | シートに行が無いか値が不完全。動作としては正常（予備手段が働いています） |
| `取得元: 特定できず` | スレッド名が `YYYY.MM.DD_施設名` 形式ではありません。`_未分類/` へ退避します |

`_未分類/` に入ったファイルは、スレッド名を直したうえで
`scripts/reprocess-setlist-message.ts` で再処理すると正しい場所へ保存されます
（`_未分類/` の古いファイルは手動で削除してください）。

### 回答シートに URL が入らない

| ログ | 意味・対処 |
|---|---|
| `回答がまだ無いため、後追いで反映します` | フォーム未回答。回答後、毎時 0 分の巡回で自動的に入ります |
| `該当する行が複数あり特定できません` | 同じ日付・似た施設名の行が複数あります。手動で記入してください |
| `既に URL があるため書き込みません` | 正常。既存の URL は保護されます |
| `該当ファイルなし` が続く | 実施日がシートとファイル名で食い違っている可能性があります |

反映を待たずに実行したい場合：

```bash
npx tsx scripts/check-setlist-sheet-link.ts          # 確認のみ
npx tsx scripts/check-setlist-sheet-link.ts --write  # 実行
```

---

## 設計上の判断

後から読む人が「なぜこうなっているのか」で迷わないよう、非自明な判断を残しておきます。

**Drive への書き込みだけ OAuth 方式なのはなぜか**
サービスアカウントには個人向け Google アカウントのストレージ割当が無く、マイドライブにファイルを作成できません（フォルダを共有しても解決しません）。共有ドライブは Google Workspace 限定の機能のため使えません。そのため Drive のみ OAuth 方式にし、実装も `googleDrive.ts` として Sheets 連携から分離しています。

**実施日を主キーにし、施設名では確定させないのはなぜか**
回答シートとスレッド名では施設名の表記が一致せず、どちらが詳しいかも一定ではないためです（`八事福祉会` ↔ `八事福祉会（八事苑デイサービスセンター）`、`エクセレント天白ガーデンヒルズ` ↔ `エクセレント天白ガーデン`）。施設名は双方向の包含判定で「同じ施設か」の検証にのみ使います。

**確証が持てないとき、なぜ書き込まないのか**
同じ日に複数のコンサートが入ることがあるためです。誤った行への記入は記録を静かに壊し後から気づけませんが、空欄なら人が気づけます。取りこぼすほうが安全という判断です。

**ファイル名の日付がピリオド区切りでないのはなぜか**
拡張子以外にピリオドがあると、素朴な拡張子判定でファイル名が壊れることがあるためです。ISO 8601 形式にすることで、表計算ソフトや OS のソートが日付として認識できる利点もあります。フォルダ名・スレッド名・シートの表記は従来どおりピリオド区切りです。

**✅ を外しても自動で再処理されないのはなぜか**
運用上その場面が想定されないため、リアクション削除の検知は実装していません。✅ が無いメッセージは「未処理」とみなされるので、`scripts/reprocess-setlist-message.ts` から再処理できます。

---

## 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [docs/setlist-drive-setup.md](docs/setlist-drive-setup.md) | Google Drive 連携のセットアップ手順 |
| [docs/setlist-phase3-testing.md](docs/setlist-phase3-testing.md) | 検知処理の検証手順（dry-run） |
| [docs/setlist-phase4-testing.md](docs/setlist-phase4-testing.md) | 実アップロードの検証手順 |
| [docs/color_discord_bot_improvement_spec.md](docs/color_discord_bot_improvement_spec.md) | 改善仕様書（日程調整・フォーラム投稿管理） |
