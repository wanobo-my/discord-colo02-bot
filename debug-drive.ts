import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const targetFolderId = process.env.GOOGLE_TARGET_FOLDER_ID;

console.log('🔍 --- Google Drive 捜査開始 ---');
console.log(`🔑 使用メアド (env): ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
console.log(`📂 探すフォルダID: ${targetFolderId}`);

async function run() {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: privateKey,
            },
            scopes: ['https://www.googleapis.com/auth/drive'],
        });

        const drive = google.drive({ version: 'v3', auth });

        // 1. そのフォルダがBotから見えるか直接確認
        try {
            const folder = await drive.files.get({
                fileId: targetFolderId,
                fields: 'id, name, owners'
            });
            console.log(`\n✅ 【発見】フォルダが見つかりました！`);
            console.log(`   名前: ${folder.data.name}`);
            console.log(`   所有者: ${folder.data.owners?.[0]?.emailAddress}`);
        } catch (e: any) {
            console.log(`\n❌ 【未発見】指定のフォルダにアクセスできませんでした。`);
            console.log(`   理由: ${e.message}`);
        }

        // 2. Botが見えているファイル一覧を表示（最大5件）
        console.log('\n👀 Botがいま見えているファイル一覧:');
        const list = await drive.files.list({
            pageSize: 5,
            fields: 'files(id, name, mimeType)'
        });
        
        if (list.data.files?.length === 0) {
            console.log('   (何も見えません...共有設定がされていない可能性があります)');
        } else {
            list.data.files?.forEach(f => {
                console.log(`   - [${f.name}] (ID: ${f.id})`);
            });
        }

    } catch (error) {
        console.error('エラー発生:', error);
    }
}

run();