/**
 * フェーズ2: Drive 書き込みの最小動作確認スクリプト。
 *
 * Discord とは完全に切り離し、ローカルで生成した小さな画像を
 * 指定フォルダへアップロードできるかだけを確認します。
 *
 * 実行方法:
 *   npx tsx scripts/test-drive-upload.ts
 *
 * 確認する項目:
 *   1. 認証が通ること
 *   2. フォルダが存在しない場合に自動作成されること
 *   3. 想定フォルダに、想定した名前でファイルが作られること
 *   4. 同名ファイルがあった場合に連番が振られ、上書きされないこと
 *
 * ⚠️ 作成されるファイル名は "TEST_" で始まります。確認後は Drive から手動で削除してください。
 */

import { Readable } from 'node:stream';
import {
    testDriveConnection,
    resolveSetlistFolder,
    buildUniqueFileName,
    uploadStream,
} from '../src/utils/googleDrive.js';

// 1x1 ピクセルの PNG (テスト用の最小画像)
const TEST_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const TEST_YEAR = '2026';
const TEST_BASE_NAME = 'TEST_2026.07.28_八事福祉会（八事苑デイサービスセンター）';

function createTestStream(): Readable {
    return Readable.from(Buffer.from(TEST_PNG_BASE64, 'base64'));
}

async function main() {
    console.log('🧪 フェーズ2: Drive 書き込みの動作確認を開始します。\n');

    // --- 1. 認証確認 ---
    console.log('--- [1/4] 認証確認 ---');
    const connected = await testDriveConnection();
    if (!connected) {
        console.error('\n❌ 認証に失敗したため、以降のテストを中止します。');
        console.error('   docs/setlist-drive-setup.md の手順を確認してください。');
        process.exit(1);
    }

    // --- 2. フォルダの自動作成 ---
    console.log('\n--- [2/4] フォルダの自動作成 ---');
    const folderId = await resolveSetlistFolder(TEST_YEAR);
    console.log(`✅ 保存先フォルダを解決しました (曲目リスト/${TEST_YEAR}/): ${folderId}`);

    // --- 3. 1枚目のアップロード ---
    console.log('\n--- [3/4] 1枚目のアップロード ---');
    const firstName = await buildUniqueFileName(folderId, TEST_BASE_NAME, '.png');
    console.log(`   生成されたファイル名: ${firstName}`);
    const first = await uploadStream({
        folderId,
        fileName: firstName,
        mimeType: 'image/png',
        stream: createTestStream(),
    });
    console.log(`✅ アップロード成功: ${first.name}`);
    console.log(`   URL: ${first.webViewLink ?? '(取得できませんでした)'}`);

    // --- 4. 2枚目のアップロード (連番の確認) ---
    console.log('\n--- [4/4] 2枚目のアップロード (連番・上書き防止の確認) ---');
    const secondName = await buildUniqueFileName(folderId, TEST_BASE_NAME, '.png');
    console.log(`   生成されたファイル名: ${secondName}`);

    if (secondName === firstName) {
        console.error('❌ 連番が振られていません。同名ファイルを上書きする恐れがあります。');
        process.exit(1);
    }

    const second = await uploadStream({
        folderId,
        fileName: secondName,
        mimeType: 'image/png',
        stream: createTestStream(),
    });
    console.log(`✅ アップロード成功: ${second.name}`);
    console.log(`   URL: ${second.webViewLink ?? '(取得できませんでした)'}`);

    console.log('\n========================================');
    console.log('🎉 すべての確認項目に合格しました。');
    console.log(`   ${firstName}`);
    console.log(`   ${secondName}`);
    console.log('\n⚠️ 確認が終わったら、上記2ファイルを Drive から手動で削除してください。');
    console.log('========================================');
}

main().catch((error: any) => {
    console.error('\n❌ テスト中にエラーが発生しました:');
    console.error(error.message);
    if (error.response?.data) {
        console.error('   詳細:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
});
