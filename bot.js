require('dotenv').config();
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const PlayFab = require('playfab-sdk');

// --- Keep-Alive Web Server ---
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('VBR Assistant Coach Bot is running 24/7!');
}).listen(PORT, () => {
    console.log(`🌐 Keep-alive server listening on port ${PORT}`);
});

// Self-ping every 5 minutes
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
PlayFab.settings.productionUrl = `https://${process.env.PLAYFAB_TITLE_ID}.playfabapi.com`;

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
    new SlashCommandBuilder().setName('website').setDescription('Get the official Volleyball Revengers website link'),
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord using a 6-digit code generated in-game')
        .addStringOption(opt => opt.setName('code').setDescription('The 6-digit link code (e.g. 294-617 or 294617)').setRequired(true)),
    new SlashCommandBuilder().setName('account').setDescription('View profile, stats, physical attributes, and PlayFab info')
        .addUserOption(opt => opt.setName('target').setDescription('Player profile to view (optional)').setRequired(false)),
    new SlashCommandBuilder().setName('club').setDescription('View club details, rank, W-L ratio, and members'),
    new SlashCommandBuilder().setName('club-info').setDescription('Learn information about what clubs are in Volleyball Revengers'),
    new SlashCommandBuilder().setName('nt-info').setDescription('Learn about the National Tournament coming in full release'),
    new SlashCommandBuilder().setName('online-players').setDescription('Show the current online player count'),
    new SlashCommandBuilder().setName('party-request').setDescription('Send a party request').addUserOption(opt => opt.setName('target').setDescription('Player to invite').setRequired(true)),
    new SlashCommandBuilder().setName('accept-party').setDescription('Accept incoming party request').addUserOption(opt => opt.setName('target').setDescription('Player who invited you').setRequired(true)),
    new SlashCommandBuilder().setName('decline-party').setDescription('Decline incoming party request').addUserOption(opt => opt.setName('target').setDescription('Player who invited you').setRequired(true)),
    new SlashCommandBuilder().setName('friend-request').setDescription('Send a friend request').addUserOption(opt => opt.setName('target').setDescription('Player to add').setRequired(true)),
    new SlashCommandBuilder().setName('accept-friend').setDescription('Accept incoming friend request').addUserOption(opt => opt.setName('target').setDescription('Player who added you').setRequired(true)),
    new SlashCommandBuilder().setName('decline-friend').setDescription('Decline incoming friend request').addUserOption(opt => opt.setName('target').setDescription('Player who added you').setRequired(true)),
    new SlashCommandBuilder().setName('make-a-club').setDescription('Create a new club').addStringOption(opt => opt.setName('name').setDescription('Name of new club').setRequired(true)),
    new SlashCommandBuilder().setName('club-request').setDescription('Send a request to join a club').addStringOption(opt => opt.setName('club_name').setDescription('Name of the club').setRequired(true)),
    new SlashCommandBuilder().setName('join-club').setDescription('Accept an invite to join a club').addStringOption(opt => opt.setName('club_name').setDescription('Name of the club').setRequired(true)),
    new SlashCommandBuilder().setName('decline-club').setDescription('Decline an invite to join a club').addStringOption(opt => opt.setName('club_name').setDescription('Name of the club').setRequired(true)),
    new SlashCommandBuilder().setName('manage-club').setDescription('Link to manage your club settings'),
    new SlashCommandBuilder().setName('msg').setDescription('Sends custom message (Admin Only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt => opt.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption(opt => opt.setName('message').setDescription('Message text').setRequired(true))
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

function executeLinkCloudScript(code, discordUser) {
    return new Promise((resolve) => {
        const payload = {
            Code: String(code),
            DiscordUserId: String(discordUser.id),
            DiscordUsername: String(discordUser.username)
        };

        PlayFab.PlayFabServer.ExecuteCloudScript({
            FunctionName: "LinkDiscord",
            FunctionParameter: payload
        }, (error, result) => {
            if (error) {
                console.error("[PlayFab Server API Error]:", error);
                resolve({ success: false, message: error.errorMessage || 'PlayFab API error.' });
            } else if (result && result.data && result.data.FunctionResult) {
                resolve(result.data.FunctionResult);
            } else if (result && result.data && result.data.Error) {
                resolve({ success: false, message: result.data.Error.Message || 'CloudScript Execution Error.' });
            } else {
                resolve({ success: false, message: 'Invalid response from PlayFab CloudScript.' });
            }
        });
    });
}

function getPlayerStats(playFabId) {
    return new Promise((resolve) => {
        PlayFab.PlayFabServer.GetUserStatistics({ PlayFabId: playFabId }, (error, result) => {
            if (error || !result || !result.data) resolve({});
            else {
                const stats = {};
                result.data.UserStatistics.forEach(stat => {
                    stats[stat.StatisticName] = stat.Value;
                });
                resolve(stats);
            }
        });
    });
}

function getPlayerData(playFabId) {
    return new Promise((resolve) => {
        PlayFab.PlayFabServer.GetUserData({ PlayFabId: playFabId }, (error, result) => {
            if (error || !result || !result.data) resolve({});
            else resolve(result.data.Data || {});
        });
    });
}

function getPlayFabUserByDiscordId(discordId) {
    return new Promise((resolve) => {
        const cleanDiscordId = String(discordId).replace(/['"]+/g, '').trim();
        const expectedCustomId = "DISCORD_" + cleanDiscordId;

        PlayFab.PlayFabServer.GetAccountInfo({
            CustomId: expectedCustomId
        }, (error, result) => {
            if (!error && result && result.data && result.data.UserInfo) {
                return resolve({ user: result.data.UserInfo, reason: 'SUCCESS' });
            }

            PlayFab.PlayFabServer.GetTitleInternalData({
                Keys: [`DiscordUserMap_${cleanDiscordId}`]
            }, (internalErr, internalResult) => {
                const fallbackPlayFabId = internalResult?.data?.Data?.[`DiscordUserMap_${cleanDiscordId}`];

                if (!fallbackPlayFabId) {
                    return resolve({ user: null, reason: 'NOT_LINKED' });
                }

                PlayFab.PlayFabServer.GetUserAccountInfo({
                    PlayFabId: fallbackPlayFabId
                }, (accErr, accResult) => {
                    if (accErr || !accResult || !accResult.data) {
                        return resolve({ user: null, reason: 'ACCOUNT_NOT_FOUND', playFabId: fallbackPlayFabId });
                    }
                    resolve({ user: accResult.data.UserInfo, reason: 'SUCCESS' });
                });
            });
        });
    });
}

async function enforceAccountLink(interaction, targetUser = null) {
    const userToVerify = targetUser || interaction.user;
    const isSelf = userToVerify.id === interaction.user.id;
    
    const { user, reason, playFabId } = await getPlayFabUserByDiscordId(userToVerify.id);

    if (!user) {
        let title = '⚠️ Account Not Linked';
        let description = isSelf 
            ? 'You have not linked your Discord account to Volleyball Revengers yet! Use `/link <code>` with your in-game code.' 
            : `**${userToVerify.username}** has not linked their Discord account yet!`;

        // Differentiate between unlinked vs API lookup failure
        if (reason === 'ACCOUNT_NOT_FOUND') {
            title = '❓ Account Not Found';
            description = `Linked PlayFab ID \`${playFabId}\` could not be retrieved from the server. The account may have been removed or lost.`;
        }

        const responseEmbed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor('#FF4B4B')
            .setFooter({ text: 'Volleyball Revengers • VBR Assistant Coach' });

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [responseEmbed] });
        } else {
            await interaction.reply({ embeds: [responseEmbed], ephemeral: true });
        }

        return null;
    }

    return user;
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

    if (commandName === 'website') {
        await interaction.reply({ content: '🌐 **Volleyball Revengers Official Website:** https://fpzard-eng.github.io/Volleyball-Revengers/home' });
    }
    
    if (commandName === 'link') {
        const rawCode = interaction.options.getString('code');
        const cleanCode = rawCode.replace(/\D/g, '');

        if (cleanCode.length !== 6) {
            return interaction.reply({
                content: '❌ Invalid code format! Please enter a 6-digit code (e.g. `294-617` or `294617`).',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const result = await executeLinkCloudScript(cleanCode, interaction.user);

        if (result.success) {
            const successEmbed = new EmbedBuilder()
                .setTitle('🎉 Account Successfully Linked!')
                .setDescription(`Your Discord account **${interaction.user.username}** has been linked to Volleyball Revengers player ID \`${result.linkedPlayerId}\`.`)
                .setColor('#00FF7F')
                .setFooter({ text: 'Volleyball Revengers • Profile Linker' });

            await interaction.editReply({ embeds: [successEmbed] });
        } else {
            const failEmbed = new EmbedBuilder()
                .setTitle('❌ Account Link Failed')
                .setDescription(result.message || 'The code entered is invalid or expired. Please generate a new code in-game.')
                .setColor('#FF4B4B')
                .setFooter({ text: 'Volleyball Revengers • Profile Linker' });

            await interaction.editReply({ embeds: [failEmbed] });
        }
    }

    if (commandName === 'account') {
        const targetDiscordUser = interaction.options.getUser('target') || interaction.user;
        const user = await enforceAccountLink(interaction, targetDiscordUser);
        if (!user) return;

        await interaction.deferReply();

        const playFabId = user.PlayFabId;
        const displayName = user.TitleInfo?.DisplayName || 'Unknown Player';

        const [stats, userData] = await Promise.all([
            getPlayerStats(playFabId),
            getPlayerData(playFabId)
        ]);

        const getStat = (key) => stats[key] ?? 0;
        const getData = (key) => userData[key]?.Value ?? null;

        const playerElo = getStat('PlayerElo');
        const matchMVPs = getStat('MVP');
        const wins = getStat('Wins');
        const matchesPlayed = getStat('MatchesPlayed');
        const assists = getStat('Assists');
        const blocks = getStat('Blocks');
        const kills = getStat('Kills');

        const playerHeight = getStat('PlayerHeight') || getData('PlayerHeight') || 'N/A';
        const standingReach = getData('StandingReach') || 'N/A';
        const wingspan = getStat('Wingspan') || getData('Wingspan') || 'N/A';
        
        const rawHandedness = getStat('RightHanded');
        const handednessText = rawHandedness === 1 ? 'Right-Handed 🖐️' : (rawHandedness === 0 ? 'Left-Handed 🤚' : 'N/A');

        const accountEmbed = new EmbedBuilder()
            .setTitle(`🏐 Player Profile: ${displayName}`)
            .setColor('#1E90D8')
            .setThumbnail(targetDiscordUser.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '🆔 Account Info', value: `**Display Name:** ${displayName}\n**PlayFab ID:** \`${playFabId}\`\n**Player ELO:** ${playerElo}`, inline: false },
                { name: '📏 Physical Attributes', value: `**Height:** ${playerHeight}\n**Standing Reach:** ${standingReach}\n**Wingspan:** ${wingspan}\n**Handedness:** ${handednessText}`, inline: true },
                { name: '📊 Performance Stats', value: `**Matches Played:** ${matchesPlayed}\n**Wins:** ${wins}\n**Match MVPs:** ${matchMVPs}`, inline: true },
                { name: '🎯 In-Game Actions', value: `**Kills:** ${kills}\n**Blocks:** ${blocks}\n**Assists:** ${assists}`, inline: false }
            )
            .setFooter({ text: 'Volleyball Revengers • Player Statistics', iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        await interaction.editReply({ embeds: [accountEmbed] });
    }

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

    if (commandName === 'club-info') {
        const embed = new EmbedBuilder()
            .setTitle('🏆 What are Clubs in Volleyball Revengers?')
            .setDescription('Clubs allow players to team up, participate in Scrimmages, climb global Leaderboards together, and prepare for official Competitive Tournaments!')
            .setColor('#1E90D8')
            .setFooter({ text: 'Volleyball Revengers • VBR Assistant Coach' });

        await interaction.reply({ embeds: [embed] });
    }

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

    if (commandName === 'online-players') {
        const embed = new EmbedBuilder()
            .setTitle('🌐 Active Players Online')
            .setDescription('Currently **0 Players** are active on the courts!')
            .setColor('#00FF7F')
            .setFooter({ text: 'Volleyball Revengers Live Status' });

        await interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'party-request') {
        if (!await enforceAccountLink(interaction)) return;
        const target = interaction.options.getUser('target');
        await interaction.reply({ content: `🎉 Party request sent to **${target.username}**!` });
    }

    if (commandName === 'accept-party') {
        if (!await enforceAccountLink(interaction)) return;
        const target = interaction.options.getUser('target');
        await interaction.reply({ content: `✅ You joined **${target.username}**'s party!` });
    }

    if (commandName === 'decline-party') {
        if (!await enforceAccountLink(interaction)) return;
        const target = interaction.options.getUser('target');
        await interaction.reply({ content: `❌ You declined **${target.username}**'s party invitation.` });
    }

    if (commandName === 'friend-request') {
        if (!await enforceAccountLink(interaction)) return;
        const target = interaction.options.getUser('target');
        await interaction.reply({ content: `📩 Friend request sent to **${target.username}**!` });
    }

    if (commandName === 'accept-friend') {
        if (!await enforceAccountLink(interaction)) return;
        const target = interaction.options.getUser('target');
        await interaction.reply({ content: `🤝 You are now friends with **${target.username}**!` });
    }

    if (commandName === 'decline-friend') {
        if (!await enforceAccountLink(interaction)) return;
        const target = interaction.options.getUser('target');
        await interaction.reply({ content: `❌ Declined friend request from **${target.username}**.` });
    }

    if (commandName === 'make-a-club') {
        if (!await enforceAccountLink(interaction)) return;
        const clubName = interaction.options.getString('name');
        await interaction.reply({ content: `🎉 Congratulations! Club **${clubName}** has been successfully created!` });
    }

    if (commandName === 'club-request') {
        if (!await enforceAccountLink(interaction)) return;
        const clubName = interaction.options.getString('club_name');
        await interaction.reply({ content: `📩 Application sent to join **${clubName}**!` });
    }

    if (commandName === 'join-club') {
        if (!await enforceAccountLink(interaction)) return;
        const clubName = interaction.options.getString('club_name');
        await interaction.reply({ content: `✅ You have joined **${clubName}**!` });
    }

    if (commandName === 'decline-club') {
        if (!await enforceAccountLink(interaction)) return;
        const clubName = interaction.options.getString('club_name');
        await interaction.reply({ content: `❌ Declined invite to join **${clubName}**.` });
    }

    if (commandName === 'manage-club') {
        await interaction.reply({ content: '⚙️ **Manage your club settings here:** https://fpzard-eng.github.io/Volleyball-Revengers/manage-club' });
    }

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
