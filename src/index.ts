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