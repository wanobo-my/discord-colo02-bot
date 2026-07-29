import { sheets } from '../utils/googleSheets.js';
import { findSetlistSubFolder, listFilesByPrefix } from '../utils/googleDrive.js';
import {
    facilityMatches,
    formatDateForFileName,
    getYear,
    normalizeDate,
    parseSetlistFileName,
} from './setlistNaming.js';

/**
 * 保存した曲目リストの URL を、活動記録フォームの回答スプレッドシートへ書き戻す処理。
 *
 * 経路は 2 つあり、どちらも同じ書き込み関数を通ります。
 *   即時   … アップロード直後に呼ぶ。回答が既に入っていればその場で埋まる
 *   後追い … 1 時間ごとの cron から呼ぶ。アップロード時に回答が未提出だった分を拾う
 *
 * 画像のアップロードとフォーム回答はどちらが先か不定のため、後追いが必要です。
 */

/** 回答シートの列 (フォームの設問順に対応。変更時はここを直す) */
const COLUMN = {
    /** C列: 実施日 (例 2026/07/28) */
    DATE: 2,
    /** D列: 施設名 (自由記述。スレッド名とは表記が一致しない) */
    FACILITY: 3,
    /** I列: 曲リスト (URL の書き込み先) */
    SETLIST_URL: 8,
} as const;

const SETLIST_URL_COLUMN_LETTER = 'I';

/** 読み取る範囲。列を増やす場合はここも広げる。 */
const READ_RANGE = 'A2:I';

function getSpreadsheetId(): string {
    const id = process.env.ACTIVITY_RESPONSE_SPREADSHEET_ID;
    if (!id) {
        throw new Error('❌ [曲目リスト] 環境変数 ACTIVITY_RESPONSE_SPREADSHEET_ID が設定されていません。');
    }
    return id;
}

function getSheetName(): string {
    return process.env.ACTIVITY_RESPONSE_SHEET_NAME || 'フォームの回答 1';
}

interface ResponseRow {
    /** スプレッドシート上の行番号 (1-indexed) */
    rowNumber: number;
    /** YYYY.MM.DD に正規化した実施日。解釈できなければ null */
    date: string | null;
    facility: string;
    /** 既に URL が入っているか */
    hasUrl: boolean;
}

/** 回答シートを読み、行番号つきで返します。 */
async function readResponseRows(): Promise<ResponseRow[]> {
    const spreadsheetId = getSpreadsheetId();
    const range = `'${getSheetName()}'!${READ_RANGE}`;

    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = res.data.values ?? [];

    return rows.map((row, index) => ({
        // READ_RANGE が 2 行目から始まるため +2
        rowNumber: index + 2,
        date: normalizeDate(String(row[COLUMN.DATE] ?? '')),
        facility: String(row[COLUMN.FACILITY] ?? '').trim(),
        hasUrl: String(row[COLUMN.SETLIST_URL] ?? '').trim().length > 0,
    }));
}

type RowLookup =
    | { status: 'found'; row: ResponseRow }
    | { status: 'none' }
    | { status: 'ambiguous'; rows: ResponseRow[] }
    | { status: 'already-filled'; row: ResponseRow };

/**
 * 実施日と施設名から、書き込むべき行を特定します。
 *
 * ⚠️ 同じ日に複数のコンサートが入ることがあるため、**日付だけで確定させません。**
 *    施設名の照合を必ず通し、確証が持てない場合は書き込まずに呼び出し側へ返します。
 *    誤った行に書き込むと記録が静かに壊れ、後から気づけないためです。
 */
function lookupRow(rows: ResponseRow[], date: string, facilityFull: string): RowLookup {
    const sameDate = rows.filter((row) => row.date === date);
    if (sameDate.length === 0) return { status: 'none' };

    const matched = sameDate.filter((row) => facilityMatches(row.facility, facilityFull));
    if (matched.length === 0) return { status: 'none' };
    if (matched.length > 1) return { status: 'ambiguous', rows: matched };

    const row = matched[0];
    // 既存の URL (旧フォームのアップロード分など) は絶対に上書きしない
    if (row.hasUrl) return { status: 'already-filled', row };

    return { status: 'found', row };
}

/** 指定行の I 列に URL を書き込みます。 */
async function writeUrl(rowNumber: number, url: string): Promise<void> {
    await sheets.spreadsheets.values.update({
        spreadsheetId: getSpreadsheetId(),
        range: `'${getSheetName()}'!${SETLIST_URL_COLUMN_LETTER}${rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[url]] },
    });
}

/**
 * アップロード直後に呼ぶ即時反映。
 *
 * 回答がまだ提出されていない場合は何もしません (後追いで拾われます)。
 * この処理が失敗してもアップロード自体は成功しているため、例外は投げません。
 */
export async function linkSetlistUrlNow(
    date: string,
    facilityFull: string,
    url: string
): Promise<void> {
    if (!process.env.ACTIVITY_RESPONSE_SPREADSHEET_ID) return;

    try {
        const rows = await readResponseRows();
        const lookup = lookupRow(rows, date, facilityFull);

        switch (lookup.status) {
            case 'found':
                await writeUrl(lookup.row.rowNumber, url);
                console.log(`📝 [曲目リスト] 回答シート ${lookup.row.rowNumber} 行目に URL を記入しました。`);
                break;
            case 'already-filled':
                console.log(
                    `ℹ️ [曲目リスト] 回答シート ${lookup.row.rowNumber} 行目には既に URL があるため書き込みません。`
                );
                break;
            case 'ambiguous':
                console.warn(
                    `⚠️ [曲目リスト] ${date} / ${facilityFull} に該当する行が複数あり特定できません ` +
                    `(行: ${lookup.rows.map((r) => r.rowNumber).join(', ')})。書き込みを見送ります。`
                );
                break;
            case 'none':
                console.log(
                    `ℹ️ [曲目リスト] ${date} / ${facilityFull} の回答がまだ無いため、後追いで反映します。`
                );
                break;
        }
    } catch (error: any) {
        // アップロードは成功しているので、ここでの失敗は致命的ではない
        console.error('❌ [曲目リスト] 回答シートへの即時記入に失敗しました:', error?.stack ?? error);
    }
}

export interface BackfillSummary {
    /** I列が空で、対象になった行数 */
    targeted: number;
    /** 実際に書き込んだ行数 */
    written: number;
    /** Drive に該当ファイルが無く見送った行数 */
    noFile: number;
    /** 特定できず見送った行数 */
    skipped: number;
}

/**
 * 回答シートの空欄を埋める後追い処理 (cron から 1 時間ごとに呼ばれます)。
 *
 * I列が空の行だけを対象にするため、処理量は未記入の件数に比例します。
 * Drive を日付で検索するので、この機能を作る前に保存された分も拾えます。
 */
export async function backfillSetlistUrls(
    options: { dryRun?: boolean } = {}
): Promise<BackfillSummary> {
    const dryRun = options.dryRun === true;
    const summary: BackfillSummary = { targeted: 0, written: 0, noFile: 0, skipped: 0 };

    if (!process.env.ACTIVITY_RESPONSE_SPREADSHEET_ID) {
        console.warn('⚠️ [曲目リスト] ACTIVITY_RESPONSE_SPREADSHEET_ID が未設定のため、回答シートへの反映はスキップします。');
        return summary;
    }

    const rows = await readResponseRows();
    const pending = rows.filter((row) => !row.hasUrl && row.date && row.facility);
    summary.targeted = pending.length;

    if (pending.length === 0) return summary;

    // 同じ年のフォルダを何度も引かないようキャッシュする
    const folderCache = new Map<string, string | null>();

    for (const row of pending) {
        try {
            const year = getYear(row.date!);
            if (!folderCache.has(year)) {
                folderCache.set(year, await findSetlistSubFolder(year));
            }
            const folderId = folderCache.get(year);
            if (!folderId) {
                summary.noFile += 1;
                continue;
            }

            const prefix = `${formatDateForFileName(row.date!)}_`;
            const files = await listFilesByPrefix(folderId, prefix);
            if (files.length === 0) {
                summary.noFile += 1;
                continue;
            }

            // 同日に複数コンサートがありうるため、施設名が一致するものだけに絞る
            const candidates = files.filter((file) => {
                const parsed = parseSetlistFileName(file.name);
                return parsed ? facilityMatches(row.facility, parsed.facilityFull) : false;
            });

            if (candidates.length === 0) {
                summary.noFile += 1;
                continue;
            }

            // 施設名が複数種類ヒットした場合は特定できないので見送る
            const facilities = new Set(
                candidates
                    .map((file) => parseSetlistFileName(file.name)?.facilityFull)
                    .filter((name): name is string => Boolean(name))
            );
            if (facilities.size > 1) {
                console.warn(
                    `⚠️ [曲目リスト] ${row.date} の候補が複数施設にまたがるため ` +
                    `${row.rowNumber} 行目への書き込みを見送ります (${[...facilities].join(' / ')})`
                );
                summary.skipped += 1;
                continue;
            }

            // 連番の若い順に並べ、1 枚目の URL を書き込む
            const sorted = candidates.sort((a, b) => {
                const ai = parseSetlistFileName(a.name)?.index ?? 0;
                const bi = parseSetlistFileName(b.name)?.index ?? 0;
                return ai - bi;
            });
            const first = sorted[0];
            if (!first.webViewLink) {
                summary.skipped += 1;
                continue;
            }

            if (dryRun) {
                console.log(
                    `🔍 [DRY-RUN] ${row.rowNumber} 行目 (${row.date} ${row.facility}) に書き込む予定:\n` +
                    `          ファイル: ${first.name}\n` +
                    `          URL     : ${first.webViewLink}` +
                    (sorted.length > 1 ? `\n          ※他 ${sorted.length - 1} 枚は書き込みません` : '')
                );
            } else {
                await writeUrl(row.rowNumber, first.webViewLink);
                console.log(
                    `📝 [曲目リスト] ${row.rowNumber} 行目 (${row.date} ${row.facility}) に URL を記入しました。` +
                    (sorted.length > 1 ? ` ※他 ${sorted.length - 1} 枚は同じフォルダにあります。` : '')
                );
            }
            summary.written += 1;
        } catch (error: any) {
            // 1 行失敗しても残りは処理する
            console.error(`❌ [曲目リスト] ${row.rowNumber} 行目の処理に失敗しました:`, error?.message ?? error);
            summary.skipped += 1;
        }
    }

    return summary;
}
