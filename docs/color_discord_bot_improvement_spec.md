# 音楽ボランティアcolor Discord Bot改善仕様書

作成日: 2026-05-22  
対象: non-public Discord bot  
想定環境: GitHub / Koyeb / TypeScript / discord.js / GAS / Google Sheets  
運用方針: 無料運用を前提に、外部DBは原則増やさず、Google Sheetsを軽量な永続データストアとして活用する。

---

## 1. 目的

本仕様書は、音楽ボランティアcolorのDiscord運営用botについて、現状機能を活かしながら、運営者の手動作業・締切管理・投稿作成の負担を減らすための改善要件を整理するものである。

特に、以下を重視する。

- 運営者が毎回思い出して実行しているリマインド・集計作業をbotへ移す。
- コマンド数を増やしすぎず、実際に使う価値がある機能に絞る。
- 既存のDiscord運用、特にフォーラム投稿を使ったコンサートごとの会話運用を壊さない。
- Google Antigravity / Codex に渡して、実装計画・実装作業に進められる粒度で整理する。

---

## 2. 背景

colorでは、訪問コンサートの依頼可能日時を把握するため、月次でメンバーの空き状況を集めている。現状のbotには `/schedule create`、`/schedule check`、`/schedule finish` があり、日程調整用スプレッドシートの作成、未回答者リマインド、集計投稿が可能である。

ただし、リマインドや集計は手動コマンド実行が必要であり、運営者が締切を覚えて実行する必要がある。

また、コンサート実施が確定した後は、Discordのフォーラムチャンネルにコンサートごとの投稿を手動作成している。この投稿は、コンサートごとの会話・準備・情報共有の起点になっている。一方で、毎回似た形式の投稿を作る手間がある。

---

## 3. 現行bot機能の整理

### 3.1 `/schedule`

現行コードでは、`schedule.ts` に以下のサブコマンドがある。

| コマンド | 現状の機能 |
|---|---|
| `/schedule create` | GASへ `action: create` を送り、日程調整シートを作成する。Discordに回答期限・シートURL・コメントをEmbed投稿する。 |
| `/schedule check` | GASへ `action: check` を送り、未回答者名を取得する。コード内の `USER_MAP` に基づいてDiscordメンション化し、未回答者にリマインド投稿する。 |
| `/schedule finish` | GASへ `action: finish` を送り、各候補日の `◯` / `△` 回答状況をEmbedで集計投稿する。 |

現在の `/schedule create` は `deadline` を必須入力としているが、GASへは `eventName` のみ送信している。つまり、回答期限はDiscord投稿に表示されるだけで、自動処理には利用されていない。

### 3.2 `/readme`

現行コードでは、`readme.ts` に以下のサブコマンドがある。

| コマンド | 現状の機能 |
|---|---|
| `/readme check` | 指定メッセージのリアクション状況を確認し、対象者の既読・未読を表示する。 |
| `/readme remind` | 指定メッセージの未読者へDMでリマインドを送る。 |

対象者は、メッセージ内の `@everyone` / `@here` / ロールメンション / ユーザーメンションから抽出される。現時点では、この機能の自動化は今回対象外とする。

### 3.3 定期実行

現行 `index.ts` では `node-cron` による定期実行がある。

| 定期処理 | 現状の内容 |
|---|---|
| 10分ごとのヘルスチェック | `HEALTH_CHECK_URL` またはlocalhostへアクセスする。Koyeb上での常駐維持を意図。 |
| 毎月1日 9:00 | GASから今月のコンサート予定を取得し、指定チャンネルへ通知する。 |
| 毎月28日 20:00 | TimeTreeの予定をスプレッドシートへ転記するリマインドを投稿する。 |

### 3.4 その他

| 機能 | 現状 |
|---|---|
| `/hello` | ランダムな言語で挨拶を返す。 |
| Botメンション反応 | botがメンションされたらランダム絵文字でリアクションする。 |
| Google連携 | `googleSheets.ts` にて Google Sheets / Drive API を利用する設定がある。 |
| コマンド登録 | `deploy-commands.ts` でグローバルコマンド登録を行う。 |

---

## 4. 今回の改善対象と対象外

### 4.1 改善対象

| Phase | 機能 | 状態 |
|---|---|---|
| Phase 1 | 月次依頼可能日時調査の自動リマインド・自動集計 | 確定 |
| Phase 1 | `/schedule cancel` | 確定 |
| Phase 2 | コンサートフォーラム投稿管理 | 採用 |
| Phase 3 | 活動後フォーム投稿補助 | Phase 2後に検討 |
| Future | 個別依頼の日程確認 | なおさんと相談後に検討。Discordリアクション集計方式が候補。 |

### 4.2 対象外

| 機能 | 理由 |
|---|---|
| 曲リスト関連 | 手動運用予定のため、bot仕様から除外する。 |
| 活動前チェックリマインド | 今回は不要。 |
| 既読管理の自動化 | 現状の `/readme check/remind` の手動運用で一旦十分。 |
| `/schedule jobs` | コマンド過多を避けるため追加しない。 |
| `/schedule status` | コマンド過多を避けるため追加しない。 |
| `/schedule rerun` | 初期実装では不要。エラー時はログ・シート確認で対応する。 |
| テンプレ生成だけのフォーラム補助 | 手動コピペと大きく変わらず、追加する価値が薄いため採用しない。 |

---

## 5. 用語整理

### 5.1 月次依頼可能日時調査

メンバーに翌月などの空き状況を入力してもらい、団体として依頼を受けられそうな日時を把握するための調査。

これはコンサート実施日を確定するためのものではない。集計結果は、施設へ提示できる候補日や、依頼対応の判断材料として使う。

### 5.2 個別依頼の日程確認

施設から具体的な候補日つきで依頼が来た場合に、数日程についてメンバーの参加可否を確認するもの。

月次依頼可能日時調査とは別物として扱う。将来的にはDiscordメッセージのリアクション集計で実装する可能性がある。

### 5.3 コンサートフォーラム投稿

コンサート実施が確定した後、Discordのフォーラムチャンネルに作成する投稿。コンサートごとの会話・準備・連絡事項共有の起点になる。

---

# Phase 1: 月次依頼可能日時調査の自動化

## 6. Phase 1の目的

月次依頼可能日時調査における未回答者確認・リマインド・集計を自動化する。

これにより、運営者が締切前日に `/schedule check` を実行したり、締切翌日に `/schedule finish` を実行したりする負担を減らす。

---

## 7. Phase 1の改善後フロー

```text
/schedule create
↓
日程調整スプレッドシート作成
↓
Discordに回答依頼を投稿
↓
回答締切日をもとに ReminderJobs シートへ自動ジョブ登録
↓
締切日前日 18:00 に自動リマインド
↓
締切日当日 18:00 に自動リマインド
↓
締切日翌日 10:00 に自動集計
```

---

## 8. `/schedule create` 改修仕様

### 8.1 現状

現状の入力項目は以下。

| 項目 | 必須 | 内容 |
|---|---:|---|
| `event_name` | 必須 | 日程調整名 |
| `deadline` | 必須 | 回答期限 |
| `comment` | 任意 | 追加の一言 |

現状では、`deadline` はDiscord投稿に表示されるのみで、自動処理には利用されていない。

### 8.2 改修後

`deadline` は機械的に解釈できる日付形式に寄せる。

推奨仕様:

| 項目              | 型      | 例                          |
| --------------- | ------ | -------------------------- |
| `event_name`    | string | `6月日程調整`                   |
| `deadline_date` | string | `2026-06-20`               |
| `comment`       | string | `6月に依頼を受けられそうな日時を入力してください` |

`deadline_date` は `YYYY-MM-DD` 形式を推奨する。締切時刻は内部的に `23:59` 扱いとする。

### 8.3 ジョブ登録

`/schedule create` 成功時、以下3件のReminderJobsを登録する。

| job_type | run_at |
|---|---|
| `schedule_remind_before` | 締切日前日の18:00 |
| `schedule_remind_deadline` | 締切日当日の18:00 |
| `schedule_finish` | 締切日翌日の10:00 |

### 8.4 GASへ送るデータ

現状:

```ts
body: JSON.stringify({ action: 'create', eventName })
```

改修後のイメージ:

```ts
body: JSON.stringify({
  action: 'create',
  eventName,
  deadlineDate,
  channelId: interaction.channelId,
  guildId: interaction.guildId,
  createdBy: interaction.user.id
})
```

ただし、ReminderJobsへの登録をbot側で行う場合、GASへは `eventName` のみでもよい。どちらで登録するかは実装時に決める。

推奨は、Discord投稿先や作成者情報を扱いやすいbot側でReminderJobsを登録する方式。

---

## 9. ReminderJobs設計

### 9.1 目的

Googleスプレッドシート上に `ReminderJobs` シートを作成し、botが定期巡回する外部保存ジョブキューとして利用する。

Koyeb上のbotが再起動・一時停止しても、未実行ジョブがシートに残るため、復帰後に処理を再開できる。

### 9.2 シート項目

| カラム | 内容 | 例 |
|---|---|---|
| `job_id` | 一意のID | `uuid` |
| `job_type` | ジョブ種別 | `schedule_remind_before` |
| `event_name` | 日程調整名 | `6月依頼可能日時調査` |
| `sheet_url` | 対象の日程調整シートURL | `https://docs.google.com/...` |
| `guild_id` | DiscordサーバーID | `123...` |
| `channel_id` | 投稿先チャンネルID | `123...` |
| `deadline_date` | 回答締切日 | `2026-06-20` |
| `run_at` | 実行予定日時 | `2026-06-19T18:00:00+09:00` |
| `status` | 状態 | `pending` / `running` / `done` / `error` / `cancelled` |
| `executed_at` | 実行完了日時 | `2026-06-19T18:00:05+09:00` |
| `retry_count` | 再試行回数 | `0` |
| `error_message` | エラー内容 | `GAS timeout` |
| `created_by` | 作成者Discord ID | `123...` |
| `created_at` | 登録日時 | `2026-05-22T15:00:00+09:00` |
| `updated_at` | 更新日時 | `2026-05-22T15:00:00+09:00` |

### 9.3 状態遷移

```text
pending
  ↓ 実行対象として取得
running
  ↓ 成功
done

pending
  ↓ 実行対象として取得
running
  ↓ 失敗
error

pending
  ↓ /schedule cancel
cancelled
```

### 9.4 二重実行防止

同じジョブが二重実行されないように、実行直前に `status` を `running` へ更新する。

ただし、Google Sheetsは本格的なトランザクションDBではないため、完全な排他制御は難しい。botを1インスタンス運用にする前提で、実運用上の二重実行リスクを抑える。

---

## 10. 自動巡回処理

### 10.1 実行間隔

botは `node-cron` により、1時間ごとにReminderJobsを巡回する。

推奨Cron:

```text
0 * * * *
```

タイムゾーンは `Asia/Tokyo`。

### 10.2 実行条件

以下を満たすジョブを実行対象とする。

```text
status = pending
かつ run_at <= 現在時刻
```

### 10.3 処理内容

| job_type | 実行内容 |
|---|---|
| `schedule_remind_before` | 既存の `/schedule check` 相当の処理を自動実行する。 |
| `schedule_remind_deadline` | 既存の `/schedule check` 相当の処理を自動実行する。締切当日であることが分かる文面にする。 |
| `schedule_finish` | 既存の `/schedule finish` 相当の処理を自動実行する。 |

---

## 11. 自動リマインド文面

### 11.1 締切日前日

```text
📣 リマインド・回答してね！

「{event_name}」の回答締切は明日です。
未回答の人は、シートを確認して入力をお願いします！

{mentions}

📎 シートURL
{sheet_url}
```

### 11.2 締切日当日

```text
📣 最終リマインド・回答お願いします！

「{event_name}」の回答締切は今日です。
まだ未回答の人は、今日中に入力をお願いします！

{mentions}

📎 シートURL
{sheet_url}
```

### 11.3 未回答者がいない場合

```text
🎉 「{event_name}」は全員回答済みです！みんな協力ありがとう！
```

---

## 12. 自動集計文面

既存の `/schedule finish` と同様のEmbed形式を基本とする。

---

## 13. `/schedule cancel` 仕様

### 13.1 目的

月次依頼可能日時調査が不要になった、誤って作成した、または作り直した場合に、紐づく自動リマインド・自動集計を停止する。

### 13.2 対象

- `status = pending` のReminderJobs
- 対象の `sheet_url` に紐づくジョブ

### 13.3 非対象

- 作成済みスプレッドシートの削除
- Discord投稿の削除
- すでに実行済みのリマインド取り消し
- `done` ジョブの変更

### 13.4 コマンド案

```text
/schedule cancel url:{日程調整シートURL}
```

イベント名指定は表記揺れが起きやすいため、シートURL指定を推奨する。

### 13.5 実行後メッセージ
実行後メッセージはコマンド実行者のみのメッセージにする。（余計な通知の軽減のため）

```text
🛑 日程調整の自動処理を停止しました

対象シート:
{sheet_url}

停止した予定:
・締切日前日リマインド
・締切日当日リマインド
・締切翌日集計
```

対象ジョブが見つからない場合:

```text
対象シートに紐づく未実行の自動処理は見つかりませんでした。
```

---

# Phase 2: コンサートフォーラム投稿管理

## 14. Phase 2の目的

コンサート実施が確定した後、Discordフォーラムチャンネルにコンサートごとの投稿を作成・更新する手間を減らす。

現在のフォーラム運用を維持しつつ、以下をbotで補助する。

- 投稿タイトルの自動生成
- 投稿本文の整形
- 参加者のメンション入力補助
- 写真可否の選択式入力
- フォーラムタグの自動付与
- bot作成投稿の後日更新

---

## 15. Phase 2の採用方針

単なるテンプレート生成だけでは、既存投稿をコピーして手動作成する運用と大きく変わらないため採用しない。

Phase 2として実装する場合は、少なくとも以下を満たす。

- `/concert create` でフォーラム投稿作成まで完了する。
- 参加者はDiscordのUser Selectで複数選択できる。
- 写真可否はボタンまたはセレクトで選べる。
- 投稿前にプレビューを確認できる。
- botが作成した投稿は `/concert update` で後から更新できる。

---

## 16. `/concert create` 仕様

### 16.1 コマンド概要

```text
/concert create
```

実行者だけに見える入力フローを開始し、最終的に指定フォーラムチャンネルへ投稿を作成する。

### 16.2 入力フロー

```text
/concert create
↓
基本情報モーダル
  1. 実施日
  2. 施設名
  3. 時間
  4. 集合
  5. メモ
↓
User Selectで参加者を複数選択
↓
写真可否をボタンまたはセレクトで選択
↓
プレビュー表示
↓
[投稿する] [修正する] [キャンセル]
↓
フォーラム投稿作成
```

### 16.3 基本情報モーダル

| 項目  |  必須 | 例             | 備考                    |
| --- | --: | ------------- | --------------------- |
| 実施日 |  必須 | `2026.05.16`  | タイトルに反映する。            |
| 施設名 |  必須 | `ボンセジュール植田`   | タイトル・本文に反映する。         |
| 時間  |  必須 | `14:15-15:00` | 本文に反映する。              |
| 集合  |  任意 | `13:45 現地集合`  | 集合時間・集合場所をまとめて入力する。   |
| メモ  |  任意 | `何弾きます...`    | 施設情報、注意点、誕生日対応など自由記述。 |

Discordモーダルは入力欄数に制約があるため、参加者と写真可否はモーダル外のUIで入力する。

### 16.4 参加者選択

DiscordのUser Selectを使用し、サーバーメンバーから参加者を複数選択する。

要件:

- 複数選択可。
- 選択したユーザーは本文でメンション表示する。
- 誤選択に備えて、投稿前プレビューで確認できる。
- 初期実装ではロールによる候補者限定は必須としない。
- 将来的に必要であれば、出演メンバーロール等による対象者整理を検討する。

### 16.5 写真可否選択

写真可否はボタンまたはセレクトで選ぶ。

選択肢案:

| 選択肢 | 本文表示 |
|---|---|
| 写真OK | `📷 写真撮影：可` |
| 顔が映らなければOK | `📷 写真撮影：入居者様の顔が映らなければ可` |
| 要確認 | `📷 写真撮影：要確認` |
| 写真NG | `📷 写真撮影：不可` |
| 自由入力 | 追加モーダルで入力する。 |

初期実装では、自由入力は任意。まずは定型選択肢だけでもよい。

### 16.6 投稿タイトル

形式:

```text
{実施日}_{施設名}
```

例:

```text
2026.05.16_ボンセジュール植田
```

### 16.7 投稿本文

例:

```text
👥 @user1 @user2 @user3

📍 ボンセジュール植田
🕒 14:15-15:00
📢 集合：13:45 現地集合
📷 写真撮影：入居者様の顔が映らなければ可

📝 その他
何弾きます...
```

### 16.8 フォーラムタグ

投稿作成時に、可能であれば「予定」タグを自動付与する。

タグIDは環境変数または設定ファイルで管理する。

例:

```text
CONCERT_FORUM_CHANNEL_ID=...
CONCERT_TAG_PLANNED_ID=...
CONCERT_TAG_DONE_ID=...
```

### 16.9 作成後に保存する情報

将来の更新や活動後フォーム投稿に備え、botが作成したフォーラム投稿情報を保存する。

保存先はGoogle Sheetsの `ConcertThreads` シートを推奨する。

| カラム | 内容 |
|---|---|
| `concert_id` | 一意のID |
| `thread_id` | Discordフォーラム投稿のスレッドID |
| `starter_message_id` | 最初の投稿メッセージID |
| `forum_channel_id` | フォーラムチャンネルID |
| `title` | 投稿タイトル |
| `concert_date` | 実施日 |
| `facility_name` | 施設名 |
| `time` | 時間 |
| `meeting` | 集合 |
| `participant_ids` | 参加者Discord ID一覧 |
| `photo_policy` | 写真可否 |
| `note` | 補足 |
| `status` | `planned` / `done` / `cancelled` |
| `created_by` | 作成者Discord ID |
| `created_at` | 作成日時 |
| `updated_at` | 更新日時 |

---

## 17. `/concert update` 仕様

### 17.1 目的

botが作成したフォーラム投稿は人間が直接編集できないため、bot経由で本文・参加者・写真可否・ステータスを更新できるようにする。

### 17.2 コマンド概要

```text
/concert update
```

基本的には、対象のフォーラム投稿内で実行することを想定する。

### 17.3 更新対象

| 項目 | 更新可否 |
|---|---:|
| 実施日 | 可 |
| 施設名 | 可 |
| 時間 | 可 |
| 集合 | 可 |
| 参加者 | 可 |
| 写真可否 | 可 |
| 補足 | 可 |
| ステータスタグ | 可 |

### 17.4 入力フロー案

```text
/concert update
↓
現在の保存情報を取得
↓
更新種別を選択
  ・基本情報を更新
  ・参加者を更新
  ・写真可否を更新
  ・補足を更新
  ・ステータスを終了にする
↓
必要な入力UIを表示
↓
プレビュー
↓
[更新する] [キャンセル]
```

### 17.5 ステータス変更

「終了」に変更した場合、可能であればフォーラムタグを「予定」から「終了」へ変更する。

初期実装では、`planned` / `done` の2状態だけでよい。

---

# Phase 3: 活動後フォーム投稿補助

## 18. Phase 3の位置づけ

活動後フォーム投稿補助は、Phase 2でフォーラム投稿をbotが管理できるようになった後に検討する。

理由:

- 現状、活動後フォームの投稿先はコンサートごとのフォーラム投稿であり、投稿先が毎回変わる。
- Phase 2で `thread_id` を保存できれば、該当フォーラム投稿へ自動投稿できるようになる。
- Phase 2なしで活動後フォーム投稿を自動化すると、投稿先管理が煩雑になる。

## 19. 将来仕様案

`/concert create` 時に実施日を保存し、ReminderJobsまたはConcertThreadsの情報をもとに、実施日当日夜または翌日朝に活動後フォームURLを該当フォーラム投稿へ投稿する。

例:

```text
【活動記録フォーム入力のお願い】

本日参加したみなさん、おつかれさまでした！
今後の活動報告や記録整理のため、活動記録フォームへの入力をお願いします。

フォーム：{FORM_URL}
```

初期実装では必須にしない。

---

# Future: 個別依頼の日程確認

## 20. 位置づけ

個別依頼の日程確認は、月次依頼可能日時調査とは別機能として扱う。

施設から「この候補日のどれかで来られるか」という依頼が来た場合、スプレッドシートを作るほどではないため、Discordのメッセージとリアクションで簡易集計する方式が候補。

なおさんと相談のうえ、必要性が高ければ別途仕様化する。

## 21. 将来案

```text
/request poll
```

または

```text
/schedule poll
```

ただし、既存の `/schedule` が月次依頼可能日時調査を意味するため、混乱を避けるなら `/request poll` など別系統のほうが望ましい。

---

# 実装設計

## 22. 推奨ファイル構成

現状の構成に合わせ、以下を追加・改修する。

```text
src/
  index.ts
  commands/
    schedule.ts
    concert.ts        # 新規
    readme.ts
    hello.ts
  services/
    reminderJobs.ts   # 新規: ReminderJobs操作
    scheduleService.ts # 新規または既存schedule.tsから分離
    concertService.ts # 新規: フォーラム投稿作成・更新
    googleSheets.ts   # 既存を移動/再利用してもよい
  utils/
    date.ts           # 新規: JST日付処理
    discord.ts        # 新規: メンション・Embed等の共通処理
```

現在はコマンドファイル内に処理がまとまっているため、Phase 1実装時に最低限サービス層へ切り出すと、Phase 2以降が実装しやすい。

---

## 23. 環境変数

既存:

| 変数 | 用途 |
|---|---|
| `DISCORD_TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application client id |
| `GAS_API_URL` | GAS Web App URL |
| `PORT` | Honoサーバーポート |
| `HEALTH_CHECK_URL` | ヘルスチェック先URL |
| `NOTIFY_CHANNEL_ID` | 月初予定通知先 |
| `SCHEDULE_SHEET_URL` | 月初予定通知用シートURL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Googleサービスアカウント |
| `GOOGLE_PRIVATE_KEY` | Googleサービスアカウント秘密鍵 |
| `GOOGLE_SPREADSHEET_ID` | Google Sheets接続テスト用 |

追加候補:

| 変数 | 用途 |
|---|---|
| `REMINDER_SPREADSHEET_ID` | ReminderJobsを保存するスプレッドシートID |
| `REMINDER_JOBS_SHEET_NAME` | `ReminderJobs` |
| `CONCERT_FORUM_CHANNEL_ID` | コンサート計画フォーラムチャンネルID |
| `CONCERT_THREADS_SPREADSHEET_ID` | ConcertThreads保存先。ReminderJobsと同じでも可。 |
| `CONCERT_THREADS_SHEET_NAME` | `ConcertThreads` |
| `CONCERT_TAG_PLANNED_ID` | 「予定」タグID |
| `CONCERT_TAG_DONE_ID` | 「終了」タグID |
| `ACTIVITY_FORM_URL` | 活動後フォームURL。Phase 3用。 |

---

## 24. Discord権限

Phase 2実装時、botには以下の権限が必要。

- フォーラムチャンネルの閲覧
- フォーラム投稿作成
- スレッド内メッセージ送信
- 自分の投稿の編集
- フォーラムタグの付与・変更に必要な権限
- User Selectで選ばれたユーザーをメンションするための通常メッセージ送信権限

既存の `/readme` では `GuildMembers` intent を利用している。Phase 2のUser Select自体はDiscord UIから選択できるが、メンバー情報を扱う場合は既存のintent設定を維持する。

---

## 25. 実装ロードマップ

### Phase 0: 整理

- 現状コードをGitHub上で最新化する。
- `.env` に必要な環境変数を整理する。
- `schedule.ts` の既存挙動を壊さないように確認する。
- GAS側の `create` / `check` / `finish` の返却形式を確認する。

### Phase 1-1: `/schedule create` の締切日形式整理

- `deadline` を `deadline_date` として `YYYY-MM-DD` 形式に寄せる。
- 既存の自由入力形式を残すかは要検討。
- 入力値バリデーションを追加する。

### Phase 1-2: ReminderJobsシート作成

- `ReminderJobs` シートを作成する。
- botから読み書きできるようにする。
- `pending` / `running` / `done` / `error` / `cancelled` の状態管理を実装する。

### Phase 1-3: `/schedule create` からジョブ登録

- GASのcreate成功後、シートURLを受け取る。
- `schedule_remind_before` / `schedule_remind_deadline` / `schedule_finish` の3ジョブを登録する。

### Phase 1-4: 定期巡回

- `node-cron` で1時間ごとにReminderJobsを巡回する。
- 実行対象ジョブを取得し、順に処理する。
- 実行成功時は `done`、失敗時は `error` に更新する。

### Phase 1-5: `/schedule cancel`

- コマンド定義に `cancel` を追加する。
- URL指定で、対象シートに紐づく `pending` ジョブを `cancelled` に更新する。
- 結果をDiscordへ返信する。

### Phase 2-1: `/concert create` 基本実装

- `concert.ts` を追加する。
- `/concert create` を登録する。
- モーダルで実施日・施設名・時間・集合・補足を入力する。
- 入力内容を一時保持する。

### Phase 2-2: 参加者選択・写真可否選択

- User Selectで参加者を複数選択できるようにする。
- 写真可否をボタンまたはセレクトで選択できるようにする。
- 選択内容をプレビューに反映する。

### Phase 2-3: フォーラム投稿作成

- `CONCERT_FORUM_CHANNEL_ID` のフォーラムチャンネルへ投稿を作成する。
- タイトル・本文を自動整形する。
- 「予定」タグを付与する。
- 作成した `thread_id` / `starter_message_id` を保存する。

### Phase 2-4: `/concert update`

- 対象フォーラム投稿内で実行する。
- 保存済みのConcertThreadsから対象を取得する。
- 基本情報・参加者・写真可否・補足・ステータスを更新できるようにする。
- 「終了」タグへの変更を可能にする。

### Phase 3: 活動後フォーム投稿補助

- Phase 2運用が安定してから実装判断する。
- `ConcertThreads` の `concert_date` と `thread_id` を使って、実施後に活動後フォームURLを投稿する。

---

## 26. テスト観点

### Phase 1

- `/schedule create` で既存通りシートが作成される。
- 回答期限が `YYYY-MM-DD` 形式でない場合、分かりやすくエラーになる。
- create成功後にReminderJobsが3件作成される。
- run_atを過去日時にしたテストジョブが巡回で実行される。
- 未回答者がいる場合、既存check相当のリマインドが投稿される。
- 未回答者がいない場合、全員回答済みメッセージが投稿される。
- finish相当の集計が自動投稿される。
- `/schedule cancel` でpendingジョブだけがcancelledになる。
- doneジョブはcancelされない。
- GASエラー時にジョブがerrorになり、error_messageが記録される。

### Phase 2

- `/concert create` でモーダルが表示される。
- 実施日・施設名・時間・集合・補足がプレビューに反映される。
- User Selectで複数参加者を選べる。
- 写真可否の選択結果がプレビューに反映される。
- プレビューから投稿できる。
- フォーラム投稿タイトルが期待通りになる。
- フォーラム投稿本文が期待通りになる。
- 「予定」タグが付与される。
- ConcertThreadsにthread情報が保存される。
- `/concert update` で本文更新できる。
- `/concert update` で参加者更新できる。
- `/concert update` で「終了」タグへ変更できる。

---

## 27. リスクと対策

| リスク | 対策 |
|---|---|
| Koyeb上でbotが一時停止し、予定時刻に実行できない | ReminderJobsにpending状態で保存し、復帰後に `run_at <= now` のジョブを実行する。 |
| Google SheetsはDBではないため排他制御が弱い | botを1インスタンス運用にする。実行前にstatusをrunningへ更新する。 |
| deadlineの自由入力で日付解釈に失敗する | `YYYY-MM-DD` 形式を必須にする。 |
| コマンドが増えすぎる | Phase 1は `/schedule cancel` のみ追加。Phase 2は `/concert create` / `/concert update` に絞る。 |
| botが作ったフォーラム投稿を人間が編集できない | `/concert update` を用意する。 |
| User Selectで関係ないメンバーを選ぶ可能性 | プレビュー確認を必須にする。必要なら将来ロール運用で絞る。 |
| フォーラムタグIDが環境により違う | `.env` でタグIDを設定する。 |

---

## 28. Google Antigravity / Codexへの実装指示メモ

実装時は、まずPhase 1のみを対象にすること。Phase 2はPhase 1が動作確認できてから着手する。

### 最初に確認すること

1. 現在のリポジトリ構成。
2. `discord.js` のバージョン。
3. TypeScriptビルド設定。
4. Koyeb上の環境変数。
5. GAS APIの `create` / `check` / `finish` のレスポンス形式。
6. Google Sheets APIをbot側で直接使うか、ReminderJobs操作もGASへ寄せるか。

### Phase 1の実装方針

- 既存の `/schedule check` / `/schedule finish` の処理を再利用できるように関数化する。
- 自動ジョブからも手動コマンドからも同じロジックを呼べるようにする。
- ReminderJobs操作は `services/reminderJobs.ts` に分離する。
- 日付処理はJST前提で統一する。

### Phase 2の実装方針

- `/concert create` はInteractionの状態管理が必要になるため、処理を小さく分ける。
- モーダル送信、User Select、写真可否選択、プレビュー、投稿確定のcustomIdを設計する。
- 一時状態は最初はメモリ上でもよいが、途中でbot再起動すると消えるため、実装難易度と相談する。
- 投稿確定後の永続データは必ずConcertThreadsへ保存する。

---

## 29. 最終優先順位

1. `/schedule create` の締切日形式整理。
2. ReminderJobsシート設計・実装。
3. `/schedule create` からのジョブ自動登録。
4. 1時間ごとの自動巡回。
5. 自動リマインド・自動集計。
6. `/schedule cancel`。
7. `/concert create`。
8. `/concert update`。
9. 活動後フォーム投稿補助。
10. 個別依頼の日程確認リアクション集計。

---

## 30. まとめ

今回のbot改善では、まず月次依頼可能日時調査のリマインド・集計を自動化する。これは現状の手動運用負担を直接減らすため、最優先で実装する価値がある。

次に、コンサート確定後のフォーラム投稿管理を導入する。単なるテンプレ生成ではなく、参加者選択・写真可否選択・投稿作成・後日更新まで含めることで、実際に使う価値のある機能にする。

曲リスト、活動前チェック、既読管理の自動化は今回対象外とし、コマンド数と運用負担を増やしすぎない設計にする。
