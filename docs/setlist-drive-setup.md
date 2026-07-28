# 曲目リスト自動保存機能：Google Drive 連携の設定手順

コンサートスレッドに送られた曲目リストの画像を、colo2号が自動で Google Drive に保存するための設定手順です。

**この手順で費用は一切かかりません。** Google Drive API は従量課金の対象外で、課金アカウントの紐付けも不要です。

---

## 全体の流れ

1. Drive に保存先フォルダを作り、フォルダ ID を控える
2. Google Cloud でプロジェクトを作り、Drive API を有効にする
3. OAuth 同意画面を設定し、**「本番環境」に公開する**
4. OAuth クライアント（デスクトップアプリ）を作る
5. `.env` に設定してリフレッシュトークンを取得する
6. 動作確認する
7. Koyeb の環境変数に登録する

所要時間は 20〜30 分程度です。

---

## ステップ1：保存先フォルダを用意する

1. [Google ドライブ](https://drive.google.com/) を、**曲目リストを保存したい Google アカウント**で開く
2. 曲目リストを置きたい場所に、任意の名前でフォルダを作る（このフォルダの中に `曲目リスト/2026/...` が自動生成されます）
3. そのフォルダを開き、ブラウザの URL を見る

```
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                       この部分がフォルダ ID
```

このフォルダ ID を控えておいてください。後で `SETLIST_ROOT_FOLDER_ID` に設定します。

---

## ステップ2：Google Cloud プロジェクトと Drive API

1. [Google Cloud Console](https://console.cloud.google.com/) を開く
   - **ステップ1と同じ Google アカウント**でログインしてください
2. 画面上部のプロジェクト選択メニューから「新しいプロジェクト」を作成
   - 名前は `colo2-drive` など分かりやすいもので構いません
   - **お支払い情報の設定を求められても、設定しないでください。** Drive API は無料で使えます
3. 作成したプロジェクトを選択した状態で、「API とサービス」→「ライブラリ」を開く
4. `Google Drive API` を検索して開き、**「有効にする」**をクリック

---

## ステップ3：OAuth 同意画面（最重要）

> ⚠️ **ここが一番の要注意ポイントです。**
> 公開ステータスを「テスト」のままにすると、**リフレッシュトークンが7日で失効し、毎週botが止まります。**
> 必ず「本番環境」に公開してください。

1. 「API とサービス」→「OAuth 同意画面」を開く
   - 新しい画面では「Google Auth Platform」という名前になっている場合があります
2. User Type（対象）で **「外部」** を選ぶ
   - 個人の Gmail アカウントの場合、「内部」は選べません
3. アプリ情報を入力する
   - アプリ名：`colo2号` など
   - ユーザーサポートメール / デベロッパーの連絡先：自分のメールアドレス
   - その他は空欄のままで構いません
4. スコープの設定で、**`https://www.googleapis.com/auth/drive`** を追加する
   - 「スコープを追加または削除」→ 検索欄に `drive` と入力 → Google Drive API の `.../auth/drive` にチェック
5. テストユーザーに自分のアカウントを追加する
6. **公開ステータスを「本番環境」に切り替える**
   - 「OAuth 同意画面」（または「対象」「Audience」）の画面に戻り、**「アプリを公開」**をクリック
   - 「確認が必要です」という警告が出ますが、**そのまま公開して構いません**
   - 自分だけが使うアプリなので、Google の審査を受けなくても動作します

### 「確認されていません」という警告について

このアプリは Google の審査を受けていないため、認可の途中で
「このアプリは Google で確認されていません」という警告画面が表示されます。

**自分で作ったアプリなので問題ありません。**
「詳細」→「（アプリ名）に移動」を選んで先に進んでください。

---

## ステップ4：OAuth クライアントを作る

1. 「API とサービス」→「認証情報」を開く
2. 「認証情報を作成」→「OAuth クライアント ID」
3. アプリケーションの種類で **「デスクトップアプリ」** を選ぶ
   - この種類を選ぶと `http://localhost` へのリダイレクトが自動的に許可されます。リダイレクト URI を自分で登録する必要はありません
4. 名前は `colo2-local` など任意
5. 作成すると **クライアント ID** と **クライアントシークレット** が表示されるので控える

---

## ステップ5：`.env` に設定してトークンを取得

プロジェクトの `.env` に、ここまでで控えた3つの値を追記します。

```
GOOGLE_OAUTH_CLIENT_ID=（ステップ4のクライアントID）
GOOGLE_OAUTH_CLIENT_SECRET=（ステップ4のクライアントシークレット）
SETLIST_ROOT_FOLDER_ID=（ステップ1のフォルダID）
```

保存したら、以下を実行します。

```bash
npx tsx scripts/get-refresh-token.ts
```

ターミナルに URL が表示されるので、ブラウザで開いて Google アカウントで許可してください。
成功すると、ターミナルに以下の形式でリフレッシュトークンが表示されます。

```
GOOGLE_OAUTH_REFRESH_TOKEN=1//0eXXXXXXXXXXXXXXXX
```

この1行を `.env` に追記してください。

> ⚠️ **このリポジトリは GitHub 上で公開設定です。**
> `.env` は `.gitignore` で除外されているので通常はコミットされませんが、
> トークンの値を他のファイルに貼り付けたり、チャットに貼ったりしないよう注意してください。
> 万一漏れた場合は、Google アカウントの「サードパーティ製アプリとの連携」から
> アクセス権を削除すれば、そのトークンは無効になります。

---

## ステップ6：動作確認

```bash
npx tsx scripts/test-drive-upload.ts
```

以下の4項目が自動で確認されます。

1. 認証が通ること
2. `曲目リスト/2026/` フォルダが自動作成されること
3. 想定した名前でファイルが作られること
4. 同名ファイルがある場合に連番が振られ、上書きされないこと

`🎉 すべての確認項目に合格しました。` と表示されれば成功です。
テストで作られた `TEST_` で始まるファイルは、確認後に Drive から手動で削除してください。

---

## ステップ7：Koyeb に登録

Koyeb の管理画面 →対象アプリ → Settings → Environment variables に、以下の4つを登録します。
**値はローカルの `.env` と完全に同じ**にしてください。

| 変数名 | 値の入手元 |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | ステップ4 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | ステップ4 |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | ステップ5 |
| `SETLIST_ROOT_FOLDER_ID` | ステップ1 |

---

## 参考：環境変数の全体像

`.env`（ローカル）と Koyeb の環境変数に必要な変数の一覧です。
**★** が今回の機能で新しく追加するものです。

```
# Discord
DISCORD_TOKEN=
CLIENT_ID=

# サーバー / ヘルスチェック
PORT=8000
HEALTH_CHECK_URL=

# Google Apps Script 連携
GAS_API_URL=
SCHEDULE_SHEET_URL=

# Google Sheets (サービスアカウント方式・既存)
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SPREADSHEET_ID=
GOOGLE_TARGET_FOLDER_ID=

# リマインダー / コンサート管理
REMINDER_SPREADSHEET_ID=
REMINDER_JOBS_SHEET_NAME=ReminderJobs
CONCERT_THREADS_SHEET_NAME=ConcertThreads
CONCERT_FORUM_CHANNEL_ID=
CONCERT_TAG_PLANNED_ID=
CONCERT_TAG_DONE_ID=
NOTIFY_CHANNEL_ID=
ACTIVITY_FORM_URL=

# ★ 曲目リストの Drive 自動保存 (OAuth 2.0 方式)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
SETLIST_ROOT_FOLDER_ID=
```

> **`ACTIVITY_FORM_URL` について**
> この変数が設定されている場合、コード内のデフォルト URL ではなくそちらが使われます。
> 今回フォーム URL からクエリ（`?usp=publish-editor`）を除去しましたが、
> Koyeb 側に古い URL が設定されていると変更が反映されません。
> 設定済みの場合は、Koyeb 側の値も
> `https://docs.google.com/forms/d/e/1FAIpQLSdKkOzdnoQi8c8-nta7cvP0XiEEYzx-sRJd7cewetZKNJdgKA/viewform`
> に更新するか、変数自体を削除してください。

---

## よくある失敗と対処

| 症状 | 原因 | 対処 |
|---|---|---|
| 1週間ほどで急に動かなくなった | OAuth 同意画面が「テスト」のまま | ステップ3-6 に戻り「本番環境」に公開してから、トークンを取り直す |
| `invalid_grant` エラー | トークンが失効・取り消された | `scripts/get-refresh-token.ts` を再実行して取り直す |
| リフレッシュトークンが表示されない | 既に許可済みで再発行されなかった | Google アカウントの「サードパーティ製アプリとの連携」からアクセス権を削除し、再実行 |
| `File not found` エラー | フォルダ ID が違う / 別アカウントのフォルダ | ステップ1 のフォルダ ID を確認。認可したアカウントとフォルダの所有者が同じか確認 |
| `storageQuotaExceeded` | Drive の空き容量不足 | 不要ファイルを削除（ゴミ箱も空にする） |
| `insufficientPermissions` | スコープ不足 | ステップ3-4 で `.../auth/drive` を追加したか確認し、トークンを取り直す |

---

## 補足：なぜサービスアカウントではないのか

このプロジェクトは既に Google Sheets 連携でサービスアカウントを使っています
（`src/utils/googleSheets.ts`）。しかし **Drive への書き込みだけは、サービスアカウントでは実現できません。**

サービスアカウントには個人向け Google アカウントのストレージ割当が存在せず（容量が 0 のため）、
マイドライブ内にファイルを作成しようとすると必ず失敗します。フォルダを共有しても解決しません。
共有ドライブ（Google Workspace 限定の機能）があれば回避できますが、
今回の Drive は個人の Gmail アカウントのため共有ドライブが存在しません。

そのため、Drive への書き込みのみ OAuth 2.0 のリフレッシュトークン方式を使い、
実装も `src/utils/googleDrive.ts` として既存の Sheets 連携から完全に分離しています。
Drive 側で問題が起きても、既存の機能は影響を受けません。
