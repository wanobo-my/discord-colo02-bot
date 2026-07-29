/**
 * チャンネルID を調べるための読み取り専用ユーティリティ。
 *
 * 使い方:
 *   npx tsx scripts/find-channel-ids.ts            # フォーラムチャンネルだけ表示
 *   npx tsx scripts/find-channel-ids.ts --all      # すべてのチャンネルを表示
 *   npx tsx scripts/find-channel-ids.ts 写真        # 名前に「写真」を含むものを表示
 *
 * Discord の開発者モードを有効にしなくても、環境変数に設定すべき ID を調べられます。
 * REST API のみを使い、Gateway 接続は張りません。読み取りのみで、何も変更しません。
 */

import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

// https://discord.com/developers/docs/resources/channel#channel-object-channel-types
const CHANNEL_TYPE_NAMES: Record<number, string> = {
    0: 'テキスト',
    2: 'ボイス',
    4: 'カテゴリ',
    5: 'アナウンス',
    13: 'ステージ',
    15: 'フォーラム',
    16: 'メディア',
};

const FORUM_TYPE = 15;

async function main() {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error('❌ DISCORD_TOKEN が設定されていません。');
        process.exit(1);
    }

    const args = process.argv.slice(2);
    const showAll = args.includes('--all');
    const keyword = args.find((a) => !a.startsWith('--'));

    const rest = new REST({ version: '10' }).setToken(token);
    const guilds = (await rest.get(Routes.userGuilds())) as any[];

    for (const guild of guilds) {
        const channels = (await rest.get(Routes.guildChannels(guild.id))) as any[];

        const matched = channels.filter((channel) => {
            if (keyword) return String(channel.name).includes(keyword);
            if (showAll) return true;
            return channel.type === FORUM_TYPE;
        });

        if (matched.length === 0) continue;

        console.log(`\n[サーバー] ${guild.name}  (ID: ${guild.id})`);
        for (const channel of matched) {
            const typeName = CHANNEL_TYPE_NAMES[channel.type] ?? `種別${channel.type}`;
            console.log(`  ${channel.id}  [${typeName}] ${channel.name}`);
            if (channel.type === FORUM_TYPE) {
                console.log(`      → CONCERT_FORUM_CHANNEL_ID の候補`);
                // フォーラムのタグID (CONCERT_TAG_PLANNED_ID / CONCERT_TAG_DONE_ID 用)
                for (const tag of channel.available_tags ?? []) {
                    console.log(`      タグ: ${tag.id}  ${tag.name}`);
                }
            }
        }
    }

    console.log('\nℹ️ 読み取りのみ実行しました。何も変更していません。');
}

main().catch((error: any) => {
    console.error('❌ エラー:', error.message);
    process.exit(1);
});
