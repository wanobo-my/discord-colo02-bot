import { 
    SlashCommandBuilder, 
    CommandInteraction, 
    EmbedBuilder, 
    Colors, 
    TextChannel
} from 'discord.js';
import dotenv from 'dotenv';
import { registerScheduleJobs, cancelPendingJobsByUrl } from '../services/reminderJobs.js';
import { getJstNow, parseJstDate } from '../utils/date.js';

dotenv.config();

// 🆔 ユーザー名とDiscord IDのマッピング表
export const USER_MAP: { [key: string]: string } = {
    "なお": "1357919391747936276",
    "さな": "960009003235176508",
    "りこ": "1358599146163933205",
    "ゆうと": "632588632137531393",
    "あい": "1358685692527513650",
    "ちより": "1359316115813040370",
    "ゆいこ": "1387668604014821477",
    "ゆう": "502083127649501184",
    "りお": "1461979171394687048"
};

export const data = new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('日程調整関連のコマンド')
    .addSubcommand(subcommand =>
        subcommand.setName('create').setDescription('日程調整シートを新規作成')
            .addStringOption(o => o.setName('event_name').setDescription('イベント名').setRequired(true))
            .addStringOption(o => o.setName('deadline_date').setDescription('回答期限 (例: 2026-06-20)').setRequired(true))
            .addStringOption(o => o.setName('comment').setDescription('追加の一言').setRequired(false))
    )
    .addSubcommand(subcommand =>
        subcommand.setName('check').setDescription('未回答者にリマインド')
            .addStringOption(o => o.setName('url').setDescription('シートのURL').setRequired(true))
    )
    .addSubcommand(subcommand =>
        subcommand.setName('finish').setDescription('日程の集計結果を表示します')
            .addStringOption(o => o.setName('url').setDescription('シートのURL').setRequired(true))
    )
    .addSubcommand(subcommand =>
        subcommand.setName('cancel').setDescription('日程調整の自動リマインド・集計を停止')
            .addStringOption(o => o.setName('url').setDescription('対象シートのURL').setRequired(true))
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;
    
    const subcommand = interaction.options.getSubcommand();
    
    // cancelコマンドのみ、実行者だけに表示する(ephemeral)
    if (subcommand === 'cancel') {
        await interaction.deferReply({ ephemeral: true });
    } else {
        await interaction.deferReply();
    }

    const gasUrl = process.env.GAS_API_URL;

    if (!gasUrl) {
        await interaction.editReply('❌ エラー: .envに GAS_API_URL が未設定です。');
        return;
    }

    // =================================================================
    // 🗓️ 作成モード
    // =================================================================
    if (subcommand === 'create') {
        const eventName = interaction.options.getString('event_name', true);
        const deadlineDate = interaction.options.getString('deadline_date', true);
        const comment = interaction.options.getString('comment');

        // 日付形式の簡易バリデーション (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(deadlineDate)) {
            await interaction.editReply('❌ エラー: 回答期限は `YYYY-MM-DD` 形式（例: 2026-06-20）で入力してください。');
            return;
        }

        // 正当な日付かチェック
        const parsedDate = parseJstDate(deadlineDate);
        if (isNaN(parsedDate.getTime())) {
            await interaction.editReply('❌ エラー: 指定された日付が無効です。');
            return;
        }

        // 過去の日付でないかチェック (回答期限日の23:59:59までは許容)
        const now = getJstNow();
        const deadlineEndOfDay = new Date(parsedDate.getTime() + (24 * 60 * 60 * 1000) - 1);
        if (deadlineEndOfDay.getTime() < now.getTime()) {
            await interaction.editReply('❌ エラー: 過去の日付を回答期限に指定することはできません。');
            return;
        }

        try {
            const response = await fetch(gasUrl, {
                method: 'POST',
                body: JSON.stringify({ action: 'create', eventName }),
            });
            const result = await response.json() as any;

            if (result.success) {
                // 自動リマインド・集計用のジョブをReminderJobsシートに登録する
                await registerScheduleJobs({
                    eventName,
                    sheetUrl: result.url,
                    deadlineDate,
                    guildId: interaction.guildId || '',
                    channelId: interaction.channelId || '',
                    createdBy: interaction.user.id
                });

                let descriptionText = '下記リンクから回答をお願いします！';
                if (comment) descriptionText += `\n\n${comment}`;

                const embed = new EmbedBuilder()
                    .setTitle(`🗓️ 【日程調整】${eventName}`)
                    .setColor(Colors.Green)
                    .addFields(
                        { name: '回答期限', value: `${deadlineDate} 23:59`, inline: false },
                        { name: 'シートURL', value: `[クリックして回答する](${result.url})`, inline: false }
                    )
                    .setDescription(descriptionText)
                    .setFooter({ text: '🤖 自動リマインド・集計がスケジュールされました。' })
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            } else {
                throw new Error(result.message);
            }
        } catch (error: any) {
            console.error('Create error:', error);
            await interaction.editReply(`❌ 作成失敗: ${error.message}`);
        }
    }

    // =================================================================
    // 🔍 未回答チェック
    // =================================================================
    else if (subcommand === 'check') {
        const sheetUrl = interaction.options.getString('url', true);
        const channel = interaction.channel;
        if (!channel || !(channel instanceof TextChannel)) {
            await interaction.editReply('テキストチャンネルでのみ使用可能です。');
            return;
        }

        try {
            const result = await checkIncompleteUsers(gasUrl, sheetUrl);

            if (result.names.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('🎉 全員回答済みです！')
                    .setColor(Colors.Green)
                    .setDescription('全員の入力が完了しています。');
                await interaction.editReply({ embeds: [embed] });
            } else {
                const mentions = result.names.map(name => USER_MAP[name] ? `<@${USER_MAP[name]}>` : name);
                const mentionString = mentions.join(' ');

                const embed = new EmbedBuilder()
                    .setTitle('📣 リマインド・回答してね！')
                    .setColor(Colors.Orange)
                    .setDescription(`${mentionString}さん、未回答の箇所があります。\nシートを確認して入力を完了させてください！\n\n**📎 シートURL**\n[クリックして回答する](${sheetUrl})`)
                    .setFooter({ text: `未回答: ${result.names.length}名` });

                await interaction.editReply({ content: mentionString, embeds: [embed] });
            }
        } catch (error: any) {
            await interaction.editReply(`❌ チェック失敗: ${error.message}`);
        }
    }

    // =================================================================
    // 📊 集計・完了モード (finish)
    // =================================================================
    else if (subcommand === 'finish') {
        const sheetUrl = interaction.options.getString('url', true);

        try {
            const embed = await generateTallyEmbed(gasUrl, sheetUrl);
            await interaction.editReply({ embeds: [embed] });
        } catch (error: any) {
            console.error(error);
            await interaction.editReply(`❌ 集計失敗: ${error.message}`);
        }
    }

    // =================================================================
    // 🛑 キャンセルモード (cancel)
    // =================================================================
    else if (subcommand === 'cancel') {
        const sheetUrl = interaction.options.getString('url', true);

        try {
            const cancelCount = await cancelPendingJobsByUrl(sheetUrl);

            if (cancelCount > 0) {
                const embed = new EmbedBuilder()
                    .setTitle('🛑 自動処理を停止しました')
                    .setColor(Colors.Red)
                    .setDescription(`対象シートに紐づく未実行の自動処理（計 ${cancelCount} 件）を停止しました。\n\n**対象シート:**\n[シートを開く](${sheetUrl})`)
                    .addFields(
                        { name: '停止した予定', value: '・締切前日リマインド\n・締切当日リマインド\n・締切翌日集計', inline: false }
                    )
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            } else {
                await interaction.editReply('対象シートに紐づく未実行の自動処理が見つかりませんでした。');
            }
        } catch (error: any) {
            await interaction.editReply(`❌ キャンセル失敗: ${error.message}`);
        }
    }
}

/**
 * GAS API を叩いて未回答者名リストを取得するヘルパー関数
 */
export async function checkIncompleteUsers(gasUrl: string, sheetUrl: string): Promise<{ success: boolean; names: string[] }> {
    const response = await fetch(gasUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'check', sheetUrl }),
    });
    const result = await response.json() as any;
    if (!result.success) throw new Error(result.message);
    return { success: true, names: result.names || [] };
}

/**
 * GAS API を叩いて日程集計結果の Embed を生成するヘルパー関数
 */
export async function generateTallyEmbed(gasUrl: string, sheetUrl: string): Promise<EmbedBuilder> {
    const response = await fetch(gasUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'finish', sheetUrl }),
    });
    const result = await response.json() as any;

    if (!result.success) throw new Error(result.message);

    const tallyData: { date: string, o: string[], tri: string[] }[] = result.data;

    const embed = new EmbedBuilder()
        .setTitle('📊 日程集計結果')
        .setColor(Colors.Blue)
        .setDescription('「◯」と「△」の回答状況一覧です。\n※敬称略')
        .setTimestamp();

    let resultText = "";

    tallyData.forEach(item => {
        if (item.o.length === 0 && item.tri.length === 0) return;

        const o_names = item.o.length > 0 ? item.o.join(', ') : 'なし';
        const tri_names = item.tri.length > 0 ? item.tri.join(', ') : 'なし';

        resultText += `**${item.date}**\n`;
        resultText += `⭕️ **${item.o.length}人**: ${o_names}\n`;
        if (item.tri.length > 0) {
            resultText += `🤔 **${item.tri.length}人**: ${tri_names}\n`;
        }
        resultText += `----------------\n`;
    });

    if (resultText.length > 4000) {
        resultText = resultText.substring(0, 4000) + "...\n(長すぎるため省略しました)";
    }
    
    if (resultText === "") {
        resultText = "表示できる日程候補（◯または△のある日）がありませんでした。";
    }

    embed.setDescription(resultText);
    return embed;
}