import { 
    SlashCommandBuilder, 
    CommandInteraction, 
    TextChannel, 
    EmbedBuilder, 
    Colors, 
    PermissionFlagsBits,
    User,
    MessageFlags
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

    // 自分だけに結果を表示 (Ephemeral)
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.channel;
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
        
        // ----------------------------------------------------
        // 1. 対象者の抽出 (メンバー取得漏れを防止)
        // ----------------------------------------------------
        const targetUsers = new Map<string, User>();

        // (A) @everyone / @here の場合
        if (targetMessage.mentions.everyone) {
            // キャッシュが少なすぎる場合は取得を試みる（安全策）
            if (guild.members.cache.size < guild.memberCount) {
                try {
                    await guild.members.fetch(); 
                } catch (e) {
                    console.warn('メンバー全取得時にエラーが発生しましたが、キャッシュのみで続行します。');
                }
            }

            guild.members.cache.forEach(member => {
                // Botを除外 & このチャンネルを見れる権限がある人のみ
                if (!member.user.bot && channel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel)) {
                    targetUsers.set(member.id, member.user);
                }
            });
        } 
        // (B) ロールメンション / ユーザーメンション の場合
        else {
            // ロールメンション: ロールに所属するメンバーを確実に取得
            for (const [roleId, role] of targetMessage.mentions.roles) {
                // 念のためメンバー情報を同期
                await guild.members.fetch(); 
                role.members.forEach(member => {
                     if (!member.user.bot && channel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel)) {
                        targetUsers.set(member.id, member.user);
                    }
                });
            }

            // ユーザーメンション
            targetMessage.mentions.users.forEach(user => {
                if (!user.bot) {
                    targetUsers.set(user.id, user);
                }
            });
        }

        // Bot自身を除外
        targetUsers.delete(interaction.client.user!.id);

        if (targetUsers.size === 0) {
            await interaction.editReply('このメッセージの対象となるメンバーが見つかりませんでした。\n（Bot起動直後はメンバーリストの読み込みに時間がかかる場合があります）');
            return;
        }

        // ----------------------------------------------------
        // 2. 既読・未読の判定 (全リアクションを確実にチェック)
        // ----------------------------------------------------
        const reactedUserIds = new Set<string>();
        
        // メッセージに付いている「全ての」リアクションを取得
        const reactions = targetMessage.reactions.cache;
        
        for (const [_, reaction] of reactions) {
            try {
                // リアクションを押したユーザーリストを取得 (APIリクエスト)
                const users = await reaction.users.fetch();
                users.forEach(user => {
                    reactedUserIds.add(user.id);
                });
            } catch (error) {
                console.log(`リアクション集計エラー (${reaction.emoji.name}):`, error);
            }
        }

        // 振り分け
        const readUsers: string[] = [];
        const unreadUsers: User[] = [];

        targetUsers.forEach(user => {
            if (reactedUserIds.has(user.id)) {
                readUsers.push(user.toString());
            } else {
                unreadUsers.push(user);
            }
        });

        // ----------------------------------------------------
        // 3. 結果の処理 (check / remind)
        // ----------------------------------------------------
        
        if (subcommand === 'check') {
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
            if (unreadUsers.length === 0) {
                await interaction.editReply('未読者はいないため、リマインドは送信しませんでした。');
                return;
            }

            let sentCount = 0;
            const guildId = interaction.guildId;
            const channelId = channel.id;

            const dmContent = `
**📝未読メッセージのお知らせ！**
以下のメッセージはもう読みましたか？
確認したらチャンネルで該当メッセージに
リアクションをポチッとお願いします！

📍チャンネル
https://discord.com/channels/${guildId}/${channelId}/${messageId}

⏰投稿日時: ${targetMessage.createdAt.toLocaleString('ja-JP')}

💬メッセージ内容
${targetMessage.content.substring(0, 100)}${targetMessage.content.length > 100 ? '...' : ''}
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
        await interaction.editReply('エラーが発生しました。時間を置いて再試行するか、メッセージIDを確認してください。');
    }
}