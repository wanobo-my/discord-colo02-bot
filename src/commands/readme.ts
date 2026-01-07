import { 
    SlashCommandBuilder, 
    CommandInteraction, 
    TextChannel, 
    EmbedBuilder, 
    Colors, 
    PermissionFlagsBits,
    User
} from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('readme')
    .setDescription('既読管理を行います（管理者専用）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
        subcommand
            .setName('check')
            .setDescription('指定したメッセージの既読状況を確認します')
            .addStringOption(option => 
                option.setName('message_id')
                .setDescription('確認したいメッセージのID')
                .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('remind')
            .setDescription('指定したメッセージの未読者にリマインドを送信します')
            .addStringOption(option => 
                option.setName('message_id')
                .setDescription('リマインドを送りたいメッセージのID')
                .setRequired(true)
            )
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel;
    // チャンネル情報を確実に取得
    if (!channel || !(channel instanceof TextChannel)) {
        await interaction.editReply('このコマンドはテキストチャンネルでのみ使用可能です。');
        return;
    }

    const subcommand = interaction.options.getSubcommand();
    const messageId = interaction.options.getString('message_id', true);
    const guild = interaction.guild;

    if (!guild) {
        await interaction.editReply('サーバー情報の取得に失敗しました。');
        return;
    }

    try {
        // メッセージを取得
        const targetMessage = await channel.messages.fetch(messageId);
        
        // 【重要】メンバー情報を最新にする（ロールを持っている人を正確に把握するため）
        // ※人数が多いサーバーだと少し時間がかかる場合があります
        await guild.members.fetch();

        // ----------------------------------------------------
        // ▼▼▼ 対象者の抽出ロジック（ここを強化！） ▼▼▼
        // ----------------------------------------------------
        // 重複を防ぐためにMapを使います
        const targetUsers = new Map<string, User>();

        // 1. @everyone / @here が含まれている場合
        if (targetMessage.mentions.everyone) {
            // サーバーの全メンバーを確認
            guild.members.cache.forEach(member => {
                // 「Botではない」かつ「このチャンネルを見る権限がある」人だけを追加
                if (!member.user.bot && channel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel)) {
                    targetUsers.set(member.id, member.user);
                }
            });
        } else {
            // 2. ロールメンションの処理
            // メッセージに含まれるロールを一つずつ確認
            targetMessage.mentions.roles.forEach(role => {
                role.members.forEach(member => {
                    // 「Botではない」かつ「チャンネル閲覧権限がある」人
                    if (!member.user.bot && channel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel)) {
                        targetUsers.set(member.id, member.user);
                    }
                });
            });

            // 3. 直接のユーザーメンションの処理
            targetMessage.mentions.users.forEach(user => {
                if (!user.bot) {
                    targetUsers.set(user.id, user);
                }
            });
        }

        // Bot自身（自分）が含まれていたら除外
        targetUsers.delete(interaction.client.user!.id);

        if (targetUsers.size === 0) {
            await interaction.editReply('このメッセージの対象となるメンバーが見つかりませんでした。（Botは除外されます）');
            return;
        }

        // ----------------------------------------------------
        // 既読・未読の判定
        // ----------------------------------------------------
        // リアクションした人（既読者）のIDリスト
        const reactedUserIds = new Set<string>();
        const reactions = targetMessage.reactions.cache;
        
        // メッセージについている全てのリアクションを確認して回る
        for (const [_, reaction] of reactions) {
            try {
                // リアクションした人たちのリストを取得
                const users = await reaction.users.fetch();
                
                // 取得できた人を既読リストに追加
                users.forEach(user => reactedUserIds.add(user.id));
                
            } catch (error) {
                // もし特定の絵文字でエラーが出ても、ログだけ出してBotは止めない
                console.log(`一部のリアクション集計に失敗しましたが続行します: ${reaction.emoji.name}`);
            }
        }

        // 振り分け
        const readUsers: string[] = [];
        const unreadUsers: User[] = [];

        // 対象者リスト(targetUsers)を回して確認
        targetUsers.forEach(user => {
            if (reactedUserIds.has(user.id)) {
                readUsers.push(user.toString()); // 表示用にメンション形式にする
            } else {
                unreadUsers.push(user); // リマインド用にUserオブジェクトを保存
            }
        });

        // ----------------------------------------------------
        // 結果の表示処理 (check / remind)
        // ----------------------------------------------------
        
        if (subcommand === 'check') {
            // 既読状況の表示
            const embed = new EmbedBuilder()
                .setTitle('📋 既読状況確認')
                .setColor(Colors.Blue)
                .addFields(
                    { 
                        name: `✅ 既読 (${readUsers.length}人)`, 
                        value: readUsers.length > 0 ? readUsers.join('\n') : 'なし',
                        inline: false 
                    },
                    { 
                        name: `❌ 未読 (${unreadUsers.length}人)`, 
                        value: unreadUsers.length > 0 ? unreadUsers.map(u => u.toString()).join('\n') : 'なし', 
                        inline: false 
                    }
                )
                .setDescription(targetMessage.mentions.everyone ? '※ @everyone / @here が含まれているため、閲覧可能な全メンバーを対象にしています。' : null)
                .setFooter({ text: `Message ID: ${messageId}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } 
        
        else if (subcommand === 'remind') {
            // リマインド送信
            if (unreadUsers.length === 0) {
                await interaction.editReply('未読者はいないため、リマインドは送信しませんでした。');
                return;
            }

            let sentCount = 0;
            const guildId = interaction.guildId;
            const channelId = channel.id;

            const dmContent = `
**📝未読メッセージのお知らせ！**
以下のメッセージはもう読んだでしょうか？
もし確認できていたらリアクションをポチッとお願いします！

📍チャンネル
https://discord.com/channels/${guildId}/${channelId}/${messageId}

⏰投稿日時
${targetMessage.createdAt.toLocaleString('ja-JP')}

💬メッセージ内容
${targetMessage.content}
`;

            for (const user of unreadUsers) {
                try {
                    await user.send(dmContent);
                    sentCount++;
                } catch (e) {
                    console.log(`${user.tag} へのDM送信失敗`);
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ 成功')
                .setColor(Colors.Green)
                .setDescription(`未読者 ${sentCount}名 にリマインドを送信しました。`)
                .setFooter({ text: `対象人数: ${unreadUsers.length}人 (送信失敗: ${unreadUsers.length - sentCount}人)` });

            await interaction.editReply({ embeds: [embed] });
        }

    } catch (error) {
        console.error(error);
        await interaction.editReply('エラーが発生しました。メッセージIDを確認してください。');
    }
}