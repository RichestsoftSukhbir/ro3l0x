// Chat XP, levels, rank, leaderboard, and roles that unlock at a level.
import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { bucket, config, persist, saveConfig } from "../storage.js";
import { COLORS, EPHEMERAL, UserError, assertCanManage, botCanManage, fillTemplate, n, progressBar, rand, requireGuild } from "../util.js";

const COOLDOWN_MS = 60_000; // one XP award per user per minute (stops spam farming)
const xpForLevel = (lvl) => 5 * lvl * lvl + 50 * lvl + 100; // XP needed to go from lvl to lvl+1

export function levelInfo(totalXp) {
  let level = 0;
  let xp = totalXp;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
  }
  return { level, into: xp, need: xpForLevel(level) };
}

const totalXpForLevel = (level) => Array.from({ length: level }, (_, i) => xpForLevel(i)).reduce((a, b) => a + b, 0);
const cfgOf = (guildId) => (config(guildId).levels ??= { enabled: true, announce: true, rewards: {}, ignored: [] });

async function applyRewards(member, level, cfg) {
  const roles = Object.entries(cfg.rewards || {})
    .filter(([lvl]) => Number(lvl) <= level)
    .map(([, roleId]) => member.guild.roles.cache.get(roleId))
    .filter((r) => r && !member.roles.cache.has(r.id) && botCanManage(member.guild, r));
  if (roles.length) await member.roles.add(roles, `Reached level ${level}`).catch(() => {});
  return roles;
}

async function onMessage(msg) {
  if (!msg.guild || msg.author.bot || !msg.member) return;
  const cfg = cfgOf(msg.guild.id);
  if (cfg.enabled === false || cfg.ignored?.includes(msg.channel.id)) return;

  const users = bucket("levels", msg.guild.id);
  const u = (users[msg.author.id] ??= { xp: 0, last: 0, msgs: 0 });
  u.msgs++;
  const now = Date.now();
  if (now - u.last < COOLDOWN_MS) return persist("levels");
  u.last = now;

  const before = levelInfo(u.xp).level;
  u.xp += Math.round(rand(15, 25) * (cfg.multiplier || 1));
  persist("levels");
  const after = levelInfo(u.xp).level;
  if (after <= before) return;

  const gained = await applyRewards(msg.member, after, cfg);
  if (cfg.announce === false) return;
  const text =
    fillTemplate(cfg.message || "🎉 {user} just reached **level {level}**!", { member: msg.member, guild: msg.guild, extra: { level: after } }) +
    (gained.length ? `\nUnlocked: ${gained.map((r) => `${r}`).join(", ")}` : "");
  const channel = (cfg.channelId && msg.guild.channels.cache.get(cfg.channelId)) || msg.channel;
  channel.send({ content: text, allowedMentions: { users: [msg.author.id] } }).catch(() => {});
}

// ---- commands -------------------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Your level and XP (or someone else's)")
    .addUserOption((o) => o.setName("member").setDescription("Whose rank?")),
  new SlashCommandBuilder()
    .setName("top")
    .setDescription("Server XP leaderboard")
    .addIntegerOption((o) => o.setName("page").setDescription("Page number").setMinValue(1)),
  new SlashCommandBuilder()
    .setName("levels")
    .setDescription("Configure leveling (admins)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName("settings").setDescription("Turn leveling on/off and change level-up messages")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Give XP for chatting?"))
        .addBooleanOption((o) => o.setName("announce").setDescription("Post a message on level up?"))
        .addChannelOption((o) => o.setName("channel").setDescription("Post level-ups here (instead of where they chatted)"))
        .addBooleanOption((o) => o.setName("same_channel").setDescription("Go back to posting where they chatted"))
        .addStringOption((o) => o.setName("message").setDescription("Use {user} and {level}, e.g. 'GG {user}, level {level}!'").setMaxLength(300))
        .addNumberOption((o) => o.setName("multiplier").setDescription("XP multiplier (1 = normal)").setMinValue(0.1).setMaxValue(5)),
    )
    .addSubcommand((s) =>
      s.setName("reward-add").setDescription("Give a role when someone reaches a level")
        .addIntegerOption((o) => o.setName("level").setDescription("Level").setRequired(true).setMinValue(1).setMaxValue(500))
        .addRoleOption((o) => o.setName("role").setDescription("Role to give").setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName("reward-remove").setDescription("Remove a level reward")
        .addIntegerOption((o) => o.setName("level").setDescription("Level").setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) => s.setName("rewards").setDescription("List level rewards and settings"))
    .addSubcommand((s) =>
      s.setName("ignore").setDescription("Toggle: no XP in a channel")
        .addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName("set").setDescription("Set someone's level")
        .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
        .addIntegerOption((o) => o.setName("level").setDescription("Level").setRequired(true).setMinValue(0).setMaxValue(500)),
    ),
];

function ranked(guildId) {
  return Object.entries(bucket("levels", guildId)).sort((a, b) => b[1].xp - a[1].xp);
}

const execute = {
  async rank(i) {
    requireGuild(i);
    const user = i.options.getUser("member") || i.user;
    if (user.bot) throw new UserError("Bots don't earn XP.");
    const list = ranked(i.guildId);
    const idx = list.findIndex(([id]) => id === user.id);
    const data = list[idx]?.[1] || { xp: 0, msgs: 0 };
    const { level, into, need } = levelInfo(data.xp);
    const e = new EmbedBuilder()
      .setColor(COLORS.main)
      .setAuthor({ name: `${user.username}'s rank`, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "Rank", value: idx >= 0 ? `#${idx + 1}` : "Unranked", inline: true },
        { name: "Level", value: String(level), inline: true },
        { name: "Total XP", value: n(data.xp), inline: true },
        { name: `Progress to level ${level + 1}`, value: `${progressBar(into, need)} ${n(into)} / ${n(need)} XP` },
      )
      .setFooter({ text: `${n(data.msgs || 0)} messages sent` });
    return i.reply({ embeds: [e] });
  },

  async top(i) {
    requireGuild(i);
    const list = ranked(i.guildId);
    const pages = Math.max(1, Math.ceil(list.length / 10));
    const page = Math.min(i.options.getInteger("page") || 1, pages);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = list.slice((page - 1) * 10, page * 10).map(([id, d], k) => {
      const pos = (page - 1) * 10 + k;
      return `${medals[pos] || `\`#${pos + 1}\``} <@${id}> • Level **${levelInfo(d.xp).level}** • ${n(d.xp)} XP`;
    });
    const e = new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle(`🏆 ${i.guild.name} leaderboard`)
      .setDescription(lines.join("\n") || "Nobody has XP yet. Start chatting!")
      .setFooter({ text: `Page ${page}/${pages} • ${list.length} members ranked` });
    return i.reply({ embeds: [e], allowedMentions: { parse: [] } });
  },

  async levels(i) {
    const cfg = cfgOf(i.guildId);
    const sub = i.options.getSubcommand();

    if (sub === "settings") {
      const o = i.options;
      if (o.getBoolean("enabled") !== null) cfg.enabled = o.getBoolean("enabled");
      if (o.getBoolean("announce") !== null) cfg.announce = o.getBoolean("announce");
      if (o.getChannel("channel")) cfg.channelId = o.getChannel("channel").id;
      if (o.getBoolean("same_channel")) delete cfg.channelId;
      if (o.getString("message")) cfg.message = o.getString("message");
      if (o.getNumber("multiplier")) cfg.multiplier = o.getNumber("multiplier");
      saveConfig();
      return execute.levelsSummary(i, cfg, "✅ Leveling settings saved.");
    }

    if (sub === "reward-add") {
      const level = i.options.getInteger("level");
      const role = i.options.getRole("role");
      assertCanManage(i.guild, role);
      cfg.rewards = { ...cfg.rewards, [level]: role.id };
      saveConfig();
      return i.reply({ content: `✅ Members reaching **level ${level}** will get ${role}. (People already past it get it next time they level up.)`, allowedMentions: { parse: [] } });
    }

    if (sub === "reward-remove") {
      const level = i.options.getInteger("level");
      if (!cfg.rewards?.[level]) throw new UserError(`There's no reward for level ${level}.`);
      delete cfg.rewards[level];
      saveConfig();
      return i.reply({ content: `🗑️ Removed the level ${level} reward.` });
    }

    if (sub === "ignore") {
      const ch = i.options.getChannel("channel");
      cfg.ignored ??= [];
      const on = !cfg.ignored.includes(ch.id);
      cfg.ignored = on ? [...cfg.ignored, ch.id] : cfg.ignored.filter((c) => c !== ch.id);
      saveConfig();
      return i.reply({ content: on ? `🔇 No XP in ${ch} anymore.` : `🔊 ${ch} gives XP again.` });
    }

    if (sub === "set") {
      const user = i.options.getUser("member");
      if (user.bot) throw new UserError("Bots don't earn XP.");
      const level = i.options.getInteger("level");
      const users = bucket("levels", i.guildId);
      users[user.id] = { ...(users[user.id] || { msgs: 0, last: 0 }), xp: totalXpForLevel(level) };
      persist("levels", 0);
      const member = await i.guild.members.fetch(user.id).catch(() => null);
      if (member) await applyRewards(member, level, cfg);
      return i.reply({ content: `✅ ${user} is now **level ${level}**.`, allowedMentions: { parse: [] } });
    }

    return execute.levelsSummary(i, cfg);
  },

  async levelsSummary(i, cfg, header = "") {
    const rewards = Object.entries(cfg.rewards || {}).sort((a, b) => a[0] - b[0]).map(([lvl, r]) => `Level **${lvl}** → <@&${r}>`);
    const e = new EmbedBuilder()
      .setColor(COLORS.main)
      .setTitle("📈 Leveling")
      .addFields(
        { name: "XP", value: cfg.enabled === false ? "Off" : `On (x${cfg.multiplier || 1})`, inline: true },
        { name: "Level-up messages", value: cfg.announce === false ? "Off" : cfg.channelId ? `In <#${cfg.channelId}>` : "Where they chat", inline: true },
        { name: "No-XP channels", value: cfg.ignored?.map((c) => `<#${c}>`).join(" ") || "None", inline: true },
        { name: "Message", value: cfg.message || "🎉 {user} just reached **level {level}**!" },
        { name: "Role rewards", value: rewards.join("\n") || "None. Add one with `/levels reward-add`." },
      );
    return i.reply({ content: header || undefined, embeds: [e], flags: EPHEMERAL, allowedMentions: { parse: [] } });
  },
};

export default {
  name: "levels",
  commands,
  execute: { rank: execute.rank, top: execute.top, levels: execute.levels },
  events: { messageCreate: onMessage },
};
