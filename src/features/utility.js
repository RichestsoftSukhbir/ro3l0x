// Utility: user/server info, avatar, AFK, announcement builder, auto-responses (custom commands),
// sticky messages, scheduled messages, and member-count stat channels.
import { ActionRowBuilder, ChannelType, EmbedBuilder, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { randomUUID } from "node:crypto";
import { bucket, config, db, persist, saveConfig } from "../storage.js";
import { COLORS, EPHEMERAL, UserError, assertCanPost, fmtDuration, n, parseDuration, requireGuild, sendTo, ts } from "../util.js";

const P = PermissionFlagsBits;
let client = null;

// ---- AFK ------------------------------------------------------------------

async function afkMessage(msg) {
  if (!msg.guild || msg.author.bot) return;
  const afk = bucket("afk", msg.guild.id);
  if (afk[msg.author.id]) {
    const since = afk[msg.author.id].since;
    delete afk[msg.author.id];
    persist("afk");
    msg.reply({ content: `👋 Welcome back ${msg.author}! You were AFK for ${fmtDuration(Date.now() - since)}.`, allowedMentions: { users: [] } }).then((m) => setTimeout(() => m.delete().catch(() => {}), 8000)).catch(() => {});
  }
  const away = [...msg.mentions.users.values()].filter((u) => afk[u.id]).slice(0, 3);
  if (away.length) {
    msg.reply({ content: away.map((u) => `💤 **${u.username}** is AFK: ${afk[u.id].reason} (${ts(afk[u.id].since)})`).join("\n"), allowedMentions: { parse: [] } }).catch(() => {});
  }
}

// ---- auto-responses (custom commands) -------------------------------------

async function autoRespond(msg) {
  if (!msg.guild || msg.author.bot || !msg.content) return;
  const list = config(msg.guild.id).autoresponses;
  if (!list?.length) return;
  const text = msg.content.toLowerCase().trim();
  const hit = list.find((r) => (r.match === "exact" ? text === r.trigger : r.match === "starts" ? text.startsWith(r.trigger) : new RegExp(`(^|\\W)${r.trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\W)`, "i").test(text)));
  if (!hit) return;
  const out = hit.response.replace(/\{user\}/g, `${msg.author}`).replace(/\{server\}/g, msg.guild.name);
  await msg.channel.send({ content: out.slice(0, 2000), allowedMentions: { users: [msg.author.id] } }).catch(() => {});
}

// ---- sticky messages ------------------------------------------------------

const stickyTimers = new Map();
async function stickyMessage(msg) {
  if (!msg.guild || msg.author.id === msg.client.user.id) return;
  const sticky = bucket("sticky", msg.guild.id)[msg.channel.id];
  if (!sticky) return;
  clearTimeout(stickyTimers.get(msg.channel.id));
  // Wait for the chat to settle, then move the sticky message to the bottom.
  stickyTimers.set(
    msg.channel.id,
    setTimeout(async () => {
      const cur = bucket("sticky", msg.guild.id)[msg.channel.id];
      if (!cur) return;
      if (cur.lastId) await msg.channel.messages.delete(cur.lastId).catch(() => {});
      const sent = await msg.channel.send({ embeds: [new EmbedBuilder().setColor(COLORS.gold).setAuthor({ name: "📌 Sticky message" }).setDescription(cur.text)] }).catch(() => null);
      if (sent) {
        cur.lastId = sent.id;
        persist("sticky");
      }
    }, 5000),
  );
}

// ---- scheduled messages + stat channels (timers) --------------------------

const schedules = () => (db("schedules").list ??= []);

async function tick() {
  const now = Date.now();
  let changed = false;
  for (const s of schedules()) {
    if (s.at > now) continue;
    await sendTo(client, s.channelId, { content: s.text, allowedMentions: { parse: ["roles", "users", "everyone"] } });
    if (s.every) {
      while (s.at <= now) s.at += s.every;
    } else s.done = true;
    changed = true;
  }
  if (changed) {
    db("schedules").list = schedules().filter((s) => !s.done);
    persist("schedules", 0);
  }
}

async function updateStats() {
  for (const guild of client.guilds.cache.values()) {
    const st = config(guild.id).stats;
    if (!st) continue;
    if (guild.memberCount < 5000) await guild.members.fetch().catch(() => {}); // so bot/human counts are accurate
    const total = guild.memberCount;
    const bots = guild.members.cache.filter((m) => m.user.bot).size;
    const values = { members: `👥 Members: ${n(total)}`, humans: `🧑 Humans: ${n(Math.max(0, total - bots))}`, bots: `🤖 Bots: ${n(bots)}`, boosts: `💎 Boosts: ${n(guild.premiumSubscriptionCount || 0)}` };
    for (const [key, chId] of Object.entries(st)) {
      const ch = guild.channels.cache.get(chId);
      if (ch && values[key] && ch.name !== values[key]) await ch.setName(values[key]).catch(() => {}); // Discord allows 2 renames / 10 min
    }
  }
}

// ---- commands -------------------------------------------------------------

const commands = [
  new SlashCommandBuilder().setName("userinfo").setDescription("Info about a member").addUserOption((o) => o.setName("member").setDescription("Who?")),
  new SlashCommandBuilder().setName("serverinfo").setDescription("Info about this server"),
  new SlashCommandBuilder().setName("avatar").setDescription("Show someone's avatar in full size").addUserOption((o) => o.setName("member").setDescription("Who?")),
  new SlashCommandBuilder().setName("afk").setDescription("Set yourself AFK (cleared when you chat)").addStringOption((o) => o.setName("reason").setDescription("Why?").setMaxLength(200)),
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Write a nice embed announcement (opens a form)")
    .setDefaultMemberPermissions(P.ManageMessages)
    .addChannelOption((o) => o.setName("channel").setDescription("Where to post").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption((o) => o.setName("ping").setDescription("Role to ping (optional)"))
    .addStringOption((o) => o.setName("color").setDescription("Color").addChoices({ name: "Blurple", value: "5865f2" }, { name: "Green", value: "57f287" }, { name: "Red", value: "ed4245" }, { name: "Gold", value: "f1c40f" }, { name: "Pink", value: "eb459e" }, { name: "Black", value: "23272a" })),
  new SlashCommandBuilder()
    .setName("autoresponse")
    .setDescription("Custom commands & auto-replies (admins)")
    .setDefaultMemberPermissions(P.ManageGuild)
    .addSubcommand((s) =>
      s.setName("add").setDescription("Reply automatically when someone says something")
        .addStringOption((o) => o.setName("trigger").setDescription("e.g. !rules or 'how do i join'").setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName("response").setDescription("What I reply ({user} = mention them)").setRequired(true).setMaxLength(1500))
        .addStringOption((o) => o.setName("match").setDescription("How to match").addChoices({ name: "Exact message (good for !commands)", value: "exact" }, { name: "Message contains it", value: "contains" }, { name: "Message starts with it", value: "starts" })),
    )
    .addSubcommand((s) => s.setName("remove").setDescription("Remove an auto-response").addStringOption((o) => o.setName("trigger").setDescription("Trigger").setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName("list").setDescription("List auto-responses")),
  new SlashCommandBuilder()
    .setName("sticky")
    .setDescription("Keep a message at the bottom of this channel (admins)")
    .setDefaultMemberPermissions(P.ManageMessages)
    .addSubcommand((s) => s.setName("set").setDescription("Set this channel's sticky message").addStringOption((o) => o.setName("text").setDescription("Message").setRequired(true).setMaxLength(1500)))
    .addSubcommand((s) => s.setName("remove").setDescription("Remove this channel's sticky message")),
  new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("Scheduled & repeating messages (admins)")
    .setDefaultMemberPermissions(P.ManageGuild)
    .addSubcommand((s) =>
      s.setName("add").setDescription("Post a message later (and optionally repeat it)")
        .addChannelOption((o) => o.setName("channel").setDescription("Where").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption((o) => o.setName("in").setDescription("When: 10m, 2h, 1d").setRequired(true).setMaxLength(20))
        .addStringOption((o) => o.setName("text").setDescription("Message").setRequired(true).setMaxLength(1800))
        .addStringOption((o) => o.setName("repeat").setDescription("Repeat every…").addChoices({ name: "Every hour", value: "1h" }, { name: "Every 6 hours", value: "6h" }, { name: "Every day", value: "1d" }, { name: "Every week", value: "1w" })),
    )
    .addSubcommand((s) => s.setName("list").setDescription("Scheduled messages"))
    .addSubcommand((s) => s.setName("cancel").setDescription("Cancel one").addStringOption((o) => o.setName("id").setDescription("ID from /schedule list").setRequired(true))),
  new SlashCommandBuilder()
    .setName("statchannels")
    .setDescription("Voice channels that show live member counts (admins)")
    .setDefaultMemberPermissions(P.ManageChannels)
    .addSubcommand((s) => s.setName("create").setDescription("Create the stat channels"))
    .addSubcommand((s) => s.setName("remove").setDescription("Delete the stat channels")),
];

const execute = {
  async userinfo(i) {
    requireGuild(i);
    const user = await (i.options.getUser("member") || i.user).fetch();
    const member = await i.guild.members.fetch(user.id).catch(() => null);
    const roles = member ? member.roles.cache.filter((r) => r.id !== i.guildId).sort((a, b) => b.position - a.position) : null;
    const e = new EmbedBuilder()
      .setColor(member?.displayColor || COLORS.main)
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "User", value: `${user}${user.bot ? " 🤖" : ""}\n\`${user.id}\``, inline: true },
        { name: "Account created", value: `${ts(user.createdTimestamp, "D")}\n${ts(user.createdTimestamp)}`, inline: true },
        ...(member ? [{ name: "Joined server", value: `${ts(member.joinedTimestamp, "D")}\n${ts(member.joinedTimestamp)}`, inline: true }] : []),
      );
    if (roles) e.addFields({ name: `Roles (${roles.size})`, value: roles.map((r) => `${r}`).slice(0, 20).join(" ") || "None" });
    if (member?.premiumSince) e.addFields({ name: "Boosting since", value: ts(member.premiumSinceTimestamp, "D"), inline: true });
    if (user.bannerURL()) e.setImage(user.bannerURL({ size: 1024 }));
    return i.reply({ embeds: [e], allowedMentions: { parse: [] } });
  },

  async serverinfo(i) {
    requireGuild(i);
    const g = i.guild;
    const ch = g.channels.cache;
    const owner = await g.fetchOwner().catch(() => null);
    const e = new EmbedBuilder()
      .setColor(COLORS.main)
      .setTitle(g.name)
      .setThumbnail(g.iconURL({ size: 256 }))
      .addFields(
        { name: "Owner", value: owner ? `${owner}` : "?", inline: true },
        { name: "Members", value: n(g.memberCount), inline: true },
        { name: "Created", value: ts(g.createdTimestamp, "D"), inline: true },
        { name: "Channels", value: `💬 ${ch.filter((c) => c.isTextBased() && !c.isThread()).size} • 🔊 ${ch.filter((c) => c.isVoiceBased()).size}`, inline: true },
        { name: "Roles", value: String(g.roles.cache.size - 1), inline: true },
        { name: "Boosts", value: `${g.premiumSubscriptionCount || 0} (tier ${g.premiumTier})`, inline: true },
        { name: "Emojis", value: String(g.emojis.cache.size), inline: true },
        { name: "Server ID", value: g.id, inline: true },
      );
    if (g.description) e.setDescription(g.description);
    if (g.bannerURL()) e.setImage(g.bannerURL({ size: 1024 }));
    return i.reply({ embeds: [e], allowedMentions: { parse: [] } });
  },

  async avatar(i) {
    const user = i.options.getUser("member") || i.user;
    const member = i.inGuild() ? await i.guild.members.fetch(user.id).catch(() => null) : null;
    const url = (member?.avatar ? member.displayAvatarURL({ size: 1024 }) : null) || user.displayAvatarURL({ size: 1024 });
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.main).setTitle(`${user.username}'s avatar`).setURL(url).setImage(url)] });
  },

  async afk(i) {
    requireGuild(i);
    const reason = i.options.getString("reason") || "AFK";
    bucket("afk", i.guildId)[i.user.id] = { reason, since: Date.now() };
    persist("afk", 0);
    return i.reply({ content: `💤 You're now AFK: **${reason}**. I'll let people know if they mention you.` });
  },

  async announce(i) {
    requireGuild(i);
    const ch = i.options.getChannel("channel");
    assertCanPost(ch, i.guild);
    const id = randomUUID().slice(0, 8);
    pendingAnnouncements.set(id, { channelId: ch.id, roleId: i.options.getRole("ping")?.id || null, color: parseInt(i.options.getString("color") || "5865f2", 16) });
    setTimeout(() => pendingAnnouncements.delete(id), 15 * 60_000);
    const modal = new ModalBuilder()
      .setCustomId(`announce:${id}`)
      .setTitle("New announcement")
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Title").setStyle(TextInputStyle.Short).setMaxLength(250).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("body").setLabel("Message (markdown works)").setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("image").setLabel("Image URL (optional)").setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("footer").setLabel("Footer (optional)").setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(false)),
      );
    return i.showModal(modal);
  },

  async autoresponse(i) {
    requireGuild(i);
    const cfg = config(i.guildId);
    cfg.autoresponses ??= [];
    const sub = i.options.getSubcommand();
    if (sub === "list") {
      const list = cfg.autoresponses.map((r) => `• \`${r.trigger}\` (${r.match}) → ${r.response.slice(0, 80)}`);
      return i.reply({ content: list.join("\n") || "No auto-responses yet.", flags: EPHEMERAL });
    }
    const trigger = i.options.getString("trigger").toLowerCase().trim();
    if (sub === "remove") {
      const before = cfg.autoresponses.length;
      cfg.autoresponses = cfg.autoresponses.filter((r) => r.trigger !== trigger);
      saveConfig();
      return i.reply({ content: before === cfg.autoresponses.length ? "No auto-response with that trigger." : `🗑️ Removed \`${trigger}\`.`, flags: EPHEMERAL });
    }
    if (cfg.autoresponses.length >= 50) throw new UserError("You can have up to 50 auto-responses.");
    cfg.autoresponses = cfg.autoresponses.filter((r) => r.trigger !== trigger);
    cfg.autoresponses.push({ trigger, response: i.options.getString("response"), match: i.options.getString("match") || (trigger.startsWith("!") ? "exact" : "contains") });
    saveConfig();
    const note = i.client.options.intents.has("MessageContent") ? "" : "\n⚠️ Turn on the **Message Content Intent** in the Developer Portal so I can read messages.";
    return i.reply({ content: `✅ When someone says \`${trigger}\`, I'll reply.${note}`, flags: EPHEMERAL });
  },

  async sticky(i) {
    requireGuild(i);
    const all = bucket("sticky", i.guildId);
    if (i.options.getSubcommand() === "remove") {
      if (all[i.channelId]?.lastId) await i.channel.messages.delete(all[i.channelId].lastId).catch(() => {});
      delete all[i.channelId];
      persist("sticky", 0);
      return i.reply({ content: "📌 Sticky message removed.", flags: EPHEMERAL });
    }
    assertCanPost(i.channel, i.guild);
    const text = i.options.getString("text");
    const sent = await i.channel.send({ embeds: [new EmbedBuilder().setColor(COLORS.gold).setAuthor({ name: "📌 Sticky message" }).setDescription(text)] });
    all[i.channelId] = { text, lastId: sent.id };
    persist("sticky", 0);
    return i.reply({ content: "📌 Sticky set. It'll stay at the bottom of this channel.", flags: EPHEMERAL });
  },

  async schedule(i) {
    requireGuild(i);
    const sub = i.options.getSubcommand();
    const mine = schedules().filter((s) => s.guildId === i.guildId);
    if (sub === "list") {
      return i.reply({ content: mine.map((s) => `\`${s.id}\` <#${s.channelId}> ${ts(s.at)}${s.every ? ` (every ${fmtDuration(s.every)})` : ""}: ${s.text.slice(0, 60)}`).join("\n") || "Nothing scheduled.", flags: EPHEMERAL });
    }
    if (sub === "cancel") {
      const id = i.options.getString("id").trim();
      if (!mine.some((s) => s.id === id)) throw new UserError("No scheduled message with that ID.");
      db("schedules").list = schedules().filter((s) => s.id !== id);
      persist("schedules", 0);
      return i.reply({ content: "🗑️ Cancelled.", flags: EPHEMERAL });
    }
    const ch = i.options.getChannel("channel");
    assertCanPost(ch, i.guild);
    const ms = parseDuration(i.options.getString("in"));
    if (!ms || ms < 60_000 || ms > 365 * 86_400_000) throw new UserError("Time must be between 1 minute and 1 year, like `30m`, `2h`, `1d`.");
    if (mine.length >= 25) throw new UserError("Up to 25 scheduled messages per server.");
    const every = i.options.getString("repeat") ? parseDuration(i.options.getString("repeat")) : null;
    const s = { id: randomUUID().slice(0, 6), guildId: i.guildId, channelId: ch.id, text: i.options.getString("text"), at: Date.now() + ms, every };
    schedules().push(s);
    persist("schedules", 0);
    return i.reply({ content: `🗓️ Scheduled for ${ts(s.at)} in ${ch}${every ? `, repeating every ${fmtDuration(every)}` : ""}. ID \`${s.id}\``, flags: EPHEMERAL });
  },

  async statchannels(i) {
    requireGuild(i);
    const cfg = config(i.guildId);
    if (i.options.getSubcommand() === "remove") {
      for (const id of Object.values(cfg.stats || {})) await i.guild.channels.cache.get(id)?.delete().catch(() => {});
      delete cfg.stats;
      saveConfig();
      return i.reply("🗑️ Stat channels removed.");
    }
    if (!i.guild.members.me.permissions.has(P.ManageChannels)) throw new UserError("I need the **Manage Channels** permission.");
    client ??= i.client;
    await i.deferReply();
    const category = await i.guild.channels.create({ name: "📊 Server Stats", type: ChannelType.GuildCategory, position: 0 });
    const locked = [{ id: i.guildId, deny: [P.Connect] }];
    const stats = { category: category.id };
    for (const key of ["members", "humans", "bots"]) {
      const ch = await i.guild.channels.create({ name: `${key}…`, type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: locked });
      stats[key] = ch.id;
    }
    cfg.stats = stats;
    saveConfig();
    await updateStats();
    return i.editReply("📊 Stat channels created at the top of your server. They update every 10 minutes.");
  },
};

const pendingAnnouncements = new Map();
async function announceModal(i, [id]) {
  const p = pendingAnnouncements.get(id);
  if (!p) return i.reply({ content: "This form expired. Run `/announce` again.", flags: EPHEMERAL });
  pendingAnnouncements.delete(id);
  const f = (k) => i.fields.getTextInputValue(k)?.trim();
  const e = new EmbedBuilder().setColor(p.color).setDescription(f("body"));
  if (f("title")) e.setTitle(f("title"));
  if (/^https?:\/\/\S+$/.test(f("image") || "")) e.setImage(f("image"));
  if (f("footer")) e.setFooter({ text: f("footer") });
  const sent = await sendTo(i.client, p.channelId, { content: p.roleId ? `<@&${p.roleId}>` : undefined, embeds: [e], allowedMentions: { roles: p.roleId ? [p.roleId] : [] } });
  return i.reply({ content: sent ? `📢 Posted in <#${p.channelId}>!` : "I couldn't post there.", flags: EPHEMERAL });
}

export default {
  name: "utility",
  commands,
  execute,
  modals: { announce: announceModal },
  events: { messageCreate: async (m) => (await afkMessage(m), await autoRespond(m), await stickyMessage(m)) },
  ready(c) {
    client = c;
    setInterval(() => tick().catch((e) => console.error("[schedule]", e)), 20_000);
    setInterval(() => updateStats().catch((e) => console.error("[stats]", e)), 10 * 60_000);
    setTimeout(() => updateStats().catch(() => {}), 15_000);
  },
};
