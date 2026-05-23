import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

// 改行コードの修正および前後のクォーテーション削除
let rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY;
if (rawPrivateKey) {
    rawPrivateKey = rawPrivateKey.trim();
    if (rawPrivateKey.startsWith('"') && rawPrivateKey.endsWith('"')) {
        rawPrivateKey = rawPrivateKey.slice(1, -1);
    } else if (rawPrivateKey.startsWith("'") && rawPrivateKey.endsWith("'")) {
        rawPrivateKey = rawPrivateKey.slice(1, -1);
    }
}

// 診断用ログ（機密情報は出力しない）
console.log("🔍 [Google Auth Diagnostic]");
console.log("- EMAIL:", process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
if (!rawPrivateKey) {
    console.log("- GOOGLE_PRIVATE_KEY: undefined or empty");
} else {
    console.log("- Key Length:", rawPrivateKey.length);
    console.log("- Starts with PEM header:", rawPrivateKey.startsWith('-----BEGIN PRIVATE KEY-----'));
    console.log("- Ends with PEM footer:", rawPrivateKey.endsWith('-----END PRIVATE KEY-----'));
    console.log("- Contains '\\n' (escaped):", rawPrivateKey.includes('\\n'));
    console.log("- Contains actual newline:", rawPrivateKey.includes('\n'));
    console.log("- Contains space (excluding header/footer):", rawPrivateKey.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').includes(' '));
}

const privateKey = rawPrivateKey?.replace(/\\n/g, '\n');

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: privateKey,
    },
    // ▼▼▼ 変更点: Driveの権限を追加しました ▼▼▼
    scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive', // ファイル操作用
    ],
});

export const sheets = google.sheets({ version: 'v4', auth });
export const drive = google.drive({ version: 'v3', auth }); // Drive用の道具を輸出

// 接続テスト関数
export async function testConnection() {
    try {
        const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
        const response = await sheets.spreadsheets.get({
            spreadsheetId,
        });
        console.log(`✅ Sheets接続成功: ${response.data.properties?.title}`);
        
        // Driveもテスト
        const driveResponse = await drive.files.get({ fileId: spreadsheetId! });
        console.log(`✅ Drive接続成功: ${driveResponse.data.name}`);
        
        return true;
    } catch (error) {
        console.error('❌ Google接続エラー:', error);
        return false;
    }
}