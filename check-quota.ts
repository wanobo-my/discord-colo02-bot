import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });

async function checkQuota() {
    console.log('📊 Botのストレージ健康診断を開始します...');
    console.log(`User: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}\n`);

    try {
        const res = await drive.about.get({
            fields: 'storageQuota',
        });

        const quota = res.data.storageQuota;
        
        if (quota) {
            const limit = parseInt(quota.limit || '0');
            const usage = parseInt(quota.usage || '0');
            const usageInDrive = parseInt(quota.usageInDrive || '0');

            console.log('--- 診断結果 ---');
            console.log(`📦 合計容量 (Limit): ${(limit / 1024 / 1024).toFixed(2)} MB`);
            console.log(`📝 使用済み (Usage): ${(usage / 1024 / 1024).toFixed(2)} MB`);
            console.log(`📂 ドライブ使用量  : ${(usageInDrive / 1024 / 1024).toFixed(2)} MB`);
            
            if (limit === 0) {
                console.log('\n❌ 【原因確定】保存容量が「0 MB」になっています。');
                console.log('   これはGoogle Cloudがお支払い情報の紐付けを確認できていないため、');
                console.log('   Botの書き込み権限を凍結している状態です。');
            } else if (usage >= limit) {
                console.log('\n❌ 保存容量が一杯です（ゴミ箱も確認してください）。');
            } else {
                console.log('\n✅ 容量には空きがあります。これでエラーが出る場合のみ、コードを疑います。');
            }
        }
    } catch (error: any) {
        console.error('診断エラー:', error.message);
    }
}

checkQuota();