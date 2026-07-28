import { Message, ThreadChannel } from 'discord.js';
import { getConcertThreadByThreadId } from './concertService.js';
import { SETLIST_FOLDER_NAME } from '../utils/googleDrive.js';
import {
    AttachmentLike,
    UNCLASSIFIED_FOLDER_NAME,
    buildBaseName,
    classifyAttachment,
    formatBytes,
    getYear,
    isSetlistAnchorContent,
    normalizeDate,
    parseThreadName,
    splitFacility,
} from './setlistNaming.js';

/**
 * コンサートスレッドに送られた曲目リストの画像を回収する処理。
 *
 * 動作モードは環境変数 SETLIST_MODE で切り替えます。
 *   off    … 何もしない (既定値。設定しなければ既存の挙動と一切変わりません)
 *   dryrun … 検知してログを出すだけ。Drive へは書き込みません (フェーズ3)
 *   on     … 実際に Drive へアップロードします (フェーズ4で実装)
 */
export type SetlistMode = 'off' | 'dryrun' | 'on';

export function getSetlistMode(): SetlistMode {
    const raw = (process.env.SETLIST_MODE ?? 'off').trim().toLowerCase();
    if (raw === 'dryrun' || raw === 'on') return raw;
    return 'off';
}

/** 実施日・施設名の特定結果。 */
interface ConcertContext {
    date: string | null;
    facilityFull: string | null;
    corporation: string | null;
    facility: string | null;
    /** どこから特定できたか (ログ用) */
    source: string;
}

/**
 * メッセージが曲目リストの回収対象かを判定します。
 *
 * 対象の条件:
 *   1. bot 以外の投稿である
 *   2. 添付ファイルが付いている
 *   3. 何かへの「返信」である
 *   4. コンサートフォーラム配下のスレッドである
 *   5. 返信先が bot の「曲目リスト」案内メッセージである
 *
 * 対象外なら null を返します (静かに無視する)。
 */
async function resolveAnchor(message: Message): Promise<ThreadChannel | null> {
    if (message.author.bot) return null;
    if (message.attachments.size === 0) return null;

    const referencedId = message.reference?.messageId;
    if (!referencedId) return null;

    const channel = message.channel;
    if (!(channel instanceof ThreadChannel)) return null;

    const forumChannelId = process.env.CONCERT_FORUM_CHANNEL_ID;
    if (!forumChannelId) {
        console.warn('⚠️ [曲目リスト] CONCERT_FORUM_CHANNEL_ID が未設定のため、監視をスキップします。');
        return null;
    }
    if (channel.parentId !== forumChannelId) return null;

    const anchor = await channel.messages.fetch(referencedId).catch((error: any) => {
        console.warn(`⚠️ [曲目リスト] 返信先メッセージを取得できませんでした: ${error.message}`);
        return null;
    });
    if (!anchor) return null;

    // bot 自身が投稿した「曲目リスト」を含むメッセージへの返信だけを対象にする
    if (anchor.author.id !== message.client.user?.id) return null;
    if (!isSetlistAnchorContent(anchor.content)) return null;

    return channel;
}

/**
 * 実施日と施設名を特定します。
 *
 * ConcertThreads シートをスレッド ID で引くのが第一手段。
 * スレッド名の文字列パースに依存しないため、表記揺れに強い。
 * シートに無い場合のみスレッド名をパースし、それも失敗したら未分類として扱う。
 */
async function resolveConcertContext(thread: ThreadChannel): Promise<ConcertContext> {
    try {
        const concert = await getConcertThreadByThreadId(thread.id);
        if (concert) {
            const date = normalizeDate(concert.concertDate ?? '');
            const facilityFull = concert.facilityName?.trim() || null;
            if (date && facilityFull) {
                return {
                    date,
                    facilityFull,
                    ...splitFacility(facilityFull),
                    source: 'ConcertThreads シート',
                };
            }
            console.warn(
                `⚠️ [曲目リスト] シートに行はありましたが日付/施設名が不完全です ` +
                `(date=${concert.concertDate ?? '空'}, facility=${concert.facilityName ?? '空'})。スレッド名から取得を試みます。`
            );
        }
    } catch (error: any) {
        // シートが引けなくても処理を止めず、スレッド名へフォールバックする
        console.error(`❌ [曲目リスト] ConcertThreads の参照に失敗しました: ${error.message}`);
    }

    const parsed = parseThreadName(thread.name);
    if (parsed) {
        return {
            date: parsed.date,
            facilityFull: parsed.facilityFull,
            corporation: parsed.corporation,
            facility: parsed.facility,
            source: 'スレッド名のパース',
        };
    }

    return { date: null, facilityFull: null, corporation: null, facility: null, source: '特定できず' };
}

/** ログ表示用に、保存予定の Drive 上のパスを組み立てます。 */
function buildPlannedPath(context: ConcertContext, fileName: string): string {
    if (!context.date) {
        return `${SETLIST_FOLDER_NAME}/${UNCLASSIFIED_FOLDER_NAME}/${fileName}`;
    }
    return `${SETLIST_FOLDER_NAME}/${getYear(context.date)}/${fileName}`;
}

/**
 * 添付の URL が生きているかを確認します。
 *
 * Discord の CDN URL は署名付きで有効期限があるため、失効していた場合は
 * メッセージを取得し直して新しい署名 URL を得るフォールバックを行います。
 * (フェーズ4の実アップロードでも同じ経路を使います)
 */
async function checkAttachmentUrl(
    message: Message,
    attachmentId: string,
    url: string
): Promise<{ ok: boolean; detail: string }> {
    const head = async (target: string) => {
        try {
            const res = await fetch(target, { method: 'HEAD' });
            return { ok: res.ok, status: res.status };
        } catch (error: any) {
            return { ok: false, status: -1, error: error.message as string };
        }
    };

    const first = await head(url);
    if (first.ok) return { ok: true, detail: '取得可能' };

    console.warn(
        `⚠️ [曲目リスト] CDN URL が使えませんでした (HTTP ${first.status})。メッセージを取り直します。`
    );

    // 署名付き URL を再取得する
    const refreshed = await message.fetch(true).catch((error: any) => {
        console.error(`❌ [曲目リスト] メッセージの再取得に失敗しました: ${error.message}`);
        return null;
    });
    if (!refreshed) {
        return { ok: false, detail: `取得不可 (HTTP ${first.status}) / メッセージ再取得も失敗` };
    }

    const fresh = refreshed.attachments.get(attachmentId);
    if (!fresh) {
        return { ok: false, detail: `取得不可 (HTTP ${first.status}) / 再取得後に添付が見つからず` };
    }

    const second = await head(fresh.url);
    return second.ok
        ? { ok: true, detail: 'URL 再取得により取得可能' }
        : { ok: false, detail: `取得不可 (再取得後も HTTP ${second.status})` };
}

/**
 * messageCreate から呼ばれるエントリポイント。
 *
 * 例外は必ずここで捕捉してログに残します (握り潰さないが、bot は落とさない)。
 */
export async function handleSetlistMessage(message: Message): Promise<void> {
    const mode = getSetlistMode();
    if (mode === 'off') return;

    try {
        const thread = await resolveAnchor(message);
        if (!thread) return;

        const context = await resolveConcertContext(thread);
        const attachments = [...message.attachments.values()];

        const lines: string[] = [];
        lines.push(`📋 [曲目リスト][${mode === 'dryrun' ? 'DRY-RUN' : '本番'}] 対象を検知しました`);
        lines.push(`   スレッド : ${thread.name}  (ID: ${thread.id})`);
        lines.push(`   投稿者   : ${message.author.tag}`);
        lines.push(`   取得元   : ${context.source}`);
        lines.push(`   日付     : ${context.date ?? '(特定できず)'}`);
        lines.push(`   法人名   : ${context.corporation ?? '(特定できず)'}`);
        lines.push(`   施設名   : ${context.facility ?? '(括弧なし / 特定できず)'}`);
        lines.push(`   添付     : ${attachments.length} 件`);

        if (!context.date) {
            lines.push(`   ⚠️ 日付・施設名を特定できないため ${UNCLASSIFIED_FOLDER_NAME}/ へ退避する対象です。`);
        }

        // 連番は Drive の既存ファイルを見て決まるため、dry-run では 01 からの仮番号を表示する
        let sequence = 0;
        for (const attachment of attachments) {
            const like: AttachmentLike = {
                name: attachment.name,
                size: attachment.size,
                contentType: attachment.contentType,
            };
            const verdict = classifyAttachment(like);
            const header = `   [${attachment.name}] ${formatBytes(attachment.size)} / ${attachment.contentType ?? 'MIME不明'}`;

            if (!verdict.accepted) {
                lines.push(`${header}\n      ⏭️  対象外: ${verdict.reason}`);
                continue;
            }

            sequence += 1;
            const baseName = context.date && context.facilityFull
                ? buildBaseName(context.date, context.facilityFull)
                : `未分類_${thread.id}`;
            const fileName = `${baseName}_${String(sequence).padStart(2, '0')}${verdict.extension}`;

            const urlCheck = await checkAttachmentUrl(message, attachment.id, attachment.url);

            lines.push(header);
            lines.push(`      保存予定: ${buildPlannedPath(context, fileName)}`);
            lines.push(`      MIME    : ${verdict.mimeType}`);
            lines.push(`      URL確認 : ${urlCheck.ok ? '✅' : '❌'} ${urlCheck.detail}`);
        }

        if (sequence === 0) {
            lines.push('   ⚠️ 回収対象の添付がありませんでした。');
        }

        lines.push(
            mode === 'dryrun'
                ? '   ※ DRY-RUN のため、Drive への書き込みと ✅ リアクションは行いません。'
                : '   ※ 本番モードの実処理はフェーズ4で実装します。'
        );

        console.log(lines.join('\n'));
    } catch (error: any) {
        // エラーは握り潰さない。ただし bot 全体は落とさない。
        console.error('❌ [曲目リスト] 検知処理でエラーが発生しました:', error?.stack ?? error);
    }
}
