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
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
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
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

const xpCooldowns = new Set();
const guildSettingsCache = new Map();
const userXPCache = new Map();

function getDefaultConfig() {
    return {
        prefix: '!',
        reportsChannelId: null,
        modRoleId: null,
        staffRoleId: null,
        onBreakRoleId: null,
        unverifiedRoleId: null,
        verifiedRoleId: null,
        staffBreaksChannelId: null,
        logsChannelId: null,
        loginsLogoutsChannelId: null,
        verificationChannelId: null,
        welcomeChannelId: null,
        levelsChannelId: null,
        logSettings: {
            memberKicked: true,
            memberBanned: true,
            memberTimedOut: true,
            memberJoined: true,
            memberLeft: true,
            memberRolesAdded: true,
            memberRolesUpdated: true,
            memberRolesRemoved: true,
            playerBanned: true,
            playerKicked: true,
            playerVcBanned: true,
            playerLoggedIn: true,
            playerLoggedOff: true,
            msgDeleted: true,
            msgEdited: true,
            msgBulkDeleted: true,
            commandUsed: true,
            channelNameUpdated: true,
            channelPermsUpdated: true,
            channelCreated: true,
            channelDeleted: true,
            roleAdded: true,
            roleDeleted: true,
            rolePermsUpdated: true,
            roleColorUpdated: true,
            roleNameUpdated: true,
            inviteCreated: true,
            inviteDeleted: true,
            inviteUsed: true,
            emojiCreated: true,
            emojiDeleted: true,
            emojiNameUpdated: true
        }
    };
}

async function getUserXP(guildId, userId) {
    const key = `${guildId}_${userId}`;
    if (userXPCache.has(key)) {
        return userXPCache.get(key);
    }

    return new Promise((resolve) => {
        PlayFabServer.GetTitleInternalData({
            Keys: [`LevelData_${key}`]
        }, (error, result) => {
            let data = { xp: 0, level: 0 };
            if (!error && result?.data?.Data?.[`LevelData_${key}`]) {
                try {
                    data = JSON.parse(result.data.Data[`LevelData_${key}`]);
                } catch (e) {
                    console.error('[XP Parse Error]:', e);
                }
            }
            userXPCache.set(key, data);
            resolve(data);
        });
    });
}

async function saveUserXP(guildId, userId, data) {
    const key = `${guildId}_${userId}`;
    userXPCache.set(key, data);
    return new Promise((resolve) => {
        PlayFabServer.SetTitleInternalData({
            Key: `LevelData_${key}`,
            Value: JSON.stringify(data)
        }, (error) => {
            if (error) console.error(`[PlayFab XP Save Error]:`, error);
            resolve(!error);
        });
    });
}

function getXPForLevel(level) {
    return (level + 1) * 100;
}

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
    
    if (req.method === 'POST' && req.url === '/send-dm') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { discordId, message } = JSON.parse(body || '{}');

                if (!discordId || !message) {
                    res.writeHead(400, { ...headers, 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, error: 'Missing discordId or message parameter.' }));
                }

                const targetUser = await client.users.fetch(discordId).catch(() => null);
                if (!targetUser) {
                    res.writeHead(404, { ...headers, 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, error: 'Discord user not found.' }));
                }

                await targetUser.send(message);
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true }));
            } catch (err) {
                console.error('[Send DM Endpoint Error]:', err);
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
        return;
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
    new SlashCommandBuilder().setName('about').setDescription('Displays information about Volleyball Revengers and development status'),
    new SlashCommandBuilder().setName('info').setDescription('Generates a categorized listing of all slash commands'),
    new SlashCommandBuilder().setName('website').setDescription('Get the official Volleyball Revengers website link'),
    new SlashCommandBuilder().setName('level').setDescription('View your XP, level, rank, and username profile card'),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the Top 10 players in a specific leaderboard category')
        .addStringOption(opt => 
            opt.setName('type')
               .setDescription('Select the leaderboard category to view')
               .setRequired(true)
               .addChoices(
                   { name: 'Elo', value: 'PlayerElo' },
                   { name: 'Aero-Coins', value: 'Aero-Coins' },
                   { name: 'Kills', value: 'Kills' },
                   { name: 'MVPs', value: 'MVP' },
                   { name: 'Wins', value: 'Wins' },
                   { name: 'Blocks', value: 'Blocks' },
                   { name: 'Assists', value: 'Assists' },
                   { name: 'Level', value: 'Level' }
               )
        ),
    new SlashCommandBuilder().setName('rewards').setDescription('View official Locker Room level rewards and perks'),
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
    new SlashCommandBuilder().setName('online-players').setDescription('Show current global online player count'),
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a user from the Discord server')
        .addUserOption(opt => opt.setName('user').setDescription('The user to ban').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('Ban duration (e.g., 7d, 30d, permanent)').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the ban').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('ban-player')
        .setDescription('Bans a player in-game via PlayFab')
        .addStringOption(opt => opt.setName('player').setDescription('PlayFab ID, Username, or Discord Mention').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('Ban duration in hours').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for in-game ban').setRequired(true)),

    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Timeout a user in the server')
        .addUserOption(opt => opt.setName('user').setDescription('User to timeout').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('Timeout duration in minutes').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for timeout').setRequired(true)),

    new SlashCommandBuilder()
        .setName('mute-player')
        .setDescription('Bans a player from in-game Voice Chat')
        .addStringOption(opt => opt.setName('player').setDescription('PlayFab ID, Username, or Discord Mention').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('Mute duration in hours').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for VC mute').setRequired(true)),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kicks a user from the server')
        .addUserOption(opt => opt.setName('user').setDescription('User to kick').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for kick').setRequired(true)),

    new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Looks up a player based on Username, Discord Account, or Game ID')
        .addStringOption(opt => opt.setName('player').setDescription('Username, Discord ID/Mention, or PlayFab ID').setRequired(true)),

    new SlashCommandBuilder()
        .setName('staff-break')
        .setDescription('Puts you on break and notifies the staff breaks channel')
        .addStringOption(opt => opt.setName('duration').setDescription('Duration of break').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for break').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Configure server settings, channels, roles, and event logging')
        .addSubcommand(sub =>
            sub.setName('view')
               .setDescription('View current server settings and logging toggles')
        )
        .addSubcommand(sub =>
            sub.setName('general')
               .setDescription('Configure general server settings')
               .addStringOption(opt => opt.setName('prefix').setDescription('Command prefix (Default: !)'))
        )
        .addSubcommand(sub =>
            sub.setName('roles')
               .setDescription('Configure server roles')
               .addRoleOption(opt => opt.setName('verified_role').setDescription('Verified member role'))
               .addRoleOption(opt => opt.setName('unverified_role').setDescription('Unverified member role'))
               .addRoleOption(opt => opt.setName('staff_role').setDescription('Staff role'))
               .addRoleOption(opt => opt.setName('moderation_role').setDescription('Moderation role'))
               .addRoleOption(opt => opt.setName('on_break_role').setDescription('On Break staff role'))
        )
        .addSubcommand(sub =>
            sub.setName('channels')
               .setDescription('Configure server channels')
               .addChannelOption(opt => opt.setName('verification_channel').setDescription('Channel for member verification'))
               .addChannelOption(opt => opt.setName('welcome_channel').setDescription('Channel for post-verification welcomes'))
               .addChannelOption(opt => opt.setName('levels_channel').setDescription('Channel for level-ups & XP announcements'))
               .addChannelOption(opt => opt.setName('reports_channel').setDescription('Channel for member reports'))
               .addChannelOption(opt => opt.setName('staff_breaks_channel').setDescription('Channel for staff break logs'))
               .addChannelOption(opt => opt.setName('logs_channel').setDescription('Channel for general server logs'))
               .addChannelOption(opt => opt.setName('logins_logouts_channel').setDescription('Channel for game logins/logouts'))
        )
        .addSubcommand(sub =>
            sub.setName('logs')
               .setDescription('Toggle granular event logging settings')
               // Member Events
               .addBooleanOption(opt => opt.setName('member_kicked').setDescription('Log member kicks'))
               .addBooleanOption(opt => opt.setName('member_banned').setDescription('Log member bans'))
               .addBooleanOption(opt => opt.setName('member_timed_out').setDescription('Log member timeouts'))
               .addBooleanOption(opt => opt.setName('member_joined').setDescription('Log member joins'))
               .addBooleanOption(opt => opt.setName('member_left').setDescription('Log member leaves'))
               .addBooleanOption(opt => opt.setName('member_roles_added').setDescription('Log roles added to member'))
               .addBooleanOption(opt => opt.setName('member_roles_updated').setDescription('Log role updates on member'))
               .addBooleanOption(opt => opt.setName('member_roles_removed').setDescription('Log roles removed from member'))
               // In-Game Events
               .addBooleanOption(opt => opt.setName('player_banned').setDescription('Log in-game player bans'))
               .addBooleanOption(opt => opt.setName('player_kicked').setDescription('Log in-game player kicks'))
               .addBooleanOption(opt => opt.setName('player_vc_banned').setDescription('Log in-game VC mutes/bans'))
               .addBooleanOption(opt => opt.setName('player_logged_in').setDescription('Log in-game logins'))
               .addBooleanOption(opt => opt.setName('player_logged_off').setDescription('Log in-game logouts'))
               // Server Events
               .addBooleanOption(opt => opt.setName('msg_deleted').setDescription('Log deleted messages'))
               .addBooleanOption(opt => opt.setName('msg_edited').setDescription('Log edited messages'))
               .addBooleanOption(opt => opt.setName('msg_bulk_deleted').setDescription('Log bulk message purges'))
               .addBooleanOption(opt => opt.setName('command_used').setDescription('Log bot command usages'))
               .addBooleanOption(opt => opt.setName('channel_name_updated').setDescription('Log channel name changes'))
               .addBooleanOption(opt => opt.setName('channel_perms_updated').setDescription('Log channel permission changes'))
               .addBooleanOption(opt => opt.setName('channel_created').setDescription('Log created channels'))
               .addBooleanOption(opt => opt.setName('channel_deleted').setDescription('Log deleted channels'))
               .addBooleanOption(opt => opt.setName('role_added').setDescription('Log created server roles'))
               .addBooleanOption(opt => opt.setName('role_deleted').setDescription('Log deleted server roles'))
               .addBooleanOption(opt => opt.setName('role_perms_updated').setDescription('Log role permission changes'))
               .addBooleanOption(opt => opt.setName('role_color_updated').setDescription('Log role color updates'))
               .addBooleanOption(opt => opt.setName('role_name_updated').setDescription('Log role name changes'))
               .addBooleanOption(opt => opt.setName('invite_created').setDescription('Log created server invites'))
               .addBooleanOption(opt => opt.setName('invite_deleted').setDescription('Log deleted server invites'))
               .addBooleanOption(opt => opt.setName('invite_used').setDescription('Log member joins via specific invite'))
               .addBooleanOption(opt => opt.setName('emoji_created').setDescription('Log created server emojis'))
               .addBooleanOption(opt => opt.setName('emoji_deleted').setDescription('Log deleted server emojis'))
               .addBooleanOption(opt => opt.setName('emoji_name_updated').setDescription('Log emoji name updates'))
        ),
    
    new SlashCommandBuilder()
        .setName('report')
        .setDescription('Report a community member for Discord server infractions or misconduct')
        .addUserOption(opt => opt.setName('user').setDescription('The Discord member you are reporting').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Select the primary reason').setRequired(true)
            .addChoices(
                { name: 'Harassment / Direct Messages Abuse', value: 'Harassment / Direct Messages Abuse' },
                { name: 'Hate Speech / Discriminatory Language', value: 'Hate Speech / Discriminatory Language' },
                { name: 'Spam / Scam / Phishing Links', value: 'Spam / Scam / Phishing Links' },
                { name: 'Inappropriate Avatar or Profile Text', value: 'Inappropriate Avatar or Profile Text' },
                { name: 'NSFW Content', value: 'NSFW Content' },
                { name: 'Other Community Infraction', value: 'Other Community Infraction' }
            ))
        .addStringOption(opt => opt.setName('details').setDescription('Explain what happened').setRequired(true))
        .addAttachmentOption(opt => opt.setName('proof').setDescription('Attach evidence screenshot').setRequired(false)),

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

function executeCloudScript(functionName, functionParameter = {}, playFabId = null) {
    return new Promise((resolve) => {
        const payload = {
            FunctionName: functionName,
            FunctionParameter: functionParameter,
            GeneratePlayStreamEvent: true
        };
        if (playFabId) payload.PlayFabId = playFabId;

        PlayFabServer.ExecuteCloudScript(payload, (error, result) => {
            if (error || !result?.data?.FunctionResult) {
                console.error(`[CloudScript Error - ${functionName}]:`, error || result?.data?.Error);
                resolve({ success: false, error: error?.errorMessage || 'CloudScript Execution Failed' });
            } else {
                resolve(result.data.FunctionResult);
            }
        });
    });
}

function rewardAeroCoins(playFabId, amount) {
    return new Promise((resolve) => {
        PlayFabServer.SubtractUserVirtualCurrency({
            PlayFabId: playFabId,
            VirtualCurrency: "AC",
            Amount: -amount
        }, (error) => {
            if (error) {
                console.error("[PlayFab AC Grant Error]:", error);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

function fetchPlayFabLeaderboard(statisticName) {
    return new Promise((resolve) => {
        PlayFabServer.GetLeaderboard({
            StatisticName: statisticName,
            StartPosition: 0,
            MaxResultsCount: 10
        }, (error, result) => {
            if (error || !result?.data?.Leaderboard) {
                console.error(`[Leaderboard Fetch Error - ${statisticName}]:`, error);
                resolve([]);
            } else {
                resolve(result.data.Leaderboard);
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

async function sendGuildLog(guild, logType, embed) {
    const config = getGuildConfig(guild.id);
    if (!config.logsChannelId) return;

    if (logType === 'member' && !config.logSettings.memberEvents) return;
    if (logType === 'mod' && !config.logSettings.modActions) return;

    const channel = await guild.channels.fetch(config.logsChannelId).catch(() => null);
    if (channel && channel.isTextBased()) {
        await channel.send({ embeds: [embed] }).catch(() => {});
    }
}

async function checkAndGrantRetroactiveCoins(guildId, userId, playFabId) {
    const key = `${guildId}_${userId}`;
    const userData = userXP.get(key);
    if (!userData || userData.level <= 0) return 0;

    const playerData = await getPlayerData(playFabId);
    const claimedLevel = parseInt(playerData.RetroactiveLevelClaimed?.Value || '0', 10);

    if (userData.level > claimedLevel) {
        const levelsDiff = userData.level - claimedLevel;
        const coinsOwed = levelsDiff * 100;

        const granted = await rewardAeroCoins(playFabId, coinsOwed);
        if (granted) {
            await new Promise((resolve) => {
                PlayFabServer.UpdateUserData({
                    PlayFabId: playFabId,
                    Data: {
                        RetroactiveLevelClaimed: String(userData.level)
                    }
                }, (err) => resolve(!err));
            });
            return coinsOwed;
        }
    }
    return 0;
}

function checkPermission(interaction, requiredType) {
    if (!interaction.guild || !interaction.member) return false;

    const config = getGuildConfig(interaction.guild.id);
    const member = interaction.member;

    if (interaction.guild.ownerId === member.id) return true;

    if (requiredType === 'owner') {
        return interaction.guild.ownerId === member.id;
    }

    if (requiredType === 'mod') {
        if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.BanMembers)) return true;
        if (config.modRoleId && member.roles.cache.has(config.modRoleId)) return true;
        return false;
    }

    if (requiredType === 'staff') {
        if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ModerateMembers)) return true;
        if (config.staffRoleId && member.roles.cache.has(config.staffRoleId)) return true;
        if (config.modRoleId && member.roles.cache.has(config.modRoleId)) return true;
        return false;
    }

    if (requiredType === 'verified') {
        if (!config.verifiedRoleId) return true;
        return member.roles.cache.has(config.verifiedRoleId);
    }

    return false;
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

process.on('unhandledRejection', error => console.error('[Unhandled Rejection]:', error));
process.on('uncaughtException', error => console.error('[Uncaught Exception]:', error));

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const guildId = message.guild.id;
    const userId = message.author.id;
    const key = `${guildId}_${userId}`;

    if (!xpCooldowns.has(key)) {
        xpCooldowns.add(key);
        setTimeout(() => xpCooldowns.delete(key), 15000);

        let userData = await getUserXP(guildId, userId);
        const gainedXP = Math.floor(Math.random() * 11) + 15;
        userData.xp += gainedXP;

        const requiredXP = getXPForLevel(userData.level);

        if (userData.xp >= requiredXP) {
            userData.level += 1;
            userData.xp = 0; // Reset XP on level up
            await saveUserXP(guildId, userId, userData);

            const config = await getGuildConfig(guildId);
            const { user: pfUser } = await getPlayFabUserByDiscordId(userId);

            let rewardNote = "";
            if (pfUser) {
                const granted = await rewardAeroCoins(pfUser.PlayFabId, 100);
                if (granted) rewardNote = "\n💰 **+100 Aero-Coins (AC)** added to your VBR PlayFab account!";
            } else {
                rewardNote = "";
            }
            
            if (userData.level % 10 === 0 && userData.level <= 100) {
                const milestoneRoleName = `Level ${userData.level}`;
                let existingRole = message.guild.roles.cache.find(r => r.name === milestoneRoleName);
                if (!existingRole) {
                    existingRole = await message.guild.roles.create({
                        name: milestoneRoleName,
                        color: '#00D4FF',
                        reason: 'Auto-created VBR milestone level role'
                    }).catch(() => null);
                }
                if (existingRole) {
                    await message.member.roles.add(existingRole).catch(() => {});
                }
            }
            
            if (config.levelsChannelId) {
                const levelsChan = await message.guild.channels.fetch(config.levelsChannelId).catch(() => null);
                if (levelsChan && levelsChan.isTextBased()) {
                    const levelUpEmbed = new EmbedBuilder()
                        .setTitle('🎉 LEVEL UP!')
                        .setDescription(`Congratulations ${message.author}! You reached **Level ${userData.level}**!${rewardNote}`)
                        .setColor('#00FF7F')
                        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                        .setFooter({ text: 'Volleyball Revengers • Leveling System' });

                    await levelsChan.send({ content: `${message.author}`, embeds: [levelUpEmbed] }).catch(() => {});
                }
            }
        } else {
            await saveUserXP(guildId, userId, userData);
        }
    }
    
    const config = await getGuildConfig(guildId);
    const prefix = config.prefix || '!';

    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    if (commandName === 'help' || commandName === 'info') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('🏐 VBR Assistant Coach • Commands Menu')
            .setDescription(`Current prefix: \`${prefix}\` (Change using \`/setup\`)\nUse slash commands (\`/\`) or prefix commands (\`${prefix}\`).`)
            .addFields(
                { name: '👥 Player Commands', value: '`/about`, `/info`, `/level`, `/leaderboard`, `/rewards`, `/account`, `/club`, `/party`, `/friends`, `/is-linked`, `/check-status`, `/online-players`, `/report`' },
                { name: '🛡️ Staff & Moderation', value: '`/ban`, `/ban-player`, `/timeout`, `/mute-player`, `/kick`, `/lookup`, `/staff-break`' },
                { name: '⚙️ Server Management', value: '`/setup`, `/log-settings`, `/msg`' }
            )
            .setColor('#1E90D8');

        await message.reply({ embeds: [helpEmbed] }).catch(() => {});
    }
});
    
client.once('clientReady', () => {
    console.log(`🤖 VBR Assistant Coach online as ${client.user.tag}!`);
});

client.on('guildMemberAdd', async member => {
    const config = getGuildConfig(member.guild.id);
    
    if (config.unverifiedRoleId) {
        await member.roles.add(config.unverifiedRoleId).catch(err => console.error('[Role Add Error]:', err));
    }

    if (config.verificationChannelId) {
        const channel = await member.guild.channels.fetch(config.verificationChannelId).catch(() => null);
        if (channel && channel.isTextBased()) {
            const verifyEmbed = new EmbedBuilder()
                .setTitle('🏐 Welcome to Volleyball Revengers!')
                .setDescription(`Welcome ${member}! Please click the **Verify Account** button below to complete server verification and optional Meta/PlayFab account linking.`)
                .setColor('#00D4FF')
                .setFooter({ text: 'Volleyball Revengers • Verification System' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_member_btn')
                    .setLabel('Verify Account')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );

            await channel.send({ content: `${member}`, embeds: [verifyEmbed], components: [row] }).catch(() => {});
        }
    }

    const logEmbed = new EmbedBuilder()
        .setTitle('📥 Member Joined')
        .setDescription(`${member.user.tag} (\`${member.id}\`) joined the server.`)
        .setColor('#00FF7F')
        .setTimestamp();
    await sendGuildLog(member.guild, 'member', logEmbed);
});

client.on('guildMemberRemove', async member => {
    const logEmbed = new EmbedBuilder()
        .setTitle('📤 Member Left')
        .setDescription(`${member.user.tag} (\`${member.id}\`) left the server.`)
        .setColor('#FF4B4B')
        .setTimestamp();
    await sendGuildLog(member.guild, 'member', logEmbed);
});

client.on('interactionCreate', async interaction => {
    const config = getGuildConfig(interaction.guild?.id || '');

    if (interaction.isButton() && interaction.customId === 'verify_member_btn') {
        const modal = new ModalBuilder()
            .setCustomId('verification_modal')
            .setTitle('VBR Member Verification');

        const usernameInput = new TextInputBuilder()
            .setCustomId('meta_username_input')
            .setLabel('Meta / VBR Username or 6-Digit Code')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter username, 6-digit code, or leave blank to skip')
            .setRequired(false);

        const firstActionRow = new ActionRowBuilder().addComponents(usernameInput);
        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);
        return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'verification_modal') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const enteredUsername = interaction.fields.getTextInputValue('meta_username_input').trim();
        let linkMessage = "";

        if (enteredUsername) {
            if (/^\d{6}$/.test(enteredUsername.replace(/\D/g, ''))) {
                const cleanCode = enteredUsername.replace(/\D/g, '');
                const result = await executeCloudScript("LinkDiscord", {
                    Code: cleanCode,
                    DiscordUserId: String(interaction.user.id),
                    DiscordUsername: String(interaction.user.username)
                });
                if (result.success) {
                    linkMessage = `\n🔗 **Account Linked:** Linked to PlayFab ID \`${result.linkedPlayerId}\`!`;
                } else {
                    linkMessage = `\n⚠️ **Linking Failed:** ${result.message || 'Invalid code.'}`;
                }
            } else {
                linkMessage = `\n📝 **Meta Username Logged:** Saved as \`${enteredUsername}\`.`;
            }
        } else {
            linkMessage = `\n💡 *Account linking skipped. You can link anytime using \`/link <code>\`.*`;
        }

        try {
            if (config.unverifiedRoleId) {
                await interaction.member.roles.remove(config.unverifiedRoleId).catch(() => {});
            }
            if (config.verifiedRoleId) {
                await interaction.member.roles.add(config.verifiedRoleId).catch(() => {});
            }

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Verification Complete!')
                .setDescription(`Welcome to the server, ${interaction.user}! You have been granted full member access.${linkMessage}`)
                .setColor('#00FF7F');

            await interaction.editReply({ embeds: [successEmbed] });

            if (config.welcomeChannelId) {
                const welcomeChan = await interaction.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
                if (welcomeChan && welcomeChan.isTextBased()) {
                    const welcomeEmbed = new EmbedBuilder()
                        .setTitle(`🏐 Welcome to Volleyball Revengers, ${interaction.user.username}!`)
                        .setDescription(`Hey ${interaction.user}! Welcome to the official server. Jump into chat, earn XP to level up, and climb the Leaderboards!`)
                        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                        .setColor('#00D4FF')
                        .setTimestamp();

                    await welcomeChan.send({ content: `🎉 Welcome ${interaction.user}!`, embeds: [welcomeEmbed] }).catch(() => {});
                }
            }

        } catch (err) {
            console.error('[Verification Execution Error]:', err);
            await interaction.editReply({ content: '❌ Failed to update roles. Please inform a server moderator.' });
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(() => {});

    const { commandName } = interaction;
    const config = getGuildConfig(interaction.guild?.id || '');
    
    try {
        if (commandName === 'about') {
            if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }

            const aboutEmbed = new EmbedBuilder()
                .setTitle('🏐 About Volleyball Revengers')
                .setDescription('**Volleyball Revengers** is an immersive VR Volleyball title developed in Unity.\n\n⚠️ **Development Status Update:** Currently, active game feature updates are on pause to allow @lizardyness to focus on advancing **3D Modeling & Animation** skills. Development will resume stronger soon!')
                .setColor('#FF9900')

            return await interaction.editReply({ embeds: [aboutEmbed] });
        }

        else if (commandName === 'info') {
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }

            const infoEmbed = new EmbedBuilder()
                .setTitle('🏐 VBR Assistant Coach • Slash Command Directory')
                .setDescription(`The server prefix is set to \`${config.prefix}\`. Below is the complete catalog of commands:`)
                .addFields(
                    { name: '👥 Public & Levels', value: '• `/about` — Game overview\n• `/info` — Slash directory\n• `/level` — Check server rank card\n• `/leaderboard` — View Top 10 leaderboards\n• `/rewards` — Locker Room perks\n• `/link <code>` — Link Discord to PlayFab' },
                    { name: '🎉 Social & Competitive', value: '• `/club` — Club hub & invites\n• `/party` — Party hub & invites\n• `/friends` — Friend requests & roster\n• `/online-players` — Live online counter' },
                )
                .setColor('#00D4FF');

            return await interaction.editReply({ embeds: [infoEmbed] });
        }
        
        else if (commandName === 'website') {
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
            return await interaction.editReply({ content: '🌐 **Official VBR Website:** https://fpzard-eng.github.io/Volleyball-Revengers/home' });
        }

         else if (commandName === 'level') {
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }

            const key = `${interaction.guild.id}_${interaction.user.id}`;
            const data = userXP.get(key) || { xp: 0, level: 0 };
            const neededXP = getXPForLevel(data.level);

            const serverEntries = [];
            userXP.forEach((val, k) => {
                const [gId, uId] = k.split('_');
                if (gId === interaction.guild.id) {
                    serverEntries.push({ userId: uId, ...val });
                }
            });

            serverEntries.sort((a, b) => b.level !== a.level ? b.level - a.level : b.xp - a.xp);
            const userRankPos = serverEntries.findIndex(e => e.userId === interaction.user.id);
            const formattedRank = userRankPos !== -1 ? `#${userRankPos + 1}` : 'Unranked';

            const levelCardEmbed = new EmbedBuilder()
                .setTitle(`🎴 Profile Card: ${interaction.user.username}`)
                .setColor('#00D4FF')
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 Username', value: `**${interaction.user.username}**`, inline: true },
                    { name: '🏅 Server Rank', value: `\`${formattedRank}\``, inline: true },
                    { name: '⭐ Level', value: `\`Level ${data.level}\``, inline: true },
                    { name: '✨ Experience (XP)', value: `\`${data.xp} / ${neededXP} XP\``, inline: false }
                )
                .setFooter({ text: 'Volleyball Revengers • Player Level System' });

            return await interaction.editReply({ embeds: [levelCardEmbed] });
        }

        else if (commandName === 'leaderboard') {
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }

            const boardType = interaction.options.getString('type');
            let leaderboardText = "";

            if (boardType === 'Level') {
                const serverEntries = [];
                userXP.forEach((val, k) => {
                    const [gId, uId] = k.split('_');
                    if (gId === interaction.guild.id) {
                        serverEntries.push({ userId: uId, ...val });
                    }
                });

                serverEntries.sort((a, b) => b.level !== a.level ? b.level - a.level : b.xp - a.xp);
                const top10 = serverEntries.slice(0, 10);

                if (top10.length === 0) {
                    leaderboardText = "*No level data recorded yet. Start chatting in the server!*";
                } else {
                    top10.forEach((e, idx) => {
                        const crown = idx === 0 ? "👑 **#1 (In-Game XP Boost)** " : `**#${idx + 1}** `;
                        leaderboardText += `${crown}<@${e.userId}> — Level${e.level} (\`${e.xp} XP\`)\n`;
                    });
                }
            } else {
                const entries = await fetchPlayFabLeaderboard(boardType);

                if (entries.length === 0) {
                    leaderboardText = `*No records found for ${boardType} leaderboard.*`;
                } else {
                    entries.forEach((entry, idx) => {
                        const crown = idx === 0 ? "👑 **#1** " : `**#${idx + 1}** `;
                        const displayName = entry.DisplayName || entry.PlayFabId;
                        leaderboardText += `${crown}**${displayName}** — \`${entry.StatValue}\` ${boardType}\n`;
                    });
                }
            }

            const lbEmbed = new EmbedBuilder()
                .setTitle(`🏆 Top 10 Leaderboard: ${boardType}`)
                .setDescription(leaderboardText)
                .setColor('#FFD700')
                .setFooter({ text: 'Volleyball Revengers • Official Leaderboards' });

            return await interaction.editReply({ embeds: [lbEmbed] });
        }

        else if (commandName === 'rewards') {
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
            const rewardsEmbed = new EmbedBuilder()
                .setTitle('🏆 Locker Room | Official Level Rewards')
                .setDescription(
                    '**Level 10 Perks:** None. You just look cool!\n\n' +
                    '**Level 20 Perks:** Grants Image & Reaction permissions.\n\n' +
                    '**Level 30 Perks:** Grants a greater chance of being selected to become a part of the Support Team. Support Team members have a chance of being promoted to moderator.\n\n' +
                    '**Level 40 Perks:** Grants a greater chance of being selected to become a part of the Testing Squad.\n\n' +
                    '**Level 50 Perks:** Grants a greater chance of being selected to become a part of the Moderation Team & you get 1k Aero-Coins.\n\n' +
                    '**Level 60 Perks:** *Coming Soon*\n\n' +
                    '**Level 70 Perks:** *Coming Soon*\n\n' +
                    '**Level 80 Perks:** *Coming Soon*\n\n' +
                    '**Level 90 Perks:** *Coming Soon*\n\n' +
                    '**Level 100 Perks:** *Coming Soon*'
                )
                .setColor('#1E90D8')
                .setFooter({ text: 'Volleyball Revengers • Level Rewards' });

            return await interaction.editReply({ embeds: [rewardsEmbed] });
        }

      else if (commandName === 'link') {
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
            const rawCode = interaction.options.getString('code');
            const cleanCode = rawCode.replace(/\D/g, '');

            if (cleanCode.length !== 6) {
                return await interaction.editReply({
                    content: '❌ Invalid format! Provide a 6-digit code (e.g. `294-617`).'
                });
            }

            const result = await executeCloudScript("LinkDiscord", {
                Code: cleanCode,
                DiscordUserId: String(interaction.user.id),
                DiscordUsername: String(interaction.user.username)
            });

            let retroactiveNote = "";
            if (result.success) {
                const coinsGranted = await checkAndGrantRetroactiveCoins(interaction.guild.id, interaction.user.id, result.linkedPlayerId);
                if (coinsGranted > 0) {
                    retroactiveNote = `\n💰 **Retroactive Bonus:** You received **+${coinsGranted} Aero-Coins** for your unlinked level progress!`;
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(result.success ? '🎉 Account Linked!' : '❌ Link Failed')
                .setDescription(result.success 
                    ? `Linked **${interaction.user.username}** to PlayFab ID \`${result.linkedPlayerId}\`.${retroactiveNote}`
                    : (result.message || 'The code is invalid or expired.'))
                .setColor(result.success ? '#00FF7F' : '#FF4B4B')
                .setFooter({ text: 'Volleyball Revengers • Profile Linker' });

            if (result.success && config.verifiedRoleId) {
                await interaction.member.roles.add(config.verifiedRoleId).catch(() => {});
                if (config.unverifiedRoleId) await interaction.member.roles.remove(config.unverifiedRoleId).catch(() => {});
            }

            await interaction.editReply({ embeds: [embed] });
        }

        else if (commandName === 'is-linked') {
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
            const targetDiscordUser = interaction.options.getUser('target') || interaction.user;
            const isSelf = targetDiscordUser.id === interaction.user.id;

            const { user } = await getPlayFabUserByDiscordId(targetDiscordUser.id);

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
        
        else if (commandName === 'check-status') {
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
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
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
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
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
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
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
            const targetDiscordUser = interaction.options.getUser('target') || interaction.user;
            const user = await enforceAccountLink(interaction, targetDiscordUser);
            if (!user) return;

            const [userData, inbox] = await Promise.all([
                getPlayerData(user.PlayFabId),
                executeCloudScript("getInboxData", {}, user.PlayFabId)
            ]);

            const partyStatus = userData.ActivePartyId?.Value ? `In Party (\`${userData.ActivePartyId.Value}\`)` : 'Not in a Party';
            const partyInvites = Array.isArray(inbox) 
                ? inbox.filter(item => item.Type === 1).map(inv => `From **${inv.SenderDisplayName}** (ID: \`${inv.PayloadId}\`)`) 
                : [];

            const partyEmbed = new EmbedBuilder()
                .setTitle(`🎉 Party Hub: ${user.TitleInfo?.DisplayName || targetDiscordUser.username}`)
                .setColor('#FF007F')
                .addFields(
                    { name: '👥 Party Status', value: `**${partyStatus}**`, inline: false },
                    { name: '📩 Pending Party Invites', value: partyInvites.length > 0 ? partyInvites.join('\n') : 'None', inline: false }
                )
                .setFooter({ text: 'Volleyball Revengers • Party Hub' });

            await interaction.editReply({ embeds: [partyEmbed] });
        }

        else if (commandName === 'friends') {
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
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
        
        else if (commandName === 'club-info') {
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
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
        
        else if (commandName === 'nt-info') {
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
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
        
        else if (commandName === 'online-players') {
             if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
            const cloudResult = await executeCloudScript("getGlobalOnlinePlayerCount");
            const count = cloudResult.success ? (cloudResult.onlineCount || 0) : 0;

            const onlineEmbed = new EmbedBuilder()
                .setTitle('🌐 Online Players')
                .setColor('#00D4FF')
                .setDescription(`There are currently **${count}** player${count === 1 ? '' : 's'} online in **Volleyball Revengers**!`)
                .setFooter({ text: 'Volleyball Revengers • Live Server Monitor' })
                .setTimestamp();

            await interaction.editReply({ embeds: [onlineEmbed] });
        }

        else if (commandName === 'ban') {
            if (!checkPermission(interaction, 'mod')) {
                return await interaction.editReply({ content: '❌ You require Moderation permissions to use this command.' });
            }

            const targetUser = interaction.options.getUser('user');
            const duration = interaction.options.getString('duration');
            const reason = interaction.options.getString('reason');

            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (member) {
                await member.ban({ reason: `[${duration}]${reason}` });
            }

            const banEmbed = new EmbedBuilder()
                .setTitle('🔨 User Banned')
                .setColor('#FF4B4B')
                .addFields(
                    { name: 'User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                    { name: 'Duration', value: duration, inline: true },
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Moderator', value: `${interaction.user}`, inline: true }
                );

            await sendGuildLog(interaction.guild, 'mod', banEmbed);
            return await interaction.editReply({ embeds: [banEmbed] });
        }

        else if (commandName === 'ban-player') {
            if (!checkPermission(interaction, 'mod')) {
                return await interaction.editReply({ content: '❌ You require Moderation permissions to use this command.' });
            }
            
            const playerInput = interaction.options.getString('player');
            const durationHours = parseInt(interaction.options.getString('duration'), 10) || 24;
            const reason = interaction.options.getString('reason');

            let targetPlayFabId = playerInput;
            if (playerInput.startsWith('<@') && playerInput.endsWith('>')) {
                const cleanId = playerInput.replace(/[<@!>]/g, '');
                const { user } = await getPlayFabUserByDiscordId(cleanId);
                if (user) targetPlayFabId = user.PlayFabId;
            }

            const banResult = await new Promise((resolve) => {
                PlayFabServer.BanUsers({
                    Bans: [{
                        PlayFabId: targetPlayFabId,
                        DurationInHours: durationHours,
                        Reason: reason
                    }]
                }, (err, res) => {
                    if (err || !res?.data) resolve({ success: false, error: err?.errorMessage || 'Ban failed' });
                    else resolve({ success: true, banId: res.data.BanData?.[0]?.BanId });
                });
            });

            const gameBanEmbed = new EmbedBuilder()
                .setTitle(banResult.success ? '🚫 In-Game Player Banned' : '❌ Ban Failed')
                .setColor(banResult.success ? '#FF4B4B' : '#808080')
                .addFields(
                    { name: 'PlayFab ID', value: `\`${targetPlayFabId}\``, inline: true },
                    { name: 'Duration', value: `${durationHours} Hours`, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                );

            if (banResult.success) await sendGuildLog(interaction.guild, 'mod', gameBanEmbed);
            return await interaction.editReply({ embeds: [gameBanEmbed] });
        }

        else if (commandName === 'timeout') {
            if (!checkPermission(interaction, 'staff')) {
                return await interaction.editReply({ content: '❌ You must be a Staff member to use this command.' });
            }

            const targetUser = interaction.options.getUser('user');
            const minutes = parseInt(interaction.options.getString('duration'), 10) || 10;
            const reason = interaction.options.getString('reason');

            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                return await interaction.editReply({ content: '❌ User not found in this server.' });
            }

            await member.timeout(minutes * 60 * 1000, reason);

            const timeoutEmbed = new EmbedBuilder()
                .setTitle('⏳ User Timed Out')
                .setColor('#FF9900')
                .addFields(
                    { name: 'User', value: `${targetUser.tag}`, inline: true },
                    { name: 'Duration', value: `${minutes} Minutes`, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                );

            await sendGuildLog(interaction.guild, 'mod', timeoutEmbed);
            return await interaction.editReply({ embeds: [timeoutEmbed] });
        }

        else if (commandName === 'mute-player') {
            if (!checkPermission(interaction, 'staff')) {
                return await interaction.editReply({ content: '❌ You must be a Staff member to use this command.' });
            }

            const playerInput = interaction.options.getString('player');
            const duration = interaction.options.getString('duration');
            const reason = interaction.options.getString('reason');

            let targetPlayFabId = playerInput;
            if (playerInput.startsWith('<@') && playerInput.endsWith('>')) {
                const cleanId = playerInput.replace(/[<@!>]/g, '');
                const { user } = await getPlayFabUserByDiscordId(cleanId);
                if (user) targetPlayFabId = user.PlayFabId;
            }

            await executeCloudScript('blockPlayerSignal', { TargetId: targetPlayFabId });

            const muteEmbed = new EmbedBuilder()
                .setTitle('🎙️ In-Game Voice Chat Muted')
                .setColor('#FF9900')
                .addFields(
                    { name: 'Target Player', value: `\`${targetPlayFabId}\``, inline: true },
                    { name: 'Duration', value: duration, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                );

            await sendGuildLog(interaction.guild, 'mod', muteEmbed);
            return await interaction.editReply({ embeds: [muteEmbed] });
        }

        else if (commandName === 'kick') {
           if (!checkPermission(interaction, 'staff')) {
                return await interaction.editReply({ content: '❌ You must be a Staff member to use this command.' });
            }
            
            const targetUser = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');

            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                return await interaction.editReply({ content: '❌ User not found in this server.' });
            }

            await member.kick(reason);

            const kickEmbed = new EmbedBuilder()
                .setTitle('👢 User Kicked')
                .setColor('#FF9900')
                .addFields(
                    { name: 'User', value: `${targetUser.tag}`, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                );

            await sendGuildLog(interaction.guild, 'mod', kickEmbed);
            return await interaction.editReply({ embeds: [kickEmbed] });
        }

        else if (commandName === 'lookup') {
            const playerInput = interaction.options.getString('player').replace(/[<@!>]/g, '');

            let pfUser = null;
            if (/^\d{17,19}$/.test(playerInput)) {
                const res = await getPlayFabUserByDiscordId(playerInput);
                pfUser = res.user;
            }

            if (!pfUser) {
                pfUser = await new Promise((resolve) => {
                    PlayFabServer.GetUserAccountInfo({ PlayFabId: playerInput }, (err, res) => {
                        if (!err && res?.data?.UserInfo) resolve(res.data.UserInfo);
                        else {
                            PlayFabServer.GetUserAccountInfo({ TitleDisplayName: playerInput }, (err2, res2) => {
                                if (!err2 && res2?.data?.UserInfo) resolve(res2.data.UserInfo);
                                else resolve(null);
                            });
                        }
                    });
                });
            }

            if (!pfUser) {
                return await interaction.editReply({ content: '❌ No matching player profile found in PlayFab.' });
            }

            const [stats, userData] = await Promise.all([
                getPlayerStats(pfUser.PlayFabId),
                getPlayerData(pfUser.PlayFabId)
            ]);

            const lookupEmbed = new EmbedBuilder()
                .setTitle(`🔍 Player Lookup: ${pfUser.TitleInfo?.DisplayName || 'Unknown'}`)
                .setColor('#00D4FF')
                .addFields(
                    { name: 'PlayFab ID', value: `\`${pfUser.PlayFabId}\``, inline: true },
                    { name: 'Created', value: `<t:${Math.floor(new Date(pfUser.Created).getTime() / 1000)}:R>`, inline: true },
                    { name: 'Linked Discord ID', value: userData.DiscordUserId?.Value ? `<@${userData.DiscordUserId.Value}> (\`${userData.DiscordUserId.Value}\`)` : '*Unlinked*', inline: false },
                    { name: 'ELO Rating', value: `${stats.PlayerElo ?? 0}`, inline: true },
                    { name: 'Total Matches', value: `${stats.MatchesPlayed ?? 0}`, inline: true }
                );

            return await interaction.editReply({ embeds: [lookupEmbed] });
        }

        else if (commandName === 'staff-break') {
            if (!checkPermission(interaction, 'staff')) {
                return await interaction.editReply({ content: '❌ You must be a Staff member to use this command.' });
            }

            const duration = interaction.options.getString('duration');
            const reason = interaction.options.getString('reason');

            if (config.onBreakRoleId) {
                await interaction.member.roles.add(config.onBreakRoleId).catch(() => {});
            }

            const breakEmbed = new EmbedBuilder()
                .setTitle('🏖️ Staff Member On Break')
                .setColor('#FF9900')
                .setDescription(`${interaction.user} has officially gone on break.`)
                .addFields(
                    { name: 'Duration', value: duration, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                )
                .setTimestamp();

            if (config.staffBreaksChannelId) {
                const breakChannel = await interaction.guild.channels.fetch(config.staffBreaksChannelId).catch(() => null);
                if (breakChannel && breakChannel.isTextBased()) {
                    await breakChannel.send({ embeds: [breakEmbed] });
                }
            }

            return await interaction.editReply({ content: '✅ Your break status has been logged and role applied.' });
        }
        
        else if (commandName === 'settings') {
            if (!checkPermission(interaction, 'owner')) {
                return await interaction.editReply({ content: '❌ Only the Server Owner can manage server settings.' });
            }

            const config = await getGuildConfig(interaction.guild.id);
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'general') {
                const prefixOpt = interaction.options.getString('prefix');
                if (prefixOpt) config.prefix = prefixOpt;
                await saveGuildConfig(interaction.guild.id, config);
                return await interaction.editReply({ content: `✅ General settings updated! Prefix set to \`${config.prefix}\`` });
            }

            if (subcommand === 'roles') {
                const verified = interaction.options.getRole('verified_role');
                const unverified = interaction.options.getRole('unverified_role');
                const staff = interaction.options.getRole('staff_role');
                const mod = interaction.options.getRole('moderation_role');
                const onBreak = interaction.options.getRole('on_break_role');

                if (verified) config.verifiedRoleId = verified.id;
                if (unverified) config.unverifiedRoleId = unverified.id;
                if (staff) config.staffRoleId = staff.id;
                if (mod) config.modRoleId = mod.id;
                if (onBreak) config.onBreakRoleId = onBreak.id;

                await saveGuildConfig(interaction.guild.id, config);
                return await interaction.editReply({ content: '✅ Role configurations successfully updated and saved!' });
            }

            if (subcommand === 'channels') {
                const verifyChan = interaction.options.getChannel('verification_channel');
                const welcomeChan = interaction.options.getChannel('welcome_channel');
                const levelsChan = interaction.options.getChannel('levels_channel');
                const reportsChan = interaction.options.getChannel('reports_channel');
                const staffBreaksChan = interaction.options.getChannel('staff_breaks_channel');
                const logsChan = interaction.options.getChannel('logs_channel');
                const loginsChan = interaction.options.getChannel('logins_logouts_channel');

                if (verifyChan) config.verificationChannelId = verifyChan.id;
                if (welcomeChan) config.welcomeChannelId = welcomeChan.id;
                if (levelsChan) config.levelsChannelId = levelsChan.id;
                if (reportsChan) config.reportsChannelId = reportsChan.id;
                if (staffBreaksChan) config.staffBreaksChannelId = staffBreaksChan.id;
                if (logsChan) config.logsChannelId = logsChan.id;
                if (loginsChan) config.loginsLogoutsChannelId = loginsChan.id;

                await saveGuildConfig(interaction.guild.id, config);
                return await interaction.editReply({ content: '✅ Channel configurations successfully updated and saved!' });
            }

            if (subcommand === 'logs') {
                const logKeys = [
                    'member_kicked', 'member_banned', 'member_timed_out', 'member_joined', 'member_left',
                    'member_roles_added', 'member_roles_updated', 'member_roles_removed',
                    'player_banned', 'player_kicked', 'player_vc_banned', 'player_logged_in', 'player_logged_off',
                    'msg_deleted', 'msg_edited', 'msg_bulk_deleted', 'command_used', 'channel_name_updated',
                    'channel_perms_updated', 'channel_created', 'channel_deleted', 'role_added', 'role_deleted',
                    'role_perms_updated', 'role_color_updated', 'role_name_updated', 'invite_created',
                    'invite_deleted', 'invite_used', 'emoji_created', 'emoji_deleted', 'emoji_name_updated'
                ];

                logKeys.forEach(optKey => {
                    const val = interaction.options.getBoolean(optKey);
                    if (val !== null) {
                        const camelKey = optKey.replace(/_([a-z])/g, g => g[1].toUpperCase());
                        config.logSettings[camelKey] = val;
                    }
                });

                await saveGuildConfig(interaction.guild.id, config);
                return await interaction.editReply({ content: '✅ Logging preferences successfully updated and saved!' });
            }

            if (subcommand === 'view') {
                const fmtBool = (b) => b ? '✅' : '❌';

                const settingsEmbed = new EmbedBuilder()
                    .setTitle('⚙️ Server Settings & Event Logging')
                    .setColor('#00FF7F')
                    .addFields(
                        { 
                            name: '🌐 General', 
                            value: `• **Prefix:** \`${config.prefix}\``, 
                            inline: false 
                        },
                        { 
                            name: '🛡️ Moderation', 
                            value: `• **Staff Role:** ${config.staffRoleId ? `<@&${config.staffRoleId}>` : 'Not Set'}\n• **Mod Role:** ${config.modRoleId ? `<@&${config.modRoleId}>` : 'Not Set'}\n• **On-Break Role:** ${config.onBreakRoleId ? `<@&${config.onBreakRoleId}>` : 'Not Set'}\n• **Reports Channel:** ${config.reportsChannelId ? `<#${config.reportsChannelId}>` : 'Not Set'}`, 
                            inline: false 
                        },
                        { 
                            name: '✅ Verification & Welcome', 
                            value: `• **Verified Role:** ${config.verifiedRoleId ? `<@&${config.verifiedRoleId}>` : 'Not Set'}\n• **Unverified Role:** ${config.unverifiedRoleId ? `<@&${config.unverifiedRoleId}>` : 'Not Set'}\n• **Verification Channel:** ${config.verificationChannelId ? `<#${config.verificationChannelId}>` : 'Not Set'}\n• **Welcome Channel:** ${config.welcomeChannelId ? `<#${config.welcomeChannelId}>` : 'Not Set'}\n• **Levels Channel:** ${config.levelsChannelId ? `<#${config.levelsChannelId}>` : 'Not Set'}`, 
                            inline: false 
                        },
                        { 
                            name: '📥 Member Event Logs', 
                            value: `Kicked: ${fmtBool(config.logSettings.memberKicked)} | Banned: ${fmtBool(config.logSettings.memberBanned)} | Timed Out: ${fmtBool(config.logSettings.memberTimedOut)}\nJoined: ${fmtBool(config.logSettings.memberJoined)} | Left: ${fmtBool(config.logSettings.memberLeft)}\nRoles Added: ${fmtBool(config.logSettings.memberRolesAdded)} | Roles Updated: ${fmtBool(config.logSettings.memberRolesUpdated)} | Roles Removed: ${fmtBool(config.logSettings.memberRolesRemoved)}`, 
                            inline: false 
                        },
                        { 
                            name: '🎮 In-Game Event Logs', 
                            value: `Player Banned: ${fmtBool(config.logSettings.playerBanned)} | Player Kicked: ${fmtBool(config.logSettings.playerKicked)} | VC Banned: ${fmtBool(config.logSettings.playerVcBanned)}\nLogged In: ${fmtBool(config.logSettings.playerLoggedIn)} | Logged Off: ${fmtBool(config.logSettings.playerLoggedOff)}`, 
                            inline: false 
                        },
                        { 
                            name: '🛠️ Server Event Logs', 
                            value: `Msg Deleted: ${fmtBool(config.logSettings.msgDeleted)} | Msg Edited: ${fmtBool(config.logSettings.msgEdited)} | Bulk Deleted: ${fmtBool(config.logSettings.msgBulkDeleted)}\nCommand Used: ${fmtBool(config.logSettings.commandUsed)} | Channel Name: ${fmtBool(config.logSettings.channelNameUpdated)} | Channel Perms: ${fmtBool(config.logSettings.channelPermsUpdated)}\nChannel Created: ${fmtBool(config.logSettings.channelCreated)} | Channel Deleted: ${fmtBool(config.logSettings.channelDeleted)}\nRole Added: ${fmtBool(config.logSettings.roleAdded)} | Role Deleted: ${fmtBool(config.logSettings.roleDeleted)} | Role Perms: ${fmtBool(config.logSettings.rolePermsUpdated)}\nRole Color: ${fmtBool(config.logSettings.roleColorUpdated)} | Role Name: ${fmtBool(config.logSettings.roleNameUpdated)}\nInvite Created: ${fmtBool(config.logSettings.inviteCreated)} | Invite Deleted: ${fmtBool(config.logSettings.inviteDeleted)} | Invite Used: ${fmtBool(config.logSettings.inviteUsed)}\nEmoji Created: ${fmtBool(config.logSettings.emojiCreated)} | Emoji Deleted: ${fmtBool(config.logSettings.emojiDeleted)} | Emoji Name: ${fmtBool(config.logSettings.emojiNameUpdated)}`, 
                            inline: false 
                        }
                    )
                    .setFooter({ text: 'Volleyball Revengers • Server Settings' })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [settingsEmbed] });
            }
        }
        
        else if (commandName === 'report') {
            if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ You must be Verified to use this command.' });
            }
            
            const targetUser = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');
            const details = interaction.options.getString('details');
            const proofAttachment = interaction.options.getAttachment('proof');

            if (targetUser.id === interaction.user.id) {
                return await interaction.editReply({ content: '❌ You cannot file a report against yourself.' });
            }

            const staffChannelId = config.reportsChannelId || process.env.DISCORD_STAFF_CHANNEL_ID;
            const modRoleId = config.modRoleId || process.env.DISCORD_MOD_ROLE_ID;

            if (!staffChannelId) {
                return await interaction.editReply({ content: '❌ Configuration error: Reports channel is not configured.' });
            }

            const staffChannel = await client.channels.fetch(staffChannelId).catch(() => null);
            if (!staffChannel || !staffChannel.isTextBased()) {
                return await interaction.editReply({ content: '❌ Unable to find or access the designated Reports Channel.' });
            }

            const reportEmbed = new EmbedBuilder()
                .setTitle('🛡️ NEW COMMUNITY REPORT')
                .setColor('#FF9900')
                .addFields(
                    { name: '👤 Reported Member', value: `${targetUser} (\`${targetUser.id}\`)`, inline: false },
                    { name: '⚠️ Violation Category', value: `\`${reason}\``, inline: true },
                    { name: '📩 Filed By', value: `${interaction.user}`, inline: true },
                    { name: '📝 Details', value: details, inline: false }
                )
                .setFooter({ text: `Volleyball Revengers • Case ID: ${interaction.id}` })
                .setTimestamp();

            if (proofAttachment?.contentType?.startsWith('image/')) {
                reportEmbed.setImage(proofAttachment.url);
            }

            const pingMention = modRoleId ? `<@&${modRoleId}>` : '**@Moderation Team**';
            await staffChannel.send({ content: `🛡️ ${pingMention} - New Report Received!`, embeds: [reportEmbed] });

            return await interaction.editReply({ content: '✅ Report successfully dispatched to moderation team.' });
        }
 
        else if (commandName === 'msg') {
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

else {
    console.warn(
        `[Command Handler Missing] /${commandName} was registered but has no handler.`
    );

    return await interaction.editReply({
        content: `⚠️ The /${commandName} command is registered, but its functionality is not implemented in this bot version yet.`
    });
}
    } catch (cmdErr) {
        console.error(`[Command Error] ${commandName}:`, cmdErr);
        await interaction.editReply({ content: 'An unexpected error occurred while executing this command.' }).catch(() => {});
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
