require('dotenv').config();
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const PlayFab = require('playfab-sdk');

// --- Keep-Alive Web Server (Render Port Binding & Anti-Sleep) ---
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('VBR Assistant Coach Bot is running 24/7!');
}).listen(PORT, () => {
    console.log(`🌐 Keep-alive server listening on port ${PORT}`);
});

// Self-ping every 5 minutes (300,000 ms) to prevent Render from idling
setInterval(() => {
    const renderAppUrl = process.env.RENDER_EXTERNAL_URL;
    if (renderAppUrl) {
        const requester = renderAppUrl.startsWith('https') ? https : http;
        requester.get(renderAppUrl, (res) => {
            console.log(`[Heartbeat] Ping sent to ${renderAppUrl} - Status: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error(`[Heartbeat Error] ${err.message}`);
        });
    }
}, 300000);

// --- Configure PlayFab Credentials ---
PlayFab.settings.titleId = process.env.PLAYFAB_TITLE_ID;
PlayFab.settings.developerSecretKey = process.env.PLAYFAB_SECRET_KEY;

// --- Initialize Discord Client ---
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
        .setName('website')
        .setDescription('Get the official Volleyball Revengers website link'),

    new SlashCommandBuilder()
        .setName('link-to-account')
        .setDescription('Link your Discord account to your Volleyball Revengers profile'),

    new SlashCommandBuilder()
        .setName('club')
        .setDescription('View your club details, rank, W-L ratio, and members'),

    new SlashCommandBuilder()
        .setName('club-info')
        .setDescription('Learn information about what clubs are in Volleyball Revengers'),

    new SlashCommandBuilder()
        .setName('nt-info')
        .setDescription('Learn about the National Tournament coming in full release'),

    new SlashCommandBuilder()
        .setName('online-players')
        .setDescription('Show the current online player count'),

    new SlashCommandBuilder()
        .setName('party-request')
        .setDescription('Send a party request to another player')
        .addUserOption(opt => opt.setName('target').setDescription('Player to invite').setRequired(true)),

    new SlashCommandBuilder()
        .setName('accept-party')
        .setDescription('Accept an incoming party request')
        .addUserOption(opt => opt.setName('target').setDescription('Player who invited you').setRequired(true)),

    new SlashCommandBuilder()
        .setName('decline-party')
        .setDescription('Decline an incoming party request')
        .addUserOption(opt => opt.setName('target').setDescription('Player who invited you').setRequired(true)),

    new SlashCommandBuilder()
        .setName('friend-request')
        .setDescription('Send a friend request to another player')
        .addUserOption(opt => opt.setName('target').setDescription('Player to add').setRequired(true)),

    new SlashCommandBuilder()
        .setName('accept-friend')
        .setDescription('Accept an incoming friend request')
        .addUserOption(opt => opt.setName('target').setDescription('Player who added you').setRequired(true)),

    new SlashCommandBuilder()
        .setName('decline-friend')
        .setDescription('Decline an incoming friend request')
        .addUserOption(opt => opt.setName('target').setDescription('Player who added you').setRequired(true)),

    new SlashCommandBuilder()
        .setName('make-a-club')
        .setDescription('Create a new club')
        .addStringOption(opt => opt.setName('name').setDescription('Name of your new club').setRequired(true)),

    new SlashCommandBuilder()
        .setName('club-request')
        .setDescription('Send a request to join a club')
        .addStringOption(opt => opt.setName('club_name').setDescription('Name of the club').setRequired(true)),

    new SlashCommandBuilder()
        .setName('join-club')
        .setDescription('Accept an invite to join a club')
        .addStringOption(opt => opt.setName('club_name').setDescription('Name of the club').setRequired(true)),

    new SlashCommandBuilder()
        .setName('decline-club')
        .setDescription('Decline an invite to join a club')
        .addStringOption(opt => opt.setName('club_name').setDescription('Name of the club').setRequired(true)),

    new SlashCommandBuilder()
        .setName('manage-club')
        .setDescription('Link to manage your club settings'),

    new SlashCommandBuilder()
        .setName('msg')
        .setDescription('Sends a custom message to a specific channel (Admin Only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt => 
            opt.setName('channel')
               .setDescription('Target channel for the message')
               .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
               .setRequired(true))
        .addStringOption(opt => 
            opt.setName('message')
               .setDescription('Message text to send')
               .setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
    try {
        console.log('Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands }
        );
        console.log('Slash commands registered successfully!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
})();

// --- Helper: Check Linked Account via PlayFab ---
function getPlayFabUserByDiscordId(discordId) {
    return new Promise((resolve) => {
        PlayFab.PlayFabServer.GetUserAccountInfo({
            PlayFabId: discordId
        }, (error, result) => {
            if (error || !result || !result.data) resolve(null);
            else resolve(result.data.UserInfo);
        });
    });
}

// --- Helper: Check Link Enforcement ---
async function enforceAccountLink(interaction) {
    const playfabUser = await getPlayFabUserByDiscordId(interaction.user.id);
    if (!playfabUser) {
        const unlinkedEmbed = new EmbedBuilder()
            .setTitle('⚠️ Account Not Linked')
            .setDescription('You must link your Discord account with Volleyball Revengers to use this command!')
            .setColor('#FF4B4B')
            .addFields({ 
                name: '🔗 Link Your Account Here', 
                value: 'https://fpzard-eng.github.io/Volleyball-Revengers/link-discord' 
            })
            .setFooter({ text: 'Volleyball Revengers • VBR Assistant Coach' });
            
        await interaction.reply({ embeds: [unlinkedEmbed], ephemeral: true });
        return null;
    }
    return playfabUser;
}

// --- Bot Ready Listener ---
client.once('clientReady', () => {
    console.log(`🤖 VBR Assistant Coach is online as ${client.user.tag}!`);
});

// --- Connection Recovery & Error Handlers ---
client.on('shardDisconnect', (event, id) => {
    console.warn(`[Network Warning] Shard ${id} disconnected. Reconnecting...`);
});

client.on('shardError', (error, id) => {
    console.error(`[Network Error] Connection error on shard ${id}:`, error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[Uncaught Exception]', error);
});

// --- Interaction Handler ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // 1. /website
    if (commandName === 'website') {
        await interaction.reply({ 
            content: '🌐 **Volleyball Revengers Official Website:** https://fpzard-eng.github.io/Volleyball-Revengers/home' 
        });
    }

    // 2. /link-to-account
    if (commandName === 'link-to-account') {
        await interaction.reply({ 
            content: '🔗 **Link your Discord to Volleyball Revengers:** https://fpzard-eng.github.io/Volleyball-Revengers/link-discord' 
        });
    }

    // 3. /club
    if (commandName === 'club') {
        const user = await enforceAccountLink(interaction);
        if (!user) return;

        const embed = new EmbedBuilder()
            .setTitle(`🏐 Club Info: Spikers United`)
            .setColor('#1E90D8')
            .addFields(
                { name: 'Leaderboard Rank', value: '#12', inline: true },
                { name: 'W - L Ratio', value: '24 W - 8 L (75%)', inline: true },
                { name: 'Members', value: '6 / 10 Active Members', inline: false }
            )
            .setFooter({ text: 'Volleyball Revengers • Club Manager' });

        await interaction.reply({ embeds: [embed] });
    }

    // 4. /club-info
    if (commandName === 'club-info') {
        const embed = new EmbedBuilder()
            .setTitle('🏆 What are Clubs in Volleyball Revengers?')
            .setDescription('Clubs allow players to team up, participate in Scrimmages, climb global Leaderboards together, and prepare for official Competitive Tournaments!')
            .setColor('#1E90D8')
            .setFooter({ text: 'Volleyball Revengers • VBR Assistant Coach' });

        await interaction.reply({ embeds: [embed] });
    }

    // 5. /nt-info
    if (commandName === 'nt-info') {
        const embed = new EmbedBuilder()
            .setTitle('🏐 National Tournament (NT) Preview')
            .setDescription('The **National Tournament** is the pinnacle competitive event in Volleyball Revengers!')
            .setColor('#FF9900')
            .addFields(
                { name: 'Status', value: '🔒 Coming in Full Release!' },
                { name: 'Format', value: 'Bracket-style elimination tournament featuring the top-ranked Clubs across all regions.' }
            )
            .setFooter({ text: 'Volleyball Revengers • VBR Assistant Coach' });

        await interaction.reply({ embeds: [embed] });
    }

    // 6. /online-players
    if (commandName === 'online-players') {
        const embed = new EmbedBuilder()
            .setTitle('🌐 Active Players Online')
            .setDescription('Currently **0 Players** are active on the courts!')
            .setColor('#00FF7F')
            .setFooter({ text: 'Volleyball Revengers Live Status' });

        await interaction.reply({ embeds: [embed] });
    }

    // 7. /party-request
    if (commandName === 'party-request') {
        if (!await enforceAccountLink(interaction)) return;
        const target = interaction.options.getUser('target');
        await interaction.reply({ content: `🎉 Party request sent to **${target.username}**!` });
    }

    // 8. /accept-party
    if (commandName === 'accept-party') {
        if (!await enforceAccountLink(interaction)) return;
        const target = interaction.options.getUser('target');
        await interaction.reply({ content: `✅ You joined **${target.username}**'s party!` });
    }

    // 9. /decline-party
    if (commandName === 'decline-party') {
        if (!await enforceAccountLink(interaction)) return;
        const target = interaction.options.getUser('target');
        await interaction.reply({ content: `❌ You declined **${target.username}**'s party invitation.` });
    }

    // 10. /friend-request
    if (commandName === 'friend-request') {
        if (!await enforceAccountLink(interaction)) return;
        const target = interaction.options.getUser('target');
        await interaction.reply({ content: `📩 Friend request sent to **${target.username}**!` });
    }

    // 11. /accept-friend
    if (commandName === 'accept-friend') {
        if (!await enforceAccountLink(interaction)) return;
        const target = interaction.options.getUser('target');
        await interaction.reply({ content: `🤝 You are now friends with **${target.username}**!` });
    }

    // 12. /decline-friend
    if (commandName === 'decline-friend') {
        if (!await enforceAccountLink(interaction)) return;
        const target = interaction.options.getUser('target');
        await interaction.reply({ content: `❌ Declined friend request from **${target.username}**.` });
    }

    // 13. /make-a-club
    if (commandName === 'make-a-club') {
        if (!await enforceAccountLink(interaction)) return;
        const clubName = interaction.options.getString('name');
        await interaction.reply({ content: `🎉 Congratulations! Club **${clubName}** has been successfully created!` });
    }

    // 14. /club-request
    if (commandName === 'club-request') {
        if (!await enforceAccountLink(interaction)) return;
        const clubName = interaction.options.getString('club_name');
        await interaction.reply({ content: `📩 Application sent to join **${clubName}**!` });
    }

    // 15. /join-club
    if (commandName === 'join-club') {
        if (!await enforceAccountLink(interaction)) return;
        const clubName = interaction.options.getString('club_name');
        await interaction.reply({ content: `✅ You have joined **${clubName}**!` });
    }

    // 16. /decline-club
    if (commandName === 'decline-club') {
        if (!await enforceAccountLink(interaction)) return;
        const clubName = interaction.options.getString('club_name');
        await interaction.reply({ content: `❌ Declined invite to join **${clubName}**.` });
    }

    // 17. /manage-club
    if (commandName === 'manage-club') {
        await interaction.reply({ 
            content: '⚙️ **Manage your club settings here:** https://fpzard-eng.github.io/Volleyball-Revengers/manage-club' 
        });
    }

    // 18. /msg
    if (commandName === 'msg') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ You must have Administrator permissions to use this command.', ephemeral: true });
        }

        const targetChannel = interaction.options.getChannel('channel');
        const messageText = interaction.options.getString('message');

        try {
            await targetChannel.send(messageText);
            await interaction.reply({ content: `✅ Custom message successfully sent to ${targetChannel}!`, ephemeral: true });
        } catch (error) {
            console.error('Failed to send message:', error);
            await interaction.reply({ content: '❌ Failed to send the message. Make sure I have permission to speak in that channel.', ephemeral: true });
        }
    }
});

// Log in the client
client.login(process.env.DISCORD_BOT_TOKEN);
