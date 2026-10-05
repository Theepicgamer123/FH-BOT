require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  Events
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const NICKNAME_CHANNEL_ID = process.env.NICKNAME_CHANNEL_ID;

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN is missing in .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ======================================================
// AFK DATA
// ======================================================

const afkUsers = new Map();

// Mention cooldown
const mentionCooldowns = new Map();
const COOLDOWN = 15000;

// ======================================================
// CHECK NICKNAME PERMISSION
// ======================================================

function canChangeNickname(guild, member) {
  const botMember = guild.members.me;

  if (!botMember) {
    return {
      ok: false,
      reason: 'Bot member could not be found.'
    };
  }

  if (!botMember.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
    return {
      ok: false,
      reason: 'Bot does not have Manage Nicknames permission.'
    };
  }

  if (guild.ownerId === member.id) {
    return {
      ok: false,
      reason: 'Bot cannot change the server owner nickname.'
    };
  }

  if (
    botMember.roles.highest.position <=
    member.roles.highest.position
  ) {
    return {
      ok: false,
      reason:
        `Bot role must be higher than ${member.user.username}'s highest role.`
    };
  }

  return {
    ok: true
  };
}

// ======================================================
// READY
// ======================================================

client.once(Events.ClientReady, (bot) => {
  console.log('====================================');
  console.log(`✅ BOT ONLINE: ${bot.user.tag}`);
  console.log(`🌐 Servers: ${bot.guilds.cache.size}`);
  console.log(`📝 Nickname Channel: ${NICKNAME_CHANNEL_ID || 'Not set'}`);
  console.log('====================================');
});

// ======================================================
// MESSAGE CREATE
// ======================================================

client.on(Events.MessageCreate, async (message) => {
  try {
    // Ignore bots and DMs
    if (message.author.bot) return;
    if (!message.guild) return;

    const member = message.member;
    const guild = message.guild;
    const channel = message.channel;
    const content = message.content.trim();

    if (!member) return;

    // ==================================================
    // NICKNAME CHANNEL
    // ==================================================

    if (
      NICKNAME_CHANNEL_ID &&
      channel.id === NICKNAME_CHANNEL_ID
    ) {
      // Don't treat commands as nicknames
      if (content.startsWith('.')) return;

      // Empty message
      if (!content) {
        if (message.deletable) {
          await message.delete().catch(() => {});
        }
        return;
      }

      // Discord nickname max = 32 characters
      if (content.length > 32) {
        if (message.deletable) {
          await message.delete().catch(() => {});
        }

        const msg = await channel.send(
          `❌ <@${member.id}>, nickname cannot be longer than 32 characters.`
        );

        setTimeout(() => {
          msg.delete().catch(() => {});
        }, 6000);

        return;
      }

      // Check permission
      const check = canChangeNickname(guild, member);

      if (!check.ok) {
        if (message.deletable) {
          await message.delete().catch(() => {});
        }

        const msg = await channel.send(
          `❌ <@${member.id}> ${check.reason}`
        );

        setTimeout(() => {
          msg.delete().catch(() => {});
        }, 8000);

        return;
      }

      // Delete original message
      if (message.deletable) {
        await message.delete().catch(() => {});
      }

      // Change nickname
      try {
        await member.setNickname(
          content,
          'Nickname Channel'
        );

        const success = await channel.send(
          `✅ <@${member.id}> nickname changed to **${content}**`
        );

        setTimeout(() => {
          success.delete().catch(() => {});
        }, 5000);

      } catch (error) {
        console.error('Nickname error:', error);

        const msg = await channel.send(
          `❌ <@${member.id}>, I could not change your nickname.`
        );

        setTimeout(() => {
          msg.delete().catch(() => {});
        }, 6000);
      }

      return;
    }

    // ==================================================
    // AFK REMOVAL
    // ==================================================

    // Only .afk command should NOT remove AFK
    const isAfkCommand =
      content === '.afk' ||
      content.startsWith('.afk ');

    if (
      afkUsers.has(member.id) &&
      !isAfkCommand
    ) {
      const afkData = afkUsers.get(member.id);

      // Remove AFK first
      afkUsers.delete(member.id);

      // Restore old nickname
      const check = canChangeNickname(guild, member);

      if (check.ok) {
        try {
          await member.setNickname(
            afkData.originalNickname || null,
            'AFK removed'
          );

          console.log(
            `[AFK] Restored nickname for ${member.user.tag}`
          );

        } catch (error) {
          console.error(
            '[AFK] Failed to restore nickname:',
            error.message
          );
        }
      }

      await channel.send(
        `👋 Welcome back, <@${member.id}>! Your AFK status has been removed.`
      );
    }

    // ==================================================
    // AFK LIST
    // ==================================================

    if (content === '.afklist') {
      const users = [];

      for (const [userId, data] of afkUsers) {
        if (data.guildId === guild.id) {
          users.push(data);
        }
      }

      if (users.length === 0) {
        return channel.send(
          '📋 There are currently no AFK members.'
        );
      }

      const description = users
        .map((data, index) => {
          const reason = data.reason
            ? ` — ${data.reason}`
            : '';

          return `${index + 1}. <@${data.userId}>${reason}`;
        })
        .join('\n');

      const embed = new EmbedBuilder()
        .setTitle('💤 AFK Members')
        .setDescription(description)
        .setColor(0x5865f2)
        .setTimestamp();

      return channel.send({
        embeds: [embed]
      });
    }

    // ==================================================
    // AFK COMMAND
    // ==================================================

    if (
      content === '.afk' ||
      content.startsWith('.afk ')
    ) {
      const reason = content
        .slice(4)
        .trim() || null;

      // Already AFK
      if (afkUsers.has(member.id)) {
        const oldData = afkUsers.get(member.id);

        oldData.reason = reason;
        oldData.timestamp = Date.now();

        afkUsers.set(member.id, oldData);

        return channel.send(
          `💤 <@${member.id}>, your AFK reason has been updated.`
        );
      }

      // Save exact original nickname
      const originalNickname = member.nickname;

      // Create AFK data
      const afkData = {
        userId: member.id,
        guildId: guild.id,
        originalNickname: originalNickname,
        reason: reason,
        timestamp: Date.now()
      };

      afkUsers.set(member.id, afkData);

      // ================================================
      // CHANGE NICKNAME
      // ================================================

      const check = canChangeNickname(guild, member);

      if (!check.ok) {
        console.log(
          `[AFK] Cannot change nickname for ${member.user.tag}: ${check.reason}`
        );
      } else {
        try {
          let baseNickname =
            member.nickname || member.user.username;

          // Remove old AFK prefix if somehow present
          if (baseNickname.startsWith('AFK | ')) {
            baseNickname =
              baseNickname.substring(6);
          }

          let afkNickname =
            `AFK | ${baseNickname}`;

          // Discord max nickname length
          if (afkNickname.length > 32) {
            afkNickname =
              afkNickname.substring(0, 32);
          }

          await member.setNickname(
            afkNickname,
            'AFK status enabled'
          );

          console.log(
            `[AFK] ${member.user.tag} -> ${afkNickname}`
          );

        } catch (error) {
          console.error(
            '[AFK] Nickname change failed:',
            error.message
          );
        }
      }

      // ================================================
      // AFK MESSAGE
      // ================================================

      let reply =
        `💤 <@${member.id}> is now AFK!`;

      if (reason) {
        reply += `\n📝 Reason: **${reason}**`;
      }

      return channel.send(reply);
    }

    // ==================================================
    // AFK MENTION SYSTEM
    // ==================================================

    if (message.mentions.users.size > 0) {
      const now = Date.now();

      for (const [userId, mentionedUser] of message.mentions.users) {

        if (mentionedUser.bot) continue;

        if (!afkUsers.has(userId)) continue;

        const data = afkUsers.get(userId);

        const cooldownKey =
          `${channel.id}:${userId}`;

        const lastTime =
          mentionCooldowns.get(cooldownKey) || 0;

        if (
          now - lastTime < COOLDOWN
        ) {
          continue;
        }

        mentionCooldowns.set(
          cooldownKey,
          now
        );

        let reply =
          `💤 <@${userId}> is currently AFK.`;

        if (data.reason) {
          reply +=
            `\n📝 Reason: **${data.reason}**`;
        }

        await channel.send({
          content: reply,
          allowedMentions: {
            users: []
          }
        });
      }
    }

  } catch (error) {
    console.error(
      'MessageCreate Error:',
      error
    );
  }
});

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN)
  .then(() => {
    console.log('🔄 Connecting to Discord...');
  })
  .catch((error) => {
    console.error('❌ Login failed:', error.message);
  });

// ======================================================
// ERROR HANDLERS
// ======================================================

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});