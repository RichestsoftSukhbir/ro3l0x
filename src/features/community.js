// Community tools: welcome/goodbye, auto-roles, button roles, giveaways, polls, reminders, starboard, birthdays.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { randomUUID } from "node:crypto";
import { bucket, config, db, persist, saveConfig } from "../storage.js";
import { COLORS, EPHEMERAL, UserError, assertCanManage, assertCanPost, botCanManage, fillTemplate, fmtDuration, n, parseDuration, requireGuild, requireManager, sendTo, ts } from "../util.js";

let client = null;

// ---- welcome / goodbye / auto-roles ---------------------------------------

function welcomeEmbed(template, member, color) {
  return new EmbedBuilder()
    .setColor(color)
    .setDescription(fillTemplate(template, { member, guild: member.guild }))
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `Member #${n(member.guild.memberCount)}` });
}

async function onJoin(member) {
  const cfg = config(member.guild.id);
  const roles = (cfg.autoroles || []).map((id) => member.guild.roles.cache.get(id)).filter((r) => r && botCanManage(member.guild, r));
  if (roles.length && !member.user.bot) await member.roles.add(roles, "Auto-role").catch((e) => console.error("[autorole]", e.message));
  if (cfg.welcome?.channelId) {
    await sendTo(member.client, cfg.welcome.channelId, {
      content: cfg.welcome.ping === false ? undefined : `${member}`,
      embeds: [welcomeEmbed(cfg.welcome.message || "👋 Welcome to **{server}**, {user}! You're member **#{count}**.", member, COLORS.ok)],
      allowedMentions: { users: [member.id] },
    });
  }
}

async function onLeave(member) {
  const g = config(member.guild.id).goodbye;
  if (!g?.channelId) return;
  await sendTo(member.client, g.channelId, { embeds: [welcomeEmbed(g.message || "😢 **{username}** left the server. We're now {count} members.", member, COLORS.bad)] });
}

// ---- button roles ---------------------------------------------------------

async function roleButton(i, [roleId]) {
  requireGuild(i);
  const role = i.guild.roles.cache.get(roleId);
  if (!role) return i.reply({ content: "That role no longer exists.", flags: EPHEMERAL });
  if (!botCanManage(i.guild, role)) return i.reply({ content: "I can't manage that role anymore. Ask an admin to move my role higher.", flags: EPHEMERAL });
  const has = i.member.roles.cache.has(role.id);
  await (has ? i.member.roles.remove(role, "Role menu") : i.member.roles.add(role, "Role menu"));
  return i.reply({ content: has ? `➖ Removed ${role}` : `➕ Gave you ${role}`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
}

// ---- giveaways ------------------------------------------------------------

const giveaways = () => db("giveaways"); // messageId -> giveaway

function giveawayEmbed(g, ended = false) {
  const e = new EmbedBuilder()
    .setColor(ended ? 0x99aab5 : COLORS.pink)
    .setTitle(`🎉 ${g.prize}`)
    .setFooter({ text: `${g.winners} winner(s) • ${g.entrants.length} entries` });
  if (ended) {
    e.setDescription(`Ended ${ts(g.endsAt)}\nHosted by <@${g.hostId}>\n\n🏆 **Winner(s):** ${g.winnerIds?.length ? g.winnerIds.map((id) => `<@${id}>`).join(", ") : "Nobody entered 😢"}`);
  } else {
    e.setDescription(`Click 🎉 to enter!\nEnds ${ts(g.endsAt)} (${ts(g.endsAt, "f")})\nHosted by <@${g.hostId}>`);
  }
  return e;
}

const enterRow = (disabled = false) =>
  new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("gw:enter").setEmoji("🎉").setLabel(disabled ? "Ended" : "Enter").setStyle(ButtonStyle.Success).setDisabled(disabled));

function drawWinners(g) {
  const pool = [...g.entrants];
  const out = [];
  while (pool.length && out.length < g.winners) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

async function endGiveaway(messageId, { reroll = false } = {}) {
  const g = giveaways()[messageId];
  if (!g) return null;
  g.winnerIds = drawWinners(g);
  g.ended = true;
  persist("giveaways", 0);
  const channel = await client.channels.fetch(g.channelId).catch(() => null);
  const msg = await channel?.messages.fetch(messageId).catch(() => null);
  await msg?.edit({ embeds: [giveawayEmbed(g, true)], components: [enterRow(true)] }).catch(() => {});
  if (channel) {
    await channel
      .send({
        content: g.winnerIds.length ? `🎉 ${reroll ? "New winner" : "Congratulations"} ${g.winnerIds.map((id) => `<@${id}>`).join(", ")}! You won **${g.prize}**!` : `No one entered the giveaway for **${g.prize}**.`,
        reply: msg ? { messageReference: messageId, failIfNotExists: false } : undefined,
        allowedMentions: { users: g.winnerIds },
      })
      .catch(() => {});
  }
  return g;
}

async function giveawayButton(i) {
  const g = giveaways()[i.message.id];
  if (!g || g.ended) return i.reply({ content: "This giveaway has ended.", flags: EPHEMERAL });
  const inIt = g.entrants.includes(i.user.id);
  g.entrants = inIt ? g.entrants.filter((u) => u !== i.user.id) : [...g.entrants, i.user.id];
  persist("giveaways");
  await i.update({ embeds: [giveawayEmbed(g)] });
  return i.followUp({ content: inIt ? "You left the giveaway." : "🎉 You're in! Good luck.", flags: EPHEMERAL });
}

// ---- reminders ------------------------------------------------------------

const reminders = () => (db("reminders").list ??= []);

// ---- starboard ------------------------------------------------------------

async function onReaction(reaction) {
  client ??= reaction.client;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const msg = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!msg?.guild) return;
  const sb = config(msg.guild.id).starboard;
  if (!sb?.channelId || reaction.emoji.name !== "⭐" || msg.channel.id === sb.channelId || msg.author?.bot) return;
  const count = reaction.count || 0;
  const posted = bucket("starboard", msg.guild.id);
  const label = `⭐ **${count}** • ${msg.channel}`;

  if (posted[msg.id]) {
    const channel = await client.channels.fetch(sb.channelId).catch(() => null);
    const starMsg = await channel?.messages.fetch(posted[msg.id]).catch(() => null);
    return starMsg?.edit({ content: label }).catch(() => {});
  }
  if (count < (sb.threshold || 3)) return;
  const e = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setAuthor({ name: msg.author.username, iconURL: msg.author.displayAvatarURL() })
    .setDescription(`${msg.content?.slice(0, 3900) || ""}\n\n[Jump to message](${msg.url})`)
    .setTimestamp(msg.createdAt);
  const img = msg.attachments.find((a) => a.contentType?.startsWith("image/"));
  if (img) e.setImage(img.url);
  const sent = await sendTo(client, sb.channelId, { content: label, embeds: [e] });
  if (sent) {
    posted[msg.id] = sent.id;
    persist("starboard", 0);
  }
}

// ---- background timers ----------------------------------------------------

async function tick() {
  const now = Date.now();
  for (const [id, g] of Object.entries(giveaways())) {
    if (!g.ended && g.endsAt <= now) await endGiveaway(id).catch((e) => console.error("[giveaway]", e));
    else if (g.ended && now - g.endsAt > 30 * 86_400_000) delete giveaways()[id]; // forget after 30 days
  }

  const list = reminders();
  const due = list.filter((r) => r.at <= now);
  if (due.length) {
    db("reminders").list = list.filter((r) => r.at > now);
    persist("reminders", 0);
    for (const r of due) {
      const text = { content: `⏰ <@${r.userId}>, reminder: **${r.text}**\n-# set ${ts(r.created)}`, allowedMentions: { users: [r.userId] } };
      const sent = r.channelId ? await sendTo(client, r.channelId, text) : null;
      if (!sent) await client.users.fetch(r.userId).then((u) => u.send(text)).catch(() => {});
    }
  }
}

async function birthdayTick() {
  const today = new Date();
  const key = today.toISOString().slice(0, 10);
  const m = today.getUTCMonth() + 1;
  const d = today.getUTCDate();
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  for (const guild of client.guilds.cache.values()) {
    const cfg = config(guild.id).birthdays;
    if (!cfg?.channelId || cfg.lastRun === key) continue;
    cfg.lastRun = key;
    saveConfig();
    const people = Object.entries(bucket("birthdays", guild.id)).filter(
      ([, b]) => (b.m === m && b.d === d) || (b.m === 2 && b.d === 29 && m === 2 && d === 28 && !isLeap(today.getUTCFullYear())),
    );
    for (const [userId] of people) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;
      await sendTo(client, cfg.channelId, {
        content: `🎂 Happy birthday ${member}! 🎉 Everyone wish them a great day!`,
        allowedMentions: { users: [userId] },
      });
      const role = cfg.roleId && guild.roles.cache.get(cfg.roleId);
      if (role && botCanManage(guild, role)) {
        await member.roles.add(role, "Birthday").catch(() => {});
        setTimeout(() => member.roles.remove(role, "Birthday over").catch(() => {}), 24 * 3_600_000);
      }
    }
  }
}

// ---- commands -------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const commands = [
  new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Welcome & goodbye messages (admins)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName("set").setDescription("Welcome new members in a channel")
        .addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true))
        .addStringOption((o) => o.setName("message").setDescription("Use {user} {username} {server} {count}").setMaxLength(1000))
        .addBooleanOption((o) => o.setName("ping").setDescription("Ping the new member? (default yes)")),
    )
    .addSubcommand((s) =>
      s.setName("goodbye").setDescription("Post when someone leaves")
        .addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true))
        .addStringOption((o) => o.setName("message").setDescription("Use {username} {server} {count}").setMaxLength(1000)),
    )
    .addSubcommand((s) =>
      s.setName("off").setDescription("Turn off welcome or goodbye messages")
        .addStringOption((o) => o.setName("which").setDescription("Which?").setRequired(true).addChoices({ name: "Welcome", value: "welcome" }, { name: "Goodbye", value: "goodbye" }, { name: "Both", value: "both" })),
    )
    .addSubcommand((s) => s.setName("test").setDescription("Preview the welcome and goodbye messages")),

  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Roles given to everyone who joins (admins)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) => s.setName("add").setDescription("Add an auto-role").addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)))
    .addSubcommand((s) => s.setName("remove").setDescription("Remove an auto-role").addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)))
    .addSubcommand((s) => s.setName("list").setDescription("Show auto-roles")),

  (() => {
    const b = new SlashCommandBuilder()
      .setName("rolemenu")
      .setDescription("Post buttons that let members pick their own roles (admins)")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addStringOption((o) => o.setName("title").setDescription("e.g. 'Pick your games'").setRequired(true).setMaxLength(200))
      .addRoleOption((o) => o.setName("role1").setDescription("Role").setRequired(true));
    for (let k = 2; k <= 10; k++) b.addRoleOption((o) => o.setName(`role${k}`).setDescription("Role"));
    return b
      .addStringOption((o) => o.setName("description").setDescription("Text under the title").setMaxLength(1000))
      .addChannelOption((o) => o.setName("channel").setDescription("Where to post (default: here)"));
  })(),

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Run giveaways")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName("start").setDescription("Start a giveaway")
        .addStringOption((o) => o.setName("prize").setDescription("What are you giving away?").setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName("duration").setDescription("e.g. 30m, 2h, 3d").setRequired(true).setMaxLength(20))
        .addIntegerOption((o) => o.setName("winners").setDescription("Number of winners (default 1)").setMinValue(1).setMaxValue(20))
        .addChannelOption((o) => o.setName("channel").setDescription("Where (default: here)")),
    )
    .addSubcommand((s) => s.setName("end").setDescription("End a giveaway now").addStringOption((o) => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true)))
    .addSubcommand((s) => s.setName("reroll").setDescription("Pick new winner(s)").addStringOption((o) => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true)))
    .addSubcommand((s) => s.setName("list").setDescription("Active giveaways")),

  new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Create a poll")
    .addStringOption((o) => o.setName("question").setDescription("The question").setRequired(true).setMaxLength(300))
    .addStringOption((o) => o.setName("options").setDescription("Answers separated by | e.g. Yes | No | Maybe").setRequired(true).setMaxLength(550))
    .addIntegerOption((o) => o.setName("hours").setDescription("How long it runs (default 24)").setMinValue(1).setMaxValue(768))
    .addBooleanOption((o) => o.setName("multiple").setDescription("Allow picking more than one answer?")),

  new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Reminders")
    .addSubcommand((s) =>
      s.setName("me").setDescription("Remind me about something")
        .addStringOption((o) => o.setName("in").setDescription("When: 10m, 2h, 1d, 1w").setRequired(true).setMaxLength(20))
        .addStringOption((o) => o.setName("text").setDescription("What to remind you about").setRequired(true).setMaxLength(500)),
    )
    .addSubcommand((s) => s.setName("list").setDescription("Your upcoming reminders"))
    .addSubcommand((s) => s.setName("cancel").setDescription("Cancel a reminder").addStringOption((o) => o.setName("id").setDescription("Reminder ID from /remind list").setRequired(true))),

  new SlashCommandBuilder()
    .setName("starboard")
    .setDescription("Repost messages that get enough ⭐ (admins)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName("set").setDescription("Set the starboard channel")
        .addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true))
        .addIntegerOption((o) => o.setName("stars").setDescription("Stars needed (default 3)").setMinValue(1).setMaxValue(50)),
    )
    .addSubcommand((s) => s.setName("off").setDescription("Turn off the starboard")),

  new SlashCommandBuilder()
    .setName("birthday")
    .setDescription("Birthdays")
    .addSubcommand((s) =>
      s.setName("set").setDescription("Save your birthday")
        .addIntegerOption((o) => o.setName("month").setDescription("Month").setRequired(true).addChoices(...MONTHS.map((name, k) => ({ name, value: k + 1 }))))
        .addIntegerOption((o) => o.setName("day").setDescription("Day").setRequired(true).setMinValue(1).setMaxValue(31)),
    )
    .addSubcommand((s) => s.setName("remove").setDescription("Remove your birthday"))
    .addSubcommand((s) => s.setName("upcoming").setDescription("Upcoming birthdays in this server"))
    .addSubcommand((s) =>
      s.setName("channel").setDescription("Where to announce birthdays (Manage Server)")
        .addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true))
        .addRoleOption((o) => o.setName("role").setDescription("Role to give for the day (optional)")),
    ),
];

const execute = {
  async welcome(i) {
    requireGuild(i);
    const cfg = config(i.guildId);
    const sub = i.options.getSubcommand();
    if (sub === "set" || sub === "goodbye") {
      const ch = i.options.getChannel("channel");
      assertCanPost(ch, i.guild);
      const key = sub === "set" ? "welcome" : "goodbye";
      cfg[key] = { channelId: ch.id, message: i.options.getString("message") || cfg[key]?.message, ping: i.options.getBoolean("ping") ?? cfg[key]?.ping };
      saveConfig();
      const note = i.client.options.intents.has?.("GuildMembers") === false ? "\n⚠️ The **Server Members Intent** is off in the Developer Portal, so I can't see joins yet. See README." : "";
      return i.reply({ content: `✅ ${key === "welcome" ? "Welcome" : "Goodbye"} messages will go to ${ch}. Try \`/welcome test\`.${note}` });
    }
    if (sub === "off") {
      const which = i.options.getString("which");
      if (which !== "goodbye") delete cfg.welcome;
      if (which !== "welcome") delete cfg.goodbye;
      saveConfig();
      return i.reply("🔕 Turned off.");
    }
    // test
    const embeds = [];
    if (cfg.welcome) embeds.push(welcomeEmbed(cfg.welcome.message || "👋 Welcome to **{server}**, {user}! You're member **#{count}**.", i.member, COLORS.ok));
    if (cfg.goodbye) embeds.push(welcomeEmbed(cfg.goodbye.message || "😢 **{username}** left the server. We're now {count} members.", i.member, COLORS.bad));
    if (!embeds.length) throw new UserError("Nothing set up yet. Use `/welcome set` first.");
    return i.reply({ content: "Preview:", embeds, flags: EPHEMERAL });
  },

  async autorole(i) {
    requireGuild(i);
    const cfg = config(i.guildId);
    cfg.autoroles ??= [];
    const sub = i.options.getSubcommand();
    if (sub === "list") {
      return i.reply({ content: cfg.autoroles.length ? `New members get: ${cfg.autoroles.map((r) => `<@&${r}>`).join(", ")}` : "No auto-roles set.", allowedMentions: { parse: [] } });
    }
    const role = i.options.getRole("role");
    if (sub === "add") {
      assertCanManage(i.guild, role);
      if (!cfg.autoroles.includes(role.id)) cfg.autoroles.push(role.id);
    } else cfg.autoroles = cfg.autoroles.filter((r) => r !== role.id);
    saveConfig();
    return i.reply({ content: sub === "add" ? `✅ New members will get ${role}.` : `🗑️ ${role} removed from auto-roles.`, allowedMentions: { parse: [] } });
  },

  async rolemenu(i) {
    requireGuild(i);
    const roles = [];
    for (let k = 1; k <= 10; k++) {
      const r = i.options.getRole(`role${k}`);
      if (r && !roles.some((x) => x.id === r.id)) roles.push(r);
    }
    for (const r of roles) assertCanManage(i.guild, r);
    const channel = i.options.getChannel("channel") || i.channel;
    assertCanPost(channel, i.guild);
    const rows = [];
    for (let k = 0; k < roles.length; k += 5) {
      rows.push(new ActionRowBuilder().addComponents(roles.slice(k, k + 5).map((r) => new ButtonBuilder().setCustomId(`rr:${r.id}`).setLabel(r.name.slice(0, 80)).setStyle(ButtonStyle.Secondary))));
    }
    const e = new EmbedBuilder()
      .setColor(COLORS.main)
      .setTitle(i.options.getString("title"))
      .setDescription(i.options.getString("description") || `Click a button to get or remove a role:\n${roles.map((r) => `• ${r}`).join("\n")}`);
    await channel.send({ embeds: [e], components: rows });
    return i.reply({ content: `✅ Role menu posted in ${channel}.`, flags: EPHEMERAL });
  },

  async giveaway(i) {
    requireGuild(i);
    client ??= i.client;
    const sub = i.options.getSubcommand();
    if (sub === "start") {
      const ms = parseDuration(i.options.getString("duration"));
      if (!ms || ms < 60_000 || ms > 30 * 86_400_000) throw new UserError("Duration must be between 1 minute and 30 days (e.g. `30m`, `2h`, `3d`).");
      const channel = i.options.getChannel("channel") || i.channel;
      assertCanPost(channel, i.guild);
      const g = { guildId: i.guildId, channelId: channel.id, prize: i.options.getString("prize"), winners: i.options.getInteger("winners") || 1, endsAt: Date.now() + ms, hostId: i.user.id, entrants: [], ended: false };
      const msg = await channel.send({ embeds: [giveawayEmbed(g)], components: [enterRow()] });
      giveaways()[msg.id] = g;
      persist("giveaways", 0);
      return i.reply({ content: `🎉 Giveaway started in ${channel}! Ends in ${fmtDuration(ms)}. Message ID: \`${msg.id}\``, flags: EPHEMERAL });
    }
    if (sub === "list") {
      const active = Object.entries(giveaways()).filter(([, g]) => g.guildId === i.guildId && !g.ended);
      return i.reply({
        content: active.map(([id, g]) => `🎉 **${g.prize}** in <#${g.channelId}>, ends ${ts(g.endsAt)} • ${g.entrants.length} entries • ID \`${id}\``).join("\n") || "No active giveaways.",
        flags: EPHEMERAL,
      });
    }
    const id = i.options.getString("message_id").trim();
    const g = giveaways()[id];
    if (!g || g.guildId !== i.guildId) throw new UserError("No giveaway with that message ID here. (Right-click the giveaway → *Copy Message ID*.)");
    if (sub === "end" && g.ended) throw new UserError("That giveaway already ended. Use `/giveaway reroll` to pick again.");
    if (sub === "reroll" && !g.ended) throw new UserError("That giveaway is still running.");
    await i.deferReply({ flags: EPHEMERAL });
    await endGiveaway(id, { reroll: sub === "reroll" });
    return i.editReply(sub === "end" ? "✅ Giveaway ended." : "🔁 Rerolled!");
  },

  async poll(i) {
    const answers = i.options.getString("options").split("|").map((s) => s.trim()).filter(Boolean);
    if (answers.length < 2 || answers.length > 10) throw new UserError("Give 2 to 10 answers separated by `|`, like `Yes | No | Maybe`.");
    if (answers.some((a) => a.length > 55)) throw new UserError("Each answer must be 55 characters or less.");
    return i.reply({
      poll: {
        question: { text: i.options.getString("question") },
        answers: answers.map((text) => ({ text })),
        duration: i.options.getInteger("hours") || 24,
        allowMultiselect: i.options.getBoolean("multiple") || false,
      },
    });
  },

  async remind(i) {
    const sub = i.options.getSubcommand();
    const mine = reminders().filter((r) => r.userId === i.user.id).sort((a, b) => a.at - b.at);
    if (sub === "list") {
      return i.reply({ content: mine.map((r) => `\`${r.id}\` ${ts(r.at)}: ${r.text}`).join("\n") || "You have no reminders.", flags: EPHEMERAL });
    }
    if (sub === "cancel") {
      const id = i.options.getString("id").trim();
      if (!mine.some((r) => r.id === id)) throw new UserError("No reminder with that ID. See `/remind list`.");
      db("reminders").list = reminders().filter((r) => r.id !== id);
      persist("reminders", 0);
      return i.reply({ content: "🗑️ Reminder cancelled.", flags: EPHEMERAL });
    }
    const ms = parseDuration(i.options.getString("in"));
    if (!ms || ms < 60_000 || ms > 365 * 86_400_000) throw new UserError("Time must be between 1 minute and 1 year, like `10m`, `2h`, `1d`.");
    if (mine.length >= 25) throw new UserError("You have 25 reminders already. Cancel some first.");
    const r = { id: randomUUID().slice(0, 6), userId: i.user.id, channelId: i.inGuild() ? i.channelId : null, text: i.options.getString("text"), at: Date.now() + ms, created: Date.now() };
    reminders().push(r);
    persist("reminders", 0);
    return i.reply({ content: `⏰ Okay! I'll remind you ${ts(r.at)}: **${r.text}**`, flags: EPHEMERAL });
  },

  async starboard(i) {
    requireGuild(i);
    const cfg = config(i.guildId);
    if (i.options.getSubcommand() === "off") {
      delete cfg.starboard;
      saveConfig();
      return i.reply("⭐ Starboard turned off.");
    }
    const ch = i.options.getChannel("channel");
    assertCanPost(ch, i.guild);
    cfg.starboard = { channelId: ch.id, threshold: i.options.getInteger("stars") || 3 };
    saveConfig();
    return i.reply(`⭐ Messages with **${cfg.starboard.threshold}** ⭐ reactions will be posted to ${ch}.`);
  },

  async birthday(i) {
    requireGuild(i);
    const sub = i.options.getSubcommand();
    const all = bucket("birthdays", i.guildId);
    if (sub === "set") {
      const m = i.options.getInteger("month");
      const d = i.options.getInteger("day");
      if (d > DAYS_IN[m - 1]) throw new UserError(`${MONTHS[m - 1]} doesn't have ${d} days.`);
      all[i.user.id] = { m, d };
      persist("birthdays", 0);
      const note = config(i.guildId).birthdays?.channelId ? "" : "\n-# An admin still needs to pick a channel with `/birthday channel`.";
      return i.reply({ content: `🎂 Saved your birthday: **${MONTHS[m - 1]} ${d}**.${note}`, flags: EPHEMERAL });
    }
    if (sub === "remove") {
      delete all[i.user.id];
      persist("birthdays", 0);
      return i.reply({ content: "🗑️ Birthday removed.", flags: EPHEMERAL });
    }
    if (sub === "channel") {
      requireManager(i);
      const ch = i.options.getChannel("channel");
      assertCanPost(ch, i.guild);
      const role = i.options.getRole("role");
      if (role) assertCanManage(i.guild, role);
      const cfg = config(i.guildId);
      cfg.birthdays = { ...cfg.birthdays, channelId: ch.id, roleId: role?.id || null };
      saveConfig();
      return i.reply(`🎂 Birthdays will be announced in ${ch}${role ? ` and get ${role} for the day` : ""} (at midnight UTC).`);
    }
    // upcoming
    const today = new Date();
    const dayOfYear = (m, d) => new Date(Date.UTC(2024, m - 1, d)).getTime();
    const nowKey = dayOfYear(today.getUTCMonth() + 1, today.getUTCDate());
    const yearMs = dayOfYear(12, 31) + 86_400_000 - dayOfYear(1, 1);
    const list = Object.entries(all)
      .map(([id, b]) => ({ id, ...b, until: (dayOfYear(b.m, b.d) - nowKey + yearMs) % yearMs }))
      .sort((a, b) => a.until - b.until)
      .slice(0, 15);
    const e = new EmbedBuilder()
      .setColor(COLORS.pink)
      .setTitle("🎂 Upcoming birthdays")
      .setDescription(list.map((b) => `**${MONTHS[b.m - 1].slice(0, 3)} ${b.d}** • <@${b.id}>${b.until === 0 ? " 🎉 **today!**" : ""}`).join("\n") || "No birthdays saved yet. Add yours with `/birthday set`!");
    return i.reply({ embeds: [e], allowedMentions: { parse: [] } });
  },
};

export default {
  name: "community",
  commands,
  execute,
  buttons: { rr: roleButton, gw: giveawayButton },
  events: { guildMemberAdd: onJoin, guildMemberRemove: onLeave, messageReactionAdd: onReaction, messageReactionRemove: onReaction },
  ready(c) {
    client = c;
    setInterval(() => tick().catch((e) => console.error("[community tick]", e)), 15_000);
    setInterval(() => birthdayTick().catch((e) => console.error("[birthdays]", e)), 10 * 60_000);
    setTimeout(() => birthdayTick().catch(() => {}), 20_000);
  },
};
