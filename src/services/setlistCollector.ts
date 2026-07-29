import { Attachment, Message, ThreadChannel } from 'discord.js';
import { getConcertThreadByThreadId } from './concertService.js';
import { linkSetlistUrlNow } from './setlistSheetLink.js';
import {
    SETLIST_FOLDER_NAME,
    buildUniqueFileName,
    fetchAttachmentStream,
    resolveSetlistFolder,
    resolveSetlistSubFolder,
    uploadStream,
} from '../utils/googleDrive.js';
import {
    UNCLASSIFIED_FOLDER_NAME,
    buildBaseName,
    classifyAttachment,
    formatBytes,
    getYear,
    isSetlistAnchorContent,
    normalizeDate,
    parseThreadName,
} from './setlistNaming.js';

/**
 * コンサートスレッドに送られた曲目リストの画像を回収する処理。
 *
 * 動作モードは環境変数 SETLIST_MODE で切り替えます。
 *   off    … 何もしない (既定値。設定しなければ既存の挙動と一切変わりません)
 *   dryrun … 検知してログを出すだけ。Drive へは書き込みません
 *   on     … 実際に Drive へアップロードし、処理済みの目印に ✅ を付けます
 */
export type SetlistMode = 'off' | 'dryrun' | 'on';

/**
 * 処理済みの目印。
 *
 * ✅ を外しても自動では再処理されない (リアクション削除の検知は運用上不要と判断して未実装)。
 * ただし ✅ が無いメッセージは「未処理」とみなすため、
 * scripts/reprocess-setlist-message.ts やバックフィルから再処理すれば取り込める。
 */
const CHECK_EMOJI = '✅';

export function getSetlistMode(): SetlistMode {
    const raw = (process.env.SETLIST_MODE ?? 'off').trim().toLowerCase();
    if (raw === 'dryrun' || raw === 'on') return raw;
    return 'off';
}

/** 実施日・施設名の特定結果。 */
interface ConcertContext {
    date: string | null;
    /**
     * 施設名。アンダーバー以降をまるごと保持する。
     * 括弧は補足として使われているだけなので、法人名と施設名には分けない。
     */
    facilityFull: string | null;
    /** どこから特定できたか (ログ用) */
    source: string;
}

interface AcceptedAttachment {
    attachment: Attachment;
    extension: string;
    mimeType: string;
}

interface RejectedAttachment {
    name: string;
    reason: string;
}

/**
 * メッセージが曲目リストの回収対象かを判定し、対象ならスレッドを返します。
 *
 * 対象の条件:
 *   1. bot 以外の投稿である
 *   2. 添付ファイルが付いている
 *   3. 何かへの「返信」である
 *   4. コンサートフォーラム配下のスレッドである
 *   5. 返信先が bot の「曲目リスト」案内メッセージである
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

    if (anchor.author.id !== message.client.user?.id) return null;
    if (!isSetlistAnchorContent(anchor.content)) return null;

    return channel;
}

/**
 * 既に bot が ✅ を付けているか (＝処理済みか) を判定します。
 *
 * これが冪等性の要です。同じメッセージを二度処理してもファイルが重複しません。
 */
async function hasBotCheckmark(message: Message): Promise<boolean> {
    const reaction = message.reactions.cache.get(CHECK_EMOJI);
    if (!reaction) return false;
    if (reaction.me) return true;

    // キャッシュに自分の反応が反映されていない場合は問い合わせる
    try {
        const users = await reaction.users.fetch();
        return users.has(message.client.user!.id);
    } catch (error: any) {
        console.warn(`⚠️ [曲目リスト] リアクションの確認に失敗しました: ${error.message}`);
        // 判断できない場合は「未処理」とみなさず、安全側 (二重アップロードを避ける) に倒す
        return true;
    }
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
                return { date, facilityFull, source: 'ConcertThreads シート' };
            }
            console.warn(
                `⚠️ [曲目リスト] シートに行はありましたが日付/施設名が不完全です ` +
                `(date=${concert.concertDate ?? '空'}, facility=${concert.facilityName ?? '空'})。スレッド名から取得を試みます。`
            );
        }
    } catch (error: any) {
        console.error(`❌ [曲目リスト] ConcertThreads の参照に失敗しました: ${error.message}`);
    }

    const parsed = parseThreadName(thread.name);
    if (parsed) {
        return {
            date: parsed.date,
            facilityFull: parsed.facilityFull,
            source: 'スレッド名のパース',
        };
    }

    return { date: null, facilityFull: null, source: '特定できず' };
}

/** 保存先フォルダを解決します。日付を特定できない場合は _未分類 へ退避します。 */
async function resolveTargetFolder(context: ConcertContext): Promise<string> {
    if (!context.date) {
        return resolveSetlistSubFolder(UNCLASSIFIED_FOLDER_NAME);
    }
    return resolveSetlistFolder(getYear(context.date));
}

/** 連番を除いたファイル名の土台を返します。 */
function baseNameFor(context: ConcertContext, thread: ThreadChannel): string {
    if (context.date && context.facilityFull) {
        return buildBaseName(context.date, context.facilityFull);
    }
    // 未分類でも取り違えが起きないようスレッドIDを付ける
    return `未分類_${thread.id}`;
}

/** ログ表示用に、保存予定の Drive 上のパスを組み立てます。 */
function buildPlannedPath(context: ConcertContext, fileName: string): string {
    const sub = context.date ? getYear(context.date) : UNCLASSIFIED_FOLDER_NAME;
    return `${SETLIST_FOLDER_NAME}/${sub}/${fileName}`;
}

/**
 * 添付を取得します。
 *
 * Discord の CDN URL は署名付きで有効期限があるため、失敗した場合は
 * メッセージを取得し直して新しい署名 URL を得てから 1 回だけ再試行します。
 */
async function openAttachmentStream(message: Message, attachment: Attachment) {
    try {
        return await fetchAttachmentStream(attachment.url);
    } catch (error: any) {
        console.warn(
            `⚠️ [曲目リスト] 添付の取得に失敗しました (${error.message})。` +
            `CDN URL の失効を疑い、メッセージを取り直して再試行します。`
        );

        const refreshed = await message.fetch(true);
        const fresh = refreshed.attachments.get(attachment.id);
        if (!fresh) {
            throw new Error('メッセージを取り直しましたが、対象の添付が見つかりませんでした。');
        }
        return await fetchAttachmentStream(fresh.url);
    }
}

/** 検知内容をログに出します (dry-run / 本番の両方で共通)。 */
function logDetection(
    mode: SetlistMode,
    thread: ThreadChannel,
    message: Message,
    context: ConcertContext,
    accepted: AcceptedAttachment[],
    rejected: RejectedAttachment[]
): void {
    const lines: string[] = [];
    lines.push(`📋 [曲目リスト][${mode === 'dryrun' ? 'DRY-RUN' : '本番'}] 対象を検知しました`);
    lines.push(`   スレッド : ${thread.name}  (ID: ${thread.id})`);
    lines.push(`   投稿者   : ${message.author.tag}`);
    lines.push(`   取得元   : ${context.source}`);
    lines.push(`   日付     : ${context.date ?? '(特定できず)'}`);
    lines.push(`   施設名   : ${context.facilityFull ?? '(特定できず)'}`);
    lines.push(`   添付     : ${accepted.length + rejected.length} 件 (対象 ${accepted.length} / 対象外 ${rejected.length})`);

    if (!context.date) {
        lines.push(`   ⚠️ 日付・施設名を特定できないため ${UNCLASSIFIED_FOLDER_NAME}/ へ退避します。`);
    }
    for (const item of rejected) {
        lines.push(`   [${item.name}] ⏭️ 対象外: ${item.reason}`);
    }

    console.log(lines.join('\n'));
}

/** dry-run: 保存予定のパスとファイル名を出力します (Drive には触れません)。 */
function logDryRunPlan(
    thread: ThreadChannel,
    context: ConcertContext,
    accepted: AcceptedAttachment[]
): void {
    const baseName = baseNameFor(context, thread);
    const lines: string[] = [];

    // 連番は Drive の既存ファイルを見て決まるため、dry-run では 01 からの仮番号を表示する
    accepted.forEach((item, index) => {
        const fileName = `${baseName}_${String(index + 1).padStart(2, '0')}${item.extension}`;
        lines.push(`   [${item.attachment.name}] ${formatBytes(item.attachment.size)} / ${item.mimeType}`);
        lines.push(`      保存予定: ${buildPlannedPath(context, fileName)}`);
    });

    lines.push('   ※ DRY-RUN のため、Drive への書き込みと ✅ リアクションは行いません。');
    console.log(lines.join('\n'));
}

interface UploadOutcome {
    succeeded: { originalName: string; savedName: string; link: string | null }[];
    failed: { originalName: string; reason: string }[];
}

/**
 * 実際に Drive へアップロードします。
 *
 * ファイル名の連番は Drive の既存ファイルを見て決めるため、**必ず 1 件ずつ順番に**処理します。
 * 並列にすると同じ連番が割り当てられ、片方が別名で保存されるなどの取り違えが起きます。
 */
async function uploadAll(
    message: Message,
    thread: ThreadChannel,
    context: ConcertContext,
    accepted: AcceptedAttachment[]
): Promise<UploadOutcome> {
    const outcome: UploadOutcome = { succeeded: [], failed: [] };
    if (accepted.length === 0) return outcome;

    const folderId = await resolveTargetFolder(context);
    const baseName = baseNameFor(context, thread);

    for (const item of accepted) {
        try {
            const fileName = await buildUniqueFileName(folderId, baseName, item.extension);
            const { stream } = await openAttachmentStream(message, item.attachment);
            const uploaded = await uploadStream({
                folderId,
                fileName,
                mimeType: item.mimeType,
                stream,
            });
            outcome.succeeded.push({
                originalName: item.attachment.name,
                savedName: uploaded.name,
                link: uploaded.webViewLink,
            });
        } catch (error: any) {
            // 1 件失敗しても残りは処理する。失敗は必ず記録する。
            console.error(`❌ [曲目リスト] アップロード失敗 (${item.attachment.name}):`, error?.stack ?? error);
            outcome.failed.push({ originalName: item.attachment.name, reason: error?.message ?? '不明なエラー' });
        }
    }

    return outcome;
}

/**
 * 利用者への報告を組み立てます。
 *
 * 全件成功した場合は ✅ リアクションだけで伝え、メッセージは投稿しません
 * (スレッドが通知で埋まるのを避けるため)。
 * 対象外ファイルや失敗があったときだけ返信します。
 */
function buildReport(outcome: UploadOutcome, rejected: RejectedAttachment[], unclassified: boolean): string | null {
    const blocks: string[] = [];

    if (outcome.failed.length > 0) {
        blocks.push('⚠️ 曲目リストの保存に失敗したファイルがありマス🤖');
        if (outcome.succeeded.length > 0) {
            blocks.push(
                '**保存できたもの**\n' +
                outcome.succeeded.map((s) => `・${s.savedName}`).join('\n')
            );
        }
        blocks.push(
            '**保存できなかったもの**\n' +
            outcome.failed.map((f) => `・${f.originalName} — ${f.reason}`).join('\n')
        );
        blocks.push('お手数デスが、保存できなかった分をもう一度送っていただけマスか？');
    }

    if (rejected.length > 0) {
        blocks.push(
            '📋 対象外のファイルがありマシタ（保存していマセン）\n' +
            rejected.map((r) => `・${r.name} — ${r.reason}`).join('\n')
        );
    }

    if (unclassified && outcome.succeeded.length > 0) {
        blocks.push(
            `⚠️ 実施日と施設名を特定できなかったので、いったん \`${UNCLASSIFIED_FOLDER_NAME}\` フォルダに保存しマシタ。\n` +
            'スレッド名が「2026.07.28_施設名」の形式か確認してくださイ。'
        );
    }

    return blocks.length > 0 ? blocks.join('\n\n') : null;
}

/** スレッドへの報告投稿。失敗してもログに残すだけで、処理は止めません。 */
async function reportToThread(message: Message, content: string): Promise<void> {
    try {
        await message.reply({ content, allowedMentions: { repliedUser: false } });
    } catch (error: any) {
        console.error(`❌ [曲目リスト] スレッドへの報告に失敗しました: ${error.message}`);
    }
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

        // 冪等性: 既に処理済みなら何もしない
        if (await hasBotCheckmark(message)) {
            console.log(`ℹ️ [曲目リスト] 既に ${CHECK_EMOJI} が付いているためスキップします (message: ${message.id})`);
            return;
        }

        const context = await resolveConcertContext(thread);

        const accepted: AcceptedAttachment[] = [];
        const rejected: RejectedAttachment[] = [];

        for (const attachment of message.attachments.values()) {
            const verdict = classifyAttachment({
                name: attachment.name,
                size: attachment.size,
                contentType: attachment.contentType,
            });
            if (verdict.accepted) {
                accepted.push({ attachment, extension: verdict.extension, mimeType: verdict.mimeType });
            } else {
                rejected.push({ name: attachment.name, reason: verdict.reason });
            }
        }

        logDetection(mode, thread, message, context, accepted, rejected);

        if (mode === 'dryrun') {
            logDryRunPlan(thread, context, accepted);
            return;
        }

        // ===== ここから本番モード =====
        const outcome = await uploadAll(message, thread, context, accepted);

        for (const item of outcome.succeeded) {
            console.log(`✅ [曲目リスト] 保存しました: ${item.savedName}  ${item.link ?? ''}`);
        }

        // 回答シートへ URL を反映する (1枚目のみ。回答が未提出なら後追いで拾われる)。
        // 失敗してもアップロード自体は成功しているため、処理は止めない。
        const firstLink = outcome.succeeded.find((item) => item.link)?.link;
        if (firstLink && context.date && context.facilityFull) {
            await linkSetlistUrlNow(context.date, context.facilityFull, firstLink);
        }

        // 全添付を処理し終えてから、かつ 1 件も失敗していない場合だけ ✅ を付ける。
        // 部分的に失敗した状態で ✅ を付けると、再送しても処理されなくなるため。
        if (accepted.length > 0 && outcome.failed.length === 0) {
            try {
                await message.react(CHECK_EMOJI);
            } catch (error: any) {
                console.error(`❌ [曲目リスト] ${CHECK_EMOJI} の付与に失敗しました: ${error.message}`);
            }
        }

        const report = buildReport(outcome, rejected, !context.date);
        if (report) {
            await reportToThread(message, report);
        }
    } catch (error: any) {
        console.error('❌ [曲目リスト] 処理でエラーが発生しました:', error?.stack ?? error);
        await reportToThread(
            message,
            '⚠️ 曲目リストの保存中にエラーが発生しマシタ🤖 運営に確認をお願いしマス。'
        ).catch(() => undefined);
    }
}
