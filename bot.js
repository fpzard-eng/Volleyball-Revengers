require('dotenv').config();
const http = require('http');
const https = require('https');
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    PermissionFlagsBits, 
    ChannelType 
} = require('discord.js');

const PlayFab = require('playfab-sdk');
const PlayFabServer = PlayFab.PlayFabServer;

PlayFab.settings.titleId = process.env.PLAYFAB_TITLE_ID;
PlayFab.settings.developerSecretKey = process.env.PLAYFAB_SECRET_KEY;
PlayFab.settings.productionUrl = `https://${process.env.PLAYFAB_TITLE_ID}.playfabapi.com`;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
    ]
});

// --- HTTP Server ---
const PORT = process.env.PORT || 10000;
const server = http.createServer(async (req, res) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (req.method === 'OPTIONS') {
        res.writeHead(204, headers);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/api/login-server-custom-id') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { discordId } = JSON.parse(body || '{}');

                if (!discordId) {
                    res.writeHead(400, { ...headers, 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, error: 'Missing discordId parameter.' }));
                }

                PlayFabServer.LoginWithServerCustomId({
                    ServerCustomId: `DISCORD_${discordId}`,
                    CreateAccount: true
                }, (error, result) => {
                    if (error || !result?.data) {
                        console.error('[PlayFab Server Auth Error]:', error);
                        res.writeHead(400, { ...headers, 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ 
                            success: false, 
                            error: error?.errorMessage || 'Login failed' 
                        }));
                    }

                    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({
                        success: true,
                        sessionTicket: result.data.SessionTicket,
                        playFabId: result.data.PlayFabId,
                        entityToken: result.data.EntityToken
                    }));
                });
            } catch (err) {
                console.error('[Server Auth Exception]:', err);
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
        return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/user-info')) {
        try {
            const urlParams = new URLSearchParams(req.url.split('?')[1]);
            const discordId = urlParams.get('discordId');

            if (!discordId) {
                res.writeHead(400, { ...headers, 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, error: 'Missing discordId parameter.' }));
            }

            const { user, reason } = await getPlayFabUserByDiscordId(discordId);

            if (!user) {
                res.writeHead(404, { ...headers, 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, reason }));
            }

            const [stats, userData] = await Promise.all([
                getPlayerStats(user.PlayFabId),
                getPlayerData(user.PlayFabId)
            ]);

            res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                success: true,
                playFabId: user.PlayFabId,
                displayName: user.TitleInfo?.DisplayName || 'Not Set',
                stats,
                userData
            }));
        } catch (apiErr) {
            console.error('[API Error] User info endpoint failed:', apiErr);
            res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: apiErr.message }));
        }
    }

    res.writeHead(200, { ...headers, 'Content-Type': 'text/plain' });
    res.end('VBR Assistant Coach Bot is running 24/7!');
}).listen(PORT, () => {
    console.log(`🌐 Webhook server listening on port ${PORT}`);
});

setInterval(() => {
    const renderAppUrl = process.env.RENDER_EXTERNAL_URL;
    if (renderAppUrl) {
        const requester = renderAppUrl.startsWith('https') ? https : http;
        requester.get(renderAppUrl, (res) => {
            console.log(`[Heartbeat] Ping sent - Status: ${res.statusCode}`);
        }).on('error', (err) => console.error(`[Heartbeat Error] ${err.message}`));
    }
}, 300000);

const commands = [
    new SlashCommandBuilder().setName('website').setDescription('Get the official Volleyball Revengers website link'),
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord using a 6-digit code generated in-game')
        .addStringOption(opt => opt.setName('code').setDescription('The 6-digit link code (e.g. 294-617)').setRequired(true)),
    new SlashCommandBuilder()
        .setName('is-linked')
        .setDescription('Check if a Discord account is linked to PlayFab')
        .addUserOption(opt => opt.setName('target').setDescription('Discord user to check (optional)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('check-status')
        .setDescription('Check a player’s in-game status')
        .addUserOption(opt => opt.setName('target').setDescription('Discord user to check status for').setRequired(true)),
    new SlashCommandBuilder().setName('account').setDescription('View profile, stats, and physical attributes')
        .addUserOption(opt => opt.setName('target').setDescription('Player profile to view (optional)').setRequired(false)),
    new SlashCommandBuilder().setName('club').setDescription('View your current club details, invites, and manage link')
        .addUserOption(opt => opt.setName('target').setDescription('Check another player\'s club (optional)').setRequired(false)),
    new SlashCommandBuilder().setName('party').setDescription('View active party details and pending invites')
        .addUserOption(opt => opt.setName('target').setDescription('Check another player\'s party (optional)').setRequired(false)),
    new SlashCommandBuilder().setName('friends').setDescription('View your friends list and pending requests')
        .addUserOption(opt => opt.setName('target').setDescription('Check another player\'s friends list (optional)').setRequired(false)),
    new SlashCommandBuilder().setName('club-info').setDescription('Learn information about what clubs are in Volleyball Revengers'),
    new SlashCommandBuilder().setName('nt-info').setDescription('Learn about the National Tournament'),
    new SlashCommandBuilder().setName('online-players').setDescription('Show the current online player count'),
    new SlashCommandBuilder()
        .setName('report-player')
        .setDescription('Report an in-game player for exploits, toxicity, or rule violations')
        .addStringOption(opt => 
            opt.setName('player_identifier')
               .setDescription('In-Game Display Name, PlayFab ID, or linked Discord @mention')
               .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('reason')
               .setDescription('Select the core category of the violation')
               .setRequired(true)
               .addChoices(
                   { name: 'Cheating / Exploiting / Hacking', value: 'Cheating / Exploiting / Hacking' },
                   { name: 'Toxic Behavior / Harassment', value: 'Toxic Behavior / Harassment' },
                   { name: 'Griefing / Intentional Throwing', value: 'Griefing / Intentional Throwing' },
                   { name: 'Inappropriate Display Name / Customization', value: 'Inappropriate Display Name / Customization' },
                   { name: 'Bug Abuse', value: 'Bug Abuse' },
                   { name: 'Other Rule Violation', value: 'Other Rule Violation' }
               )
        )
        .addStringOption(opt => 
            opt.setName('details')
               .setDescription('Provide detailed context, match time, or specifics of what occurred')
               .setRequired(true)
        )
        .addAttachmentOption(opt => 
            opt.setName('proof')
               .setDescription('Attach a video/screenshot proving the infraction (Highly Recommended)')
               .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('report-discord-user')
        .setDescription('Report a community member for Discord server infractions or misconduct')
        .addUserOption(opt => 
            opt.setName('user')
               .setDescription('The Discord member you are reporting')
               .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('reason')
               .setDescription('Select the primary reason for reporting this user')
               .setRequired(true)
               .addChoices(
                   { name: 'Harassment / Direct Messages Abuse', value: 'Harassment / Direct Messages Abuse' },
                   { name: 'Hate Speech / Discriminatory Language', value: 'Hate Speech / Discriminatory Language' },
                   { name: 'Spam / Scam / Phishing Links', value: 'Spam / Scam / Phishing Links' },
                   { name: 'Inappropriate Avatar or Profile Text', value: 'Inappropriate Avatar or Profile Text' },
                   { name: 'NSFW Content', value: 'NSFW Content' },
                   { name: 'Other Community Infraction', value: 'Other Community Infraction' }
               )
        )
        .addStringOption(opt => 
            opt.setName('details')
               .setDescription('Explain what happened and list channels or message links where it occurred')
               .setRequired(true)
        )
        .addAttachmentOption(opt => 
            opt.setName('proof')
               .setDescription('Attach a screenshot of the message or DM interaction')
               .setRequired(false)
        ),

    new SlashCommandBuilder().setName('msg').setDescription('Sends custom message (Admin Only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt => opt.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption(opt => opt.setName('message').setDescription('Message text').setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.process.env.DISCORD_BOT_TOKEN);

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

function getPlayerStats(playFabId) {
    return new Promise((resolve) => {
        PlayFabServer.GetPlayerStatistics({ PlayFabId: playFabId }, (error, result) => {
            if (error || !result?.data) return resolve({});
            const stats = {};
            (result.data.Statistics || []).forEach(s => { stats[s.StatisticName] = s.Value; });
            resolve(stats);
        });
    });
}

function getPlayerData(playFabId) {
    return new Promise((resolve) => {
        PlayFabServer.GetUserData({ PlayFabId: playFabId }, (error, result) => {
            if (error || !result?.data) return resolve({});
            resolve(result.data.Data || {});
        });
    });
}

function getPlayFabUserByDiscordId(discordId) {
    return new Promise((resolve) => {
        try {
            const cleanDiscordId = String(discordId).replace(/['"]+/g, '').trim();
            PlayFabServer.GetTitleInternalData({
                Keys: [`DiscordUserMap_${cleanDiscordId}`]
            }, (error, result) => {
                if (error) return resolve({ user: null, reason: 'NOT_LINKED' });

                const mappedPlayFabId = result?.data?.Data?.[`DiscordUserMap_${cleanDiscordId}`];
                if (!mappedPlayFabId) return resolve({ user: null, reason: 'NOT_LINKED' });

                PlayFabServer.GetUserAccountInfo({ PlayFabId: mappedPlayFabId }, (accErr, accResult) => {
                    if (accErr || !accResult?.data?.UserInfo) {
                        return resolve({ user: null, reason: 'ACCOUNT_NOT_FOUND', playFabId: mappedPlayFabId });
                    }
                    resolve({ user: accResult.data.UserInfo, reason: 'SUCCESS' });
                });
            });
        } catch {
            resolve({ user: null, reason: 'NOT_LINKED' });
        }
    });
}

function getOnlinePlayerCount() {
    return new Promise((resolve) => {
        PlayFabServer.GetTitleData({ Keys: ['OnlinePlayersCount', 'ActiveSessions'] }, (error, result) => {
            if (!error && result?.data?.Data?.OnlinePlayersCount) {
                return resolve(parseInt(result.data.Data.OnlinePlayersCount, 10) || 0);
            }
            
            PlayFabServer.GetTitleInternalData({ Keys: ['GlobalServerState'] }, (intErr, intResult) => {
                if (intErr || !intResult?.data?.Data?.GlobalServerState) return resolve(0);
                try {
                    const serverState = JSON.parse(intResult.data.Data.GlobalServerState);
                    resolve(serverState.totalOnline || 0);
                } catch {
                    resolve(0);
                }
            });
        });
    });
}

function logReportToPlayFab(reportType, reportData) {
    return new Promise((resolve) => {
        const timestamp = new Date().toISOString();
        const key = `Report_${reportType}_${Date.now()}`;
        
        PlayFabServer.SetTitleInternalData({
            Key: key,
            Value: JSON.stringify({ ...reportData, timestamp })
        }, (error) => {
            if (error) console.error('[PlayFab Report Logging Error]:', error);
            resolve(!error);
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
            ? 'You have not linked your Discord account yet! Use `/link <code>` with your in-game code.' 
            : `**${userToVerify.username}** has not linked their Discord account yet.`;

        if (reason === 'ACCOUNT_NOT_FOUND') {
            title = '❓ Account Not Found';
            description = `Linked PlayFab ID \`${playFabId}\` could not be retrieved.`;
        }

        const responseEmbed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor('#FF4B4B')
            .setFooter({ text: 'Volleyball Revengers • Assistant Coach' });

        await interaction.editReply({ embeds: [responseEmbed] }).catch(() => {});
        return null;
    }

    return user;
}

// --- Process Safety Listeners ---
process.on('unhandledRejection', error => console.error('[Unhandled Rejection]:', error));
process.on('uncaughtException', error => console.error('[Uncaught Exception]:', error));

// --- Bot Login & Events ---
client.once('clientReady', () => {
    console.log(`🤖 VBR Assistant Coach online as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // Beats Discord's 3-second timeout immediately across all commands
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const { commandName } = interaction;

    try {
        if (commandName === 'website') {
            return await interaction.editReply({ content: '🌐 **Official Website:** https://fpzard-eng.github.io/Volleyball-Revengers/home' });
        }

        if (commandName === 'club-info') {
            const embed = new EmbedBuilder()
                .setTitle('🏐 Club System Overview')
                .setDescription('Clubs are the core competitive units in Volleyball Revengers. Build your roster, compete in regional circuits, and climb the standings toward full release.')
                .addFields(
                    { name: '👥 Roster Capacity', value: '• **Standard Roster:** 12 Players\n• **Max Roster (with Coaches):** 14 Players', inline: true },
                    { name: '🏆 Competitive Paths', value: '• Open Gym / Regional Matches\n• Qualification Play-Ins\n• National Tournament (NT)', inline: false }
                )
                .setColor('#2B2D31')
                .setFooter({ text: 'Volleyball Revengers • Club Information' });

            return await interaction.editReply({ embeds: [embed] });
        }
        
        if (commandName === 'nt-info') {
            const embed = new EmbedBuilder()
                .setTitle('🏆 NATIONAL TOURNAMENT (NT)')
                .setDescription('**The Premier Championship for Volleyball Revengers**')
                .addFields(
                    { 
                        name: '🥇 QUALIFICATION ROUND', 
                        value: '>>> • **Format:** Single-Elimination Knockout (Best of 3)\n• **Entrants:** Open Entrant Pool\n• **Advancement Goal:** Top **36 Teams** reach the League Stage', 
                        inline: false
                    },
                    { name: '\u200B', value: '\u200B', inline: false },
                    { 
                        name: '🏐 LEAGUE STAGE (36 TEAMS)', 
                        value: '>>> • **Structure:** 6 Pools of 6 Teams (Round-Robin)\n• **Match Length:** Best 2-out-of-3 sets\n• **Scoring System:**\n  └ **3 pts:** 2-0 Win | **2 pts:** 2-1 Win\n  └ **1 pt:** 1-2 Loss | **0 pts:** 0-2 Loss\n• **Advancement:** Top 2 per pool (12) + Top 4 Wildcards (**16 total**)', 
                        inline: false 
                    },
                    { name: '\u200B', value: '\u200B', inline: false },
                    { 
                        name: '👑 FINALS — NT PLAYOFFS (16 TEAMS)', 
                        value: '>>> • **Format:** Single-Elimination Bracket (Random Seeding)\n• **Match Length:** Best 3-out-of-5 sets\n• **Progression:** Round of 16 ➔ Quarterfinals ➔ Semifinals\n• **Podium Matches:**\n  └ 🥉 **3rd Place Match:** Semifinal Losers\n  └ 🏆 **Grand Final:** Semifinal Winners', 
                        inline: false 
                    }
                )
                .setColor('#FFD700')
                .setFooter({ text: 'Volleyball Revengers • National Tournament Information' })
                .setTimestamp();

            return await interaction.editReply({ embeds: [embed] });
        }
         
        if (commandName === 'msg') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.editReply({ content: '❌ Administrator permission required.' });
            }

            const channelOption = interaction.options.getChannel('channel');
            const messageText = interaction.options.getString('message');
            const targetChannel = interaction.guild.channels.cache.get(channelOption.id);
            if (!targetChannel || !targetChannel.isTextBased()) {
                return await interaction.editReply({ content: '❌ Selected channel is not a valid text channel.' });
            }

            try {
                await targetChannel.send(messageText);
                return await interaction.editReply({ content: `✅ Sent to ${targetChannel}!` });
            } catch (sendErr) {
                console.error(`[MSG Command Error]:`, sendErr);
                return await interaction.editReply({ content: `❌ Failed to send message to ${targetChannel}. Check bot permissions.` });
            }
        }

        if (commandName === 'link') {
            const rawCode = interaction.options.getString('code');
            const cleanCode = rawCode.replace(/\D/g, '');

            if (cleanCode.length !== 6) {
                return await interaction.editReply({
                    content: '❌ Invalid format! Provide a 6-digit code (e.g. `294-617`).'
                });
            }

            const result = await new Promise((resolve) => {
                PlayFabServer.ExecuteCloudScript({
                    FunctionName: "LinkDiscord",
                    FunctionParameter: {
                        Code: cleanCode,
                        DiscordUserId: String(interaction.user.id),
                        DiscordUsername: String(interaction.user.username)
                    }
                }, (error, res) => {
                    if (error || !res?.data?.FunctionResult) resolve({ success: false, message: 'PlayFab execution failed.' });
                    else resolve(res.data.FunctionResult);
                });
            });

            const embed = new EmbedBuilder()
                .setTitle(result.success ? '🎉 Account Linked!' : '❌ Link Failed')
                .setDescription(result.success 
                    ? `Linked **${interaction.user.username}** to PlayFab ID \`${result.linkedPlayerId}\`.`
                    : (result.message || 'The code is invalid or expired.'))
                .setColor(result.success ? '#00FF7F' : '#FF4B4B')
                .setFooter({ text: 'Volleyball Revengers • Profile Linker' });

            await interaction.editReply({ embeds: [embed] });
        }

        else if (commandName === 'is-linked') {
            const targetDiscordUser = interaction.options.getUser('target') || interaction.user;
            const isSelf = targetDiscordUser.id === interaction.user.id;

            const { user, reason, playFabId } = await getPlayFabUserByDiscordId(targetDiscordUser.id);

            const isLinkedEmbed = new EmbedBuilder().setTimestamp();

            if (user) {
                const displayName = user.TitleInfo?.DisplayName || 'Not Set';
                isLinkedEmbed
                    .setTitle('🔗 Account Linked')
                    .setColor('#00FF7F')
                    .setDescription(isSelf 
                        ? `Your Discord account is linked to PlayFab!` 
                        : `**${targetDiscordUser.username}**'s Discord account is linked to PlayFab.`)
                    .addFields(
                        { name: '👤 Discord User', value: `${targetDiscordUser}`, inline: true },
                        { name: '🎮 Display Name', value: displayName, inline: true },
                        { name: '🆔 PlayFab ID', value: `\`${user.PlayFabId}\``, inline: false }
                    )
                    .setFooter({ text: 'Volleyball Revengers • Account Verification' });
            } else {
                isLinkedEmbed
                    .setTitle('❌ Account Not Linked')
                    .setColor('#FF4B4B')
                    .setDescription(isSelf 
                        ? 'Your Discord account is not linked to PlayFab yet. Use `/link <code>` to link your account.' 
                        : `**${targetDiscordUser.username}** has not linked their Discord account yet.`)
                    .setFooter({ text: 'Volleyball Revengers • Account Verification' });
            }

            await interaction.editReply({ embeds: [isLinkedEmbed] });
        }

        else if (commandName === 'online-players') {
            const count = await getOnlinePlayerCount();

            const onlineEmbed = new EmbedBuilder()
                .setTitle('🌐 Online Players')
                .setColor('#00D4FF')
                .setDescription(`There are currently **${count}** player${count === 1 ? '' : 's'} online in **Volleyball Revengers**!`)
                .setFooter({ text: 'Volleyball Revengers • Live Server Monitor' })
                .setTimestamp();

            await interaction.editReply({ embeds: [onlineEmbed] });
        }

        else if (commandName === 'check-status') {
            const targetDiscordUser = interaction.options.getUser('target');
            const user = await enforceAccountLink(interaction, targetDiscordUser);
            if (!user) return;

            const playFabId = user.PlayFabId;
            const displayName = user.TitleInfo?.DisplayName || targetDiscordUser.username;
            const userData = await getPlayerData(playFabId);
            const rawStatus = userData.PresenceStatus?.Value || 'Offline';

            let statusColor = '#E0E0E0';
            let statusEmoji = '⚪';
            let formattedStatus = 'Offline';

            if (rawStatus.toLowerCase().includes('in-game') || rawStatus.toLowerCase().includes('ingame')) {
                statusColor = '#00D4FF';
                statusEmoji = '🔵';
                formattedStatus = 'In-Game';
            } else if (rawStatus.toLowerCase() === 'online') {
                statusColor = '#00FF7F';
                statusEmoji = '🟢';
                formattedStatus = 'Online';
            }

            const statusEmbed = new EmbedBuilder()
                .setTitle(`${statusEmoji} Player Status:${displayName}`)
                .setColor(statusColor)
                .setThumbnail(targetDiscordUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 Discord User', value: `${targetDiscordUser}`, inline: true },
                    { name: '🆔 PlayFab ID', value: `\`${playFabId}\``, inline: true },
                    { name: '📡 Status', value: `**${formattedStatus}**`, inline: false }
                )
                .setFooter({ text: 'Volleyball Revengers • Status Checker' })
                .setTimestamp();

            await interaction.editReply({ embeds: [statusEmbed] });
        }

        else if (commandName === 'account') {
            const targetDiscordUser = interaction.options.getUser('target') || interaction.user;
            const user = await enforceAccountLink(interaction, targetDiscordUser);
            if (!user) return;

            const playFabId = user.PlayFabId;
            const displayName = user.TitleInfo?.DisplayName || 'Unknown Player';

            const [stats, userData] = await Promise.all([
                getPlayerStats(playFabId),
                getPlayerData(playFabId)
            ]);

            const getStat = (k) => stats[k] ?? 0;
            const getData = (k) => userData[k]?.Value ?? 'N/A';

            const accountEmbed = new EmbedBuilder()
                .setTitle(`🏐 Player Profile: ${displayName}`)
                .setColor('#1E90D8')
                .setThumbnail(targetDiscordUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '🆔 Account Info', value: `**Display Name:** ${displayName}\n**PlayFab ID:** \`${playFabId}\`\n**ELO:** ${getStat('PlayerElo')}`, inline: false },
                    { name: '📏 Physical Attributes', value: `**Height:** ${getStat('PlayerHeight') || getData('PlayerHeight')}\n**Reach:** ${getStat('StandingReach')}\n**Wingspan:** ${getStat('Wingspan')}`, inline: true },
                    { name: '📊 Performance', value: `**Matches:** ${getStat('MatchesPlayed')}\n**Wins:** ${getStat('Wins')}\n**MVPs:** ${getStat('MVP')}`, inline: true },
                    { name: '🎯 In-Game Actions', value: `**Kills:** ${getStat('Kills')}\n**Blocks:** ${getStat('Blocks')}\n**Assists:** ${getStat('Assists')}`, inline: false }
                )
                .setFooter({ text: 'Volleyball Revengers • Player Statistics' })
                .setTimestamp();

            await interaction.editReply({ embeds: [accountEmbed] });
        }

        else if (commandName === 'club') {
            const targetDiscordUser = interaction.options.getUser('target') || interaction.user;
            const user = await enforceAccountLink(interaction, targetDiscordUser);
            if (!user) return;

            const userData = await getPlayerData(user.PlayFabId);
            const clubName = userData.ClubName?.Value || 'Free Agent (No Club)';
            const pendingInvites = userData.ClubInvites?.Value ? JSON.parse(userData.ClubInvites.Value) : [];

            const clubEmbed = new EmbedBuilder()
                .setTitle(`🛡️ Club Details: ${user.TitleInfo?.DisplayName || targetDiscordUser.username}`)
                .setColor('#1E90D8')
                .addFields(
                    { name: '🏷️ Current Club', value: `**${clubName}**`, inline: false },
                    { name: '📩 Pending Invites', value: pendingInvites.length > 0 ? pendingInvites.join(', ') : 'None', inline: false },
                    { name: '🌐 Management Portal', value: 'Manage invitations, view stats, and access settings at:\nhttps://fpzard-eng.github.io/Volleyball-Revengers/club', inline: false }
                )
                .setFooter({ text: 'Volleyball Revengers • Club Hub' });

            await interaction.editReply({ embeds: [clubEmbed] });
        }

        else if (commandName === 'party') {
            const targetDiscordUser = interaction.options.getUser('target') || interaction.user;
            const user = await enforceAccountLink(interaction, targetDiscordUser);
            if (!user) return;

            const userData = await getPlayerData(user.PlayFabId);
            const partyStatus = userData.ActivePartyId?.Value ? `In Party (\`${userData.ActivePartyId.Value}\`)` : 'Not in a Party';
            const pendingInvites = userData.PartyInvites?.Value ? JSON.parse(userData.PartyInvites.Value) : [];

            const partyEmbed = new EmbedBuilder()
                .setTitle(`🎉 Party Hub: ${user.TitleInfo?.DisplayName || targetDiscordUser.username}`)
                .setColor('#FF007F')
                .addFields(
                    { name: '👥 Party Status', value: `**${partyStatus}**`, inline: false },
                    { name: '📩 Incoming Invites', value: pendingInvites.length > 0 ? pendingInvites.join(', ') : 'None', inline: false }
                )
                .setFooter({ text: 'Volleyball Revengers • Party Hub' });

            await interaction.editReply({ embeds: [partyEmbed] });
        }

        else if (commandName === 'friends') {
            const targetDiscordUser = interaction.options.getUser('target') || interaction.user;
            const user = await enforceAccountLink(interaction, targetDiscordUser);
            if (!user) return;

            const userData = await getPlayerData(user.PlayFabId);
            const friendList = userData.FriendList?.Value ? JSON.parse(userData.FriendList.Value) : [];
            const pendingRequests = userData.FriendRequests?.Value ? JSON.parse(userData.FriendRequests.Value) : [];

            const friendsEmbed = new EmbedBuilder()
                .setTitle(`🤝 Friends Overview: ${user.TitleInfo?.DisplayName || targetDiscordUser.username}`)
                .setColor('#00FF7F')
                .addFields(
                    { name: `👥 Friends (${friendList.length})`, value: friendList.length > 0 ? friendList.slice(0, 10).join(', ') : 'No friends added yet.', inline: false },
                    { name: '📩 Pending Requests', value: pendingRequests.length > 0 ? pendingRequests.join(', ') : 'None', inline: false },
                    { name: '🌐 Manage Friends', value: 'Add or remove friends on the dashboard:\nhttps://fpzard-eng.github.io/Volleyball-Revengers/friends', inline: false }
                )
                .setFooter({ text: 'Volleyball Revengers • Social Network' });

            await interaction.editReply({ embeds: [friendsEmbed] });
        }

        // --- REPORT PLAYER IMPLEMENTATION ---
        else if (commandName === 'report-player') {
            const playerIdentifier = interaction.options.getString('player_identifier');
            const reason = interaction.options.getString('reason');
            const details = interaction.options.getString('details');
            const proofAttachment = interaction.options.getAttachment('proof');

            const staffChannelId = process.env.DISCORD_STAFF_CHANNEL_ID;
            const modRoleId = process.env.DISCORD_MOD_ROLE_ID;

            if (!staffChannelId) {
                return await interaction.editReply({ content: '❌ Configuration error: Staff Channel ID is not configured.' });
            }

            const staffChannel = await client.channels.fetch(staffChannelId).catch(() => null);
            if (!staffChannel) {
                return await interaction.editReply({ content: '❌ Unable to find or access the designated Staff Channel.' });
            }

            const reporterAccount = await getPlayFabUserByDiscordId(interaction.user.id);
            const reporterPlayFab = reporterAccount?.user?.PlayFabId ? `\`${reporterAccount.user.PlayFabId}\`` : 'Unlinked';

            const mentionMatch = playerIdentifier.match(/^<@!?(\d+)>$/);
            let suspectAccountDetails = 'Not Linked / Manual Entry';
            if (mentionMatch) {
                const targetId = mentionMatch[1];
                const suspectAccount = await getPlayFabUserByDiscordId(targetId);
                if (suspectAccount?.user?.PlayFabId) {
                    suspectAccountDetails = `\`${suspectAccount.user.PlayFabId}\` (${suspectAccount.user.TitleInfo?.DisplayName || 'No Display Name'})`;
                }
            }

            const reportEmbed = new EmbedBuilder()
                .setTitle('🚨 IN-GAME PLAYER REPORT')
                .setColor('#FF3333')
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '🎯 Reported Subject', value: `**Identifier Provided:** ${playerIdentifier}\n**PlayFab Match:** ${suspectAccountDetails}`, inline: false },
                    { name: '⚠️ Violation Category', value: `\`${reason}\``, inline: true },
                    { name: '👤 Reporter', value: `${interaction.user} (PlayFab:${reporterPlayFab})`, inline: true },
                    { name: '📝 Incident Details', value: details, inline: false }
                )
                .setFooter({ text: `Volleyball Revengers • Incident ID: ${interaction.id}` })
                .setTimestamp();

            if (proofAttachment) {
                reportEmbed.setImage(proofAttachment.url);
                reportEmbed.addFields({ name: '📎 Attached Proof', value: `[View Full Attachment](${proofAttachment.url}) (${proofAttachment.contentType || 'file'})` });
            }

            const pingMention = modRoleId ? `<@&${modRoleId}>` : '**@Moderation Team**';
            await staffChannel.send({ content: `🚨 ${pingMention} - New In-Game Player Report Submitted!`, embeds: [reportEmbed] });
            
            logReportToPlayFab('Player', {
                reporterDiscordId: interaction.user.id,
                targetIdentifier: playerIdentifier,
                reason,
                details,
                proofUrl: proofAttachment ? proofAttachment.url : null
            });

            const userReceiptEmbed = new EmbedBuilder()
                .setTitle('✅ Player Report Submitted')
                .setColor('#00FF7F')
                .setDescription('Thank you for helping keep **Volleyball Revengers** fair and competitive! Our moderation team has been pinged and will review the evidence.')
                .addFields(
                    { name: 'Target Reported', value: playerIdentifier, inline: true },
                    { name: 'Category', value: reason, inline: true }
                )
                .setFooter({ text: 'Volleyball Revengers • Staff Operations' });

            await interaction.editReply({ embeds: [userReceiptEmbed] });
        }

        else if (commandName === 'report-discord-user') {
            const targetUser = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');
            const details = interaction.options.getString('details');
            const proofAttachment = interaction.options.getAttachment('proof');

            const staffChannelId = process.env.DISCORD_STAFF_CHANNEL_ID;
            const modRoleId = process.env.DISCORD_MOD_ROLE_ID;

            if (!staffChannelId) {
                return await interaction.editReply({ content: '❌ Configuration error: Staff Channel ID is not configured.' });
            }

            const staffChannel = await client.channels.fetch(staffChannelId).catch(() => null);
            if (!staffChannel) {
                return await interaction.editReply({ content: '❌ Unable to find or access the designated Staff Channel.' });
            }
            
            const [reporterPF, targetPF] = await Promise.all([
                getPlayFabUserByDiscordId(interaction.user.id),
                getPlayFabUserByDiscordId(targetUser.id)
            ]);

            const reporterPFText = reporterPF?.user?.PlayFabId ? `\`${reporterPF.user.PlayFabId}\`` : 'Unlinked';
            const targetPFText = targetPF?.user?.PlayFabId ? `\`${targetPF.user.PlayFabId}\`` : 'Unlinked';

            const reportEmbed = new EmbedBuilder()
                .setTitle('🛡️ DISCORD COMMUNITY MEMBER REPORT')
                .setColor('#FF9900')
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 Reported Member', value: `${targetUser} (\`${targetUser.id}\`)\n**Linked PlayFab:** ${targetPFText}`, inline: false },
                    { name: '⚠️ Violation Category', value: `\`${reason}\``, inline: true },
                    { name: '📩 Filed By', value: `${interaction.user} (PlayFab: ${reporterPFText})`, inline: true },
                    { name: '📝 Description & Location', value: details, inline: false }
                )
                .setFooter({ text: `Volleyball Revengers • Case ID: ${interaction.id}` })
                .setTimestamp();

            if (proofAttachment) {
                reportEmbed.setImage(proofAttachment.url);
                reportEmbed.addFields({ name: '📎 Evidence File', value: `[View Full Image/Proof](${proofAttachment.url})` });
            }

            const pingMention = modRoleId ? `<@&${modRoleId}>` : '**@Moderation Team**';
            await staffChannel.send({ content: `🛡️ ${pingMention} - New Community Misconduct Report Received!`, embeds: [reportEmbed] });
            
            logReportToPlayFab('DiscordUser', {
                reporterDiscordId: interaction.user.id,
                reportedDiscordId: targetUser.id,
                reason,
                details,
                proofUrl: proofAttachment ? proofAttachment.url : null
            });

            const userReceiptEmbed = new EmbedBuilder()
                .setTitle('✅ Community Report Filed')
                .setColor('#00FF7F')
                .setDescription(`Your report regarding **${targetUser.username}** has been sent directly to the server moderators. We appreciate your vigilance in maintaining a safe community.`)
                .setFooter({ text: 'Volleyball Revengers • Community Moderation' });

            await interaction.editReply({ embeds: [userReceiptEmbed] });
        }

    } catch (cmdErr) {
        console.error(`[Command Error] ${commandName}:`, cmdErr);

        const isPermissionsError = cmdErr.code === 50013;
        const description = isPermissionsError 
            ? '❌ I do not have the required permissions to execute this command.' 
            : 'An unexpected error occurred while executing this command.';

        const errEmbed = new EmbedBuilder()
            .setTitle('❌ Command Failure')
            .setDescription(description)
            .setColor('#FF4B4B')
            .setTimestamp();

        await interaction.editReply({ embeds: [errEmbed] }).catch(() => {});
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
