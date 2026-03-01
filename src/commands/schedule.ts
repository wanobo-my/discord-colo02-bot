import { 
    SlashCommandBuilder, 
    CommandInteraction, 
    EmbedBuilder, 
    Colors, 
    TextChannel
} from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

// 🆔 ユーザー名とDiscord IDのマッピング表
const USER_MAP: { [key: string]: string } = {
    "なお": "1357919391747936276",
    "さな": "960009003235176508",
    "りこ": "1358599146163933205",
    "もりた": "632588632137531393",
    "あい": "1358685692527513650",
    "ちより": "1359316115813040370",
    "りお（うだつ）": "1362306374973001928",
    "ゆいこ": "1387668604014821477",
    "ゆう": "502083127649501184",
    "りお（まえだ）": "1461979171394687048"
};

export const data = new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('日程調整関連のコマンド')
    .addSubcommand(subcommand =>
        subcommand.setName('create').setDescription('日程調整シートを新規作成')
            .addStringOption(o => o.setName('event_name').setDescription('イベント名').setRequired(true))
            // ✨ setRequired(true) に変更
            .addStringOption(o => o.setName('deadline').setDescription('回答期限').setRequired(true))
            .addStringOption(o => o.setName('comment').setDescription('追加の一言').setRequired(false))
    )
    .addSubcommand(subcommand =>
        subcommand.setName('check').setDescription('未回答者にリマインド')
            .addStringOption(o => o.setName('url').setDescription('シートのURL').setRequired(true))
    )
    .addSubcommand(subcommand =>
        subcommand.setName('finish').setDescription('日程の集計結果を表示します')
            .addStringOption(o => o.setName('url').setDescription('シートのURL').setRequired(true))
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();
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
        // ✨ 必須になったので true を指定
        const deadline = interaction.options.getString('deadline', true);
        const comment = interaction.options.getString('comment');

        try {
            const response = await fetch(gasUrl, {
                method: 'POST',
                body: JSON.stringify({ action: 'create', eventName }),
            });
            const result = await response.json() as any;

            if (result.success) {
                let descriptionText = '下記リンクから回答をお願いします！';
                if (comment) descriptionText += `\n\n${comment}`;

                const embed = new EmbedBuilder()
                    .setTitle(`🗓️ 【日程調整】${eventName}`)
                    .setColor(Colors.Green)
                    .addFields(
                        { name: '回答期限', value: deadline, inline: false },
                        { name: 'シートURL', value: `[クリックして回答する](${result.url})`, inline: false }
                    )
                    .setDescription(descriptionText)
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            } else {
                throw new Error(result.message);
            }
        } catch (error: any) {
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
            const response = await fetch(gasUrl, {
                method: 'POST',
                body: JSON.stringify({ action: 'check', sheetUrl }),
            });
            const result = await response.json() as any;
            if (!result.success) throw new Error(result.message);

            const incompleteNames: string[] = result.names;

            if (incompleteNames.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('🎉 全員回答済みです！')
                    .setColor(Colors.Green)
                    .setDescription('全員の入力が完了しています。')
                await interaction.editReply({ embeds: [embed] });
            } else {
                const mentions = incompleteNames.map(name => USER_MAP[name] ? `<@${USER_MAP[name]}>` : name);
                const mentionString = mentions.join(' ');

                const embed = new EmbedBuilder()
                    .setTitle('📣 リマインド・回答してね！')
                    .setColor(Colors.Orange)
                    .setDescription(`${mentionString}さん、未回答の箇所があります。\nシートを確認して入力を完了させてください！\n\n**📎 シートURL**\n[クリックして回答する](${sheetUrl})`)
                    .setFooter({ text: `未回答: ${incompleteNames.length}名` });

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

            await interaction.editReply({ embeds: [embed] });

        } catch (error: any) {
            console.error(error);
            await interaction.editReply(`❌ 集計失敗: ${error.message}`);
        }
    }
}