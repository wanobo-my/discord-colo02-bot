import { sheets } from '../utils/googleSheets.js';
import { getJstNow, toJstIsoString, parseJstDate, getJstTimeForDate } from '../utils/date.js';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const SPREADSHEET_ID = process.env.REMINDER_SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;
const SHEET_NAME = process.env.REMINDER_JOBS_SHEET_NAME || 'ReminderJobs';

// カラム定義と位置マッピング (0-indexed)
const HEADERS = [
    'job_id', 'job_type', 'event_name', 'sheet_url', 'guild_id', 'channel_id',
    'deadline_date', 'run_at', 'status', 'executed_at', 'retry_count',
    'error_message', 'created_by', 'created_at', 'updated_at'
];

export interface ReminderJob {
    jobId: string;
    jobType: string;
    eventName: string;
    sheetUrl: string;
    guildId: string;
    channelId: string;
    deadlineDate: string;
    runAt: string;
    status: string;
    executedAt: string;
    retryCount: number;
    errorMessage: string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    rowNumber?: number; // スプレッドシート内の行番号 (1-indexed)
}

/**
 * スプレッドシートの初期化（シートが無い場合は自動作成、ヘッダーが無い場合は自動書き込み）
 */
async function ensureHeader(): Promise<void> {
    if (!SPREADSHEET_ID) {
        throw new Error('❌ SPREADSHEET_ID (REMINDER_SPREADSHEET_ID or GOOGLE_SPREADSHEET_ID) が設定されていません。');
    }

    try {
        // 1. スプレッドシートのシート名一覧を取得し、該当シートが存在するか確認
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID,
        });
        
        const sheetExists = spreadsheet.data.sheets?.some(
            (s) => s.properties?.title === SHEET_NAME
        );

        // 2. 存在しない場合はシートを作成
        if (!sheetExists) {
            console.log(`ℹ️ [ReminderJobs] ${SHEET_NAME} シートが存在しないため、新規作成します。`);
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
            console.log(`✅ [ReminderJobs] ${SHEET_NAME} シートを作成しました。`);
        }

        // 3. ヘッダーを確認し、無い場合は書き込む
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1:O1`,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0 || rows[0].length === 0) {
            // ヘッダーが空の場合に書き込み
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A1:O1`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [HEADERS]
                }
            });
            console.log(`ℹ️ [ReminderJobs] ${SHEET_NAME} シートにヘッダーを自動作成しました。`);
        }
    } catch (error: any) {
        console.error('❌ [ReminderJobs] ヘッダー・シート確認エラー:', error.message);
        throw error;
    }
}

/**
 * 新しいジョブ（リマインド・集計）を3つ登録します。
 */
export async function registerScheduleJobs(params: {
    eventName: string;
    sheetUrl: string;
    deadlineDate: string;
    guildId: string;
    channelId: string;
    createdBy: string;
}): Promise<void> {
    await ensureHeader();

    const deadline = parseJstDate(params.deadlineDate);
    const nowJstStr = toJstIsoString(getJstNow());

    // 1. 前日リマインド (締切前日 10:00 JST)
    const runAtBefore = getJstTimeForDate(new Date(deadline.getTime() - 24 * 60 * 60 * 1000), 10, 0);
    // 2. 当日リマインド (締切当日 18:00 JST)
    const runAtDeadline = getJstTimeForDate(deadline, 18, 0);
    // 3. 翌日集計 (締切翌日 00:00 JST)
    const runAtFinish = getJstTimeForDate(new Date(deadline.getTime() + 24 * 60 * 60 * 1000), 0, 0);

    const jobs = [
        { type: 'schedule_remind_before', runAt: runAtBefore },
        { type: 'schedule_remind_deadline', runAt: runAtDeadline },
        { type: 'schedule_finish', runAt: runAtFinish }
    ];

    const rows = jobs.map(job => {
        const jobId = crypto.randomUUID();
        return [
            jobId,
            job.type,
            params.eventName,
            params.sheetUrl,
            params.guildId,
            params.channelId,
            params.deadlineDate,
            toJstIsoString(job.runAt),
            'pending', // status
            '', // executed_at
            0, // retry_count
            '', // error_message
            params.createdBy,
            nowJstStr, // created_at
            nowJstStr // updated_at
        ];
    });

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID!,
            range: `${SHEET_NAME}!A:O`,
            valueInputOption: 'RAW',
            requestBody: {
                values: rows
            }
        });
        console.log(`✅ [ReminderJobs] 「${params.eventName}」の自動ジョブを3件登録しました。`);
    } catch (error: any) {
        console.error('❌ [ReminderJobs] ジョブ登録エラー:', error.message);
        throw error;
    }
}

/**
 * 実行対象の pending ジョブ（run_at が現在時刻以前）をすべて取得します。
 */
export async function getExecutableJobs(): Promise<ReminderJob[]> {
    await ensureHeader();

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID!,
            range: `${SHEET_NAME}!A:O`,
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) return [];

        const now = getJstNow();
        const executableJobs: ReminderJob[] = [];

        // 2行目からループ (i = 1 はスプレッドシートの2行目、1-indexedでは i + 1 行目)
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            // 列数が不足している場合は空文字で補完
            const paddedRow = row.concat(Array(HEADERS.length - row.length).fill(''));

            const status = paddedRow[8];
            const runAtStr = paddedRow[7];

            if (status === 'pending' && runAtStr) {
                const runAt = new Date(runAtStr);
                if (runAt.getTime() <= now.getTime()) {
                    executableJobs.push({
                        jobId: paddedRow[0],
                        jobType: paddedRow[1],
                        eventName: paddedRow[2],
                        sheetUrl: paddedRow[3],
                        guildId: paddedRow[4],
                        channelId: paddedRow[5],
                        deadlineDate: paddedRow[6],
                        runAt: runAtStr,
                        status: status,
                        executedAt: paddedRow[9],
                        retryCount: Number(paddedRow[10]) || 0,
                        errorMessage: paddedRow[11],
                        createdBy: paddedRow[12],
                        createdAt: paddedRow[13],
                        updatedAt: paddedRow[14],
                        rowNumber: i + 1 // スプレッドシートの行番号 (1-indexed)
                    });
                }
            }
        }

        return executableJobs;
    } catch (error: any) {
        console.error('❌ [ReminderJobs] ジョブ取得エラー:', error.message);
        return [];
    }
}

/**
 * 特定のジョブの状態を更新します。
 */
export async function updateJob(
    rowNumber: number,
    updates: Partial<Pick<ReminderJob, 'status' | 'executedAt' | 'retryCount' | 'errorMessage'>>
): Promise<void> {
    if (!SPREADSHEET_ID) throw new Error('❌ SPREADSHEET_ID が未設定です。');
    
    const nowJstStr = toJstIsoString(getJstNow());

    try {
        // 更新前の現行データを1行取得
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${rowNumber}:O${rowNumber}`,
        });

        const row = response.data.values?.[0];
        if (!row) {
            throw new Error(`行番号 ${rowNumber} のデータが見つかりません。`);
        }

        // データの更新
        if (updates.status !== undefined) row[8] = updates.status;
        if (updates.executedAt !== undefined) row[9] = updates.executedAt;
        if (updates.retryCount !== undefined) row[10] = updates.retryCount;
        if (updates.errorMessage !== undefined) row[11] = updates.errorMessage;
        row[14] = nowJstStr; // updated_at

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${rowNumber}:O${rowNumber}`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [row]
            }
        });
        console.log(`ℹ️ [ReminderJobs] ジョブ (行: ${rowNumber}) を更新しました。Status: ${updates.status || row[8]}`);
    } catch (error: any) {
        console.error(`❌ [ReminderJobs] ジョブ更新エラー (行: ${rowNumber}):`, error.message);
        throw error;
    }
}

/**
 * 指定された日程調整シートURLに紐づく pending 状態のジョブをすべて cancelled に更新します。
 * キャンセルされたジョブの件数を返します。
 */
export async function cancelPendingJobsByUrl(sheetUrl: string): Promise<number> {
    await ensureHeader();

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID!,
            range: `${SHEET_NAME}!A:O`,
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) return 0;

        let cancelCount = 0;
        const nowJstStr = toJstIsoString(getJstNow());

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const currentUrl = row[3];
            const currentStatus = row[8];

            if (currentUrl === sheetUrl && currentStatus === 'pending') {
                const rowNumber = i + 1;
                row[8] = 'cancelled';
                row[14] = nowJstStr;

                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID!,
                    range: `${SHEET_NAME}!A${rowNumber}:O${rowNumber}`,
                    valueInputOption: 'RAW',
                    requestBody: {
                        values: [row]
                    }
                });
                cancelCount++;
            }
        }

        return cancelCount;
    } catch (error: any) {
        console.error('❌ [ReminderJobs] ジョブキャンセルエラー:', error.message);
        throw error;
    }
}
