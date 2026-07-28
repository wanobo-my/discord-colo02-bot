/**
 * 曲目リストの命名・判定に関する純粋関数。
 *
 * ⚠️ このファイルには副作用のある import を追加しないこと。
 *    Discord / Google Drive / dotenv に依存しないからこそ、
 *    ネットワークにも認証情報にも触れずに単体テストできる (tests/setlistNaming.test.ts)。
 */

/** 添付ファイルのサイズ上限 (25MB)。Discord 無料枠の添付上限より大きいため実質すべて通る。 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** 日付・施設名を特定できなかった場合の退避先フォルダ名。 */
export const UNCLASSIFIED_FOLDER_NAME = '_未分類';

export interface FacilityParts {
    /** 法人名 (括弧の前)。括弧が無い場合は全体。 */
    corporation: string;
    /** 施設名 (括弧の中)。括弧が無い場合は null。 */
    facility: string | null;
}

export interface ParsedThreadName extends FacilityParts {
    /** YYYY.MM.DD 形式に正規化した実施日 */
    date: string;
    /** スレッド名から取り出した施設表記そのまま (例: 八事福祉会（八事苑デイサービスセンター）) */
    facilityFull: string;
}

// 例: 2026.07.28_八事福祉会（八事苑デイサービスセンター）
// 区切りは . - / のいずれも許容する (シート側の表記揺れに備える)。
const DATE_PREFIX_PATTERN = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})_(.+)$/;
const DATE_ONLY_PATTERN = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/;

/**
 * 「2026.07.28」「2026-7-8」などを「YYYY.MM.DD」に正規化します。
 * 解釈できない場合は null を返します。
 */
export function normalizeDate(raw: string): string | null {
    const matched = raw.trim().match(DATE_ONLY_PATTERN);
    if (!matched) return null;
    return buildDate(matched[1], matched[2], matched[3]);
}

function buildDate(year: string, month: string, day: string): string | null {
    const m = Number(month);
    const d = Number(day);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${year}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}`;
}

/**
 * 「八事福祉会（八事苑デイサービスセンター）」を法人名と施設名に分解します。
 * 全角・半角どちらの括弧にも対応します。括弧が無い場合は施設名を null にします。
 */
export function splitFacility(facilityFull: string): FacilityParts {
    const matched = facilityFull.trim().match(/^(.+?)[（(]([^（()）]*)[）)]$/);
    if (!matched || !matched[1].trim() || !matched[2].trim()) {
        return { corporation: facilityFull.trim(), facility: null };
    }
    return { corporation: matched[1].trim(), facility: matched[2].trim() };
}

/**
 * スレッド名を「YYYY.MM.DD_施設名」として解釈します。
 * 解釈できない場合は null を返します (呼び出し側で _未分類 へ退避する)。
 */
export function parseThreadName(name: string): ParsedThreadName | null {
    const matched = name.trim().match(DATE_PREFIX_PATTERN);
    if (!matched) return null;

    const date = buildDate(matched[1], matched[2], matched[3]);
    if (!date) return null;

    const facilityFull = matched[4].trim();
    if (!facilityFull) return null;

    return { date, facilityFull, ...splitFacility(facilityFull) };
}

/** 「2026.07.28」から年 (「2026」) を取り出します。 */
export function getYear(date: string): string {
    return date.slice(0, 4);
}

/**
 * 連番を除いたファイル名の土台を作ります。
 * 例: 2026.07.28_八事福祉会（八事苑デイサービスセンター）
 */
export function buildBaseName(date: string, facilityFull: string): string {
    return `${date}_${facilityFull.trim()}`;
}

/** bot のメッセージが「曲目リストの受付メッセージ」かどうかを判定します。 */
export function isSetlistAnchorContent(content: string): boolean {
    return content.includes('曲目リスト');
}

const IMAGE_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tif', '.tiff',
]);

const EXTENSION_BY_MIME: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'image/bmp': '.bmp',
    'image/tiff': '.tif',
    'application/pdf': '.pdf',
};

const MIME_BY_EXTENSION: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.pdf': 'application/pdf',
};

/** discord.js の Attachment から、判定に必要な最小限だけを取り出した形。 */
export interface AttachmentLike {
    name: string;
    size: number;
    contentType: string | null;
}

export type AttachmentVerdict =
    | { accepted: true; extension: string; mimeType: string }
    | { accepted: false; reason: string };

/** ファイル名から拡張子を小文字で取り出します (無ければ空文字)。 */
export function extensionOf(fileName: string): string {
    const index = fileName.lastIndexOf('.');
    if (index <= 0 || index === fileName.length - 1) return '';
    return fileName.slice(index).toLowerCase();
}

/** バイト数を人が読める形式にします。 */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 添付ファイルが回収対象かを判定します。
 *
 * 対象は画像 (image/*) と PDF のみ。contentType が取得できない場合は拡張子で判定します。
 * 対象外や上限超過は理由付きで返し、呼び出し側が利用者へ通知できるようにします。
 */
export function classifyAttachment(attachment: AttachmentLike): AttachmentVerdict {
    const mime = (attachment.contentType ?? '').split(';')[0].trim().toLowerCase();
    const extension = extensionOf(attachment.name);

    const isImage = mime.startsWith('image/');
    const isPdf = mime === 'application/pdf';
    // contentType が無い場合のフォールバック
    const looksSupported = !mime && (IMAGE_EXTENSIONS.has(extension) || extension === '.pdf');

    if (!isImage && !isPdf && !looksSupported) {
        const shown = mime || extension || '不明';
        return { accepted: false, reason: `対象外の形式です (${shown})。画像かPDFを送ってください。` };
    }

    if (attachment.size > MAX_ATTACHMENT_BYTES) {
        return {
            accepted: false,
            reason: `サイズが上限を超えています (${formatBytes(attachment.size)} > ${formatBytes(MAX_ATTACHMENT_BYTES)})`,
        };
    }

    return {
        accepted: true,
        extension: extension || EXTENSION_BY_MIME[mime] || '',
        mimeType: mime || MIME_BY_EXTENSION[extension] || 'application/octet-stream',
    };
}
