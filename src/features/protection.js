// Protection & social: anti-raid, lockdown, invite tracking, anonymous confessions, memes/animals/jokes.
import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { bucket, config, persist, saveConfig } from "../storage.js";
import { COLORS, EPHEMERAL, UserError, assertCanPost, n, requireGuild, sendTo, ts } from "../util.js";

const P = PermissionFlagsBits;

async function modlog(guild, embed) {
  const id = config(guild.id).modlog || config(guild.id).logs;
  if (id) await sendTo(guild.client, id, { embeds: [embed.setTimestamp()], allowedMentions: { parse: [] } });
}

// ---- lockdown -------------------------------------------------------------

async function setLock(guild, channels, locked, reason) {
  let done = 0;
  for (const ch of channels) {
    if (!ch.permissionOverwrites) continue;
    const ok = await ch.permissionOverwrites
      .edit(guild.id, { SendMessages: locked ? false : null, SendMessagesInThreads: locked ? false : null, AddReactions: locked ? false : null }, { reason })
      .then(() => true)
      .catch(() => false);
    if (ok) done++;
  }
  return done;
}

const textChannels = (guild) => [...guild.channels.cache.filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).values()];

// ---- anti-raid ------------------------------------------------------------

const joins = new Map(); // guildId -> timestamps

async function antiRaidJoin(member) {
  const cfg = config(member.guild.id).antiraid;
  if (!cfg?.enabled || member.user.bot) return;
  const now = Date.now();

  // Raid mode active → act on every new joiner until it ends.
  if (cfg.activeUntil > now) {
    if (cfg.action === "kick" && member.kickable) await member.kick("Anti-raid: raid mode active").catch(() => {});
    else if (cfg.action === "timeout" && member.moderatable) await member.timeout(60 * 60_000, "Anti-raid: raid mode active").catch(() => {});
    return;
  }
  // New accounts (younger than X days) can be blocked always.
  if (cfg.minAgeDays && now - member.user.createdTimestamp < cfg.minAgeDays * 86_400_000) {
    await member.send(`Your account is too new to join **${member.guild.name}**. Try again in a few days.`).catch(() => {});
    if (member.kickable) await member.kick(`Anti-raid: account younger than ${cfg.minAgeDays} days`).catch(() => {});
    return modlog(member.guild, new EmbedBuilder().setColor(COLORS.warn).setDescription(`🛡️ Kicked ${member.user} (${member.user.username}): account created ${ts(member.user.createdTimestamp)} (min age ${cfg.minAgeDays}d)`));
  }

  const list = (joins.get(member.guild.id) || []).filter((t) => now - t < (cfg.seconds || 10) * 1000);
  list.push(now);
  joins.set(member.guild.id, list);
  if (list.length < (cfg.joins || 8)) return;

  // Raid detected.
  joins.set(member.guild.id, []);
  cfg.activeUntil = now + 10 * 60_000;
  saveConfig();
  let locked = 0;
  if (cfg.lock) locked = await setLock(member.guild, textChannels(member.guild), true, "Anti-raid lockdown");
  await modlog(
    member.guild,
    new EmbedBuilder()
      .setColor(COLORS.bad)
      .setTitle("🚨 RAID DETECTED")
      .setDescription(`${list.length} joins in ${cfg.seconds || 10}s. Raid mode is on for **10 minutes**: new joiners get **${cfg.action === "kick" ? "kicked" : cfg.action === "timeout" ? "timed out" : "flagged"}**.${cfg.lock ? `\n🔒 Locked ${locked} channels. Run \`/lockdown server off\` when it's safe.` : ""}`),
  );
}

// ---- invite tracking ------------------------------------------------------

const inviteCache = new Map(); // guildId -> Map(code -> {uses, inviterId})

async function cacheInvites(guild) {
  if (!guild.members.me?.permissions.has(P.ManageGuild)) return;
  const invites = await guild.invites.fetch().catch(() => null);
  if (invites) inviteCache.set(guild.id, new Map(invites.map((inv) => [inv.code, { uses: inv.uses || 0, inviterId: inv.inviter?.id }])));
}

async function trackJoin(member) {
  const before = inviteCache.get(member.guild.id);
  await cacheInvites(member.guild);
  const after = inviteCache.get(member.guild.id);
  if (!before || !after) return;
  let used = null;
  for (const [code, inv] of after) if ((before.get(code)?.uses || 0) < inv.uses) used = { code, ...inv };
  if (!used) for (const [code, inv] of before) if (!after.has(code)) used = { code, ...inv }; // single-use invite consumed

  const stats = bucket("invites", member.guild.id);
  const joined = (stats._joined ??= {});
  joined[member.id] = used?.inviterId || null;
  if (used?.inviterId) {
    const s = (stats[used.inviterId] ??= { joins: 0, left: 0, fake: 0 });
    s.joins++;
    if (Date.now() - member.user.createdTimestamp < 7 * 86_400_000) s.fake++;
  }
  persist("invites");
  const ch = config(member.guild.id).inviteLog;
  if (ch) {
    const inviter = used?.inviterId ? `<@${used.inviterId}> (${stats[used.inviterId].joins - stats[used.inviterId].left} invites)` : "an unknown invite (vanity URL or widget)";
    await sendTo(member.client, ch, { content: `📨 ${member} joined, invited by ${inviter}`, allowedMentions: { parse: [] } });
  }
}

async function trackLeave(member) {
  const stats = bucket("invites", member.guild.id);
  const inviterId = stats._joined?.[member.id];
  if (inviterId && stats[inviterId]) {
    stats[inviterId].left++;
    persist("invites");
  }
}

// ---- fun images & jokes ---------------------------------------------------

async function json(url) {
  const res = await fetch(url, { headers: { "User-Agent": "RO3L0XBot/1.0" }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res?.ok) throw new UserError("That service isn't responding right now. Try again in a bit.");
  return res.json();
}

const ANIMALS = {
  dog: async () => (await json("https://dog.ceo/api/breeds/image/random")).message,
  cat: async () => (await json("https://api.thecatapi.com/v1/images/search"))[0]?.url,
  fox: async () => (await json("https://randomfox.ca/floof/")).image,
};

// ---- commands -------------------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("antiraid")
    .setDescription("Protect against join raids (admins)")
    .setDefaultMemberPermissions(P.ManageGuild)
    .addBooleanOption((o) => o.setName("enabled").setDescription("Anti-raid on?"))
    .addIntegerOption((o) => o.setName("joins").setDescription("Joins that count as a raid (default 8)").setMinValue(3).setMaxValue(50))
    .addIntegerOption((o) => o.setName("seconds").setDescription("…within this many seconds (default 10)").setMinValue(3).setMaxValue(120))
    .addStringOption((o) => o.setName("action").setDescription("What to do with joiners during a raid").addChoices({ name: "Kick them", value: "kick" }, { name: "Timeout 1 hour", value: "timeout" }, { name: "Only alert staff", value: "alert" }))
    .addBooleanOption((o) => o.setName("lock_channels").setDescription("Also lock all text channels during a raid?"))
    .addIntegerOption((o) => o.setName("min_account_age").setDescription("Kick accounts younger than this many days (0 = off)").setMinValue(0).setMaxValue(60)),
  new SlashCommandBuilder()
    .setName("lockdown")
    .setDescription("Stop everyone from chatting (staff)")
    .setDefaultMemberPermissions(P.ManageChannels)
    .addSubcommand((s) => s.setName("channel").setDescription("Lock or unlock this channel").addBooleanOption((o) => o.setName("on").setDescription("Lock?").setRequired(true)))
    .addSubcommand((s) => s.setName("server").setDescription("Lock or unlock all text channels").addBooleanOption((o) => o.setName("on").setDescription("Lock?").setRequired(true))),
  new SlashCommandBuilder()
    .setName("invites")
    .setDescription("Invite tracking")
    .addSubcommand((s) => s.setName("check").setDescription("How many people someone invited").addUserOption((o) => o.setName("member").setDescription("Who?")))
    .addSubcommand((s) => s.setName("top").setDescription("Top inviters"))
    .addSubcommand((s) => s.setName("log").setDescription("Post who invited each new member (Manage Server)").addChannelOption((o) => o.setName("channel").setDescription("Channel (empty = off)").addChannelTypes(ChannelType.GuildText))),
  new SlashCommandBuilder()
    .setName("confess")
    .setDescription("Post an anonymous confession")
    .addStringOption((o) => o.setName("text").setDescription("Your confession").setRequired(true).setMaxLength(1800)),
  new SlashCommandBuilder()
    .setName("confessions")
    .setDescription("Set up anonymous confessions (admins)")
    .setDefaultMemberPermissions(P.ManageGuild)
    .addChannelOption((o) => o.setName("channel").setDescription("Confession channel (empty = off)").addChannelTypes(ChannelType.GuildText)),
  new SlashCommandBuilder().setName("meme").setDescription("A random meme from Reddit"),
  new SlashCommandBuilder()
    .setName("animal")
    .setDescription("Random cute animal picture")
    .addStringOption((o) => o.setName("type").setDescription("Which animal?").setRequired(true).addChoices({ name: "🐶 Dog", value: "dog" }, { name: "🐱 Cat", value: "cat" }, { name: "🦊 Fox", value: "fox" })),
  new SlashCommandBuilder().setName("joke").setDescription("A random (safe) joke"),
];

const execute = {
  async antiraid(i) {
    requireGuild(i);
    const root = config(i.guildId);
    const cfg = (root.antiraid ??= { enabled: false, joins: 8, seconds: 10, action: "kick", lock: false, minAgeDays: 0 });
    const o = i.options;
    if (o.getBoolean("enabled") !== null) cfg.enabled = o.getBoolean("enabled");
    if (o.getInteger("joins")) cfg.joins = o.getInteger("joins");
    if (o.getInteger("seconds")) cfg.seconds = o.getInteger("seconds");
    if (o.getString("action")) cfg.action = o.getString("action");
    if (o.getBoolean("lock_channels") !== null) cfg.lock = o.getBoolean("lock_channels");
    if (o.getInteger("min_account_age") !== null) cfg.minAgeDays = o.getInteger("min_account_age");
    saveConfig();
    const e = new EmbedBuilder()
      .setColor(cfg.enabled ? COLORS.ok : COLORS.bad)
      .setTitle(`🛡️ Anti-raid is ${cfg.enabled ? "ON" : "OFF"}`)
      .setDescription(
        `A raid = **${cfg.joins} joins in ${cfg.seconds}s**.\nDuring a raid (10 min): **${{ kick: "kick new joiners", timeout: "timeout new joiners for 1h", alert: "only alert staff" }[cfg.action]}**${cfg.lock ? " + lock all text channels" : ""}.\nMinimum account age: **${cfg.minAgeDays ? `${cfg.minAgeDays} days` : "off"}**\nAlerts go to your \`/modlog\` channel.`,
      );
    return i.reply({ embeds: [e], flags: EPHEMERAL });
  },

  async lockdown(i) {
    requireGuild(i);
    const on = i.options.getBoolean("on");
    const server = i.options.getSubcommand() === "server";
    if (!i.guild.members.me.permissions.has(P.ManageChannels) && !i.guild.members.me.permissions.has(P.ManageRoles)) throw new UserError("I need **Manage Channels** (or Manage Roles) to lock channels.");
    await i.deferReply();
    const reason = `${on ? "Lockdown" : "Unlock"} by ${i.user.username}`;
    const done = await setLock(i.guild, server ? textChannels(i.guild) : [i.channel], on, reason);
    if (!on && server) {
      const cfg = config(i.guildId).antiraid;
      if (cfg) {
        cfg.activeUntil = 0;
        saveConfig();
      }
    }
    await modlog(i.guild, new EmbedBuilder().setColor(on ? COLORS.bad : COLORS.ok).setDescription(`${on ? "🔒" : "🔓"} ${i.user} ${on ? "locked" : "unlocked"} ${server ? `${done} channels` : `${i.channel}`}`));
    return i.editReply(on ? `🔒 Locked ${server ? `**${done}** channels` : "this channel"}. Members can't send messages.` : `🔓 Unlocked ${server ? `**${done}** channels` : "this channel"}.`);
  },

  async invites(i) {
    requireGuild(i);
    const sub = i.options.getSubcommand();
    const stats = bucket("invites", i.guildId);
    if (sub === "log") {
      if (!i.memberPermissions?.has(P.ManageGuild)) throw new UserError("You need **Manage Server** for that.");
      const ch = i.options.getChannel("channel");
      if (ch) assertCanPost(ch, i.guild);
      config(i.guildId).inviteLog = ch?.id || null;
      saveConfig();
      if (!i.guild.members.me.permissions.has(P.ManageGuild)) return i.reply("⚠️ Saved, but I need the **Manage Server** permission to see which invite people used.");
      return i.reply(ch ? `📨 I'll post who invited each new member in ${ch}.` : "📨 Invite log turned off.");
    }
    if (sub === "top") {
      const top = Object.entries(stats).filter(([k]) => k !== "_joined").map(([id, s]) => ({ id, real: s.joins - s.left - s.fake, ...s })).sort((a, b) => b.real - a.real).slice(0, 10);
      const e = new EmbedBuilder()
        .setColor(COLORS.gold)
        .setTitle("📨 Top inviters")
        .setDescription(top.map((s, k) => `\`#${k + 1}\` <@${s.id}>: **${s.real}** invites (${s.joins} joined, ${s.left} left, ${s.fake} new accounts)`).join("\n") || "No invites tracked yet. (Tracking starts once I'm online with **Manage Server**.)");
      return i.reply({ embeds: [e], allowedMentions: { parse: [] } });
    }
    const user = i.options.getUser("member") || i.user;
    const s = stats[user.id] || { joins: 0, left: 0, fake: 0 };
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.main).setDescription(`📨 ${user} has **${s.joins - s.left - s.fake}** invites\n✅ ${s.joins} joined • 🚪 ${s.left} left • 🆕 ${s.fake} brand-new accounts`)], allowedMentions: { parse: [] } });
  },

  async confess(i) {
    requireGuild(i);
    const chId = config(i.guildId).confessions;
    if (!chId) throw new UserError("Confessions aren't set up. An admin can run `/confessions`.");
    const counter = bucket("confessions", i.guildId);
    counter.n = (counter.n || 0) + 1;
    counter.log ??= {};
    counter.log[counter.n] = i.user.id; // kept so mods can deal with abuse via the mod-log; never shown publicly
    persist("confessions", 0);
    const sent = await sendTo(i.client, chId, { embeds: [new EmbedBuilder().setColor(COLORS.pink).setTitle(`🤫 Confession #${counter.n}`).setDescription(i.options.getString("text")).setFooter({ text: "Anonymous • /confess to post your own" })], allowedMentions: { parse: [] } });
    if (!sent) throw new UserError("I couldn't post in the confessions channel.");
    const ml = config(i.guildId).modlog;
    if (ml) await sendTo(i.client, ml, { content: `🤫 Confession #${counter.n} was posted by <@${i.user.id}> (visible to staff only).`, allowedMentions: { parse: [] } });
    return i.reply({ content: `🤫 Posted anonymously as confession #${counter.n}.${ml ? "\n-# Server staff can see who posted confessions, to stop abuse." : ""}`, flags: EPHEMERAL });
  },

  async confessions(i) {
    requireGuild(i);
    const ch = i.options.getChannel("channel");
    if (ch) assertCanPost(ch, i.guild);
    config(i.guildId).confessions = ch?.id || null;
    saveConfig();
    return i.reply(ch ? `🤫 Members can post anonymous confessions with \`/confess\`; they appear in ${ch}. Staff can see authors in the mod-log (if set) to stop abuse.` : "🤫 Confessions turned off.");
  },

  async meme(i) {
    await i.deferReply();
    let m;
    for (let k = 0; k < 3; k++) {
      m = await json("https://meme-api.com/gimme/memes");
      if (!m.nsfw && !m.spoiler) break;
    }
    if (!m || m.nsfw) throw new UserError("Couldn't find a clean meme right now. Try again!");
    return i.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.main).setTitle(m.title.slice(0, 250)).setURL(m.postLink).setImage(m.url).setFooter({ text: `👍 ${n(m.ups || 0)} • r/${m.subreddit}` })] });
  },

  async animal(i) {
    await i.deferReply();
    const type = i.options.getString("type");
    const url = await ANIMALS[type]();
    if (!url) throw new UserError("No picture this time. Try again!");
    return i.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.pink).setImage(url).setFooter({ text: { dog: "🐶 Woof!", cat: "🐱 Meow!", fox: "🦊 What does the fox say?" }[type] })] });
  },

  async joke(i) {
    const j = await json("https://v2.jokeapi.dev/joke/Any?safe-mode&blacklistFlags=nsfw,religious,political,racist,sexist,explicit");
    const text = j.type === "single" ? j.joke : `${j.setup}\n\n||${j.delivery}||`;
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.gold).setDescription(`😂 ${text}`)] });
  },
};

export default {
  name: "protection",
  commands,
  execute,
  events: {
    guildMemberAdd: async (m) => (await antiRaidJoin(m), await trackJoin(m)),
    guildMemberRemove: trackLeave,
    inviteCreate: (inv) => inv.guild && cacheInvites(inv.guild),
    inviteDelete: (inv) => inv.guild && setTimeout(() => cacheInvites(inv.guild), 1000),
  },
  ready(c) {
    setTimeout(async () => {
      for (const g of c.guilds.cache.values()) await cacheInvites(g);
    }, 5000);
  },
};
