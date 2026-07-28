import { google, drive_v3 } from 'googleapis';
import { Readable } from 'node:stream';
import dotenv from 'dotenv';

dotenv.config();

/**
 * 曲目リスト保存用の Google Drive クライアント。
 *
 * 既存の googleSheets.ts (サービスアカウント方式) とは意図的に分離しています。
 * サービスアカウントは個人向け Google アカウントのマイドライブにファイルを所有できず
 * (ストレージ割当が 0 のため必ず失敗する)、Drive への書き込みだけは
 * OAuth 2.0 のリフレッシュトークン方式を使う必要があるためです。
 *
 * この分離により、Drive 側で問題が起きても既存の Sheets 連携は影響を受けません。
 */

const REQUIRED_ENV = [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_OAUTH_REFRESH_TOKEN',
] as const;

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// SETLIST_ROOT_FOLDER_ID の直下に作られる、曲目リスト用フォルダの名前。
// ⚠️ Drive 側でこのフォルダをリネームした場合は、ここも必ず合わせること。
//    一致しないと bot は「無い」と判断して同名フォルダを新規作成してしまう。
export const SETLIST_FOLDER_NAME = '#記録_曲目リスト';

let cachedDrive: drive_v3.Drive | null = null;

/**
 * Drive クライアントを取得します。
 *
 * 環境変数が未設定でも import 時点では失敗させず、実際に使う時点で明示的に投げます。
 * (import 時に throw すると bot 全体が起動しなくなり、既存機能を巻き込むため)
 */
export function getSetlistDrive(): drive_v3.Drive {
    if (cachedDrive) return cachedDrive;

    const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(
            `❌ [Drive] 環境変数が未設定のため Drive に接続できません: ${missing.join(', ')}`
        );
    }

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_OAUTH_CLIENT_ID,
        process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    // アクセストークンは googleapis がリフレッシュトークンから自動で再取得します。
    oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
    });

    cachedDrive = google.drive({ version: 'v3', auth: oauth2Client });
    return cachedDrive;
}

/**
 * Drive の検索クエリ (q パラメータ) に文字列を埋め込むためのエスケープ。
 * 施設名にクォートが含まれた場合にクエリが壊れるのを防ぎます。
 */
function escapeForQuery(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeForRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ファイル名として使えない文字を除去します。
 * Drive はほとんどの文字を許容しますが、パス区切りと制御文字だけは避けます。
 */
export function sanitizeFileName(value: string): string {
    return value
        // 制御文字 (U+0000〜U+001F) を除去
        .replace(/[\u0000-\u001f]/g, '')
        // パス区切りとして解釈されうる文字を置換
        .replace(/[/\\]/g, '_')
        .trim();
}

/**
 * 指定した親フォルダ直下に、名前が一致するフォルダを探し、無ければ作成して ID を返します。
 */
export async function ensureFolder(name: string, parentId: string): Promise<string> {
    const drive = getSetlistDrive();
    const safeName = sanitizeFileName(name);

    const q = [
        `name = '${escapeForQuery(safeName)}'`,
        `mimeType = '${FOLDER_MIME}'`,
        `'${escapeForQuery(parentId)}' in parents`,
        'trashed = false',
    ].join(' and ');

    const found = await drive.files.list({
        q,
        fields: 'files(id, name)',
        pageSize: 1,
    });

    const existing = found.data.files?.[0];
    if (existing?.id) {
        return existing.id;
    }

    const created = await drive.files.create({
        requestBody: {
            name: safeName,
            mimeType: FOLDER_MIME,
            parents: [parentId],
        },
        fields: 'id',
    });

    if (!created.data.id) {
        throw new Error(`フォルダ「${safeName}」の作成に失敗しました (ID が返りませんでした)`);
    }

    console.log(`📁 [Drive] フォルダを作成しました: ${safeName}`);
    return created.data.id;
}

/**
 * 曲目リストの保存先フォルダ ( {SETLIST_ROOT_FOLDER_ID}/{SETLIST_FOLDER_NAME}/{年}/ ) を解決します。
 * 途中のフォルダが存在しない場合は自動で作成します。
 */
export async function resolveSetlistFolder(year: string): Promise<string> {
    const rootId = process.env.SETLIST_ROOT_FOLDER_ID;
    if (!rootId) {
        throw new Error('❌ [Drive] 環境変数 SETLIST_ROOT_FOLDER_ID が設定されていません。');
    }

    const setlistFolderId = await ensureFolder(SETLIST_FOLDER_NAME, rootId);
    return ensureFolder(year, setlistFolderId);
}

/**
 * フォルダ内の既存ファイルを見て、重複しない連番付きファイル名を組み立てます。
 *
 * 既存ファイルを上書きしないことを最優先にしており、
 * 同じベース名のファイルがあれば連番の最大値 + 1 を採用します。
 *
 * 例: baseName = "2026.07.28_八事福祉会", extension = ".jpg"
 *     → "2026.07.28_八事福祉会_01.jpg"
 */
export async function buildUniqueFileName(
    folderId: string,
    baseName: string,
    extension: string
): Promise<string> {
    const drive = getSetlistDrive();
    const safeBase = sanitizeFileName(baseName);

    const q = [
        `name contains '${escapeForQuery(safeBase)}'`,
        `'${escapeForQuery(folderId)}' in parents`,
        'trashed = false',
    ].join(' and ');

    const res = await drive.files.list({
        q,
        fields: 'files(name)',
        pageSize: 1000,
    });

    const pattern = new RegExp(`^${escapeForRegExp(safeBase)}_(\\d+)\\.`);
    let nextIndex = 1;

    for (const file of res.data.files ?? []) {
        const matched = file.name?.match(pattern);
        if (matched) {
            nextIndex = Math.max(nextIndex, Number(matched[1]) + 1);
        }
    }

    return `${safeBase}_${String(nextIndex).padStart(2, '0')}${extension}`;
}

/**
 * URL から添付ファイルを取得し、Node の Readable ストリームとして返します。
 *
 * Koyeb の無料プランはメモリが小さいため、ファイル全体をメモリに展開せず
 * 取得したそばから Drive へ流し込めるようストリームのまま扱います。
 */
export async function fetchAttachmentStream(
    url: string
): Promise<{ stream: Readable; contentLength: number | null }> {
    const res = await fetch(url);

    if (!res.ok) {
        // Discord の CDN URL は署名付きで有効期限があるため、
        // 403 / 404 の場合は呼び出し側でメッセージを取り直して再試行してください。
        throw new Error(`添付ファイルの取得に失敗しました (HTTP ${res.status} ${res.statusText})`);
    }
    if (!res.body) {
        throw new Error('添付ファイルのレスポンスボディが空でした');
    }

    const lengthHeader = res.headers.get('content-length');

    return {
        stream: Readable.fromWeb(res.body as any),
        contentLength: lengthHeader ? Number(lengthHeader) : null,
    };
}

export interface UploadedFile {
    id: string;
    name: string;
    webViewLink: string | null;
}

/**
 * ストリームをそのまま Drive へアップロードします。
 */
export async function uploadStream(params: {
    folderId: string;
    fileName: string;
    mimeType: string;
    stream: Readable;
}): Promise<UploadedFile> {
    const drive = getSetlistDrive();

    const res = await drive.files.create({
        requestBody: {
            name: params.fileName,
            parents: [params.folderId],
        },
        media: {
            mimeType: params.mimeType,
            body: params.stream,
        },
        fields: 'id, name, webViewLink',
    });

    if (!res.data.id) {
        throw new Error(`ファイル「${params.fileName}」のアップロードに失敗しました (ID が返りませんでした)`);
    }

    console.log(`⬆️ [Drive] アップロード完了: ${res.data.name}`);

    return {
        id: res.data.id,
        name: res.data.name ?? params.fileName,
        webViewLink: res.data.webViewLink ?? null,
    };
}

/**
 * 接続確認用。認証が通り、指定フォルダにアクセスできるかを確かめます。
 */
export async function testDriveConnection(): Promise<boolean> {
    try {
        const drive = getSetlistDrive();

        const about = await drive.about.get({ fields: 'user(emailAddress), storageQuota(limit, usage)' });
        console.log(`✅ [Drive] 認証成功: ${about.data.user?.emailAddress}`);

        const quota = about.data.storageQuota;
        if (quota?.limit) {
            const limitGb = Number(quota.limit) / 1024 / 1024 / 1024;
            const usageGb = Number(quota.usage ?? 0) / 1024 / 1024 / 1024;
            console.log(`📦 [Drive] 使用量: ${usageGb.toFixed(2)} GB / ${limitGb.toFixed(2)} GB`);
        }

        const rootId = process.env.SETLIST_ROOT_FOLDER_ID;
        if (!rootId) {
            console.warn('⚠️ [Drive] SETLIST_ROOT_FOLDER_ID が未設定のため、フォルダ確認はスキップします。');
            return true;
        }

        const folder = await drive.files.get({ fileId: rootId, fields: 'id, name, mimeType' });
        if (folder.data.mimeType !== FOLDER_MIME) {
            console.error(`❌ [Drive] SETLIST_ROOT_FOLDER_ID がフォルダではありません: ${folder.data.name}`);
            return false;
        }
        console.log(`✅ [Drive] 保存先フォルダを確認: ${folder.data.name}`);

        return true;
    } catch (error: any) {
        console.error('❌ [Drive] 接続エラー:', error.message);
        return false;
    }
}
