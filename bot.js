require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const PlayFab = require('playfab-sdk');

// Configure PlayFab Title
PlayFab.settings.titleId = 1E90D8;
PlayFab.settings.developerSecretKey = GJMO19S5F7KUQKEYOQWSYZF99JYGFU7F1TRI6OF1RQWQISXKMU;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
    ]
});

// --- Register Slash Commands ---
const commands = [
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View your Volleyball Revengers stats')
        .addUserOption(option => 
            option.setName('target')
                .setDescription('User to view stats for')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('clubinfo')
        .setDescription('Get details and standings for a club')
        .addStringOption(option =>
            option.setName('club_name')
                .setDescription('Name of the club')
                .setRequired(true)
        )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(MTU0NzgwODA1MzA3ODkyNTMzMg.GxDtwN.SNpUVGFOsJ3Zznz6Pf1dT5xeHMXhcQrZz3S_yc);

(async () => {
    try {
        console.log('Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(1547808053078925332),
            { body: commands }
        );
        console.log('Slash commands registered successfully!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
})();

// --- Helper: PlayFab API Wrapper ---
function getPlayFabLeaderboard(statisticName) {
    return new Promise((resolve, reject) => {
        PlayFab.PlayFabServer.GetLeaderboard({
            StatisticName: statisticName,
            StartPosition: 0,
            MaxResultsCount: 10
        }, (error, result) => {
            if (error) reject(error);
            else resolve(result.data.Leaderboard);
        });
    });
}

// --- Bot Ready Listener ---
client.once('ready', () => {
    console.log(`🤖 VBR Assistant Coach is online as ${client.user.tag}!`);
});

// --- Interaction (Slash Commands) Handler ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // Command: /stats
    if (commandName === 'stats') {
        const targetUser = interaction.options.getUser('target') || interaction.user;

        const embed = new EmbedBuilder()
            .setTitle(`🏐 Player Stats: ${targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL())
            .setColor('#1E90D8')
            .addFields(
                { name: 'Spikes Completed', value: '142', inline: true },
                { name: 'Blocks', value: '38', inline: true },
                { name: 'Aero-Coins', value: '12,450 🪙', inline: true },
                { name: 'Club Role', value: 'Captain', inline: true }
            )
            .setFooter({ text: 'Volleyball Revengers • VBR Assistant Coach' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    // Command: /clubinfo
    if (commandName === 'clubinfo') {
        const clubName = interaction.options.getString('club_name');

        const embed = new EmbedBuilder()
            .setTitle(`🏆 Club Info: ${clubName}`)
            .setColor('#1E90D8')
            .setDescription(`Official record and schedule for **${clubName}**.`)
            .addFields(
                { name: 'Practice Days', value: 'Mon, Wed, Fri', inline: true },
                { name: 'NT Stage Status', value: 'Stage 1: Qualification', inline: true },
                { name: 'Record', value: '12 W - 3 L', inline: true }
            )
            .setFooter({ text: 'Volleyball Revengers • VBR Assistant Coach' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
});

// --- Direct Message (DM) Notification Handler ---
/**
 * Sends a Direct Message to a specific Discord user via their Discord User ID.
 */
async function sendDirectMessage(discordUserId, title, messageContent, fields = []) {
    try {
        const user = await client.users.fetch(discordUserId);
        if (!user) return false;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(messageContent)
            .setColor('#1E90D8')
            .addFields(fields)
            .setFooter({ text: 'Volleyball Revengers • Personal Update' })
            .setTimestamp();

        await user.send({ embeds: [embed] });
        console.log(`[VBR Coach] Direct message sent to ${user.tag}`);
        return true;
    } catch (err) {
        console.error(`[VBR Coach] DM failed to send: ${err.message}`);
        return false;
    }
}

client.login(MTU0NzgwODA1MzA3ODkyNTMzMg.GxDtwN.SNpUVGFOsJ3Zznz6Pf1dT5xeHMXhcQrZz3S_yc);
