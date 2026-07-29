import { 
    SlashCommandBuilder, 
    CommandInteraction, 
    EmbedBuilder, 
    Colors, 
    TextChannel,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    UserSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalSubmitInteraction,
    UserSelectMenuInteraction,
    ButtonInteraction,
    ForumChannel,
    ThreadChannel,
    Client
} from 'discord.js';
import dotenv from 'dotenv';
import { saveConcertThread, getConcertThreadByThreadId, updateConcertThread } from '../services/concertService.js';
import { getJstNow, toJstIsoString } from '../utils/date.js';

dotenv.config();

// 一時的な登録セッションを保持するメモリマップ
// キー: 作成者のDiscord ID (userID)
interface CreateSession {
    date: string;
    facility: string;
    time: string;
    meeting: string;
    note: string;
    participantIds?: string[];
    photoPolicy?: string;
    previewMessageId?: string;
}
const createSessions = new Map<string, CreateSession>();

const PHOTO_POLICIES: { [key: string]: string } = {
    'photo_ok': '📷 写真撮影：可',
    'photo_face_ng': '📷 写真撮影：入居者様の顔が映らなければ可',
    'photo_confirm': '📷 写真撮影：要確認',
    'photo_ng': '📷 写真撮影：不可'
};

export const data = new SlashCommandBuilder()
    .setName('concert')
    .setDescription('コンサートフォーラム投稿管理')
    .addSubcommand(subcommand =>
        subcommand.setName('create').setDescription('コンサート予定のフォーラム投稿を作成')
    )
    .addSubcommand(subcommand =>
        subcommand.setName('update').setDescription('このコンサート予定のスレッド情報を更新')
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;

    const subcommand = interaction.options.getSubcommand();

    // =================================================================
    // 🆕 新規作成モード (create)
    // =================================================================
    if (subcommand === 'create') {
        // 1. 基本情報モーダルの送信
        const modal = new ModalBuilder()
            .setCustomId('concert_modal_create')
            .setTitle('コンサート予定の登録');

        const dateInput = new TextInputBuilder()
            .setCustomId('date')
            .setLabel('実施日 (例: 2026.05.16)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const facilityInput = new TextInputBuilder()
            .setCustomId('facility')
            .setLabel('施設名 (例: ボンセジュール植田)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const timeInput = new TextInputBuilder()
            .setCustomId('time')
            .setLabel('演奏時間 (例: 14:15-15:00)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const meetingInput = new TextInputBuilder()
            .setCustomId('meeting')
            .setLabel('集合時間・場所 (例: 13:45 現地集合)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        const noteInput = new TextInputBuilder()
            .setCustomId('note')
            .setLabel('メモ・自由記述欄')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(facilityInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(timeInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(meetingInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(noteInput)
        );

        await interaction.showModal(modal);
    }

    // =================================================================
    // 🔄 更新モード (update)
    // =================================================================
    else if (subcommand === 'update') {
        await interaction.deferReply({ ephemeral: true });

        const channel = interaction.channel;
        if (!channel || !(channel instanceof ThreadChannel)) {
            await interaction.editReply('❌ エラー: このコマンドはコンサートスレッド（フォーラムの投稿）内でのみ使用できます。');
            return;
        }

        // スプレッドシートから対象コンサートを検索
        const concert = await getConcertThreadByThreadId(channel.id);
        if (!concert) {
            await interaction.editReply('❌ エラー: このスレッドはBotで管理されているコンサート予定ではないか、データが見つかりません。');
            return;
        }

        // 更新項目を選択するボタンを送信
        const embed = new EmbedBuilder()
            .setTitle('🔄 コンサート情報の更新')
            .setColor(Colors.Blue)
            .setDescription(`**現在の施設名:** ${concert.facilityName}\n**実施日:** ${concert.concertDate}\n\n更新したい項目を選択してください。`)
            .setTimestamp();

        const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`concert_updbtn_info_${channel.id}`)
                .setLabel('基本情報を更新 (日時/施設/時間/集合)')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`concert_updbtn_members_${channel.id}`)
                .setLabel('参加メンバーを更新')
                .setStyle(ButtonStyle.Primary)
        );

        const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`concert_updbtn_photo_${channel.id}`)
                .setLabel('写真ポリシーを更新')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`concert_updbtn_note_${channel.id}`)
                .setLabel('補足メモを更新')
                .setStyle(ButtonStyle.Primary)
        );

        const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`concert_updbtn_done_${channel.id}`)
                .setLabel('ステータスを「終了」にする')
                .setStyle(ButtonStyle.Success)
        );

        await interaction.editReply({
            embeds: [embed],
            components: [row1, row2, row3]
        });
    }
}

/**
 * モーダル送信ハンドラ
 */
export async function handleModalSubmit(interaction: ModalSubmitInteraction) {
    const customId = interaction.customId;

    // A. 新規作成時の基本情報送信
    if (customId === 'concert_modal_create') {
        await interaction.deferReply({ ephemeral: true });

        const date = interaction.fields.getTextInputValue('date');
        const facility = interaction.fields.getTextInputValue('facility');
        const time = interaction.fields.getTextInputValue('time');
        const meeting = interaction.fields.getTextInputValue('meeting') || '';
        const note = interaction.fields.getTextInputValue('note') || '';

        // セッション保存
        createSessions.set(interaction.user.id, {
            date,
            facility,
            time,
            meeting,
            note
        });

        // メンバー選択メニューを送信
        const memberSelect = new UserSelectMenuBuilder()
            .setCustomId('concert_select_members')
            .setPlaceholder('参加するメンバーを全員選択してください')
            .setMinValues(1)
            .setMaxValues(25);

        const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(memberSelect);

        await interaction.editReply({
            content: '👥 **ステップ 2**: コンサートに参加するメンバーを選択してください。',
            components: [row]
        });
    }

    // B. 基本情報更新時の送信
    else if (customId.startsWith('concert_modal_update_info_')) {
        await interaction.deferReply({ ephemeral: true });
        const threadId = customId.split('_').pop()!;

        const date = interaction.fields.getTextInputValue('date');
        const facility = interaction.fields.getTextInputValue('facility');
        const time = interaction.fields.getTextInputValue('time');
        const meeting = interaction.fields.getTextInputValue('meeting') || '';

        const concert = await getConcertThreadByThreadId(threadId);
        if (!concert || !concert.rowNumber) {
            await interaction.editReply('❌ エラー: 該当するデータが見つかりません。');
            return;
        }

        // スプレッドシート更新
        await updateConcertThread(concert.rowNumber, {
            concertDate: date,
            facilityName: facility,
            time: time,
            meeting: meeting,
            title: `${date}_${facility}`
        });

        // スレッド名および親メッセージの更新
        await syncThreadMessage(interaction.client, threadId);

        await interaction.editReply('✅ コンサート基本情報を更新しました。');
    }

    // C. 補足メモ更新時の送信
    else if (customId.startsWith('concert_modal_update_note_')) {
        await interaction.deferReply({ ephemeral: true });
        const threadId = customId.split('_').pop()!;

        const note = interaction.fields.getTextInputValue('note') || '';

        const concert = await getConcertThreadByThreadId(threadId);
        if (!concert || !concert.rowNumber) {
            await interaction.editReply('❌ エラー: 該当するデータが見つかりません。');
            return;
        }

        // スプレッドシート更新
        await updateConcertThread(concert.rowNumber, { note });

        // 親メッセージ更新
        await syncThreadMessage(interaction.client, threadId);

        await interaction.editReply('✅ 補足メモを更新しました。');
    }
}

/**
 * ユーザー選択メニューハンドラ
 */
export async function handleUserSelect(interaction: UserSelectMenuInteraction) {
    const customId = interaction.customId;

    // A. 新規作成時のメンバー選択
    if (customId === 'concert_select_members') {
        await interaction.deferUpdate();

        const session = createSessions.get(interaction.user.id);
        if (!session) {
            await interaction.editReply('❌ エラー: セッションの有効期限が切れました。最初からやり直してください。');
            return;
        }

        // メンバーIDを保存
        session.participantIds = interaction.values;
        createSessions.set(interaction.user.id, session);

        // 写真ポリシー選択のボタンを送信
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('concert_btn_photo_ok').setLabel('写真OK').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('concert_btn_photo_face_ng').setLabel('顔が映らなければOK').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('concert_btn_photo_confirm').setLabel('要確認').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('concert_btn_photo_ng').setLabel('写真NG').setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({
            content: '📷 **ステップ 3**: 入居者様の写真撮影に関するポリシーを選択してください。',
            components: [row]
        });
    }

    // B. 更新時のメンバー選択
    else if (customId.startsWith('concert_select_update_members_')) {
        await interaction.deferReply({ ephemeral: true });
        const threadId = customId.split('_').pop()!;

        const concert = await getConcertThreadByThreadId(threadId);
        if (!concert || !concert.rowNumber) {
            await interaction.editReply('❌ エラー: 該当するデータが見つかりません。');
            return;
        }

        // スプレッドシート更新
        await updateConcertThread(concert.rowNumber, {
            participantIds: interaction.values.join(',')
        });

        // 親メッセージ更新
        await syncThreadMessage(interaction.client, threadId);

        await interaction.editReply('✅ 参加メンバーを更新しました。');
    }
}

/**
 * ボタンクリックハンドラ
 */
export async function handleButton(interaction: ButtonInteraction) {
    const customId = interaction.customId;

    // A. 新規作成時の写真ポリシー選択
    if (customId.startsWith('concert_btn_photo_')) {
        await interaction.deferUpdate();

        const session = createSessions.get(interaction.user.id);
        if (!session) {
            await interaction.editReply('❌ エラー: セッションが見つかりません。');
            return;
        }

        // ポリシーIDの抽出 (例: 'concert_btn_photo_ok' -> 'photo_ok')
        const policyKey = customId.replace('concert_btn_', '');
        session.photoPolicy = PHOTO_POLICIES[policyKey] || '📷 写真撮影：要確認';
        createSessions.set(interaction.user.id, session);

        // 最終プレビュー表示
        const bodyText = generateConcertBody({
            participantIds: session.participantIds || [],
            facilityName: session.facility,
            time: session.time,
            meeting: session.meeting,
            photoPolicy: session.photoPolicy,
            note: session.note
        });

        const embed = new EmbedBuilder()
            .setTitle(`👀 投稿プレビュー: ${session.date}_${session.facility}`)
            .setColor(Colors.Gold)
            .setDescription(bodyText)
            .setFooter({ text: '内容を確認の上、[投稿する] ボタンを押してください。' });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('concert_post_confirm').setLabel('投稿する').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('concert_post_cancel').setLabel('キャンセル').setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({
            content: '📝 **最終ステップ**: プレビューを確認してください。',
            embeds: [embed],
            components: [row]
        });
    }

    // B. 新規作成の確定 (投稿する)
    else if (customId === 'concert_post_confirm') {
        await interaction.deferUpdate();

        const session = createSessions.get(interaction.user.id);
        if (!session) {
            await interaction.editReply({ content: '❌ エラー: セッションが見つかりません。', embeds: [], components: [] });
            return;
        }

        const forumChannelId = process.env.CONCERT_FORUM_CHANNEL_ID;
        if (!forumChannelId) {
            await interaction.editReply({ content: '❌ エラー: 環境変数 `CONCERT_FORUM_CHANNEL_ID` が設定されていません。', embeds: [], components: [] });
            return;
        }

        try {
            const forum = await interaction.client.channels.fetch(forumChannelId) as ForumChannel;
            if (!forum || !(forum instanceof ForumChannel)) {
                await interaction.editReply({ content: '❌ エラー: 指定されたチャンネルはフォーラムチャンネルではありません。', embeds: [], components: [] });
                return;
            }

            const title = `${session.date}_${session.facility}`;
            const body = generateConcertBody({
                participantIds: session.participantIds || [],
                facilityName: session.facility,
                time: session.time,
                meeting: session.meeting,
                photoPolicy: session.photoPolicy || '要確認',
                note: session.note
            });

            // 予定タグIDの適用
            const appliedTags: string[] = [];
            const plannedTagId = process.env.CONCERT_TAG_PLANNED_ID;
            if (plannedTagId) appliedTags.push(plannedTagId);

            // 1. フォーラムスレッドの新規作成
            const thread = await forum.threads.create({
                name: title,
                message: {
                    content: body
                },
                appliedTags: appliedTags
            });

            // 2. スプレッドシートへの保存
            await saveConcertThread({
                threadId: thread.id,
                starterMessageId: thread.lastMessageId || '',
                forumChannelId: forumChannelId,
                title: title,
                concertDate: session.date,
                facilityName: session.facility,
                time: session.time,
                meeting: session.meeting,
                participantIds: (session.participantIds || []).join(','),
                photoPolicy: session.photoPolicy || '要確認',
                note: session.note,
                createdBy: interaction.user.id
            });

            // セッションクリア
            createSessions.delete(interaction.user.id);

            // コマンド使用者に見えるメッセージを投稿完了通知で上書きする
            await interaction.editReply({ 
                content: `🎉 コンサートのフォーラム投稿を作成しました！スレッド: <#${thread.id}>`, 
                embeds: [], 
                components: [] 
            });
        } catch (error: any) {
            console.error('Post error:', error);
            await interaction.editReply({ content: `❌ 投稿失敗: ${error.message}`, embeds: [], components: [] });
        }
    }

    // C. 新規作成のキャンセル
    else if (customId === 'concert_post_cancel') {
        createSessions.delete(interaction.user.id);
        await interaction.update({
            content: '🛑 投稿の作成をキャンセルしました。',
            embeds: [],
            components: []
        });
    }

    // =================================================================
    // 🔄 更新メニューから各種ボタンが押された時の処理
    // =================================================================
    
    // 基本情報の更新ボタン
    else if (customId.startsWith('concert_updbtn_info_')) {
        const threadId = customId.split('_').pop()!;
        const concert = await getConcertThreadByThreadId(threadId);

        if (!concert) {
            await interaction.reply({ content: '❌ データが見つかりません。', ephemeral: true });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId(`concert_modal_update_info_${threadId}`)
            .setTitle('基本情報の更新');

        const dateInput = new TextInputBuilder()
            .setCustomId('date')
            .setLabel('実施日')
            .setValue(concert.concertDate)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const facilityInput = new TextInputBuilder()
            .setCustomId('facility')
            .setLabel('施設名')
            .setValue(concert.facilityName)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const timeInput = new TextInputBuilder()
            .setCustomId('time')
            .setLabel('演奏時間')
            .setValue(concert.time)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const meetingInput = new TextInputBuilder()
            .setCustomId('meeting')
            .setLabel('集合時間・場所')
            .setValue(concert.meeting)
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(facilityInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(timeInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(meetingInput)
        );

        await interaction.showModal(modal);
    }

    // メンバー更新ボタン
    else if (customId.startsWith('concert_updbtn_members_')) {
        await interaction.deferReply({ ephemeral: true });
        const threadId = customId.split('_').pop()!;
        const concert = await getConcertThreadByThreadId(threadId);

        if (!concert) {
            await interaction.editReply('❌ データが見つかりません。');
            return;
        }

        const currentMembers = concert.participantIds ? concert.participantIds.split(',') : [];

        const memberSelect = new UserSelectMenuBuilder()
            .setCustomId(`concert_select_update_members_${threadId}`)
            .setPlaceholder('参加メンバーを新しく選択しなおしてください')
            .setMinValues(1)
            .setMaxValues(25);
            
        // 初期値のプレセレクトはdiscord.js v14のUserSelectMenuBuilderではAPI上の制約から難しいため、
        // ユーザーが再選択するUIになります。

        const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(memberSelect);
        await interaction.editReply({
            content: '👥 更新後のコンサートメンバーを全員選択してください。',
            components: [row]
        });
    }

    // 写真ポリシー更新ボタン
    else if (customId.startsWith('concert_updbtn_photo_')) {
        await interaction.deferReply({ ephemeral: true });
        const threadId = customId.split('_').pop()!;

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`concert_updphoto_ok_${threadId}`).setLabel('写真OK').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`concert_updphoto_faceng_${threadId}`).setLabel('顔NG').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`concert_updphoto_confirm_${threadId}`).setLabel('要確認').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`concert_updphoto_ng_${threadId}`).setLabel('写真NG').setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({
            content: '📷 新しい写真ポリシーを選択してください。',
            components: [row]
        });
    }

    // 各ポリシーが選択された時の更新処理
    else if (customId.startsWith('concert_updphoto_')) {
        await interaction.deferReply({ ephemeral: true });
        const parts = customId.split('_');
        const threadId = parts.pop()!;
        const actionType = parts.slice(2).join('_'); // ok / faceng / confirm / ng

        const policyKeysMap: { [key: string]: string } = {
            'ok': 'photo_ok',
            'faceng': 'photo_face_ng',
            'confirm': 'photo_confirm',
            'ng': 'photo_ng'
        };

        const policyKey = policyKeysMap[actionType];
        const policyText = PHOTO_POLICIES[policyKey] || '📷 写真撮影：要確認';

        const concert = await getConcertThreadByThreadId(threadId);
        if (!concert || !concert.rowNumber) {
            await interaction.editReply('❌ データが見つかりません。');
            return;
        }

        await updateConcertThread(concert.rowNumber, {
            photoPolicy: policyText
        });

        await syncThreadMessage(interaction.client, threadId);
        await interaction.editReply('✅ 写真ポリシーを更新しました。');
    }

    // 補足メモ更新ボタン
    else if (customId.startsWith('concert_updbtn_note_')) {
        const threadId = customId.split('_').pop()!;
        const concert = await getConcertThreadByThreadId(threadId);

        if (!concert) {
            await interaction.reply({ content: '❌ データが見つかりません。', ephemeral: true });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId(`concert_modal_update_note_${threadId}`)
            .setTitle('補足メモの更新');

        const noteInput = new TextInputBuilder()
            .setCustomId('note')
            .setLabel('補足メモ')
            .setValue(concert.note)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(noteInput));
        await interaction.showModal(modal);
    }

    // 終了タグへの更新
    else if (customId.startsWith('concert_updbtn_done_')) {
        await interaction.deferReply({ ephemeral: true });
        const threadId = customId.split('_').pop()!;

        const concert = await getConcertThreadByThreadId(threadId);
        if (!concert || !concert.rowNumber) {
            await interaction.editReply('❌ データが見つかりません。');
            return;
        }

        // スプレッドシート更新
        await updateConcertThread(concert.rowNumber, {
            status: 'done'
        });

        // スレッドのタグ変更
        try {
            const thread = await interaction.client.channels.fetch(threadId) as ThreadChannel;
            if (thread && thread instanceof ThreadChannel) {
                const doneTagId = process.env.CONCERT_TAG_DONE_ID;
                if (doneTagId) {
                    await thread.setAppliedTags([doneTagId]);
                }
                
                // 本文を再生成してスターターメッセージを更新
                await syncThreadMessage(interaction.client, threadId);

                // Phase 3: 活動後フォーム自動投稿
                await postActivityForm(thread);

                // 写真アルバムスレッド作成
                await createPhotoAlbumThread(interaction.client, concert);
            }
            await interaction.editReply('✅ ステータスを「終了」にし、タグを更新しました。活動後フォームも自動投稿し、#写真アルバム にスレッドを作成しました。');
        } catch (error: any) {
            console.error('Status update error:', error);
            await interaction.editReply(`⚠️ スプレッドシートは「終了」にしましたが、Discordの更新に失敗しました: ${error.message}`);
        }
    }
}

/**
 * スレッドの本文テキストを自動生成するヘルパー関数
 */
function generateConcertBody(data: {
    participantIds: string[];
    facilityName: string;
    time: string;
    meeting: string;
    photoPolicy: string;
    note: string;
}): string {
    const mentions = data.participantIds.map(id => `<@${id}>`).join(' ');
    
    let body = `👥 ${mentions}\n\n`;
    body += `📍 ${data.facilityName}\n`;
    body += `🕒 ${data.time}\n`;
    
    if (data.meeting) {
        body += `📢 集合：${data.meeting}\n`;
    }
    
    body += `${data.photoPolicy}\n\n`;
    
    if (data.note) {
        body += `📝 メモ\n${data.note}`;
    }
    
    return body;
}

/**
 * スプレッドシートの最新データを元に、Discordスレッド名および親メッセージを同期更新します。
 */
async function syncThreadMessage(client: any, threadId: string): Promise<void> {
    const concert = await getConcertThreadByThreadId(threadId);
    if (!concert) return;

    try {
        const thread = await client.channels.fetch(threadId) as ThreadChannel;
        if (!thread || !(thread instanceof ThreadChannel)) return;

        // 1. スレッド名 (タイトル) を同期更新
        const currentTitle = `${concert.concertDate}_${concert.facilityName}`;
        if (thread.name !== currentTitle) {
            await thread.setName(currentTitle);
        }

        // 2. 親メッセージ (スターターメッセージ) の更新
        const bodyText = generateConcertBody({
            participantIds: concert.participantIds ? concert.participantIds.split(',') : [],
            facilityName: concert.facilityName,
            time: concert.time,
            meeting: concert.meeting,
            photoPolicy: concert.photoPolicy,
            note: concert.note
        });

        // スターターメッセージを取得して編集
        // thread.id が starterMessageId と同じであることが多いが、明示的に取得する
        const starterMessageId = concert.starterMessageId || thread.id;
        
        try {
            const message = await thread.messages.fetch(starterMessageId);
            if (message && message.author.id === client.user.id) {
                await message.edit(bodyText);
            }
        } catch {
            // スターターメッセージのIDで直接取得できなかった場合、スレッドの最初のメッセージを探して編集
            const messages = await thread.messages.fetch({ limit: 10, after: thread.id });
            const firstMsg = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp).first();
            if (firstMsg && firstMsg.author.id === client.user.id) {
                await firstMsg.edit(bodyText);
            }
        }

    } catch (error) {
        console.error('Sync thread message failed:', error);
    }
}

/**
 * 指定されたスレッドへ活動記録フォームのリンクを自動投稿します。
 */
export function buildActivityFormMessage(): string {
    const defaultUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSdKkOzdnoQi8c8-nta7cvP0XiEEYzx-sRJd7cewetZKNJdgKA/viewform';
    const formUrl = process.env.ACTIVITY_FORM_URL || defaultUrl;

    // 「曲目リスト」の文字列は、このメッセージへの返信を回収対象と判定する目印も兼ねています。
    // 文面を変更する際も、この語は残してください (services/setlistCollector.ts を参照)。
    return `**🌷活動記録フォームのお願い**
今日もおつかれさまでした！
↓今後の活動報告や記録整理のためにフォーム入力お願いします！
${formUrl}

**📋 曲目リストの画像はこちらへ**
このメッセージに返信する形で画像を送ってください。coloが自動で保存しマス🤖
-# 送り方：このメッセージを長押し →「返信」→ 画像を添付して送信。複数枚まとめてOKです！`;
}

export async function postActivityForm(thread: ThreadChannel): Promise<void> {
    const formMessage = buildActivityFormMessage();

    await thread.send(formMessage);
    console.log(`✅ [Phase 3] スレッド ID: ${thread.id} に活動記録フォームを自動投稿しました。`);
}

/**
 * #写真アルバム チャンネルに、該当コンサートの写真投稿用スレッドを作成し、
 * 参加メンバーをメンションします。
 */
export async function createPhotoAlbumThread(
    client: Client,
    concert: { title: string; participantIds?: string }
): Promise<void> {
    const albumChannelId = '1358112786521129290';
    try {
        const channel = await client.channels.fetch(albumChannelId);
        if (!channel || !(channel.isTextBased() && 'threads' in channel)) {
            console.error(`⚠️ #写真アルバム チャンネル (${albumChannelId}) が見つからないか、スレッドを作成できるチャンネルではありません。`);
            return;
        }

        // スレッドの作成
        const thread = await (channel as any).threads.create({
            name: concert.title,
            autoArchiveDuration: 1440, // 24時間
            reason: `コンサート ${concert.title} の写真アルバムスレッド`
        });

        // 参加メンバーのメンション文字列を作成
        const participantIds = concert.participantIds ? concert.participantIds.split(',') : [];
        if (participantIds.length > 0) {
            const mentionString = participantIds.map(id => `<@${id.trim()}>`).join(' ');
            // 作成したスレッドにメンションメッセージを送信
            await thread.send({
                content: `${mentionString} コンサートの写真こちらにお願いします！`,
                allowedMentions: { parse: ['users'] }
            });
        }
        console.log(`✅ #写真アルバム チャンネルにスレッド「${concert.title}」を作成し、メンバーをメンションしました。`);

    } catch (error: any) {
        console.error('❌ #写真アルバム スレッド作成エラー:', error.message);
    }
}
