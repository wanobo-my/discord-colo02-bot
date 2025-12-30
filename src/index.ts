import { Client, GatewayIntentBits, Interaction, TextChannel } from 'discord.js';
import dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import cron from 'node-cron'; // ✨ Cronを追加
import * as scheduleCommand from './commands/schedule.js';

dotenv.config();

// =====================================================
// 🌍 1. Koyeb用 Webサーバー設定 (Hono)
// =====================================================
const app = new Hono();

// UptimeRobotなどがアクセスする場所
app.get('/', (c) => c.text('Bot is active!'));

const port = parseInt(process.env.PORT || '8000');
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port: port
});

// =====================================================
// ⏰ 2. 定期実行設定 (Cron)
// =====================================================
// 例: 5分ごとにログを表示（ここに「定期リクエスト」の処理を書けます）
cron.schedule('*/5 * * * *', () => {
    console.log('⏰ Cron: 5分経過。Botは正常に稼働中です。');
    
    // もし「自分自身にリクエストを送る」ならここで fetch を使います
    // fetch('https://あなたのアプリ.koyeb.app/'); 
});

// =====================================================
// 🤖 3. Discord Bot設定
// =====================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`🚀 準備完了！ ${client.user?.tag} が起動しました`);
});

client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'schedule') {
        await scheduleCommand.execute(interaction);
    }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
    throw new Error('❌ DISCORD_TOKEN が設定されていません');
}

client.login(token);