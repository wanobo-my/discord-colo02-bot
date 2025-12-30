import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

// 改行コードの修正
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

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