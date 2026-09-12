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
    new SlashCommandBuilder().setName('account').setDescription('View profile, stats, and physical attributes')
        .addUserOption(opt => opt.setName('target').setDescription('Player profile to view (optional)').setRequired(false)),
    new SlashCommandBuilder().setName('club').setDescription('View club details, rank, W-L ratio, and members')
        .addStringOption(opt => opt.setName('name').setDescription('Name of the club to view').setRequired(false)),
    new SlashCommandBuilder().setName('club-info').setDescription('Learn information about what clubs are in Volleyball Revengers'),
    new SlashCommandBuilder().setName('nt-info').setDescription('Learn about the National Tournament'),
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
].map(cmd => cmd.toJSON());

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

// --- PlayFab Helpers ---
function callCloudScript(functionName, functionParameter, playFabId) {
    return new Promise((resolve) => {
        PlayFabServer.ExecuteCloudScript({
            FunctionName: functionName,
            FunctionParameter: functionParameter,
            PlayFabId: playFabId
        }, (error, result) => {
            if (error) {
                console.error(`[PlayFab Error] ${functionName}:`, error);
                resolve({ success: false, error: error.errorMessage || 'API error.' });
            } else if (result?.data?.FunctionResult) {
                resolve(result.data.FunctionResult);
            } else {
                resolve({ success: false, error: 'Invalid execution response.' });
            }
        });
    });
}

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

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [responseEmbed] });
        } else {
            await interaction.reply({ embeds: [responseEmbed], ephemeral: true });
        }

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

    const { commandName } = interaction;

    try {
        if (commandName === 'website') {
            await interaction.reply({ content: '🌐 **Official Website:** https://fpzard-eng.github.io/Volleyball-Revengers/home' });
        }
        
        else if (commandName === 'link') {
            const rawCode = interaction.options.getString('code');
            const cleanCode = rawCode.replace(/\D/g, '');

            if (cleanCode.length !== 6) {
                return interaction.reply({
                    content: '❌ Invalid format! Provide a 6-digit code (e.g. `294-617`).',
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

        else if (commandName === 'msg') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ Administrator permission required.', ephemeral: true });
            }

            const targetChannel = interaction.options.getChannel('channel');
            const messageText = interaction.options.getString('message');

            await targetChannel.send(messageText);
            await interaction.reply({ content: `✅ Sent to ${targetChannel}!`, ephemeral: true });
        }

    } catch (cmdErr) {
        console.error(`[Command Error] ${commandName}:`, cmdErr);
        const errEmbed = new EmbedBuilder()
            .setTitle('❌ Command Failure')
            .setDescription('An unexpected error occurred while executing this command.')
            .setColor('#FF4B4B');

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [errEmbed] }).catch(() => {});
        } else {
            await interaction.reply({ embeds: [errEmbed], ephemeral: true }).catch(() => {});
        }
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
