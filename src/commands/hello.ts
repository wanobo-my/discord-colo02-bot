import { SlashCommandBuilder, CommandInteraction } from 'discord.js';

// 挨拶リスト
const greetings = [
    "こんにちは！", "Hello!", "Bonjour!", "Guten Tag!", 
    "Hola✋", "Ciao👋", "Γειά σας!", "Здравствуйте:)", 
    "你好~", "안녕하세요"
];

export const data = new SlashCommandBuilder()
    .setName('hello')
    .setDescription('ランダムな言語で挨拶を返します');

export async function execute(interaction: CommandInteraction) {
    // ランダムに1つ選ぶ
    const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
    
    // 返信する
    await interaction.reply(randomGreeting);
}