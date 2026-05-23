import { Client, GatewayIntentBits, Interaction, Events, EmbedBuilder, TextChannel, ThreadChannel } from 'discord.js';
import dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import cron from 'node-cron';
import * as scheduleCommand from './commands/schedule.js';
import * as helloCommand from './commands/hello.js'; 
import * as readmeCommand from './commands/readme.js';
import * as concertCommand from './commands/concert.js';
import { getExecutableJobs, updateJob } from './services/reminderJobs.js';
import { getAllConcertThreads, updateConcertThread } from './services/concertService.js';
import { checkIncompleteUsers, generateTallyEmbed, USER_MAP } from './commands/schedule.js';
import { toJstIsoString, getJstNow } from './utils/date.js';

dotenv.config();

// ポート設定
const PORT = parseInt(process.env.PORT || '8000');

// =====================================================
// 🌍 1. Hono Webサーバー設定 (ご提示のコードを統合)
// =====================================================
const app = new Hono();

// ヘルスチェック用のエンドポイント
app.get("/", (c) => {
  return c.json({
    status: "ok",
    message: "Discord Bot is running",
    node_version: process.version,
    timestamp: new Date().toISOString(),
  });
});

console.log(`Server is running on port ${PORT}`);

serve({
  fetch: app.fetch,
  port: PORT
});

// =====================================================
// ⏰ 2. 定期実行設定 (ご提示のコードを統合)
// =====================================================
// 環境変数 HEALTH_CHECK_URL があればそれを、なければ localhost を使う
const HEALTH_CHECK_URL = process.env.HEALTH_CHECK_URL || `http://localhost:${PORT}`;

console.log(`🕐 ヘルスチェックの定期実行を開始しました (10分間隔) - Target: ${HEALTH_CHECK_URL}`);

// 10分ごとにヘルスチェックを実行
cron.schedule("*/10 * * * *", async () => {
  try {
    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    console.log(`🔍 [${now}] ヘルスチェック実行中... (${HEALTH_CHECK_URL})`);
    
    const response = await fetch(HEALTH_CHECK_URL);

    if (response.ok) {
      console.log(`✅ [${now}] ヘルスチェック成功: ${response.status}`);
    } else {
      console.warn(`⚠️ [${now}] ヘルスチェック失敗: ${response.status}`);
    }
  } catch (error) {
    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    console.error(`❌ [${now}] ヘルスチェックエラー:`, error);
  }
});

// (2) ✨ 月初のコンサート予定通知 (毎月1日 AM9:00)
// Cron式: 0 9 1 * * = 毎月1日の 9:00
cron.schedule("0 9 1 * *", async () => {
    console.log("📅 月初の予定通知を実行します...");

    const NOTIFY_CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID;
    //const NOTIFY_CHANNEL_ID = "1224642207978491997";

    const SCHEDULE_SHEET_URL = process.env.SCHEDULE_SHEET_URL;
    const GAS_API_URL = process.env.GAS_API_URL;

    if (!NOTIFY_CHANNEL_ID || !SCHEDULE_SHEET_URL || !GAS_API_URL) {
        console.error("❌ 環境変数が設定されていません");
        return;
    }

    try {
        // GASから予定を取得
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'get_monthly', sheetUrl: SCHEDULE_SHEET_URL }),
        });
        const result = await response.json() as any;

        if (!result.success) throw new Error(result.message);

        const events = result.events;
        const channel = await client.channels.fetch(NOTIFY_CHANNEL_ID) as TextChannel;

        if (!channel) return;

        // ------------------------------------------------
        // 🎨 1. ランダムカラーの決定
        // ------------------------------------------------
        // 水色, ピンク, 黄色, 黄緑, ライラック のHexコード
        const colors = [
            0xADD8E6, // Light Blue
            0xFFC0CB, // Pink
            0xFFFF00, // Yellow
            0x9ACD32, // YellowGreen
            0xC8A2C8  // Lilac
        ];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        // ------------------------------------------------
        // 💬 2. 件数別メッセージの決定
        // ------------------------------------------------
        const count = events.length;
        const targetRole = "<@&1374042129201893396>";
        let messageText = `${targetRole}\nオハヨウゴザイマス！今月のコンサートは${count}件デス！\n`;

        if (count === 0) {
            messageText += "今月の予定はまだありません。練習期間デスネ！☕";
        } else if (count === 1) {
            messageText += "1件を丁寧に楽しく準備シマショウ！笑顔で^_^";
        } else if (count === 2) {
            messageText += "少しゆったりモード！しっかり準備シテ楽しみマショウ✌️";
        } else if (count === 3) {
            messageText += "今月もガンバリマショー！🤖";
        } else if (count === 4) {
            messageText += "たくさん依頼がアリマス！準備大切に🌱";
        } else if (count === 5) {
            messageText += "忙しくなりそうデス...！楽しみつつがんばりマショウ💪";
        } else { // 6件以上
            messageText += "color大人気デス💥 ガンバロ〜〜٩( ᐛ )و";
        }

        // ------------------------------------------------
        // 📦 3. 通知の送信
        // ------------------------------------------------
        if (count === 0) {
             await channel.send(messageText);
        } else {
            // Embedを作成
            const embed = new EmbedBuilder()
                .setTitle(`📅 今月(${new Date().getMonth() + 1}月)のコンサート予定`)
                .setColor(randomColor) // ✨ ランダムカラーを適用
                .setDescription("今月のスケジュール詳細です👇")
                .setTimestamp();

            events.forEach((e: any) => {
                // ✨ 1. (数字) を (数字回目) に書き換える処理
                // GASから来た "施設名 (3)" という文字の、最後の "(3)" だけを見つけて加工します
                const placeFormatted = e.place.replace(/\((\d+)\)$/, '($1回目)');
                embed.addFields({
                    name: `${e.date} ${e.time}`,
                    value: `📍 **場所**: ${placeFormatted}\n👥 **メンバー**: ${e.member}\n────────────────`,
                    inline: false
                });
            });

            // メッセージ送信
            await channel.send({ content: messageText, embeds: [embed] });
        }

    } catch (error) {
        console.error("❌ 予定通知のエラー:", error);
    }
}, {
    timezone: "Asia/Tokyo"
});

// =====================================================
// (3) 🤖 月末のスプレッドシート更新リマインダー (毎月28日 AM9:00)
// =====================================================
cron.schedule("00 20 28 * *", async () => {
    console.log("📅 月末のリマインダーを実行します...");

    // ご指定いただいたチャンネルID
    const REMIND_CHANNEL_ID = "1358406882208780482";

    try {
        const channel = await client.channels.fetch(REMIND_CHANNEL_ID) as TextChannel;
        if (!channel) return;

        // 🤖 フランクなロボット風メッセージ
        const messageText = `ピピピッ！🤖 そろそろ来月になっちゃいマス！
TimeTreeの予定をスプレッドシートに転記シマショウ⚡️
あとで焦らないように、今のうちにサクッと更新しておくのがオススメデース！

[✏︎今すぐ入力する](https://docs.google.com/spreadsheets/d/107NQnqETbr4COKh4DPyIkabcd3CkwbT6UgRLYtG4IHQ/edit?usp=drivesdk)

よろしく頼むヨー！⚙️`;

        await channel.send(messageText);
        
    } catch (error) {
        console.error("❌ リマインダー通知のエラー:", error);
    }
}, {
    timezone: "Asia/Tokyo"
});

// =====================================================
// ⏰ (4) 自動ジョブの定期巡回 (1時間ごと)
// =====================================================
cron.schedule("0 * * * *", async () => {
    console.log("⏰ [cron] 自動ジョブの巡回を開始します...");
    await processReminderJobs();
}, {
    timezone: "Asia/Tokyo"
});

/**
 * 実行期限の過ぎた pending ジョブを処理します。
 */
async function processReminderJobs() {
    try {
        const jobs = await getExecutableJobs();
        if (jobs.length === 0) {
            console.log("⏰ [cron] 実行対象のジョブはありませんでした。");
            return;
        }

        console.log(`⏰ [cron] ${jobs.length} 件のジョブを実行します。`);

        for (const job of jobs) {
            console.log(`⏰ [cron] ジョブ実行開始 - ID: ${job.jobId}, Type: ${job.jobType}, Event: ${job.eventName}`);
            
            if (!job.rowNumber) {
                console.error(`❌ ジョブの行番号が不明です。ID: ${job.jobId}`);
                continue;
            }

            // 1. 二重実行防止のためにステータスを running に更新
            try {
                await updateJob(job.rowNumber, { status: 'running' });
            } catch (err: any) {
                console.error(`❌ ジョブステータスを running に更新できませんでした:`, err.message);
                continue;
            }

            try {
                const gasUrl = process.env.GAS_API_URL;
                if (!gasUrl) throw new Error("GAS_API_URL が設定されていません。");

                // Discordのチャンネルを取得
                const channel = await client.channels.fetch(job.channelId) as TextChannel;
                if (!channel) throw new Error(`チャンネルが見つかりません。ID: ${job.channelId}`);

                if (job.jobType === 'schedule_remind_before' || job.jobType === 'schedule_remind_deadline') {
                    // 未回答チェック
                    const result = await checkIncompleteUsers(gasUrl, job.sheetUrl);
                    
                    if (result.names.length === 0) {
                        // 全員回答済み
                        const embed = new EmbedBuilder()
                            .setTitle(`🎉 「${job.eventName}」は全員回答済みです！`)
                            .setColor(0x00FF00) // Green
                            .setDescription('みんな協力ありがとう！');
                        await channel.send({ embeds: [embed] });
                    } else {
                        // 未回答者がいる場合
                        const mentions = result.names.map(name => USER_MAP[name] ? `<@${USER_MAP[name]}>` : name);
                        const mentionString = mentions.join(' ');
                        
                        let title = '📣 リマインド・回答してね！';
                        let desc = `「${job.eventName}」の回答締切は明日です。\n未回答の人は、シートを確認して入力をお願いします！`;
                        
                        if (job.jobType === 'schedule_remind_deadline') {
                            title = '📣 最終リマインド・回答お願いします！';
                            desc = `「${job.eventName}」の回答締切は今日です。\nまだ未回答の人は、今日中に入力をお願いします！`;
                        }

                        const embed = new EmbedBuilder()
                            .setTitle(title)
                            .setColor(0xFFA500) // Orange
                            .setDescription(`${desc}\n\n${mentionString}\n\n**📎 シートURL**\n[クリックして回答する](${job.sheetUrl})`)
                            .setFooter({ text: `未回答: ${result.names.length}名` })
                            .setTimestamp();
                        
                        await channel.send({ content: mentionString, embeds: [embed] });
                    }
                } 
                else if (job.jobType === 'schedule_finish') {
                    // 自動集計
                    const embed = await generateTallyEmbed(gasUrl, job.sheetUrl);
                    await channel.send({ embeds: [embed] });
                }
                else {
                    throw new Error(`未知のジョブタイプです: ${job.jobType}`);
                }

                // 成功したら done に更新
                const nowJstStr = toJstIsoString(getJstNow());
                await updateJob(job.rowNumber, {
                    status: 'done',
                    executedAt: nowJstStr
                });
                console.log(`✅ [cron] ジョブ実行完了 - ID: ${job.jobId}`);

            } catch (error: any) {
                console.error(`❌ [cron] ジョブ実行エラー - ID: ${job.jobId}:`, error.message);
                
                // 失敗時は error に更新
                await updateJob(job.rowNumber, {
                    status: 'error',
                    errorMessage: error.message,
                    retryCount: job.retryCount + 1
                });
            }
        }
    } catch (err: any) {
        console.error("❌ [cron] 巡回処理全体のエラー:", err.message);
    }
}

// =====================================================
// 🤖 3. Discord Bot設定
// =====================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions, // リアクションを見る能力
        GatewayIntentBits.GuildMembers           // メンバー名簿を見る能力
    ]
});

client.once('ready', () => {
    console.log(`🚀 準備完了！ ${client.user?.tag} が起動しました`);
});

client.on('interactionCreate', async (interaction: Interaction) => {
    // 1. スラッシュコマンドの処理
    if (interaction.isCommand()) {
        const { commandName } = interaction;

        try {
            if (commandName === 'schedule') {
                await scheduleCommand.execute(interaction);
            } 
            else if (commandName === 'hello') {
                await helloCommand.execute(interaction);
            }
            else if (commandName === 'readme') {
                await readmeCommand.execute(interaction);
            }
            else if (commandName === 'concert') {
                await concertCommand.execute(interaction);
            }
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'コマンド実行中にエラーが発生しました。', ephemeral: true });
            } else {
                await interaction.reply({ content: 'コマンド実行中にエラーが発生しました。', ephemeral: true });
            }
        }
        return;
    }

    // 2. モーダル送信の処理
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('concert_')) {
            await concertCommand.handleModalSubmit(interaction);
        }
        return;
    }

    // 3. ユーザー選択メニューの処理
    if (interaction.isUserSelectMenu()) {
        if (interaction.customId.startsWith('concert_')) {
            await concertCommand.handleUserSelect(interaction);
        }
        return;
    }

    // 4. ボタンクリックの処理
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('concert_')) {
            await concertCommand.handleButton(interaction);
        }
        return;
    }
});
client.on(Events.MessageCreate, async message => {
    // Bot自身の発言や、Botによる発言は無視
    if (message.author.bot) return;

    // Botがメンションに含まれているかチェック
    if (message.mentions.users.has(client.user!.id)) {
        try {
            // ランダムで選ぶリアクションのリスト
            const emojis = ['👀', '❤️', '👍', '🙋‍♀️', '🌱', '🤖', '✒️', '🍀', '😎'];
            
            // ランダムに1つ選ぶ
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

            // 選ばれたリアクションをつける
            await message.react(randomEmoji);
            
        } catch (error) {
            console.error('リアクションの追加に失敗しました:', error);
        }
    }
});

// =====================================================
// 🏷️ (5) 手動でのフォーラムスレッドタグ更新の同期
// =====================================================
client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
    const forumChannelId = process.env.CONCERT_FORUM_CHANNEL_ID;
    if (!forumChannelId || newThread.parentId !== forumChannelId) return;

    const doneTagId = process.env.CONCERT_TAG_DONE_ID;
    if (!doneTagId) return;

    // タグが「終了」に変更されたかを検知
    const wasDone = oldThread.appliedTags.includes(doneTagId);
    const isDone = newThread.appliedTags.includes(doneTagId);

    if (!wasDone && isDone) {
        console.log(`ℹ️ [threadUpdate] スレッド ID: ${newThread.id} のタグが手動で「終了」に更新されました。`);

        // スプレッドシートから対象のレコードを検索
        const allConcerts = await getAllConcertThreads();
        const concert = allConcerts.find(c => c.threadId === newThread.id);
        
        // すでに done になっている二重送信を防ぐ
        if (concert && concert.status === 'planned' && concert.rowNumber) {
            try {
                // スプレッドシートのステータスを更新
                await updateConcertThread(concert.rowNumber, { status: 'done' });
                
                // 活動報告フォームを自動投稿
                await concertCommand.postActivityForm(newThread as ThreadChannel);
            } catch (error: any) {
                console.error(`❌ [threadUpdate] 手動終了同期エラー:`, error.message);
            }
        }
    }
});

// =====================================================
// ⏰ (6) 当日コンサートの自動終了・フォーム投稿 (毎日 17:00)
// =====================================================
cron.schedule("0 17 * * *", async () => {
    console.log("⏰ [cron] 当日コンサートの自動終了処理を開始します...");
    try {
        await autoCloseConcertsForToday();
    } catch (error: any) {
        console.error("❌ 当日コンサート自動終了処理のエラー:", error.message);
    }
}, {
    timezone: "Asia/Tokyo"
});

/**
 * 本日実施予定のコンサートについて、自動的にステータスを終了に変更し、
 * タグの更新および活動報告フォームの自動投稿を行います。
 */
async function autoCloseConcertsForToday() {
    const allConcerts = await getAllConcertThreads();
    const now = getJstNow();
    
    // 比較用日付文字列 (YYYY.MM.DD および YYYY-MM-DD)
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const todayDot = `${yyyy}.${mm}.${dd}`;
    const todayDash = `${yyyy}-${mm}-${dd}`;
    
    const todaysConcerts = allConcerts.filter(c => 
        c.status === 'planned' && 
        (c.concertDate.trim() === todayDot || c.concertDate.trim() === todayDash)
    );

    if (todaysConcerts.length === 0) {
        console.log("⏰ [cron] 本日実施予定の未終了コンサートはありません。");
        return;
    }

    console.log(`⏰ [cron] ${todaysConcerts.length} 件のコンサートを自動終了処理します...`);

    for (const concert of todaysConcerts) {
        if (!concert.rowNumber) continue;

        try {
            // 1. スプレッドシート更新
            await updateConcertThread(concert.rowNumber, { status: 'done' });

            // 2. Discord側の処理 (タグ変更 & フォーム投稿)
            const thread = await client.channels.fetch(concert.threadId);
            if (thread && thread instanceof ThreadChannel) {
                const doneTagId = process.env.CONCERT_TAG_DONE_ID;
                if (doneTagId) {
                    await thread.setAppliedTags([doneTagId]);
                }
                
                // 活動報告フォームを自動投稿
                await concertCommand.postActivityForm(thread);
            }
            console.log(`✅ [cron] コンサート「${concert.title}」を自動終了しました。`);
        } catch (error: any) {
            console.error(`❌ [cron] コンサート「${concert.title}」の自動終了エラー:`, error.message);
        }
    }
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
    throw new Error('❌ DISCORD_TOKEN が設定されていません');
}

client.login(token);