/**
 * Google Drive 用のリフレッシュトークンを取得する一回限りのスクリプト。
 *
 * 実行方法:
 *   npx tsx scripts/get-refresh-token.ts
 *
 * 事前に .env へ以下を設定しておいてください (取得手順は docs/setlist-drive-setup.md)。
 *   GOOGLE_OAUTH_CLIENT_ID=...
 *   GOOGLE_OAUTH_CLIENT_SECRET=...
 *
 * 実行するとブラウザで開く URL が表示されます。Google にログインして許可すると
 * リフレッシュトークンが表示されるので、それを .env と Koyeb の環境変数に登録してください。
 *
 * ⚠️ 表示されたトークンは絶対にコミットしないでください (このリポジトリは公開設定です)。
 */

import http from 'node:http';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const PORT = 5555;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

// Drive 全体のスコープを使います。
// drive.file (アプリが作成したファイルのみ) では、あなたが既に作った保存先フォルダの
// 中にファイルを作れないため、この用途では使えません。
const SCOPES = ['https://www.googleapis.com/auth/drive'];

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
    console.error('❌ .env に GOOGLE_OAUTH_CLIENT_ID と GOOGLE_OAUTH_CLIENT_SECRET を設定してください。');
    console.error('   取得手順: docs/setlist-drive-setup.md');
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
    // offline を指定しないとリフレッシュトークンが発行されません
    access_type: 'offline',
    scope: SCOPES,
    // 一度許可済みのアカウントでも確実にリフレッシュトークンを再発行させます
    prompt: 'consent',
});

const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith('/oauth2callback')) {
        res.writeHead(404);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>認可がキャンセルされました</h1><p>ターミナルに戻ってください。</p>');
        console.error(`❌ 認可がキャンセルされました: ${error}`);
        server.close();
        process.exit(1);
    }

    if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>コードが取得できませんでした</h1>');
        return;
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>✅ 取得できました</h1><p>ターミナルに戻ってください。このタブは閉じて構いません。</p>');

        console.log('\n========================================');
        if (tokens.refresh_token) {
            console.log('✅ リフレッシュトークンを取得しました。\n');
            console.log('以下の1行を .env に追記し、Koyeb の環境変数にも同じ値を登録してください:\n');
            console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
            console.log('\n⚠️ この値は絶対にコミットしないでください (このリポジトリは公開設定です)。');
        } else {
            console.error('❌ リフレッシュトークンが返りませんでした。');
            console.error('   Google アカウントの「サードパーティ製アプリとの連携」から');
            console.error('   このアプリのアクセス権を削除して、もう一度実行してください。');
        }
        console.log('========================================\n');
    } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>エラーが発生しました</h1><p>ターミナルを確認してください。</p>');
        console.error('❌ トークンの取得に失敗しました:', err.message);
    } finally {
        server.close();
    }
});

server.listen(PORT, () => {
    console.log('🔑 Google Drive のリフレッシュトークンを取得します。\n');
    console.log('以下の URL をブラウザで開いて、Google アカウントでログインし許可してください:\n');
    console.log(authUrl);
    console.log('\n※「このアプリは Google で確認されていません」と表示された場合は、');
    console.log('  「詳細」→「(アプリ名) に移動」を選んで進めてください。');
    console.log('  自分で作ったアプリなので問題ありません。\n');
    console.log('待機中... (中断する場合は Ctrl+C)');
});
