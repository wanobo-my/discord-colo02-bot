/**
 * フェーズ3の検証用: 曲目リストの案内メッセージ（返信先）だけを投稿するスクリプト。
 *
 * 使い方:
 *   # 何が投稿されるかを確認するだけ (投稿しない)
 *   npx tsx scripts/post-setlist-anchor.ts "2026.07.30_テストモード"
 *
 *   # 実際に投稿する
 *   npx tsx scripts/post-setlist-anchor.ts "2026.07.30_テストモード" --post
 *
 * スレッド名の代わりにスレッドIDを渡すこともできます。
 *
 * なぜこれが必要か:
 *   Koyeb の本番 bot はまだ変更前のコードで動いているため、「曲目リスト」の案内文を
 *   含むメッセージを投稿しません。またローカル bot を起動して /concert update を使うと、
 *   本番 bot と同じ操作を二重に受け取り Interaction が競合します (実測で確認済み)。
 *
 *   このスクリプトは Gateway 接続を張らず REST API だけを使うため、本番 bot と競合しません。
 *   スプレッドシートの更新や写真アルバムスレッドの作成といった副作用も一切ありません。
 *   投稿されるのは指定スレッドへの 1 メッセージだけです。
 */

import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { buildActivityFormMessage } from '../src/commands/concert.js';

dotenv.config();

interface ThreadInfo {
    id: string;
    name: string;
    parentId: string | null;
}

const SNOWFLAKE = /^\d{17,20}$/;

async function resolveThread(rest: REST, input: string): Promise<ThreadInfo> {
    // スレッドIDが直接渡された場合
    if (SNOWFLAKE.test(input)) {
        const channel = (await rest.get(Routes.channel(input))) as any;
        return { id: channel.id, name: channel.name, parentId: channel.parent_id ?? null };
    }

    // スレッド名で検索する
    const forumChannelId = process.env.CONCERT_FORUM_CHANNEL_ID;
    if (!forumChannelId) {
        throw new Error('CONCERT_FORUM_CHANNEL_ID が未設定のため、スレッド名では検索できません。スレッドIDを指定してください。');
    }

    const forum = (await rest.get(Routes.channel(forumChannelId))) as any;
    const guildId = forum.guild_id as string;

    const candidates: ThreadInfo[] = [];

    const active = (await rest.get(Routes.guildActiveThreads(guildId))) as any;
    for (const thread of active.threads ?? []) {
        if (thread.parent_id === forumChannelId && thread.name === input) {
            candidates.push({ id: thread.id, name: thread.name, parentId: thread.parent_id });
        }
    }

    // アクティブに無ければアーカイブ済みも探す
    if (candidates.length === 0) {
        const archived = (await rest.get(Routes.channelThreads(forumChannelId, 'public'))) as any;
        for (const thread of archived.threads ?? []) {
            if (thread.name === input) {
                candidates.push({ id: thread.id, name: thread.name, parentId: thread.parent_id ?? forumChannelId });
            }
        }
    }

    if (candidates.length === 0) {
        throw new Error(`「${input}」という名前のスレッドがコンサートフォーラム内に見つかりませんでした。`);
    }
    if (candidates.length > 1) {
        throw new Error(
            `「${input}」に一致するスレッドが ${candidates.length} 件あります。スレッドIDで指定してください。\n` +
            candidates.map((c) => `  - ${c.name} (ID: ${c.id})`).join('\n')
        );
    }

    return candidates[0];
}

async function main() {
    const args = process.argv.slice(2);
    const shouldPost = args.includes('--post');
    const target = args.find((a) => a !== '--post');

    if (!target) {
        console.error('❌ 対象のスレッド名またはスレッドIDを指定してください。');
        console.error('   例: npx tsx scripts/post-setlist-anchor.ts "2026.07.30_テストモード"');
        process.exit(1);
    }

    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error('❌ DISCORD_TOKEN が設定されていません。');
        process.exit(1);
    }

    const rest = new REST({ version: '10' }).setToken(token);
    const thread = await resolveThread(rest, target);

    const forumChannelId = process.env.CONCERT_FORUM_CHANNEL_ID;
    const inForum = !forumChannelId || thread.parentId === forumChannelId;

    const message = buildActivityFormMessage();

    console.log('=== 投稿先 ===');
    console.log(`  スレッド名 : ${thread.name}`);
    console.log(`  スレッドID : ${thread.id}`);
    console.log(`  親チャンネル: ${thread.parentId ?? '(不明)'}${inForum ? ' ✅ コンサートフォーラム配下' : ' ⚠️ フォーラム外です'}`);
    console.log('');
    console.log('=== 投稿されるメッセージ ===');
    console.log('----------------------------------------');
    console.log(message);
    console.log('----------------------------------------');
    console.log('');

    if (!inForum) {
        console.warn('⚠️ このスレッドはコンサートフォーラム配下ではないため、投稿しても曲目リストの検知対象になりません。');
    }

    if (!shouldPost) {
        console.log('ℹ️ 確認のみで、まだ投稿していません。');
        console.log('   実際に投稿するには、末尾に --post を付けて再実行してください。');
        return;
    }

    await rest.post(Routes.channelMessages(thread.id), { body: { content: message } });
    console.log(`✅ 「${thread.name}」に案内メッセージを投稿しました。`);
    console.log('   このメッセージに返信する形で画像を送り、ローカルbotのログを確認してください。');
}

main().catch((error: any) => {
    console.error('❌ エラー:', error.message);
    if (error.rawError) {
        console.error('   詳細:', JSON.stringify(error.rawError, null, 2));
    }
    process.exit(1);
});
