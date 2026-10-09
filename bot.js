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
    TextInputStyle
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

// ===================================================================
// Guild Configurations & In-Memory XP State
// ===================================================================
const guildSettings = new Map();
const userXP = new Map(); // Key: "guildId_userId" -> { xp: number, level: number }
const xpCooldowns = new Set(); // Stores user IDs on 15s XP cooldown

function getGuildConfig(guildId) {
    if (!guildSettings.has(guildId)) {
        guildSettings.set(guildId, {
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
                dailySummary: true,
                memberEvents: true,
                modActions: true
            }
        });
    }
    return guildSettings.get(guildId);
}

function getXPForLevel(level) {
    return 5 * (level ** 2) + (50 * level) + 100;
}

// ===================================================================
// Webhook & Heartbeat Server
// ===================================================================
const PORT = process.env.PORT || 10000;
http.createServer(async (req, res) => {
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
                    return res.end(JSON.stringify({ success: false, error: 'Missing parameters.' }));
                }

                const targetUser = await client.users.fetch(discordId).catch(() => null);
                if (!targetUser) {
                    res.writeHead(404, { ...headers, 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, error: 'User not found.' }));
                }

                await targetUser.send(message);
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true }));
            } catch (err) {
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
        requester.get(renderAppUrl, () => {}).on('error', () => {});
    }
}, 300000);

// ===================================================================
// Slash Commands Definition
// ===================================================================
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
        .setName('log-settings')
        .setDescription('Toggle daily log summaries and log channel preferences')
        .addBooleanOption(opt => opt.setName('daily_summary').setDescription('Toggle daily summary').setRequired(false))
        .addBooleanOption(opt => opt.setName('member_events').setDescription('Toggle member joins/leaves logging').setRequired(false))
        .addBooleanOption(opt => opt.setName('mod_actions').setDescription('Toggle moderation actions logging').setRequired(false)),
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure server roles, channels, and command prefix')
        .addStringOption(opt => opt.setName('prefix').setDescription('Command prefix (Default: !)'))
        .addRoleOption(opt => opt.setName('verified_role').setDescription('Verified member role'))
        .addRoleOption(opt => opt.setName('unverified_role').setDescription('Unverified member role'))
        .addRoleOption(opt => opt.setName('staff_role').setDescription('Staff role'))
        .addRoleOption(opt => opt.setName('moderation_role').setDescription('Moderation role'))
        .addRoleOption(opt => opt.setName('on_break_role').setDescription('On Break staff role'))
        .addChannelOption(opt => opt.setName('verification_channel').setDescription('Channel for member verification'))
        .addChannelOption(opt => opt.setName('welcome_channel').setDescription('Channel for post-verification welcomes'))
        .addChannelOption(opt => opt.setName('levels_channel').setDescription('Channel for level-ups & XP announcements'))
        .addChannelOption(opt => opt.setName('reports_channel').setDescription('Channel for member reports'))
        .addChannelOption(opt => opt.setName('staff_breaks_channel').setDescription('Channel for staff break logs'))
        .addChannelOption(opt => opt.setName('logs_channel').setDescription('Channel for general server logs'))
        .addChannelOption(opt => opt.setName('logins_logouts_channel').setDescription('Channel for game logins/logouts')),
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

// ===================================================================
// PlayFab Helpers & Safe Async Invokers
// ===================================================================
function executeCloudScript(functionName, functionParameter = {}, playFabId = null) {
    return new Promise((resolve) => {
        const payload = { FunctionName: functionName, FunctionParameter: functionParameter, GeneratePlayStreamEvent: true };
        if (playFabId) payload.PlayFabId = playFabId;

        PlayFabServer.ExecuteCloudScript(payload, (error, result) => {
            if (error || !result?.data?.FunctionResult) {
                resolve({ success: false, error: error?.errorMessage || 'CloudScript Failed' });
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
        }, (error) => resolve(!error));
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
            PlayFabServer.GetTitleInternalData({ Keys: [`DiscordUserMap_${cleanDiscordId}`] }, (error, result) => {
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
    if (channel?.isTextBased()) {
        await channel.send({ embeds: [embed] }).catch(() => {});
    }
}

function checkPermission(interaction, requiredType) {
    const config = getGuildConfig(interaction.guild.id);
    const member = interaction.member;

    if (interaction.guild.ownerId === member.id) return true;

    if (requiredType === 'owner') return interaction.guild.ownerId === member.id;

    if (requiredType === 'mod') {
        if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.BanMembers)) return true;
        return Boolean(config.modRoleId && member.roles.cache.has(config.modRoleId));
    }

    if (requiredType === 'staff') {
        if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ModerateMembers)) return true;
        return Boolean((config.staffRoleId && member.roles.cache.has(config.staffRoleId)) || (config.modRoleId && member.roles.cache.has(config.modRoleId)));
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

// ===================================================================
// Typing Listener & Leveling System
// ===================================================================
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const key = `${message.guild.id}_${message.author.id}`;
    if (xpCooldowns.has(key)) return;

    xpCooldowns.add(key);
    setTimeout(() => xpCooldowns.delete(key), 15000);

    let userData = userXP.get(key) || { xp: 0, level: 0 };
    userData.xp += Math.floor(Math.random() * 11) + 15;

    const nextLevelXP = getXPForLevel(userData.level);

    if (userData.xp >= nextLevelXP) {
        userData.level += 1;
        userXP.set(key, userData);

        const config = getGuildConfig(message.guild.id);
        const { user: pfUser } = await getPlayFabUserByDiscordId(message.author.id);

        let rewardNote = pfUser 
            ? (await rewardAeroCoins(pfUser.PlayFabId, 100) ? "\n💰 **+100 Aero-Coins (AC)** added to your PlayFab account!" : "") 
            : "\n💡 *Link your PlayFab account using `/link <code>` to earn Aero-Coins on level-up!*";

        if (userData.level % 10 === 0 && userData.level <= 100) {
            const role = message.guild.roles.cache.find(r => r.name === `Level ${userData.level}`);
            if (role) await message.member.roles.add(role).catch(() => {});
        }

        if (config.levelsChannelId) {
            const levelsChan = await message.guild.channels.fetch(config.levelsChannelId).catch(() => null);
            if (levelsChan?.isTextBased()) {
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
        userXP.set(key, userData);
    }
});

client.once('clientReady', () => {
    console.log(`🤖 VBR Assistant Coach online as ${client.user.tag}!`);
});

client.on('guildMemberAdd', async member => {
    const config = getGuildConfig(member.guild.id);
    if (config.unverifiedRoleId) await member.roles.add(config.unverifiedRoleId).catch(() => {});

    if (config.verificationChannelId) {
        const channel = await member.guild.channels.fetch(config.verificationChannelId).catch(() => null);
        if (channel?.isTextBased()) {
            const verifyEmbed = new EmbedBuilder()
                .setTitle('🏐 Welcome to Volleyball Revengers!')
                .setDescription(`Welcome ${member}! Please click the **Verify Account** button below to complete server verification.`)
                .setColor('#00D4FF')
                .setFooter({ text: 'Volleyball Revengers • Verification System' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('verify_member_btn').setLabel('Verify Account').setStyle(ButtonStyle.Success).setEmoji('✅')
            );

            await channel.send({ content: `${member}`, embeds: [verifyEmbed], components: [row] }).catch(() => {});
        }
    }

    const logEmbed = new EmbedBuilder().setTitle('📥 Member Joined').setDescription(`${member.user.tag} (\`${member.id}\`) joined.`).setColor('#00FF7F').setTimestamp();
    await sendGuildLog(member.guild, 'member', logEmbed);
});

client.on('guildMemberRemove', async member => {
    const logEmbed = new EmbedBuilder().setTitle('📤 Member Left').setDescription(`${member.user.tag} (\`${member.id}\`) left.`).setColor('#FF4B4B').setTimestamp();
    await sendGuildLog(member.guild, 'member', logEmbed);
});

// ===================================================================
// Interaction Router (Buttons, Modals, Slash Commands)
// ===================================================================
client.on('interactionCreate', async interaction => {
    const config = getGuildConfig(interaction.guild?.id || '');

    // 1. Verification Button Modal Popup (DO NOT defer before showing modal!)
    if (interaction.isButton() && interaction.customId === 'verify_member_btn') {
        const modal = new ModalBuilder().setCustomId('verification_modal').setTitle('VBR Member Verification');
        const usernameInput = new TextInputBuilder()
            .setCustomId('meta_username_input')
            .setLabel('Meta / VBR Username or PlayFab ID')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter username, 6-digit code, or leave blank to skip')
            .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
        return await interaction.showModal(modal);
    }

    // 2. Verification Modal Submission
    if (interaction.isModalSubmit() && interaction.customId === 'verification_modal') {
        await interaction.deferReply({ ephemeral: true });

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
                linkMessage = result.success ? `\n🔗 **Account Linked:** Linked to PlayFab ID \`${result.linkedPlayerId}\`!` : `\n⚠️ **Linking Failed:** ${result.message || 'Invalid code.'}`;
            } else {
                linkMessage = `\n📝 **Meta Username Logged:** Saved as \`${enteredUsername}\`.`;
            }
        } else {
            linkMessage = `\n💡 *Account linking skipped. Use \`/link <code>\` anytime.*`;
        }

        try {
            if (config.unverifiedRoleId) await interaction.member.roles.remove(config.unverifiedRoleId).catch(() => {});
            if (config.verifiedRoleId) await interaction.member.roles.add(config.verifiedRoleId).catch(() => {});

            const successEmbed = new EmbedBuilder().setTitle('✅ Verification Complete!').setDescription(`Welcome, ${interaction.user}! Full access granted.${linkMessage}`).setColor('#00FF7F');
            await interaction.editReply({ embeds: [successEmbed] });

            if (config.welcomeChannelId) {
                const welcomeChan = await interaction.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
                if (welcomeChan?.isTextBased()) {
                    const welcomeEmbed = new EmbedBuilder()
                        .setTitle(`🏐 Welcome to Volleyball Revengers, ${interaction.user.username}!`)
                        .setDescription(`Hey ${interaction.user}! Jump into chat, earn XP to level up, and climb the Leaderboards!`)
                        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                        .setColor('#00D4FF')
                        .setTimestamp();

                    await welcomeChan.send({ content: `🎉 Welcome ${interaction.user}!`, embeds: [welcomeEmbed] }).catch(() => {});
                }
            }
        } catch (err) {
            await interaction.editReply({ content: '❌ Failed to assign roles.' });
        }
        return;
    }

    // 3. Command Interactions
    if (!interaction.isChatInputCommand()) return;

    // Immediately defer all slash commands to guarantee response within 3 seconds
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const { commandName } = interaction;

    try {
        if (commandName === 'level') {
            if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ Verified role required.' });
            }

            const key = `${interaction.guild.id}_${interaction.user.id}`;
            const data = userXP.get(key) || { xp: 0, level: 0 };
            const neededXP = getXPForLevel(data.level);

            const serverEntries = [];
            userXP.forEach((val, k) => {
                const [gId, uId] = k.split('_');
                if (gId === interaction.guild.id) serverEntries.push({ userId: uId, ...val });
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

        if (commandName === 'leaderboard') {
            if (!checkPermission(interaction, 'verified')) {
                return await interaction.editReply({ content: '❌ Verified role required.' });
            }

            const boardType = interaction.options.getString('type');
            let leaderboardText = "";

            if (boardType === 'Level') {
                const serverEntries = [];
                userXP.forEach((val, k) => {
                    const [gId, uId] = k.split('_');
                    if (gId === interaction.guild.id) serverEntries.push({ userId: uId, ...val });
                });

                serverEntries.sort((a, b) => b.level !== a.level ? b.level - a.level : b.xp - a.xp);
                const top10 = serverEntries.slice(0, 10);

                if (top10.length === 0) {
                    leaderboardText = "*No level data recorded yet.*";
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
                        leaderboardText += `${crown}**${entry.DisplayName || entry.PlayFabId}** — \`${entry.StatValue}\` ${boardType}\n`;
                    });
                }
            }

            const lbEmbed = new EmbedBuilder().setTitle(`🏆 Top 10 Leaderboard: ${boardType}`).setDescription(leaderboardText).setColor('#FFD700');
            return await interaction.editReply({ embeds: [lbEmbed] });
        }

        if (commandName === 'setup') {
            if (!checkPermission(interaction, 'owner')) return await interaction.editReply({ content: '❌ Owner permissions required.' });

            const prefixOpt = interaction.options.getString('prefix');
            const verifiedRole = interaction.options.getRole('verified_role');
            const unverifiedRole = interaction.options.getRole('unverified_role');
            const staffRole = interaction.options.getRole('staff_role');
            const modRole = interaction.options.getRole('moderation_role');
            const onBreakRole = interaction.options.getRole('on_break_role');
            const verifyChan = interaction.options.getChannel('verification_channel');
            const welcomeChan = interaction.options.getChannel('welcome_channel');
            const levelsChan = interaction.options.getChannel('levels_channel');
            const reportsChan = interaction.options.getChannel('reports_channel');
            const staffBreaksChan = interaction.options.getChannel('staff_breaks_channel');
            const logsChan = interaction.options.getChannel('logs_channel');
            const loginsLogoutsChan = interaction.options.getChannel('logins_logouts_channel');

            if (prefixOpt) config.prefix = prefixOpt;
            if (verifiedRole) config.verifiedRoleId = verifiedRole.id;
            if (unverifiedRole) config.unverifiedRoleId = unverifiedRole.id;
            if (staffRole) config.staffRoleId = staffRole.id;
            if (modRole) config.modRoleId = modRole.id;
            if (onBreakRole) config.onBreakRoleId = onBreakRole.id;
            if (verifyChan) config.verificationChannelId = verifyChan.id;
            if (welcomeChan) config.welcomeChannelId = welcomeChan.id;
            if (levelsChan) config.levelsChannelId = levelsChan.id;
            if (reportsChan) config.reportsChannelId = reportsChan.id;
            if (staffBreaksChan) config.staffBreaksChannelId = staffBreaksChan.id;
            if (logsChan) config.logsChannelId = logsChan.id;
            if (loginsLogoutsChan) config.loginsLogoutsChannelId = loginsLogoutsChan.id;

            const setupEmbed = new EmbedBuilder()
                .setTitle('⚙️ Server Setup Updated')
                .setColor('#00FF7F')
                .addFields(
                    { name: 'Prefix', value: `\`${config.prefix}\``, inline: true },
                    { name: 'Verified Role', value: config.verifiedRoleId ? `<@&${config.verifiedRoleId}>` : 'Not Set', inline: true },
                    { name: 'Unverified Role', value: config.unverifiedRoleId ? `<@&${config.unverifiedRoleId}>` : 'Not Set', inline: true },
                    { name: 'Verification Channel', value: config.verificationChannelId ? `<#${config.verificationChannelId}>` : 'Not Set', inline: true },
                    { name: 'Welcome Channel', value: config.welcomeChannelId ? `<#${config.welcomeChannelId}>` : 'Not Set', inline: true },
                    { name: 'Levels Channel', value: config.levelsChannelId ? `<#${config.levelsChannelId}>` : 'Not Set', inline: true }
                );

            return await interaction.editReply({ embeds: [setupEmbed] });
        }

        if (commandName === 'account') {
            const targetDiscordUser = interaction.options.getUser('target') || interaction.user;
            const user = await enforceAccountLink(interaction, targetDiscordUser);
            if (!user) return;

            const [stats, userData] = await Promise.all([getPlayerStats(user.PlayFabId), getPlayerData(user.PlayFabId)]);
            const getStat = (k) => stats[k] ?? 0;

            const accountEmbed = new EmbedBuilder()
                .setTitle(`🏐 Player Profile: ${user.TitleInfo?.DisplayName || targetDiscordUser.username}`)
                .setColor('#1E90D8')
                .setThumbnail(targetDiscordUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '🆔 Account Info', value: `**PlayFab ID:** \`${user.PlayFabId}\`\n**ELO:** ${getStat('PlayerElo')}`, inline: false },
                    { name: '📊 Performance', value: `**Matches:** ${getStat('MatchesPlayed')}\n**Wins:** ${getStat('Wins')}\n**MVPs:** ${getStat('MVP')}`, inline: true },
                    { name: '🎯 Actions', value: `**Kills:** ${getStat('Kills')}\n**Blocks:** ${getStat('Blocks')}\n**Assists:** ${getStat('Assists')}`, inline: true }
                );

            return await interaction.editReply({ embeds: [accountEmbed] });
        }

        if (commandName === 'link') {
            const cleanCode = interaction.options.getString('code').replace(/\D/g, '');
            if (cleanCode.length !== 6) return await interaction.editReply({ content: '❌ Provide a 6-digit code.' });

            const result = await executeCloudScript("LinkDiscord", {
                Code: cleanCode,
                DiscordUserId: String(interaction.user.id),
                DiscordUsername: String(interaction.user.username)
            });

            if (result.success && config.verifiedRoleId) {
                await interaction.member.roles.add(config.verifiedRoleId).catch(() => {});
                if (config.unverifiedRoleId) await interaction.member.roles.remove(config.unverifiedRoleId).catch(() => {});
            }

            return await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle(result.success ? '🎉 Account Linked!' : '❌ Link Failed')
                    .setDescription(result.success ? `Linked **${interaction.user.username}** to PlayFab ID \`${result.linkedPlayerId}\`.` : result.message || 'Expired code.')
                    .setColor(result.success ? '#00FF7F' : '#FF4B4B')]
            });
        }

        if (commandName === 'rewards') {
            return await interaction.editReply({ embeds: [new EmbedBuilder()
                .setTitle('🏆 Locker Room | Official Level Rewards')
                .setDescription(
                    '**Level 10 Perks:** None. You just look cool!\n\n' +
                    '**Level 20 Perks:** Grants Image & Reaction permissions & test driver eligibility.\n\n' +
                    '**Level 30 Perks:** Grants Support Team selection eligibility.\n\n' +
                    '**Levels 40-100 Perks:** *Coming Soon*'
                ).setColor('#1E90D8')] });
        }

        if (commandName === 'about') {
            return await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🏐 About Volleyball Revengers').setDescription('Developed in Unity. Feature updates currently on pause to focus on 3D Modeling & Animation.').setColor('#FF9900')] });
        }

        if (commandName === 'website') {
            return await interaction.editReply({ content: '🌐 **Official Website:** https://fpzard-eng.github.io/Volleyball-Revengers/home' });
        }

    } catch (cmdErr) {
        console.error(`[Command Error] ${commandName}:`, cmdErr);
        await interaction.editReply({ content: 'An error occurred while executing this command.' }).catch(() => {});
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
