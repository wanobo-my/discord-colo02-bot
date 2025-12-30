import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts'));

// commandsフォルダの中身を全部読み込む
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
    } else {
        console.log(`[警告] ${filePath} に必要な "data" または "execute" がありません。`);
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

// 登録処理
(async () => {
    try {
        console.log(`${commands.length} 個のコマンドを登録・更新します...`);

        // 現在のBotが入っている全てのサーバーに対してコマンドを登録（開発用）
        // ※ 本番では Routes.applicationCommands(clientId) を使うことが多いですが
        //    反映に時間がかかるため、開発中はサーバーID指定で登録するのが確実です。
        
        // 今回はシンプルにするため「グローバル登録」を行います（全サーバー共通）
        // ※反映に最大1時間かかる場合がありますが、一番手軽です。
        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID!),
            { body: commands },
        );

        console.log(`✅ コマンドの登録が完了しました！`);
    } catch (error) {
        console.error(error);
    }
})();