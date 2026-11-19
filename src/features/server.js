// Server tools: support tickets (with transcripts), member verification, server logs, suggestions.
import { ActionRowBuilder, AttachmentBuilder, AuditLogEvent, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { bucket, config, persist, saveConfig } from "../storage.js";
import { COLORS, EPHEMERAL, UserError, assertCanManage, assertCanPost, pick, requireGuild, sendTo, ts } from "../util.js";

const P = PermissionFlagsBits;

// ---- tickets --------------------------------------------------------------

const ticketCfg = (guildId) => config(guildId).tickets;

async function openTicket(i) {
  requireGuild(i);
  const cfg = ticketCfg(i.guildId);
  if (!cfg) return i.reply({ content: "Tickets aren't set up here anymore.", flags: EPHEMERAL });
  const open = bucket("tickets", i.guildId);
  const existing = Object.entries(open).find(([chId, t]) => t.userId === i.user.id && i.guild.channels.cache.has(chId));
  if (existing) return i.reply({ content: `You already have an open ticket: <#${existing[0]}>`, flags: EPHEMERAL });
  if (!i.guild.members.me.permissions.has(P.ManageChannels)) return i.reply({ content: "I need the **Manage Channels** permission to open tickets.", flags: EPHEMERAL });

  await i.deferReply({ flags: EPHEMERAL });
  cfg.counter = (cfg.counter || 0) + 1;
  saveConfig();
  const num = String(cfg.counter).padStart(4, "0");
  const overwrites = [
    { id: i.guild.id, deny: [P.ViewChannel] },
    { id: i.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] },
    { id: i.client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.EmbedLinks, P.AttachFiles] },
  ];
  if (cfg.staffRoleId) overwrites.push({ id: cfg.staffRoleId, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles] });
  const ch = await i.guild.channels.create({
    name: `ticket-${num}`,
    type: ChannelType.GuildText,
    parent: cfg.categoryId || undefined,
    topic: `Ticket #${num} for ${i.user.username} (${i.user.id})`,
    permissionOverwrites: overwrites,
  });
  open[ch.id] = { userId: i.user.id, num, openedAt: Date.now() };
  persist("tickets", 0);

  const e = new EmbedBuilder()
    .setColor(COLORS.main)
    .setTitle(`🎫 Ticket #${num}`)
    .setDescription(`Hi ${i.user}! Tell us what you need and ${cfg.staffRoleId ? `<@&${cfg.staffRoleId}>` : "staff"} will help you soon.\nPress **Close** when you're done.`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket:close").setEmoji("🔒").setLabel("Close").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket:claim").setEmoji("🙋").setLabel("Claim").setStyle(ButtonStyle.Secondary),
  );
  await ch.send({ content: `${i.user}${cfg.staffRoleId ? ` <@&${cfg.staffRoleId}>` : ""}`, embeds: [e], components: [row], allowedMentions: { users: [i.user.id], roles: cfg.staffRoleId ? [cfg.staffRoleId] : [] } });
  return i.editReply(`✅ Ticket opened: ${ch}`);
}

async function transcript(channel) {
  const all = [];
  let before;
  for (let k = 0; k < 5; k++) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    all.push(...batch.values());
    before = batch.last().id;
  }
  const lines = all.reverse().map((m) => {
    const att = m.attachments.size ? ` [attachments: ${[...m.attachments.values()].map((a) => a.url).join(" ")}]` : "";
    const emb = m.embeds.length && !m.content ? ` [embed: ${m.embeds[0].title || m.embeds[0].description?.slice(0, 80) || ""}]` : "";
    return `[${m.createdAt.toISOString().replace("T", " ").slice(0, 19)}] ${m.author.username}: ${m.content}${att}${emb}`;
  });
  return Buffer.from(`Transcript of #${channel.name}\n${"=".repeat(40)}\n${lines.join("\n")}\n`, "utf8");
}

async function closeTicket(i, by) {
  const open = bucket("tickets", i.guildId);
  const t = open[i.channelId];
  if (!t) throw new UserError("This isn't an open ticket channel.");
  const cfg = ticketCfg(i.guildId) || {};
  const isStaff = i.memberPermissions?.has(P.ManageChannels) || (cfg.staffRoleId && i.member.roles.cache.has(cfg.staffRoleId));
  if (i.user.id !== t.userId && !isStaff) throw new UserError("Only the ticket owner or staff can close this.");
  await (i.deferred || i.replied ? Promise.resolve() : i.reply({ content: "🔒 Closing ticket and saving transcript…" }));

  const file = new AttachmentBuilder(await transcript(i.channel), { name: `ticket-${t.num}.txt` });
  const summary = new EmbedBuilder()
    .setColor(COLORS.bad)
    .setTitle(`🎫 Ticket #${t.num} closed`)
    .addFields(
      { name: "Opened by", value: `<@${t.userId}>`, inline: true },
      { name: "Closed by", value: `${by}`, inline: true },
      { name: "Opened", value: ts(t.openedAt), inline: true },
    );
  if (cfg.logChannelId) await sendTo(i.client, cfg.logChannelId, { embeds: [summary], files: [file], allowedMentions: { parse: [] } });
  const owner = await i.client.users.fetch(t.userId).catch(() => null);
  await owner?.send({ content: `Your ticket in **${i.guild.name}** was closed. Here's the transcript:`, files: [new AttachmentBuilder(await transcript(i.channel), { name: `ticket-${t.num}.txt` })] }).catch(() => {});
  delete open[i.channelId];
  persist("tickets", 0);
  setTimeout(() => i.channel.delete("Ticket closed").catch(() => {}), 4000);
}

async function ticketButton(i, [action]) {
  if (action === "open") return openTicket(i);
  if (action === "close") return closeTicket(i, i.user);
  if (action === "claim") {
    const cfg = ticketCfg(i.guildId) || {};
    const isStaff = i.memberPermissions?.has(P.ManageChannels) || (cfg.staffRoleId && i.member.roles.cache.has(cfg.staffRoleId));
    if (!isStaff) return i.reply({ content: "Only staff can claim tickets.", flags: EPHEMERAL });
    return i.reply({ content: `🙋 ${i.user} claimed this ticket and will help you.` });
  }
}

// ---- verification ---------------------------------------------------------

const FRUITS = ["🍎", "🍌", "🍇", "🍉", "🍓", "🍒", "🥝", "🍍"];
const verifyAnswers = new Map(); // userId -> correct emoji

async function verifyButton(i, [action, choice]) {
  requireGuild(i);
  const cfg = config(i.guildId).verify;
  if (!cfg) return i.reply({ content: "Verification isn't set up here anymore.", flags: EPHEMERAL });
  const role = i.guild.roles.cache.get(cfg.roleId);
  if (!role) return i.reply({ content: "The verified role was deleted. Ask an admin to run `/verification setup` again.", flags: EPHEMERAL });
  if (i.member.roles.cache.has(role.id)) return i.reply({ content: "✅ You're already verified!", flags: EPHEMERAL });

  if (action === "start") {
    // A tiny human check: click the fruit we name.
    const options = [...FRUITS].sort(() => Math.random() - 0.5).slice(0, 4);
    const answer = pick(options);
    verifyAnswers.set(i.user.id, answer);
    const row = new ActionRowBuilder().addComponents(options.map((f) => new ButtonBuilder().setCustomId(`verify:pick:${f}`).setEmoji(f).setStyle(ButtonStyle.Secondary)));
    return i.reply({ content: `🤖 Quick check: click the **${answer}**`, components: [row], flags: EPHEMERAL });
  }
  const answer = verifyAnswers.get(i.user.id);
  verifyAnswers.delete(i.user.id);
  if (!answer || choice !== answer) return i.update({ content: "❌ Wrong one. Press **Verify** again to retry.", components: [] });
  await i.member.roles.add(role, "Verified");
  return i.update({ content: `✅ You're verified! Welcome to **${i.guild.name}** 🎉`, components: [] });
}

// ---- suggestions ----------------------------------------------------------

function suggestionEmbed(s, guildId) {
  const color = s.status === "accepted" ? COLORS.ok : s.status === "denied" ? COLORS.bad : COLORS.main;
  const up = s.up.length;
  const down = s.down.length;
  const e = new EmbedBuilder()
    .setColor(color)
    .setTitle(`💡 Suggestion #${s.num}${s.status ? ` • ${s.status.toUpperCase()}` : ""}`)
    .setDescription(s.text)
    .addFields({ name: "Votes", value: `👍 ${up}  •  👎 ${down}${up + down ? `  (${Math.round((up / (up + down)) * 100)}% 👍)` : ""}` })
    .setFooter({ text: `Suggested by ${s.authorName}` })
    .setTimestamp(s.at);
  if (s.reason) e.addFields({ name: `Staff response (${s.status})`, value: s.reason });
  return e;
}

const voteRow = (closed) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("sugg:up").setEmoji("👍").setStyle(ButtonStyle.Success).setDisabled(closed),
    new ButtonBuilder().setCustomId("sugg:down").setEmoji("👎").setStyle(ButtonStyle.Danger).setDisabled(closed),
  );

async function suggestionVote(i, [dir]) {
  const all = bucket("suggestions", i.guildId);
  const s = Object.values(all).find((x) => x.messageId === i.message.id);
  if (!s || s.status) return i.reply({ content: "Voting is closed on this suggestion.", flags: EPHEMERAL });
  s.up = s.up.filter((u) => u !== i.user.id);
  s.down = s.down.filter((u) => u !== i.user.id);
  (dir === "up" ? s.up : s.down).push(i.user.id);
  persist("suggestions");
  return i.update({ embeds: [suggestionEmbed(s)] });
}

// ---- logs -----------------------------------------------------------------

async function log(guild, embed) {
  const id = config(guild.id).logs;
  if (id) await sendTo(guild.client, id, { embeds: [embed.setTimestamp()], allowedMentions: { parse: [] } });
}

const logEvents = {
  async messageDelete(msg) {
    if (!msg.guild || msg.author?.bot || !config(msg.guild.id).logs) return;
    if (bucket("tickets", msg.guild.id)[msg.channelId]) return;
    await log(msg.guild, new EmbedBuilder().setColor(COLORS.bad).setTitle("🗑️ Message deleted").setDescription(`**Author:** ${msg.author ?? "unknown"}\n**Channel:** <#${msg.channelId}>\n\n${msg.content?.slice(0, 3500) || "*(content not cached)*"}`));
  },
  async messageUpdate(before, after) {
    if (!after.guild || after.author?.bot || !config(after.guild.id).logs) return;
    if (before.partial || before.content === after.content) return;
    await log(after.guild, new EmbedBuilder().setColor(COLORS.warn).setTitle("✏️ Message edited").setURL(after.url).setDescription(`**Author:** ${after.author}\n**Channel:** <#${after.channelId}>`).addFields({ name: "Before", value: before.content?.slice(0, 1000) || "*(empty)*" }, { name: "After", value: after.content?.slice(0, 1000) || "*(empty)*" }));
  },
  async guildMemberAdd(m) {
    if (!config(m.guild.id).logs) return;
    await log(m.guild, new EmbedBuilder().setColor(COLORS.ok).setTitle("📥 Member joined").setThumbnail(m.user.displayAvatarURL()).setDescription(`${m} (${m.user.username})\nAccount created ${ts(m.user.createdTimestamp)}`));
  },
  async guildMemberRemove(m) {
    if (!config(m.guild.id).logs) return;
    await log(m.guild, new EmbedBuilder().setColor(COLORS.bad).setTitle("📤 Member left").setThumbnail(m.user.displayAvatarURL()).setDescription(`${m.user} (${m.user.username})${m.joinedTimestamp ? `\nJoined ${ts(m.joinedTimestamp)}` : ""}`));
  },
  async guildMemberUpdate(before, after) {
    if (!config(after.guild.id).logs || before.partial) return;
    const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id));
    const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id));
    const lines = [];
    if (added.size) lines.push(`➕ ${added.map((r) => `${r}`).join(", ")}`);
    if (removed.size) lines.push(`➖ ${removed.map((r) => `${r}`).join(", ")}`);
    if (before.nickname !== after.nickname) lines.push(`📝 Nickname: **${before.nickname || "none"}** → **${after.nickname || "none"}**`);
    if (lines.length) await log(after.guild, new EmbedBuilder().setColor(COLORS.main).setTitle("👤 Member updated").setDescription(`${after}\n${lines.join("\n")}`));
  },
  async voiceStateUpdate(o, n) {
    if (!config(n.guild.id).logs || o.channelId === n.channelId || n.member?.user.bot) return;
    const text = !o.channelId ? `🔊 joined <#${n.channelId}>` : !n.channelId ? `🔇 left <#${o.channelId}>` : `🔀 moved <#${o.channelId}> → <#${n.channelId}>`;
    await log(n.guild, new EmbedBuilder().setColor(0x99aab5).setDescription(`${n.member} ${text}`));
  },
  async channelCreate(ch) {
    if (!ch.guild || !config(ch.guild.id).logs || bucket("tickets", ch.guild.id)[ch.id] || /^ticket-|'s room$/.test(ch.name)) return;
    await log(ch.guild, new EmbedBuilder().setColor(COLORS.ok).setDescription(`📁 Channel created: ${ch} (\`${ch.name}\`)`));
  },
  async channelDelete(ch) {
    if (!ch.guild || !config(ch.guild.id).logs || /^ticket-|'s room$/.test(ch.name)) return;
    await log(ch.guild, new EmbedBuilder().setColor(COLORS.bad).setDescription(`🗑️ Channel deleted: \`#${ch.name}\``));
  },
  async guildBanAdd(ban) {
    if (!config(ban.guild.id).logs) return;
    const entry = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 }).then((l) => l.entries.first()).catch(() => null);
    await log(ban.guild, new EmbedBuilder().setColor(COLORS.bad).setDescription(`🔨 ${ban.user} (${ban.user.username}) was banned${entry?.executor ? ` by ${entry.executor}` : ""}${entry?.reason ? `\nReason: ${entry.reason}` : ""}`));
  },
};

// ---- commands -------------------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Support tickets")
    .addSubcommand((s) =>
      s.setName("setup").setDescription("Post the 'Open ticket' panel (Manage Server)")
        .addChannelOption((o) => o.setName("channel").setDescription("Where to post the panel").setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addRoleOption((o) => o.setName("staff_role").setDescription("Role that can see and answer tickets"))
        .addChannelOption((o) => o.setName("category").setDescription("Category for ticket channels").addChannelTypes(ChannelType.GuildCategory))
        .addChannelOption((o) => o.setName("log_channel").setDescription("Where transcripts are saved").addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) => o.setName("message").setDescription("Panel text").setMaxLength(1000)),
    )
    .addSubcommand((s) => s.setName("close").setDescription("Close this ticket"))
    .addSubcommand((s) => s.setName("add").setDescription("Add someone to this ticket").addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)))
    .addSubcommand((s) => s.setName("remove").setDescription("Remove someone from this ticket").addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))),

  new SlashCommandBuilder()
    .setName("verification")
    .setDescription("Make new members click Verify before they can chat (admins)")
    .setDefaultMemberPermissions(P.ManageGuild)
    .addSubcommand((s) =>
      s.setName("setup").setDescription("Post the Verify button")
        .addChannelOption((o) => o.setName("channel").setDescription("Channel new members can see").setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addRoleOption((o) => o.setName("role").setDescription("Role given after verifying").setRequired(true))
        .addStringOption((o) => o.setName("message").setDescription("Panel text").setMaxLength(1000)),
    )
    .addSubcommand((s) => s.setName("off").setDescription("Turn verification off")),

  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Server logs: deleted/edited messages, joins, roles, voice, channels, bans (admins)")
    .setDefaultMemberPermissions(P.ManageGuild)
    .addChannelOption((o) => o.setName("channel").setDescription("Log channel (leave empty to turn off)").addChannelTypes(ChannelType.GuildText)),

  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Suggest something for the server")
    .addStringOption((o) => o.setName("idea").setDescription("Your suggestion").setRequired(true).setMaxLength(1500)),

  new SlashCommandBuilder()
    .setName("suggestions")
    .setDescription("Manage suggestions (admins)")
    .setDefaultMemberPermissions(P.ManageGuild)
    .addSubcommand((s) => s.setName("channel").setDescription("Where suggestions go").addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) =>
      s.setName("accept").setDescription("Accept a suggestion")
        .addIntegerOption((o) => o.setName("number").setDescription("Suggestion #").setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName("reason").setDescription("Response").setMaxLength(1000)),
    )
    .addSubcommand((s) =>
      s.setName("deny").setDescription("Deny a suggestion")
        .addIntegerOption((o) => o.setName("number").setDescription("Suggestion #").setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName("reason").setDescription("Response").setMaxLength(1000)),
    ),
];

const execute = {
  async ticket(i) {
    requireGuild(i);
    const sub = i.options.getSubcommand();
    if (sub === "setup") {
      if (!i.memberPermissions?.has(P.ManageGuild)) throw new UserError("You need **Manage Server** for that.");
      if (!i.guild.members.me.permissions.has(P.ManageChannels)) throw new UserError("I need the **Manage Channels** permission to create tickets.");
      const ch = i.options.getChannel("channel");
      assertCanPost(ch, i.guild);
      const cfg = config(i.guildId);
      cfg.tickets = {
        staffRoleId: i.options.getRole("staff_role")?.id || null,
        categoryId: i.options.getChannel("category")?.id || null,
        logChannelId: i.options.getChannel("log_channel")?.id || null,
        counter: cfg.tickets?.counter || 0,
      };
      saveConfig();
      const e = new EmbedBuilder().setColor(COLORS.main).setTitle("🎫 Need help?").setDescription(i.options.getString("message") || "Click the button below to open a private ticket with our staff.");
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket:open").setEmoji("🎫").setLabel("Open ticket").setStyle(ButtonStyle.Primary));
      await ch.send({ embeds: [e], components: [row] });
      return i.reply({ content: `✅ Ticket panel posted in ${ch}.`, flags: EPHEMERAL });
    }
    if (sub === "close") return closeTicket(i, i.user);
    const t = bucket("tickets", i.guildId)[i.channelId];
    if (!t) throw new UserError("Use this inside a ticket channel.");
    const member = i.options.getUser("member");
    if (sub === "add") await i.channel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    else await i.channel.permissionOverwrites.delete(member.id);
    return i.reply({ content: sub === "add" ? `➕ Added ${member} to this ticket.` : `➖ Removed ${member} from this ticket.` });
  },

  async verification(i) {
    requireGuild(i);
    const cfg = config(i.guildId);
    if (i.options.getSubcommand() === "off") {
      delete cfg.verify;
      saveConfig();
      return i.reply("🔓 Verification turned off.");
    }
    const ch = i.options.getChannel("channel");
    const role = i.options.getRole("role");
    assertCanPost(ch, i.guild);
    assertCanManage(i.guild, role);
    cfg.verify = { roleId: role.id, channelId: ch.id };
    saveConfig();
    const e = new EmbedBuilder().setColor(COLORS.ok).setTitle("✅ Verify to join the server").setDescription(i.options.getString("message") || "Click **Verify** below to get access to the rest of the server.");
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("verify:start").setEmoji("✅").setLabel("Verify").setStyle(ButtonStyle.Success));
    await ch.send({ embeds: [e], components: [row] });
    return i.reply({
      content: `✅ Verify panel posted in ${ch}. Members get ${role} after a quick click-the-fruit check.\n**Next:** make channels visible only to ${role} (deny *View Channel* for @everyone, allow for ${role}), and leave ${ch} visible to everyone.`,
      flags: EPHEMERAL,
      allowedMentions: { parse: [] },
    });
  },

  async logs(i) {
    requireGuild(i);
    const ch = i.options.getChannel("channel");
    const cfg = config(i.guildId);
    if (!ch) {
      delete cfg.logs;
      saveConfig();
      return i.reply("📕 Server logs turned off.");
    }
    assertCanPost(ch, i.guild);
    cfg.logs = ch.id;
    saveConfig();
    return i.reply(`📗 Server logs will go to ${ch}: deleted/edited messages, joins & leaves, role and nickname changes, voice activity, channels and bans.`);
  },

  async suggest(i) {
    requireGuild(i);
    const chId = config(i.guildId).suggestChannel;
    if (!chId) throw new UserError("Suggestions aren't set up. An admin can run `/suggestions channel`.");
    const all = bucket("suggestions", i.guildId);
    const num = Object.keys(all).length + 1;
    const s = { num, text: i.options.getString("idea"), authorId: i.user.id, authorName: i.user.username, at: Date.now(), up: [], down: [], status: null };
    const msg = await sendTo(i.client, chId, { embeds: [suggestionEmbed(s)], components: [voteRow(false)] });
    if (!msg) throw new UserError("I couldn't post in the suggestions channel. Check my permissions there.");
    s.messageId = msg.id;
    s.channelId = chId;
    all[num] = s;
    persist("suggestions", 0);
    msg.startThread?.({ name: `Suggestion #${num} discussion` }).catch(() => {});
    return i.reply({ content: `💡 Suggestion #${num} posted in <#${chId}>!`, flags: EPHEMERAL });
  },

  async suggestions(i) {
    requireGuild(i);
    const sub = i.options.getSubcommand();
    if (sub === "channel") {
      const ch = i.options.getChannel("channel");
      assertCanPost(ch, i.guild);
      config(i.guildId).suggestChannel = ch.id;
      saveConfig();
      return i.reply(`💡 Members can now use \`/suggest\`; suggestions appear in ${ch} with vote buttons.`);
    }
    const s = bucket("suggestions", i.guildId)[i.options.getInteger("number")];
    if (!s) throw new UserError("No suggestion with that number.");
    s.status = sub === "accept" ? "accepted" : "denied";
    s.reason = i.options.getString("reason") || null;
    persist("suggestions", 0);
    const ch = await i.client.channels.fetch(s.channelId).catch(() => null);
    const msg = await ch?.messages.fetch(s.messageId).catch(() => null);
    await msg?.edit({ embeds: [suggestionEmbed(s)], components: [voteRow(true)] }).catch(() => {});
    const author = await i.client.users.fetch(s.authorId).catch(() => null);
    await author?.send(`Your suggestion #${s.num} in **${i.guild.name}** was **${s.status}**.${s.reason ? `\n> ${s.reason}` : ""}`).catch(() => {});
    return i.reply({ content: `${sub === "accept" ? "✅ Accepted" : "❌ Denied"} suggestion #${s.num}.`, flags: EPHEMERAL });
  },
};

export default {
  name: "server",
  commands,
  execute,
  buttons: { ticket: ticketButton, verify: verifyButton, sugg: suggestionVote },
  events: logEvents,
};
