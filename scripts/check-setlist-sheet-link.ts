/**
 * 曲目リスト URL の回答シート反映を、**書き込まずに**確認するスクリプト。
 *
 * 使い方:
 *   # 何が書き込まれる予定かを確認するだけ (既定)
 *   npx tsx scripts/check-setlist-sheet-link.ts
 *
 *   # 実際に書き込む (cron を待たずに反映したいとき)
 *   npx tsx scripts/check-setlist-sheet-link.ts --write
 *
 * cron と同じ関数を呼ぶので、ここで確認できた挙動がそのまま本番の挙動になります。
 */

import dotenv from 'dotenv';
import { backfillSetlistUrls } from '../src/services/setlistSheetLink.js';

dotenv.config();

async function main() {
    const write = process.argv.includes('--write');

    console.log(write ? '📝 実際に書き込みます。' : '🔍 DRY-RUN: 書き込みは行いません。');
    console.log(`   対象シート: ${process.env.ACTIVITY_RESPONSE_SPREADSHEET_ID ?? '(未設定)'}`);
    console.log(`   タブ名    : ${process.env.ACTIVITY_RESPONSE_SHEET_NAME || 'フォームの回答 1'}`);
    console.log('');

    const summary = await backfillSetlistUrls({ dryRun: !write });

    console.log('');
    console.log('=== 結果 ===');
    console.log(`  I列が空で対象になった行 : ${summary.targeted} 件`);
    console.log(`  ${write ? '書き込んだ行' : '書き込む予定の行'}       : ${summary.written} 件`);
    console.log(`  該当ファイルなし         : ${summary.noFile} 件`);
    console.log(`  特定できず見送り         : ${summary.skipped} 件`);

    if (!write && summary.written > 0) {
        console.log('');
        console.log('内容に問題がなければ --write を付けて再実行してください。');
    }
}

main().catch((error: any) => {
    console.error('❌ エラー:', error.message);
    process.exit(1);
});
