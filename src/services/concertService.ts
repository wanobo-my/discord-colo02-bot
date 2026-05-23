import { sheets } from '../utils/googleSheets.js';
import { getJstNow, toJstIsoString } from '../utils/date.js';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const SPREADSHEET_ID = process.env.REMINDER_SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;
const SHEET_NAME = process.env.CONCERT_THREADS_SHEET_NAME || 'ConcertThreads';

// カラム定義 (0-indexed)
const HEADERS = [
    'concert_id', 'thread_id', 'starter_message_id', 'forum_channel_id',
    'title', 'concert_date', 'facility_name', 'time', 'meeting',
    'participant_ids', 'photo_policy', 'note', 'status', 'created_by',
    'created_at', 'updated_at'
];

export interface ConcertThread {
    concertId: string;
    threadId: string;
    starterMessageId: string;
    forumChannelId: string;
    title: string;
    concertDate: string;
    facilityName: string;
    time: string;
    meeting: string;
    participantIds: string; // カンマ区切り
    photoPolicy: string;
    note: string;
    status: string; // 'planned' | 'done' | 'cancelled'
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    rowNumber?: number; // スプレッドシート内の行番号 (1-indexed)
}

/**
 * シートおよびヘッダーの存在確認と自動作成
 */
async function ensureHeader(): Promise<void> {
    if (!SPREADSHEET_ID) {
        throw new Error('❌ SPREADSHEET_ID が設定されていません。');
    }

    try {
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID,
        });

        const sheetExists = spreadsheet.data.sheets?.some(
            (s) => s.properties?.title === SHEET_NAME
        );

        if (!sheetExists) {
            console.log(`ℹ️ [ConcertThreads] ${SHEET_NAME} シートが存在しないため、新規作成します。`);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    requests: [
                        {
                            addSheet: {
                                properties: {
                                    title: SHEET_NAME,
                                },
                            },
                        },
                    ],
                },
            });
            console.log(`✅ [ConcertThreads] ${SHEET_NAME} シートを作成しました。`);
        }

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1:P1`, // カラムA〜Pまで
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0 || rows[0].length === 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A1:P1`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [HEADERS]
                }
            });
            console.log(`ℹ️ [ConcertThreads] ${SHEET_NAME} シートにヘッダーを自動作成しました。`);
        }
    } catch (error: any) {
        console.error('❌ [ConcertThreads] ヘッダー・シート確認エラー:', error.message);
        throw error;
    }
}

/**
 * 新規コンサートスレッド情報を保存します。
 */
export async function saveConcertThread(params: Omit<ConcertThread, 'concertId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<string> {
    await ensureHeader();

    const concertId = crypto.randomUUID();
    const nowJstStr = toJstIsoString(getJstNow());

    const row = [
        concertId,
        params.threadId,
        params.starterMessageId,
        params.forumChannelId,
        params.title,
        params.concertDate,
        params.facilityName,
        params.time,
        params.meeting,
        params.participantIds,
        params.photoPolicy,
        params.note,
        'planned', // status (初期値)
        params.createdBy,
        nowJstStr, // created_at
        nowJstStr  // updated_at
    ];

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID!,
            range: `${SHEET_NAME}!A:P`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [row]
            }
        });
        console.log(`✅ [ConcertThreads] コンサート「${params.title}」をシートに記録しました。`);
        return concertId;
    } catch (error: any) {
        console.error('❌ [ConcertThreads] コンサート保存エラー:', error.message);
        throw error;
    }
}

/**
 * threadId からコンサート情報を取得します。
 */
export async function getConcertThreadByThreadId(threadId: string): Promise<ConcertThread | null> {
    await ensureHeader();

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID!,
            range: `${SHEET_NAME}!A:P`,
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) return null;

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const currentThreadId = row[1];

            if (currentThreadId === threadId) {
                // 列数が不足している場合は空文字で補完
                const paddedRow = row.concat(Array(HEADERS.length - row.length).fill(''));

                return {
                    concertId: paddedRow[0],
                    threadId: paddedRow[1],
                    starterMessageId: paddedRow[2],
                    forumChannelId: paddedRow[3],
                    title: paddedRow[4],
                    concertDate: paddedRow[5],
                    facilityName: paddedRow[6],
                    time: paddedRow[7],
                    meeting: paddedRow[8],
                    participantIds: paddedRow[9],
                    photoPolicy: paddedRow[10],
                    note: paddedRow[11],
                    status: paddedRow[12],
                    createdBy: paddedRow[13],
                    createdAt: paddedRow[14],
                    updatedAt: paddedRow[15],
                    rowNumber: i + 1 // スプレッドシートの行番号 (1-indexed)
                };
            }
        }

        return null;
    } catch (error: any) {
        console.error('❌ [ConcertThreads] コンサート取得エラー:', error.message);
        return null;
    }
}

/**
 * コンサート情報を更新します。
 */
export async function updateConcertThread(
    rowNumber: number,
    updates: Partial<Omit<ConcertThread, 'concertId' | 'createdAt' | 'updatedAt' | 'rowNumber'>>
): Promise<void> {
    if (!SPREADSHEET_ID) throw new Error('❌ SPREADSHEET_ID が未設定です。');
    
    const nowJstStr = toJstIsoString(getJstNow());

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${rowNumber}:P${rowNumber}`,
        });

        const row = response.data.values?.[0];
        if (!row) {
            throw new Error(`行番号 ${rowNumber} のデータが見つかりません。`);
        }

        // データの補完
        const paddedRow = row.concat(Array(HEADERS.length - row.length).fill(''));

        // 各フィールドの更新
        if (updates.threadId !== undefined) paddedRow[1] = updates.threadId;
        if (updates.starterMessageId !== undefined) paddedRow[2] = updates.starterMessageId;
        if (updates.forumChannelId !== undefined) paddedRow[3] = updates.forumChannelId;
        if (updates.title !== undefined) paddedRow[4] = updates.title;
        if (updates.concertDate !== undefined) paddedRow[5] = updates.concertDate;
        if (updates.facilityName !== undefined) paddedRow[6] = updates.facilityName;
        if (updates.time !== undefined) paddedRow[7] = updates.time;
        if (updates.meeting !== undefined) paddedRow[8] = updates.meeting;
        if (updates.participantIds !== undefined) paddedRow[9] = updates.participantIds;
        if (updates.photoPolicy !== undefined) paddedRow[10] = updates.photoPolicy;
        if (updates.note !== undefined) paddedRow[11] = updates.note;
        if (updates.status !== undefined) paddedRow[12] = updates.status;
        if (updates.createdBy !== undefined) paddedRow[13] = updates.createdBy;
        paddedRow[15] = nowJstStr; // updated_at

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${rowNumber}:P${rowNumber}`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [paddedRow]
            }
        });
        console.log(`ℹ️ [ConcertThreads] コンサート情報 (行: ${rowNumber}) を更新しました。`);
    } catch (error: any) {
        console.error(`❌ [ConcertThreads] コンサート更新エラー (行: ${rowNumber}):`, error.message);
        throw error;
    }
}
