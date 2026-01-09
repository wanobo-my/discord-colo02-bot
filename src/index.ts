import { Client, GatewayIntentBits, Interaction, Events } from 'discord.js';
import dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import cron from 'node-cron';
import * as scheduleCommand from './commands/schedule.js';
import * as helloCommand from './commands/hello.js'; 
import * as readmeCommand from './commands/readme.js';

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
cron.schedule("25 2 10 * *", async () => {
    console.log("📅 (テスト中)月初の予定通知を実行します...");

    //const NOTIFY_CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID;
    const NOTIFY_CHANNEL_ID = "1358458777589780732";

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
        let messageText = `おはようございます！今月のコンサートは${count}件です！\n`;

        if (count === 0) {
            messageText += "今月の予定はまだありません。練習期間ですね！☕";
        } else if (count === 1) {
            messageText += "1件を丁寧に楽しく準備しましょう！笑顔で^_^";
        } else if (count === 2) {
            messageText += "少しゆったりモード！しっかり準備して楽しみましょう✌️";
        } else if (count === 3) {
            messageText += "今月もがんばりましょー！🤖";
        } else if (count === 4) {
            messageText += "たくさん依頼があります！準備大切に🌱";
        } else if (count === 5) {
            messageText += "忙しくなりそうです...！楽しみつつがんばりましょう💪";
        } else { // 6件以上
            messageText += "color大人気です💥 がんばろう〜〜٩( ᐛ )و";
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
                embed.addFields({
                    name: `🎵 ${e.date} ${e.time}`,
                    value: `📍 **場所**: ${e.place}\n👥 **メンバー**: ${e.member}`,
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
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    // ▼▼▼ 各ファイルの中にある execute() を呼び出します ▼▼▼
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
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'コマンド実行中にエラーが発生しました。', ephemeral: true });
        } else {
            await interaction.reply({ content: 'コマンド実行中にエラーが発生しました。', ephemeral: true });
        }
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

const token = process.env.DISCORD_TOKEN;
if (!token) {
    throw new Error('❌ DISCORD_TOKEN が設定されていません');
}

client.login(token);