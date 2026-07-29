/**
 * 曲目リストの命名・判定ロジックのテスト。
 *
 * Discord にも Google Drive にも接続しないため、認証情報なしで実行できる。
 *   npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    MAX_ATTACHMENT_BYTES,
    buildBaseName,
    classifyAttachment,
    extensionOf,
    formatBytes,
    getYear,
    isSetlistAnchorContent,
    normalizeDate,
    formatDateForFileName,
    parseThreadName,
} from '../src/services/setlistNaming.js';

describe('parseThreadName', () => {
    test('アンダーバー以降をまるごと施設名として扱う', () => {
        const result = parseThreadName('2026.07.28_八事福祉会（八事苑デイサービスセンター）');
        assert.deepEqual(result, {
            date: '2026.07.28',
            facilityFull: '八事福祉会（八事苑デイサービスセンター）',
        });
    });

    test('括弧がない施設名もそのまま扱う', () => {
        const result = parseThreadName('2026.05.16_ボンセジュール植田');
        assert.equal(result?.facilityFull, 'ボンセジュール植田');
    });

    test('ハイフン区切りとゼロ埋めなしの日付を正規化する', () => {
        assert.equal(parseThreadName('2026-7-8_テスト施設')?.date, '2026.07.08');
    });

    test('施設名にアンダースコアが含まれても最初の区切りで分割する', () => {
        const result = parseThreadName('2026.07.28_A_B（C）');
        assert.equal(result?.facilityFull, 'A_B（C）');
    });

    test('日付で始まらない名前は null', () => {
        assert.equal(parseThreadName('雑談スレッド'), null);
        assert.equal(parseThreadName('八事福祉会_2026.07.28'), null);
    });

    test('施設名が空なら null', () => {
        assert.equal(parseThreadName('2026.07.28_'), null);
        assert.equal(parseThreadName('2026.07.28'), null);
    });

    test('存在しない月日は null', () => {
        assert.equal(parseThreadName('2026.13.01_テスト'), null);
        assert.equal(parseThreadName('2026.01.32_テスト'), null);
    });

    test('前後の空白を無視する', () => {
        assert.equal(parseThreadName('  2026.07.28_テスト施設  ')?.date, '2026.07.28');
    });
});

describe('normalizeDate', () => {
    test('シート側の表記揺れを吸収する', () => {
        assert.equal(normalizeDate('2026.07.28'), '2026.07.28');
        assert.equal(normalizeDate('2026-07-28'), '2026.07.28');
        assert.equal(normalizeDate(' 2026/7/8 '), '2026.07.08');
    });

    test('解釈できない値は null', () => {
        assert.equal(normalizeDate(''), null);
        assert.equal(normalizeDate('未定'), null);
        assert.equal(normalizeDate('2026.07.28 14:00'), null);
    });
});

describe('getYear / buildBaseName', () => {
    test('年を取り出せる', () => {
        assert.equal(getYear('2026.07.28'), '2026');
    });

    test('ファイル名の土台を組み立てる (日付はハイフン形式)', () => {
        assert.equal(
            buildBaseName('2026.07.28', '八事福祉会（八事苑デイサービスセンター）'),
            '2026-0728_八事福祉会（八事苑デイサービスセンター）'
        );
    });

    test('ファイル名にピリオドが残らない (拡張子の判定を壊さないため)', () => {
        const base = buildBaseName('2026.07.28', 'ボンセジュール植田');
        assert.equal(base.includes('.'), false);
    });

    test('日付をファイル名用に整形する', () => {
        assert.equal(formatDateForFileName('2026.07.28'), '2026-0728');
        assert.equal(formatDateForFileName('2026.12.01'), '2026-1201');
    });

    test('名前順に並べると日付順になる', () => {
        const names = [
            buildBaseName('2026.12.01', 'C'),
            buildBaseName('2026.07.28', 'A'),
            buildBaseName('2027.01.05', 'D'),
            buildBaseName('2026.08.05', 'B'),
        ].sort();
        assert.deepEqual(names.map((n) => n.slice(-1)), ['A', 'B', 'C', 'D']);
    });
});

describe('isSetlistAnchorContent', () => {
    test('案内メッセージを目印として認識する', () => {
        const actual = [
            '**🌷活動記録フォームのお願い**',
            '今日もおつかれさまでした！',
            '',
            '**📋 曲目リストの画像はこちらへ**',
            'このメッセージに返信する形で画像を送ってください。',
        ].join('\n');
        assert.equal(isSetlistAnchorContent(actual), true);
    });

    test('無関係なメッセージは対象外', () => {
        assert.equal(isSetlistAnchorContent('おつかれさまでした！'), false);
    });
});

describe('extensionOf', () => {
    test('拡張子を小文字で取り出す', () => {
        assert.equal(extensionOf('IMG_1234.JPG'), '.jpg');
        assert.equal(extensionOf('a.b.png'), '.png');
    });

    test('拡張子が無い場合は空文字', () => {
        assert.equal(extensionOf('README'), '');
        assert.equal(extensionOf('.env'), ''); // 先頭のドットは拡張子とみなさない
        assert.equal(extensionOf('trailing.'), '');
    });
});

describe('classifyAttachment', () => {
    const base = { name: 'setlist.jpg', size: 1024, contentType: 'image/jpeg' };

    test('画像は受け入れる', () => {
        const verdict = classifyAttachment(base);
        assert.equal(verdict.accepted, true);
        assert.equal(verdict.accepted && verdict.extension, '.jpg');
        assert.equal(verdict.accepted && verdict.mimeType, 'image/jpeg');
    });

    test('PDFも受け入れる', () => {
        const verdict = classifyAttachment({ name: 'setlist.pdf', size: 2048, contentType: 'application/pdf' });
        assert.equal(verdict.accepted, true);
    });

    test('charset 付きの contentType を扱える', () => {
        const verdict = classifyAttachment({ ...base, contentType: 'image/png; charset=utf-8' });
        assert.equal(verdict.accepted, true);
        assert.equal(verdict.accepted && verdict.mimeType, 'image/png');
    });

    test('動画や書庫は対象外', () => {
        const video = classifyAttachment({ name: 'movie.mp4', size: 1024, contentType: 'video/mp4' });
        assert.equal(video.accepted, false);
        assert.match(video.accepted === false ? video.reason : '', /対象外/);

        const zip = classifyAttachment({ name: 'a.zip', size: 1024, contentType: 'application/zip' });
        assert.equal(zip.accepted, false);
    });

    test('contentType が無ければ拡張子で判定する', () => {
        assert.equal(classifyAttachment({ name: 'photo.HEIC', size: 1024, contentType: null }).accepted, true);
        assert.equal(classifyAttachment({ name: 'note.txt', size: 1024, contentType: null }).accepted, false);
    });

    test('contentType が無くても mimeType を拡張子から補う', () => {
        const verdict = classifyAttachment({ name: 'photo.png', size: 1024, contentType: null });
        assert.equal(verdict.accepted && verdict.mimeType, 'image/png');
    });

    test('上限ちょうどは通し、超過は拒否する', () => {
        assert.equal(classifyAttachment({ ...base, size: MAX_ATTACHMENT_BYTES }).accepted, true);

        const tooBig = classifyAttachment({ ...base, size: MAX_ATTACHMENT_BYTES + 1 });
        assert.equal(tooBig.accepted, false);
        assert.match(tooBig.accepted === false ? tooBig.reason : '', /サイズが上限/);
    });
});

describe('formatBytes', () => {
    test('単位を切り替える', () => {
        assert.equal(formatBytes(512), '512 B');
        assert.equal(formatBytes(2048), '2.0 KB');
        assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
    });
});
