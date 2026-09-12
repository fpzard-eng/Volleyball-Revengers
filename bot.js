require('dotenv').config();
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const PlayFab = require('playfab-sdk');
const PlayFabServer = PlayFab.PlayFabServer;

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

// --- Keep-Alive & Notification HTTP Web Server ---
const PORT = process.env.PORT || 10000;
const server = http.createServer(async (req, res) => {
    // Handling inbound notifications from PlayFab CloudScript to DM users
    if (req.method === 'POST' && req.url === '/send-dm') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { discordId, message } = JSON.parse(body);
                if (discordId && message) {
                    const user = await client.users.fetch(discordId);
                    if (user) {
                        const dmEmbed = new EmbedBuilder()
                            .setTitle('🏐 Volleyball Revengers Notification')
                            .setDescription(message)
                            .setColor('#1E90D8')
                            .setTimestamp();
                        await user.send({ embeds: [dmEmbed] });
                    }
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                console.error('[HTTP Server Error] Failed to send DM:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('VBR Assistant Coach Bot is running 24/7!');
}).listen(PORT, () => {
    console.log(`🌐 Keep-alive & Webhook server listening on port ${PORT}`);
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

// --- Register Slash Commands ---
const commands = [
    new SlashCommandBuilder().setName('website').setDescription('Get the official Volleyball Revengers website link'),
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord using a 6-digit code generated in-game')
        .addStringOption(opt => opt.setName('code').setDescription('The 6-digit link code (e.g. 294-617 or 294617)').setRequired(true)),
    new SlashCommandBuilder().setName('account').setDescription('View profile, stats, physical attributes, and PlayFab info')
        .addUserOption(opt => opt.setName('target').setDescription('Player profile to view (optional)').setRequired(false)),
    new SlashCommandBuilder().setName('club').setDescription('View club details, rank, W-L ratio, and members')
        .addStringOption(opt => opt.setName('name').setDescription('Name of the club to view').setRequired(false)),
    new SlashCommandBuilder().setName('club-info').setDescription('Learn information about what clubs are in Volleyball Revengers'),
    new SlashCommandBuilder().setName('nt-info').setDescription('Learn about the National Tournament coming in full release'),
    new SlashCommandBuilder().setName('online-players').setDescription('Show the current online player count'),
    new SlashCommandBuilder().setName('party-request').setDescription('Send a party request').addUserOption(opt => opt.setName('target').setDescription('Player to invite').setRequired(true)),
    new SlashCommandBuilder().setName('accept-party').setDescription('Accept incoming party request').addStringOption(opt => opt.setName('party_id').setDescription('Party ID').setRequired(true)),
    new SlashCommandBuilder().setName('decline-party').setDescription('Decline incoming party request').addStringOption(opt => opt.setName('party_id').setDescription('Party ID').setRequired(true)),
    new SlashCommandBuilder().setName('friend-request').setDescription('Send a friend request').addUserOption(opt => opt.setName('target').setDescription('Player to add').setRequired(true)),
    new SlashCommandBuilder().setName('accept-friend').setDescription('Accept incoming friend request').addUserOption(opt => opt.setName('target').setDescription('Player who added you').setRequired(true)),
    new SlashCommandBuilder().setName('decline-friend').setDescription('Decline incoming friend request').addUserOption(opt => opt.setName('target').setDescription('Player who added you').setRequired(true)),
    new SlashCommandBuilder().setName('block-player').setDescription('Block a player').addUserOption(opt => opt.setName('target').setDescription('Player to block').setRequired(true)),
    new SlashCommandBuilder()
        .setName('make-a-club')
        .setDescription('Create a new club (Costs 10,000 Aero-Coins)')
        .addStringOption(opt => opt.setName('name').setDescription('Name of new club').setRequired(true))
        .addStringOption(opt => opt.setName('tag').setDescription('3-4 character tag').setRequired(true))
        .addStringOption(opt => opt.setName('practice_dates').setDescription('Comma separated days (e.g. Mon, Wed, Fri)').setRequired(true)),
    new SlashCommandBuilder().setName('club-request').setDescription('Send a request to join a club').addStringOption(opt => opt.setName('club_name').setDescription('Name of the club').setRequired(true)),
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

// --- PlayFab Wrapper Helpers ---
function callCloudScript(functionName, functionParameter, playFabId) {
    return new Promise((resolve) => {
        PlayFabServer.ExecuteCloudScript({
            FunctionName: functionName,
            FunctionParameter: functionParameter,
            PlayFabId: playFabId
        }, (error, result) => {
            if (error) {
                console.error(`[PlayFab CloudScript Error] ${functionName}:`, error);
                resolve({ success: false, error: error.errorMessage || 'API error.' });
            } else if (result && result.data && result.data.FunctionResult) {
                resolve(result.data.FunctionResult);
            } else {
                resolve({ success: false, error: 'Execution returned an invalid response.' });
            }
        });
    });
}

function getPlayerStats(playFabId) {
    return new Promise((resolve) => {
        PlayFabServer.GetPlayerStatistics({ PlayFabId: playFabId }, (error, result) => {
            if (error || !result || !result.data) return resolve({});
            const stats = {};
            (result.data.Statistics || []).forEach(stat => { stats[stat.StatisticName] = stat.Value; });
            resolve(stats);
        });
    });
}

function getPlayerData(playFabId) {
    return new Promise((resolve) => {
        PlayFabServer.GetUserData({ PlayFabId: playFabId }, (error, result) => {
            if (error || !result || !result.data) return resolve({});
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

                PlayFabServer.GetUserAccountInfo({
                    PlayFabId: mappedPlayFabId
                }, (accErr, accResult) => {
                    if (accErr || !accResult?.data?.UserInfo) {
                        return resolve({ user: null, reason: 'ACCOUNT_NOT_FOUND', playFabId: mappedPlayFabId });
                    }
                    resolve({ user: accResult.data.UserInfo, reason: 'SUCCESS' });
                });
            });
        } catch (fatalErr) {
            resolve({ user: null, reason: 'NOT_LINKED' });
        }
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

        if (reason === 'ACCOUNT_NOT_FOUND') {
            title = '❓ Account Not Found';
            description = `Linked PlayFab ID \`${playFabId}\` could not be retrieved from the server.`;
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

// --- Interaction Handler ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
        if (commandName === 'website') {
            await interaction.reply({ content: '🌐 **Volleyball Revengers Official Website:** https://fpzard-eng.github.io/Volleyball-Revengers/home' });
        }
        
        else if (commandName === 'link') {
            const rawCode = interaction.options.getString('code');
            const cleanCode = rawCode.replace(/\D/g, '');

            if (cleanCode.length !== 6) {
                return interaction.reply({
                    content: '❌ Invalid code format! Please enter a 6-digit code (e.g. `294-617` or `294617`).',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const result = await new Promise((resolve) => {
                PlayFabServer.ExecuteCloudScript({
                    FunctionName: "LinkDiscord",
                    FunctionParameter: {
                        Code: cleanCode,
                        DiscordUserId: String(interaction.user.id),
                        DiscordUsername: String(interaction.user.username)
                    }
                }, (error, res) => {
                    if (error || !res?.data?.FunctionResult) resolve({ success: false, message: 'PlayFab API error.' });
                    else resolve(res.data.FunctionResult);
                });
            });

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

        else if (commandName === 'account') {
            await interaction.deferReply();
            const targetDiscordUser = interaction.options.getUser('target') || interaction.user;
            const user = await enforceAccountLink(interaction, targetDiscordUser);
            if (!user) return;

            const playFabId = user.PlayFabId;
            const displayName = user.TitleInfo?.DisplayName || 'Unknown Player';

            const [stats, userData] = await Promise.all([
                getPlayerStats(playFabId),
                getPlayerData(playFabId)
            ]);

            const getStat = (key) => stats[key] ?? 0;
            const getData = (key) => userData[key]?.Value ?? null;

            const avatarURL = targetDiscordUser?.displayAvatarURL?.({ dynamic: true }) || interaction.user.displayAvatarURL({ dynamic: true });

            const accountEmbed = new EmbedBuilder()
                .setTitle(`🏐 Player Profile: ${displayName}`)
                .setColor('#1E90D8')
                .setThumbnail(avatarURL)
                .addFields(
                    { name: '🆔 Account Info', value: `**Display Name:** ${displayName}\n**PlayFab ID:** \`${playFabId}\`\n**Player ELO:** ${getStat('PlayerElo')}`, inline: false },
                    { name: '📏 Physical Attributes', value: `**Height:** ${getStat('PlayerHeight') || getData('PlayerHeight') || 'N/A'}\n**Standing Reach:** ${getStat('StandingReach') || 'N/A'}\n**Wingspan:** ${getStat('Wingspan') || 'N/A'}`, inline: true },
                    { name: '📊 Performance Stats', value: `**Matches Played:** ${getStat('MatchesPlayed')}\n**Wins:** ${getStat('Wins')}\n**Match MVPs:** ${getStat('MVP')}`, inline: true },
                    { name: '🎯 In-Game Actions', value: `**Kills:** ${getStat('Kills')}\n**Blocks:** ${getStat('Blocks')}\n**Assists:** ${getStat('Assists')}`, inline: false }
                )
                .setFooter({ text: 'Volleyball Revengers • Player Statistics' })
                .setTimestamp();

            await interaction.editReply({ embeds: [accountEmbed] });
        }

        else if (commandName === 'friend-request') {
            await interaction.deferReply();
            const sender = await enforceAccountLink(interaction);
            if (!sender) return;

            const target = interaction.options.getUser('target');
            const result = await callCloudScript('sendFriendRequestSignal', { TargetId: target.id }, sender.PlayFabId);

            if (result.success) {
                await interaction.editReply({ content: `📩 Friend request sent to **${target.username}**!` });
            } else {
                await interaction.editReply({ content: `❌ Could not send friend request: ${result.error || result.message}` });
            }
        }

        else if (commandName === 'accept-friend') {
            await interaction.deferReply();
            const user = await enforceAccountLink(interaction);
            if (!user) return;

            const target = interaction.options.getUser('target');
            const result = await callCloudScript('acceptFriendRequestSignal', { TargetId: target.id }, user.PlayFabId);

            if (result.success) {
                await interaction.editReply({ content: `🤝 You are now friends with **${target.username}**!` });
            } else {
                await interaction.editReply({ content: `❌ Error accepting request: ${result.error}` });
            }
        }

        else if (commandName === 'decline-friend') {
            await interaction.deferReply();
            const user = await enforceAccountLink(interaction);
            if (!user) return;

            const target = interaction.options.getUser('target');
            const result = await callCloudScript('declineFriendRequestSignal', { TargetId: target.id }, user.PlayFabId);

            if (result.success) {
                await interaction.editReply({ content: `❌ Declined friend request from **${target.username}**.` });
            } else {
                await interaction.editReply({ content: `❌ Error declining request: ${result.error}` });
            }
        }

        else if (commandName === 'block-player') {
            await interaction.deferReply();
            const user = await enforceAccountLink(interaction);
            if (!user) return;

            const target = interaction.options.getUser('target');
            const result = await callCloudScript('blockPlayerSignal', { TargetId: target.id }, user.PlayFabId);

            if (result.success) {
                await interaction.editReply({ content: `🚫 **${target.username}** has been blocked and removed from your friends list.` });
            } else {
                await interaction.editReply({ content: `❌ Could not block player: ${result.error}` });
            }
        }

        else if (commandName === 'make-a-club') {
            await interaction.deferReply();
            const user = await enforceAccountLink(interaction);
            if (!user) return;

            const clubName = interaction.options.getString('name');
            const clubTag = interaction.options.getString('tag');
            const rawDates = interaction.options.getString('practice_dates');
            const practiceDates = rawDates.split(',').map(s => s.trim());

            const result = await callCloudScript('createClub', {
                ClubName: clubName,
                ClubTag: clubTag,
                PracticeDates: practiceDates
            }, user.PlayFabId);

            if (result.success) {
                await interaction.editReply({ content: `🎉 **${clubName}** [${clubTag}] has been successfully created!` });
            } else {
                await interaction.editReply({ content: `❌ Failed to create club: ${result.error}` });
            }
        }

        else if (commandName === 'party-request') {
            await interaction.deferReply();
            const user = await enforceAccountLink(interaction);
            if (!user) return;

            const target = interaction.options.getUser('target');
            const result = await callCloudScript('inviteToParty', { TargetId: target.id, PartyId: `Party_${user.PlayFabId}` }, user.PlayFabId);

            if (result.success) {
                await interaction.editReply({ content: `🎉 Party request sent to **${target.username}**!` });
            } else {
                await interaction.editReply({ content: `❌ Could not send party invite: ${result.error}` });
            }
        }

        else if (commandName === 'club-info') {
            const embed = new EmbedBuilder()
                .setTitle('🏆 What are Clubs in Volleyball Revengers?')
                .setDescription('Clubs allow players to team up, participate in Scrimmages, climb global Leaderboards together, and prepare for official Competitive Tournaments!')
                .setColor('#1E90D8')
                .setFooter({ text: 'Volleyball Revengers • VBR Assistant Coach' });

            await interaction.reply({ embeds: [embed] });
        }

        else if (commandName === 'nt-info') {
            const embed = new EmbedBuilder()
                .setTitle('🏐 National Tournament (NT) Preview')
                .setDescription('The **National Tournament** is the pinnacle competitive event in Volleyball Revengers!')
                .setColor('#FF9900')
                .addFields(
                    { name: 'Status', value: '🔒 Coming in Full Release!' },
                    { name: 'Format', value: 'Bracket-style elimination tournament featuring top-ranked Clubs across all regions.' }
                )
                .setFooter({ text: 'Volleyball Revengers • VBR Assistant Coach' });

            await interaction.reply({ embeds: [embed] });
        }

        else if (commandName === 'online-players') {
            const embed = new EmbedBuilder()
                .setTitle('🌐 Active Players Online')
                .setDescription('Currently **0 Players** are active on the courts!')
                .setColor('#00FF7F')
                .setFooter({ text: 'Volleyball Revengers Live Status' });

            await interaction.reply({ embeds: [embed] });
        }

        else if (commandName === 'manage-club') {
            await interaction.reply({ content: '⚙️ **Manage your club settings here:** https://fpzard-eng.github.io/Volleyball-Revengers/manage-club' });
        }

        else if (commandName === 'msg') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ You must have Administrator permissions to use this command.', ephemeral: true });
            }

            const targetChannel = interaction.options.getChannel('channel');
            const messageText = interaction.options.getString('message');

            try {
                await targetChannel.send(messageText);
                await interaction.reply({ content: `✅ Custom message successfully sent to ${targetChannel}!`, ephemeral: true });
            } catch (error) {
                await interaction.reply({ content: '❌ Failed to send the message. Check channel permissions.', ephemeral: true });
            }
        }
    } catch (cmdErr) {
        console.error(`[Command Error] Command ${commandName} failed:`, cmdErr);
        const errEmbed = new EmbedBuilder()
            .setTitle('❌ Command Failure')
            .setDescription('An internal error occurred while processing this command.')
            .setColor('#FF4B4B');

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [errEmbed] }).catch(() => {});
        } else {
            await interaction.reply({ embeds: [errEmbed], ephemeral: true }).catch(() => {});
        }
    }
});

// Log in the client
client.login(process.env.DISCORD_BOT_TOKEN);
