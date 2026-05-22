import dotenv from 'dotenv';
dotenv.config();

/**
 * 日本時間 (JST) の現在時刻を取得します。
 */
export function getJstNow(): Date {
    // 現在のUTC時間を取得し、JSTのタイムゾーン時間を計算します
    const now = new Date();
    return new Date(now.getTime() + (9 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000));
}

/**
 * YYYY-MM-DD 形式の文字列を、日本時間 (JST) の 00:00:00 として解釈した Date オブジェクトに変換します。
 * 例: "2026-06-20" -> JSTの2026年6月20日 00:00:00
 */
export function parseJstDate(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    // 月は0から始まるため、month - 1
    // UTCで作成し、9時間分戻すことでJSTの0時を表現する
    const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    // JSTはUTC+9なので、UTCから9時間引いたものがJSTの0時
    date.setUTCHours(date.getUTCHours() - 9);
    return date;
}

/**
 * 指定された日付から、日本時間 (JST) の特定の時刻 (HH:MM:SS) の Date オブジェクトを作成します。
 * 例: (2026-06-20のDate, 18, 0) -> JSTの2026年6月20日 18:00:00
 */
export function getJstTimeForDate(date: Date, hours: number, minutes: number = 0, seconds: number = 0): Date {
    // 一度JSTのタイムゾーンに合わせた日付情報を取得
    const jstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
    const year = jstDate.getUTCFullYear();
    const month = jstDate.getUTCMonth();
    const day = jstDate.getUTCDate();
    
    // UTCで指定の時刻を作成し、そこから9時間引いてJST表現にする
    const target = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
    target.setUTCHours(target.getUTCHours() - 9);
    return target;
}

/**
 * Date オブジェクトを ISO 8601 (JST基準) 形式の文字列に変換します。
 * 例: "2026-06-20T18:00:00+09:00"
 */
export function toJstIsoString(date: Date): string {
    const jstTime = date.getTime() + (9 * 60 * 60 * 1000);
    const jstDate = new Date(jstTime);
    
    const pad = (n: number) => n.toString().padStart(2, '0');
    
    const year = jstDate.getUTCFullYear();
    const month = pad(jstDate.getUTCMonth() + 1);
    const day = pad(jstDate.getUTCDate());
    const hours = pad(jstDate.getUTCHours());
    const minutes = pad(jstDate.getUTCMinutes());
    const seconds = pad(jstDate.getUTCSeconds());
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+09:00`;
}
