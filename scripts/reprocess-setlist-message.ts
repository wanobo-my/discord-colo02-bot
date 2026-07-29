/**
 * 既存のメッセージに対して曲目リストの回収処理をもう一度実行するスクリプト。
 *
 * 使い方:
 *   npx tsx scripts/reprocess-setlist-message.ts <スレッドIDまたはスレッド名> <メッセージID>
 *
 * 何のためにあるか:
 *   通常の運用では messageCreate は 1 メッセージにつき 1 回しか発火しないため、
 *   「同じメッセージを 2 度処理しても二重にファイルが作られない」という冪等性を
 *   実地で確認できません。このスクリプトは意図的に再処理を起こして確認するためのものです。
 *
 *   1 回目: アップロードされ ✅ が付く
 *   2 回目: 「既に ✅ が付いているためスキップ」となり、ファイルは増えない
 *
 *   フェーズ5のバックフィル実装の土台としても使えます。
 *
 * 注意:
 *   SETLIST_MODE=on のときだけ実際にアップロードします (dryrun ならログのみ)。
 *   Gateway に接続するため、ローカル bot を起動したまま実行すると一時的に
 *   セッションが増えますが、このスクリプトはイベントリスナーを登録しないので
 *   リアクションの重複などは起きません。処理が終わると自動で切断します。
 */

import { Client, GatewayIntentBits, ThreadChannel } from 'discord.js';
import dotenv from 'dotenv';
import { handleSetlistMessage, getSetlistMode } from '../src/services/setlistCollector.js';

dotenv.config();

const SNOWFLAKE = /^\d{17,20}$/;

async function main() {
    const [target, messageId] = process.argv.slice(2);

    if (!target || !messageId) {
        console.error('❌ スレッド（IDまたは名前）とメッセージIDを指定してください。');
        console.error('   例: npx tsx scripts/reprocess-setlist-message.ts "2026.07.30_テストモード" 1531884292546891846');
        process.exit(1);
    }
    if (!SNOWFLAKE.test(messageId)) {
        console.error(`❌ メッセージIDの形式が正しくありません: ${messageId}`);
        process.exit(1);
    }

    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error('❌ DISCORD_TOKEN が設定されていません。');
        process.exit(1);
    }

    console.log(`ℹ️ 現在の SETLIST_MODE: ${getSetlistMode()}`);

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMessageReactions,
        ],
    });

    // イベントリスナーは登録しない (本番botと二重に反応しないため)
    client.on('error', (error) => console.error('❌ クライアントエラー:', error));

    await client.login(token);
    await new Promise<void>((resolve) => client.once('ready', () => resolve()));
    console.log(`✅ ${client.user?.tag} として接続しました`);

    try {
        const thread = await resolveThread(client, target);
        console.log(`   スレッド: ${thread.name} (ID: ${thread.id})`);

        const message = await thread.messages.fetch(messageId);
        console.log(`   メッセージ: ${message.author.tag} / 添付 ${message.attachments.size} 件`);
        console.log(`   現在のリアクション: ${[...message.reactions.cache.keys()].join(' ') || '(なし)'}`);
        console.log('');
        console.log('--- 回収処理を実行します ---');

        await handleSetlistMessage(message);

        console.log('--- 実行完了 ---');
    } finally {
        await client.destroy();
        console.log('🔌 切断しました');
    }
}

async function resolveThread(client: Client, target: string): Promise<ThreadChannel> {
    if (SNOWFLAKE.test(target)) {
        const channel = await client.channels.fetch(target);
        if (!(channel instanceof ThreadChannel)) {
            throw new Error(`指定されたチャンネルはスレッドではありません: ${target}`);
        }
        return channel;
    }

    const forumChannelId = process.env.CONCERT_FORUM_CHANNEL_ID;
    if (!forumChannelId) {
        throw new Error('CONCERT_FORUM_CHANNEL_ID が未設定のため、スレッド名では検索できません。');
    }

    const forum: any = await client.channels.fetch(forumChannelId);
    const active = await forum.threads.fetchActive();
    const archived = await forum.threads.fetchArchived();

    const found = [...active.threads.values(), ...archived.threads.values()].filter(
        (t: any) => t.name === target
    );

    if (found.length === 0) throw new Error(`「${target}」という名前のスレッドが見つかりませんでした。`);
    if (found.length > 1) {
        throw new Error(
            `「${target}」に一致するスレッドが ${found.length} 件あります。スレッドIDで指定してください。`
        );
    }
    return found[0] as ThreadChannel;
}

main().catch((error: any) => {
    console.error('❌ エラー:', error.message);
    process.exit(1);
});
