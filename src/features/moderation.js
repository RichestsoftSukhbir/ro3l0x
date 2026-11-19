// Moderation: warn/timeout/kick/ban/purge with case history and a mod-log, plus automod.
import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { bucket, config, persist, saveConfig } from "../storage.js";
import { COLORS, EPHEMERAL, UserError, assertCanPost, fmtDuration, parseDuration, requireGuild, sendTo, ts } from "../util.js";

const P = PermissionFlagsBits;

// ---- cases & mod-log ------------------------------------------------------

const ICONS = { warn: "⚠️", timeout: "🔇", untimeout: "🔊", kick: "👢", ban: "🔨", unban: "🕊️", purge: "🧹", automod: "🤖" };

function addCase(guildId, data) {
  const c = bucket("cases", guildId);
  c.next ??= 1;
  c.list ??= [];
  const entry = { id: c.next++, at: Date.now(), ...data };
  c.list.push(entry);
  if (c.list.length > 5000) c.list.shift();
  persist("cases", 0);
  return entry;
}

async function modLog(guild, entry) {
  const channelId = config(guild.id).modlog;
  if (!channelId) return;
  const e = new EmbedBuilder()
    .setColor(entry.type === "ban" || entry.type === "kick" ? COLORS.bad : entry.type === "automod" ? COLORS.warn : COLORS.main)
    .setTitle(`${ICONS[entry.type] || "📝"} ${entry.type.toUpperCase()}${entry.id ? ` • Case #${entry.id}` : ""}`)
    .addFields(
      ...(entry.userId ? [{ name: "User", value: `<@${entry.userId}> (\`${entry.userId}\`)`, inline: true }] : []),
      { name: "By", value: entry.modId ? `<@${entry.modId}>` : "Automod", inline: true },
      ...(entry.duration ? [{ name: "Duration", value: fmtDuration(entry.duration), inline: true }] : []),
      { name: "Reason", value: (entry.reason || "No reason given").slice(0, 1000) },
    )
    .setTimestamp(entry.at || Date.now());
  await sendTo(guild.client, channelId, { embeds: [e], allowedMentions: { parse: [] } });
}

async function dm(user, guild, text) {
  await user.send({ embeds: [new EmbedBuilder().setColor(COLORS.warn).setDescription(`**${guild.name}:** ${text}`)] }).catch(() => {});
}

/** Throws if the moderator or bot can't act on this member. */
function checkTarget(i, member, action) {
  if (!member) return;
  if (member.id === i.user.id) throw new UserError(`You can't ${action} yourself.`);
  if (member.id === i.client.user.id) throw new UserError(`I can't ${action} myself.`);
  if (member.id === i.guild.ownerId) throw new UserError(`You can't ${action} the server owner.`);
  if (i.user.id !== i.guild.ownerId && member.roles.highest.position >= i.member.roles.highest.position) {
    throw new UserError(`${member} has a role equal to or higher than yours.`);
  }
  const ok = { timeout: member.moderatable, kick: member.kickable, ban: member.bannable }[action] ?? true;
  if (!ok) throw new UserError(`I can't ${action} ${member}: their role is above mine, or I'm missing permission.`);
}

const reasonOpt = (o) => o.setName("reason").setDescription("Reason").setMaxLength(500);
const done = (text, color = COLORS.ok) => ({ embeds: [new EmbedBuilder().setColor(color).setDescription(text)], allowedMentions: { parse: [] } });

// ---- automod --------------------------------------------------------------

const recent = new Map(); // guild:user -> timestamps
const LINK_RE = /(https?:\/\/[^\s<]+|discord(?:\.gg|(?:app)?\.com\/invite)\/[\w-]+|\bwww\.[^\s<]+)/gi;

function linkHost(url) {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

async function automodAct(msg, rule, cfg) {
  await msg.delete().catch(() => {});
  const warn = await msg.channel.send({ content: `🤖 ${msg.author}, your message was removed (${rule}).`, allowedMentions: { users: [msg.author.id] } }).catch(() => null);
  if (warn) setTimeout(() => warn.delete().catch(() => {}), 6000);
  let duration;
  if (cfg.action === "timeout" && msg.member?.moderatable) {
    duration = 5 * 60_000;
    await msg.member.timeout(duration, `Automod: ${rule}`).catch(() => {});
  }
  await modLog(msg.guild, { type: "automod", userId: msg.author.id, reason: `${rule} in ${msg.channel}${duration ? " → 5m timeout" : ""}\n> ${msg.content.slice(0, 300)}`, duration });
}

/** Returns true if the message was removed (so other features skip it). */
async function onMessage(msg) {
  if (!msg.guild || msg.author.bot || !msg.member) return false;
  const cfg = config(msg.guild.id).automod;
  if (!cfg?.enabled) return false;
  if (msg.member.permissions.has(P.ManageMessages)) return false; // staff are exempt
  if (cfg.exemptRoles?.some((r) => msg.member.roles.cache.has(r))) return false;
  const text = msg.content.toLowerCase();

  if (cfg.badwords?.length) {
    const hit = cfg.badwords.find((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i").test(text));
    if (hit) return automodAct(msg, "blocked word", cfg).then(() => true);
  }
  if (cfg.links) {
    const allowed = cfg.allowedLinks || [];
    const bad = (msg.content.match(LINK_RE) || []).some((u) => {
      const host = linkHost(u);
      return !allowed.some((a) => host === a || host.endsWith(`.${a}`));
    });
    if (bad) return automodAct(msg, "links aren't allowed", cfg).then(() => true);
  }
  if (cfg.maxMentions && msg.mentions.users.size + msg.mentions.roles.size >= cfg.maxMentions) {
    return automodAct(msg, "too many mentions", cfg).then(() => true);
  }
  if (cfg.spam) {
    const key = `${msg.guild.id}:${msg.author.id}`;
    const now = Date.now();
    const times = (recent.get(key) || []).filter((t) => now - t < 5000);
    times.push(now);
    recent.set(key, times);
    if (times.length >= 6) {
      recent.delete(key);
      return automodAct(msg, "spamming", cfg).then(() => true);
    }
  }
  return false;
}

// ---- commands -------------------------------------------------------------

const commands = [
  new SlashCommandBuilder().setName("warn").setDescription("Warn a member").setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)).addStringOption((o) => reasonOpt(o).setRequired(true)),
  new SlashCommandBuilder().setName("warnings").setDescription("See a member's moderation history").setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder().setName("clearwarns").setDescription("Clear a member's warnings").setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder().setName("timeout").setDescription("Timeout (mute) a member").setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("duration").setDescription("e.g. 10m, 1h, 1d (max 28d)").setRequired(true).setMaxLength(20))
    .addStringOption(reasonOpt),
  new SlashCommandBuilder().setName("untimeout").setDescription("Remove a timeout").setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)).addStringOption(reasonOpt),
  new SlashCommandBuilder().setName("kick").setDescription("Kick a member").setDefaultMemberPermissions(P.KickMembers)
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)).addStringOption(reasonOpt),
  new SlashCommandBuilder().setName("ban").setDescription("Ban a user").setDefaultMemberPermissions(P.BanMembers)
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)).addStringOption(reasonOpt)
    .addIntegerOption((o) => o.setName("delete_messages").setDescription("Delete their recent messages").addChoices({ name: "Don't delete", value: 0 }, { name: "Last hour", value: 3600 }, { name: "Last 24 hours", value: 86400 }, { name: "Last 7 days", value: 604800 })),
  new SlashCommandBuilder().setName("unban").setDescription("Unban a user").setDefaultMemberPermissions(P.BanMembers)
    .addStringOption((o) => o.setName("user_id").setDescription("User ID").setRequired(true)).addStringOption(reasonOpt),
  new SlashCommandBuilder().setName("purge").setDescription("Bulk delete recent messages").setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption((o) => o.setName("amount").setDescription("How many (1-100)").setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName("member").setDescription("Only delete this member's messages")),
  new SlashCommandBuilder().setName("slowmode").setDescription("Set channel slowmode").setDefaultMemberPermissions(P.ManageChannels)
    .addIntegerOption((o) => o.setName("seconds").setDescription("0 to turn off (max 21600)").setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName("modlog").setDescription("Set the mod-log channel").setDefaultMemberPermissions(P.ManageGuild)
    .addChannelOption((o) => o.setName("channel").setDescription("Channel (leave empty to turn off)")),
  new SlashCommandBuilder().setName("automod").setDescription("Automatic moderation (admins)").setDefaultMemberPermissions(P.ManageGuild)
    .addSubcommand((s) =>
      s.setName("settings").setDescription("Turn automod rules on/off")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Automod on?"))
        .addBooleanOption((o) => o.setName("anti_spam").setDescription("Remove spam (6+ messages in 5s)"))
        .addBooleanOption((o) => o.setName("block_links").setDescription("Remove links"))
        .addStringOption((o) => o.setName("allowed_links").setDescription("Allowed sites, comma separated: youtube.com, twitch.tv").setMaxLength(500))
        .addIntegerOption((o) => o.setName("max_mentions").setDescription("Remove messages with this many mentions (0 = off)").setMinValue(0).setMaxValue(50))
        .addStringOption((o) => o.setName("action").setDescription("What to do").addChoices({ name: "Delete message", value: "delete" }, { name: "Delete + 5 min timeout", value: "timeout" }))
        .addRoleOption((o) => o.setName("exempt_role").setDescription("Toggle a role that automod ignores")),
    )
    .addSubcommand((s) => s.setName("badword-add").setDescription("Block a word/phrase").addStringOption((o) => o.setName("word").setDescription("Word").setRequired(true).setMaxLength(50)))
    .addSubcommand((s) => s.setName("badword-remove").setDescription("Unblock a word").addStringOption((o) => o.setName("word").setDescription("Word").setRequired(true).setMaxLength(50)))
    .addSubcommand((s) => s.setName("status").setDescription("Show automod settings")),
];

async function getMember(i, opt = "member") {
  const user = i.options.getUser(opt);
  const member = await i.guild.members.fetch(user.id).catch(() => null);
  return { user, member };
}

const execute = {
  async warn(i) {
    requireGuild(i);
    const { user, member } = await getMember(i);
    if (!member) throw new UserError("That user isn't in this server.");
    checkTarget(i, member, "warn");
    const reason = i.options.getString("reason");
    const entry = addCase(i.guildId, { type: "warn", userId: user.id, modId: i.user.id, reason });
    const count = bucket("cases", i.guildId).list.filter((c) => c.userId === user.id && c.type === "warn" && !c.cleared).length;
    await dm(user, i.guild, `You were warned: ${reason}`);
    await modLog(i.guild, entry);
    return i.reply(done(`⚠️ Warned ${user} (case #${entry.id}). They now have **${count}** warning(s).\nReason: ${reason}`, COLORS.warn));
  },

  async warnings(i) {
    requireGuild(i);
    const user = i.options.getUser("member");
    const list = (bucket("cases", i.guildId).list || []).filter((c) => c.userId === user.id).slice(-15).reverse();
    const e = new EmbedBuilder()
      .setColor(COLORS.main)
      .setAuthor({ name: `${user.username}'s history`, iconURL: user.displayAvatarURL() })
      .setDescription(list.map((c) => `${ICONS[c.type] || "📝"} **#${c.id} ${c.type}**${c.cleared ? " (cleared)" : ""} ${ts(c.at, "d")} by ${c.modId ? `<@${c.modId}>` : "automod"}\n↳ ${(c.reason || "No reason").slice(0, 150)}`).join("\n") || "Clean record ✨");
    return i.reply({ embeds: [e], flags: EPHEMERAL, allowedMentions: { parse: [] } });
  },

  async clearwarns(i) {
    requireGuild(i);
    const user = i.options.getUser("member");
    let count = 0;
    for (const c of bucket("cases", i.guildId).list || []) {
      if (c.userId === user.id && c.type === "warn" && !c.cleared) {
        c.cleared = true;
        count++;
      }
    }
    persist("cases", 0);
    return i.reply(done(`🧽 Cleared **${count}** warning(s) for ${user}.`));
  },

  async timeout(i) {
    requireGuild(i);
    const { user, member } = await getMember(i);
    if (!member) throw new UserError("That user isn't in this server.");
    checkTarget(i, member, "timeout");
    const ms = parseDuration(i.options.getString("duration"));
    if (!ms || ms > 28 * 86_400_000) throw new UserError("Duration must be like `10m`, `1h` or `1d`, max 28 days.");
    const reason = i.options.getString("reason") || "No reason given";
    await member.timeout(ms, `${i.user.username}: ${reason}`);
    const entry = addCase(i.guildId, { type: "timeout", userId: user.id, modId: i.user.id, reason, duration: ms });
    await dm(user, i.guild, `You were timed out for ${fmtDuration(ms)}: ${reason}`);
    await modLog(i.guild, entry);
    return i.reply(done(`🔇 Timed out ${user} for **${fmtDuration(ms)}** (case #${entry.id}).\nReason: ${reason}`, COLORS.warn));
  },

  async untimeout(i) {
    requireGuild(i);
    const { user, member } = await getMember(i);
    if (!member) throw new UserError("That user isn't in this server.");
    checkTarget(i, member, "timeout");
    await member.timeout(null, i.options.getString("reason") || undefined);
    const entry = addCase(i.guildId, { type: "untimeout", userId: user.id, modId: i.user.id, reason: i.options.getString("reason") });
    await modLog(i.guild, entry);
    return i.reply(done(`🔊 Removed timeout from ${user}.`));
  },

  async kick(i) {
    requireGuild(i);
    const { user, member } = await getMember(i);
    if (!member) throw new UserError("That user isn't in this server.");
    checkTarget(i, member, "kick");
    const reason = i.options.getString("reason") || "No reason given";
    await dm(user, i.guild, `You were kicked: ${reason}`);
    await member.kick(`${i.user.username}: ${reason}`);
    const entry = addCase(i.guildId, { type: "kick", userId: user.id, modId: i.user.id, reason });
    await modLog(i.guild, entry);
    return i.reply(done(`👢 Kicked **${user.username}** (case #${entry.id}).\nReason: ${reason}`, COLORS.bad));
  },

  async ban(i) {
    requireGuild(i);
    const { user, member } = await getMember(i, "user");
    checkTarget(i, member, "ban");
    const reason = i.options.getString("reason") || "No reason given";
    if (member) await dm(user, i.guild, `You were banned: ${reason}`);
    await i.guild.bans.create(user.id, { reason: `${i.user.username}: ${reason}`, deleteMessageSeconds: i.options.getInteger("delete_messages") || 0 });
    const entry = addCase(i.guildId, { type: "ban", userId: user.id, modId: i.user.id, reason });
    await modLog(i.guild, entry);
    return i.reply(done(`🔨 Banned **${user.username}** (case #${entry.id}).\nReason: ${reason}`, COLORS.bad));
  },

  async unban(i) {
    requireGuild(i);
    const id = i.options.getString("user_id").replace(/\D/g, "");
    const reason = i.options.getString("reason") || "No reason given";
    await i.guild.members.unban(id, `${i.user.username}: ${reason}`).catch(() => {
      throw new UserError("That user isn't banned (or the ID is wrong).");
    });
    const entry = addCase(i.guildId, { type: "unban", userId: id, modId: i.user.id, reason });
    await modLog(i.guild, entry);
    return i.reply(done(`🕊️ Unbanned <@${id}>.`));
  },

  async purge(i) {
    requireGuild(i);
    const amount = i.options.getInteger("amount");
    const user = i.options.getUser("member");
    if (!i.channel?.bulkDelete) throw new UserError("I can't purge here.");
    if (!i.channel.permissionsFor(i.guild.members.me).has([P.ManageMessages, P.ReadMessageHistory])) throw new UserError("I need **Manage Messages** and **Read Message History** here.");
    await i.deferReply({ flags: EPHEMERAL });
    let messages = await i.channel.messages.fetch({ limit: 100 });
    if (user) messages = messages.filter((m) => m.author.id === user.id);
    const deleted = await i.channel.bulkDelete([...messages.values()].slice(0, amount), true);
    await modLog(i.guild, { type: "purge", modId: i.user.id, reason: `Deleted ${deleted.size} message(s) in ${i.channel}${user ? ` from ${user}` : ""}` });
    return i.editReply(`🧹 Deleted **${deleted.size}** message(s).${deleted.size < amount ? " (Messages older than 14 days can't be bulk deleted.)" : ""}`);
  },

  async slowmode(i) {
    requireGuild(i);
    const s = i.options.getInteger("seconds");
    if (!i.channel?.setRateLimitPerUser) throw new UserError("Slowmode doesn't work in this channel.");
    await i.channel.setRateLimitPerUser(s);
    return i.reply(done(s ? `🐢 Slowmode set to **${fmtDuration(s * 1000)}**.` : "🐇 Slowmode off."));
  },

  async modlog(i) {
    requireGuild(i);
    const ch = i.options.getChannel("channel");
    const cfg = config(i.guildId);
    if (!ch) {
      delete cfg.modlog;
      saveConfig();
      return i.reply(done("📕 Mod-log turned off."));
    }
    assertCanPost(ch, i.guild);
    cfg.modlog = ch.id;
    saveConfig();
    return i.reply(done(`📗 Moderation actions will be logged in ${ch}.`));
  },

  async automod(i) {
    requireGuild(i);
    const root = config(i.guildId);
    const cfg = (root.automod ??= { enabled: false, spam: true, links: false, allowedLinks: [], maxMentions: 6, action: "delete", badwords: [], exemptRoles: [] });
    const sub = i.options.getSubcommand();
    const o = i.options;
    if (sub === "settings") {
      if (o.getBoolean("enabled") !== null) cfg.enabled = o.getBoolean("enabled");
      if (o.getBoolean("anti_spam") !== null) cfg.spam = o.getBoolean("anti_spam");
      if (o.getBoolean("block_links") !== null) cfg.links = o.getBoolean("block_links");
      if (o.getString("allowed_links") !== null) cfg.allowedLinks = o.getString("allowed_links").split(",").map((s) => linkHost(s.trim())).filter(Boolean);
      if (o.getInteger("max_mentions") !== null) cfg.maxMentions = o.getInteger("max_mentions");
      if (o.getString("action")) cfg.action = o.getString("action");
      const role = o.getRole("exempt_role");
      if (role) cfg.exemptRoles = cfg.exemptRoles.includes(role.id) ? cfg.exemptRoles.filter((r) => r !== role.id) : [...cfg.exemptRoles, role.id];
    } else if (sub === "badword-add") {
      const w = o.getString("word").toLowerCase().trim();
      if (!cfg.badwords.includes(w)) cfg.badwords.push(w);
    } else if (sub === "badword-remove") {
      cfg.badwords = cfg.badwords.filter((w) => w !== o.getString("word").toLowerCase().trim());
    }
    saveConfig();
    const onOff = (b) => (b ? "✅ On" : "❌ Off");
    const e = new EmbedBuilder()
      .setColor(cfg.enabled ? COLORS.ok : COLORS.bad)
      .setTitle(`🤖 Automod is ${cfg.enabled ? "ON" : "OFF"}`)
      .addFields(
        { name: "Anti-spam", value: onOff(cfg.spam), inline: true },
        { name: "Block links", value: onOff(cfg.links), inline: true },
        { name: "Mention limit", value: cfg.maxMentions ? String(cfg.maxMentions) : "Off", inline: true },
        { name: "Allowed sites", value: cfg.allowedLinks.join(", ") || "None", inline: true },
        { name: "Action", value: cfg.action === "timeout" ? "Delete + 5m timeout" : "Delete", inline: true },
        { name: "Exempt roles", value: cfg.exemptRoles.map((r) => `<@&${r}>`).join(" ") || "None (staff with Manage Messages are always exempt)", inline: true },
        { name: `Blocked words (${cfg.badwords.length})`, value: cfg.badwords.length ? `||${cfg.badwords.join(", ").slice(0, 1000)}||` : "None" },
      );
    if (!cfg.enabled) e.setFooter({ text: "Turn it on with /automod settings enabled:True" });
    if (!i.client.options.intents.has("MessageContent")) e.setDescription("⚠️ The **Message Content Intent** is off, so I can't read messages. Enable it in the Developer Portal (see README).");
    return i.reply({ embeds: [e], flags: EPHEMERAL });
  },
};

export default { name: "moderation", commands, execute, events: { messageCreate: onMessage } };
