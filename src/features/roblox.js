// Roblox: verified account linking, profiles, live game stats, groups, and group-rank → Discord role sync.
// Uses Roblox's public web APIs (no key needed).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { randomBytes } from "node:crypto";
import { ApiError, getJSON } from "../games/http.js";
import { config, getLink, removeLink, saveConfig, setLink } from "../storage.js";
import { COLORS, EPHEMERAL, UserError, assertCanManage, botCanManage, n, requireGuild, ts } from "../util.js";

const RED = 0xe2231a;
const UA = { "User-Agent": "RO3L0XBot/1.0", "Content-Type": "application/json", Accept: "application/json" };

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: UA, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res) throw new ApiError("Couldn't reach Roblox. Try again in a bit.");
  if (res.status === 429) throw new ApiError("Roblox is rate-limiting us. Try again in a minute.");
  if (!res.ok) throw new ApiError(`Roblox returned an error (${res.status}).`);
  return res.json();
}
const get = (url, ttl = 5 * 60_000) => getJSON(url, { ttl, service: "Roblox" });

// ---- lookups --------------------------------------------------------------

async function userByName(name) {
  const clean = name.trim().replace(/^@/, "");
  if (/^\d{1,15}$/.test(clean)) return get(`https://users.roblox.com/v1/users/${clean}`).catch(() => null);
  if (!/^\w{3,20}$/.test(clean)) return null;
  const d = await post("https://users.roblox.com/v1/usernames/users", { usernames: [clean], excludeBannedUsers: false });
  const hit = d.data?.[0];
  return hit ? get(`https://users.roblox.com/v1/users/${hit.id}`, 60_000) : null;
}

async function findUser(name) {
  const u = await userByName(name);
  if (!u) throw new UserError(`Couldn't find a Roblox user named **${name}**.`);
  return u;
}

const thumb = async (path) => (await get(`https://thumbnails.roblox.com/v1/${path}`, 30 * 60_000).catch(() => null))?.data?.[0]?.imageUrl;
const groupsOf = (userId) => get(`https://groups.roblox.com/v2/users/${userId}/groups/roles`, 2 * 60_000).then((d) => d.data || []);
const count = (path) => get(`https://friends.roblox.com/v1/users/${path}`).then((d) => d.count).catch(() => null);

async function presence(userId) {
  const d = await post("https://presence.roblox.com/v1/presence/users", { userIds: [Number(userId)] }).catch(() => null);
  const p = d?.userPresences?.[0];
  return ["⚫ Offline", "🟢 Online", "🎮 In a game", "🛠️ In Studio", "👻 Invisible"][p?.userPresenceType ?? 0];
}

// Accepts a game link, place ID, or a name to search for. Returns a universe ID.
async function findUniverse(query) {
  const q = query.trim();
  const placeId = q.match(/roblox\.com\/games\/(\d+)/)?.[1] || (/^\d+$/.test(q) ? q : null);
  if (placeId) {
    const r = await get(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`, 60 * 60_000).catch(() => null);
    if (r?.universeId) return r.universeId;
    throw new UserError("Couldn't find a game with that link or ID.");
  }
  const s = await get(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&sessionId=ro3l0x&pageType=all`, 10 * 60_000).catch(() => null);
  const game = (s?.searchResults || []).find((g) => g.contentGroupType === "Game")?.contents?.[0];
  if (!game) throw new UserError(`No Roblox game found for **${q}**. Try pasting the game link.`);
  return game.universeId;
}

// ---- role sync ------------------------------------------------------------

const rcfg = (guildId) => (config(guildId).roblox ??= { binds: [] });

/** Gives/removes verified + group-rank roles and sets nickname. Returns a summary of changes. */
async function syncMember(member, account) {
  const cfg = rcfg(member.guild.id);
  const add = [];
  const remove = [];
  const role = (id) => member.guild.roles.cache.get(id);

  if (cfg.verifiedRole && role(cfg.verifiedRole)) (account ? add : remove).push(role(cfg.verifiedRole));
  if (cfg.binds.length) {
    const groups = account ? await groupsOf(account.id).catch(() => null) : [];
    if (groups) {
      for (const b of cfg.binds) {
        const r = role(b.roleId);
        if (!r) continue;
        const g = groups.find((x) => String(x.group.id) === String(b.groupId));
        const ok = g && g.role.rank >= b.minRank && (b.maxRank == null || g.role.rank <= b.maxRank);
        (ok ? add : remove).push(r);
      }
    }
  }
  const toAdd = add.filter((r) => !member.roles.cache.has(r.id) && botCanManage(member.guild, r));
  const toRemove = remove.filter((r) => member.roles.cache.has(r.id) && !add.includes(r) && botCanManage(member.guild, r));
  if (toAdd.length) await member.roles.add(toAdd, "Roblox sync").catch(() => {});
  if (toRemove.length) await member.roles.remove(toRemove, "Roblox sync").catch(() => {});

  let nick = null;
  if (account && cfg.nickname && cfg.nickname !== "off" && member.manageable) {
    nick = (cfg.nickname === "display" ? account.displayName : cfg.nickname === "both" ? `${account.displayName} (@${account.name})` : account.name).slice(0, 32);
    if (member.nickname !== nick) await member.setNickname(nick, "Roblox sync").catch(() => {});
  }
  return { added: toAdd, removed: toRemove, nick };
}

const syncText = ({ added, removed, nick }) =>
  [added.length && `➕ ${added.join(", ")}`, removed.length && `➖ ${removed.join(", ")}`, nick && `📝 Nickname: **${nick}**`].filter(Boolean).join("\n") || "No role changes.";

// ---- verification flow ----------------------------------------------------

const pending = new Map(); // discordId -> { userId, name, code, expires }

async function verifyButton(i) {
  const p = pending.get(i.user.id);
  if (!p || p.expires < Date.now()) return i.reply({ content: "This verification expired. Run `/roblox verify` again.", flags: EPHEMERAL });
  await i.deferReply({ flags: EPHEMERAL });
  const u = await get(`https://users.roblox.com/v1/users/${p.userId}`, 0);
  if (!u.description?.includes(p.code)) {
    return i.editReply(`❌ I couldn't find \`${p.code}\` in **${u.name}**'s About section yet.\nMake sure you **saved** it on Roblox, wait ~30 seconds, then press the button again.`);
  }
  pending.delete(i.user.id);
  const account = { id: String(u.id), name: u.name, displayName: u.displayName };
  setLink(i.user.id, "roblox", account);
  const sync = i.inGuild() ? await syncMember(i.member, account) : null;
  return i.editReply(`✅ Verified as **${u.displayName}** (@${u.name})! You can remove the code from your profile now.${sync ? `\n${syncText(sync)}` : ""}`);
}

// ---- auto-sync on join ----------------------------------------------------

async function onJoin(member) {
  const account = getLink(member.id, "roblox");
  if (account) await syncMember(member, account).catch(() => {});
}

// ---- commands -------------------------------------------------------------

const command = new SlashCommandBuilder()
  .setName("roblox")
  .setDescription("Roblox accounts, games and groups")
  .addSubcommand((s) => s.setName("verify").setDescription("Link your Roblox account (proves you own it)").addStringOption((o) => o.setName("username").setDescription("Your Roblox username").setRequired(true).setMaxLength(20)))
  .addSubcommand((s) => s.setName("unlink").setDescription("Unlink your Roblox account"))
  .addSubcommand((s) =>
    s.setName("profile").setDescription("Roblox profile: avatar, status, friends, groups")
      .addStringOption((o) => o.setName("username").setDescription("Roblox username (default: linked)").setMaxLength(20))
      .addUserOption((o) => o.setName("member").setDescription("A member's linked account")),
  )
  .addSubcommand((s) => s.setName("game").setDescription("Live stats for a Roblox game").addStringOption((o) => o.setName("game").setDescription("Game name or link").setRequired(true).setMaxLength(200)))
  .addSubcommand((s) => s.setName("group").setDescription("Info about a Roblox group").addStringOption((o) => o.setName("group").setDescription("Group link or ID").setRequired(true).setMaxLength(200)))
  .addSubcommand((s) => s.setName("update").setDescription("Re-sync Roblox roles").addUserOption((o) => o.setName("member").setDescription("Who (Manage Roles to update others)")))
  .addSubcommand((s) =>
    s.setName("setup").setDescription("Verified role & nickname format (Manage Server)")
      .addRoleOption((o) => o.setName("verified_role").setDescription("Role for verified members"))
      .addStringOption((o) => o.setName("nickname").setDescription("Set nicknames to…").addChoices({ name: "Roblox username", value: "username" }, { name: "Display name", value: "display" }, { name: "Display (@username)", value: "both" }, { name: "Don't change", value: "off" })),
  )
  .addSubcommand((s) =>
    s.setName("bind").setDescription("Give a role for a rank in a Roblox group (Manage Server)")
      .addStringOption((o) => o.setName("group").setDescription("Group link or ID").setRequired(true))
      .addRoleOption((o) => o.setName("role").setDescription("Discord role").setRequired(true))
      .addIntegerOption((o) => o.setName("min_rank").setDescription("Lowest rank number (1-255, default 1 = any member)").setMinValue(1).setMaxValue(255))
      .addIntegerOption((o) => o.setName("max_rank").setDescription("Highest rank number (optional)").setMinValue(1).setMaxValue(255)),
  )
  .addSubcommand((s) => s.setName("unbind").setDescription("Remove a group bind (Manage Server)").addRoleOption((o) => o.setName("role").setDescription("Discord role").setRequired(true)))
  .addSubcommand((s) => s.setName("binds").setDescription("Show Roblox settings and group binds"));

const groupIdFrom = (text) => text.match(/(?:groups|communities)\/(\d+)/)?.[1] || text.match(/^\s*(\d+)\s*$/)?.[1];
const manager = (i) => i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

async function roblox(i) {
  const sub = i.options.getSubcommand();

  if (sub === "verify") {
    const u = await findUser(i.options.getString("username"));
    const code = `RO3L0X-${randomBytes(3).toString("hex").toUpperCase()}`;
    pending.set(i.user.id, { userId: u.id, name: u.name, code, expires: Date.now() + 15 * 60_000 });
    const e = new EmbedBuilder()
      .setColor(RED)
      .setTitle(`🔐 Verify you own ${u.name}`)
      .setDescription(
        `1. Open **[your Roblox profile](https://www.roblox.com/users/${u.id}/profile)** → click the ✏️ next to **About**\n` +
          `2. Paste this code anywhere in it and **Save**:\n\`\`\`${code}\`\`\`\n3. Press **Done** below.\n\nThe code expires ${ts(Date.now() + 15 * 60_000)}.`,
      )
      .setThumbnail((await thumb(`users/avatar-headshot?userIds=${u.id}&size=150x150&format=Png`)) || null);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("rbxverify").setLabel("Done, check it").setStyle(ButtonStyle.Success));
    return i.reply({ embeds: [e], components: [row], flags: EPHEMERAL });
  }

  if (sub === "unlink") {
    const had = removeLink(i.user.id, "roblox");
    if (had && i.inGuild()) await syncMember(i.member, null);
    return i.reply({ content: had ? "🗑️ Unlinked your Roblox account." : "You don't have a Roblox account linked.", flags: EPHEMERAL });
  }

  if (sub === "profile") {
    await i.deferReply();
    const typed = i.options.getString("username");
    const member = i.options.getUser("member");
    let id = null;
    if (typed) id = (await findUser(typed)).id;
    else {
      const linked = getLink((member || i.user).id, "roblox");
      if (!linked) throw new UserError(member ? `${member} hasn't linked Roblox.` : "You haven't linked Roblox. Use `/roblox verify` or type a username.");
      id = linked.id;
    }
    const [u, avatar, friends, followers, groups, status] = await Promise.all([
      get(`https://users.roblox.com/v1/users/${id}`),
      thumb(`users/avatar?userIds=${id}&size=420x420&format=Png`),
      count(`${id}/friends/count`),
      count(`${id}/followers/count`),
      groupsOf(id).catch(() => []),
      presence(id),
    ]);
    const url = `https://www.roblox.com/users/${id}/profile`;
    const e = new EmbedBuilder()
      .setColor(RED)
      .setTitle(`${u.displayName}${u.hasVerifiedBadge ? " ☑️" : ""}`)
      .setURL(url)
      .setDescription(`@${u.name}${u.isBanned ? " • 🚫 **Banned**" : ""}\n${(u.description || "").slice(0, 300)}`)
      .addFields(
        { name: "Status", value: status, inline: true },
        { name: "Friends", value: friends == null ? "?" : n(friends), inline: true },
        { name: "Followers", value: followers == null ? "?" : n(followers), inline: true },
        { name: "Joined", value: `<t:${Math.floor(Date.parse(u.created) / 1000)}:D>`, inline: true },
        { name: "Groups", value: String(groups.length), inline: true },
        { name: "User ID", value: String(u.id), inline: true },
      )
      .setFooter({ text: "Roblox" });
    if (groups.length) {
      const top = groups.sort((a, b) => b.role.rank - a.role.rank).slice(0, 5);
      e.addFields({ name: "Top groups", value: top.map((g) => `**${g.group.name}**: ${g.role.name}`).join("\n").slice(0, 1000) });
    }
    if (avatar) e.setThumbnail(avatar);
    return i.editReply({ embeds: [e] });
  }

  if (sub === "game") {
    await i.deferReply();
    const universe = await findUniverse(i.options.getString("game"));
    const [games, votes, icon] = await Promise.all([
      get(`https://games.roblox.com/v1/games?universeIds=${universe}`, 60_000),
      get(`https://games.roblox.com/v1/games/votes?universeIds=${universe}`, 5 * 60_000).catch(() => null),
      thumb(`games/icons?universeIds=${universe}&size=256x256&format=Png`),
    ]);
    const g = games.data?.[0];
    if (!g) throw new UserError("Couldn't load that game.");
    const v = votes?.data?.[0];
    const likePct = v && v.upVotes + v.downVotes ? Math.round((v.upVotes / (v.upVotes + v.downVotes)) * 100) : null;
    const url = `https://www.roblox.com/games/${g.rootPlaceId}`;
    const e = new EmbedBuilder()
      .setColor(RED)
      .setTitle(g.name)
      .setURL(url)
      .setDescription(`by **${g.creator?.name || "?"}**${g.creator?.hasVerifiedBadge ? " ☑️" : ""}\n${(g.description || "").slice(0, 250)}`)
      .addFields(
        { name: "🟢 Playing now", value: n(g.playing || 0), inline: true },
        { name: "👀 Visits", value: n(g.visits || 0), inline: true },
        { name: "⭐ Favorites", value: n(g.favoritedCount || 0), inline: true },
        { name: "👍 Likes", value: likePct == null ? "?" : `${likePct}%`, inline: true },
        { name: "👥 Server size", value: String(g.maxPlayers || "?"), inline: true },
        { name: "🔄 Updated", value: `<t:${Math.floor(Date.parse(g.updated) / 1000)}:R>`, inline: true },
      )
      .setFooter({ text: `Universe ${universe}` });
    if (icon) e.setThumbnail(icon);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Play on Roblox").setURL(url));
    return i.editReply({ embeds: [e], components: [row] });
  }

  if (sub === "group") {
    await i.deferReply();
    const id = groupIdFrom(i.options.getString("group"));
    if (!id) throw new UserError("Paste the group link (like `roblox.com/communities/123456/...`) or its ID.");
    const [g, icon] = await Promise.all([get(`https://groups.roblox.com/v1/groups/${id}`).catch(() => null), thumb(`groups/icons?groupIds=${id}&size=150x150&format=Png`)]);
    if (!g) throw new UserError("Couldn't find that group.");
    const e = new EmbedBuilder()
      .setColor(RED)
      .setTitle(`${g.name}${g.hasVerifiedBadge ? " ☑️" : ""}`)
      .setURL(`https://www.roblox.com/communities/${id}`)
      .setDescription((g.description || "").slice(0, 400) || null)
      .addFields(
        { name: "Members", value: n(g.memberCount || 0), inline: true },
        { name: "Owner", value: g.owner ? `@${g.owner.username}` : "None", inline: true },
        { name: "Public entry", value: g.publicEntryAllowed ? "Yes" : "No", inline: true },
      );
    if (g.shout?.body) e.addFields({ name: "📢 Shout", value: g.shout.body.slice(0, 500) });
    if (icon) e.setThumbnail(icon);
    return i.editReply({ embeds: [e] });
  }

  // ---- server-side settings & sync ----
  requireGuild(i);
  const cfg = rcfg(i.guildId);

  if (sub === "update") {
    const target = i.options.getUser("member") || i.user;
    if (target.id !== i.user.id && !i.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) throw new UserError("You need **Manage Roles** to update other members.");
    await i.deferReply({ flags: EPHEMERAL });
    const member = await i.guild.members.fetch(target.id).catch(() => null);
    if (!member) throw new UserError("That user isn't in this server.");
    const account = getLink(target.id, "roblox");
    const result = await syncMember(member, account || null);
    return i.editReply(`${account ? `🔄 Synced **${account.name}**.` : "This member isn't verified, so Roblox roles were removed."}\n${syncText(result)}`);
  }

  if (sub === "binds") {
    const e = new EmbedBuilder()
      .setColor(RED)
      .setTitle("🔗 Roblox settings")
      .addFields(
        { name: "Verified role", value: cfg.verifiedRole ? `<@&${cfg.verifiedRole}>` : "None", inline: true },
        { name: "Nicknames", value: { username: "Roblox username", display: "Display name", both: "Display (@username)" }[cfg.nickname] || "Don't change", inline: true },
        { name: "Group binds", value: cfg.binds.map((b) => `Group **${b.groupName || b.groupId}** rank ${b.minRank}${b.maxRank ? `-${b.maxRank}` : "+"} → <@&${b.roleId}>`).join("\n") || "None. Add with `/roblox bind`." },
      );
    return i.reply({ embeds: [e], flags: EPHEMERAL });
  }

  if (!manager(i)) throw new UserError("You need the **Manage Server** permission for that.");

  if (sub === "setup") {
    const role = i.options.getRole("verified_role");
    if (role) {
      assertCanManage(i.guild, role);
      cfg.verifiedRole = role.id;
    }
    const nick = i.options.getString("nickname");
    if (nick) cfg.nickname = nick;
    saveConfig();
    return i.reply({ content: `✅ Saved. Members who \`/roblox verify\` will ${cfg.verifiedRole ? `get <@&${cfg.verifiedRole}>` : "be linked"}${cfg.nickname && cfg.nickname !== "off" ? " and have their nickname updated" : ""}.`, allowedMentions: { parse: [] } });
  }

  if (sub === "bind") {
    const groupId = groupIdFrom(i.options.getString("group"));
    if (!groupId) throw new UserError("Paste the group link or ID.");
    const g = await get(`https://groups.roblox.com/v1/groups/${groupId}`).catch(() => null);
    if (!g) throw new UserError("Couldn't find that group.");
    const role = i.options.getRole("role");
    assertCanManage(i.guild, role);
    cfg.binds = cfg.binds.filter((b) => b.roleId !== role.id);
    cfg.binds.push({ groupId, groupName: g.name, roleId: role.id, minRank: i.options.getInteger("min_rank") || 1, maxRank: i.options.getInteger("max_rank") ?? null });
    saveConfig();
    return i.reply({ content: `✅ Members of **${g.name}** with rank ${i.options.getInteger("min_rank") || 1}${i.options.getInteger("max_rank") ? `-${i.options.getInteger("max_rank")}` : "+"} get ${role} when they verify or run \`/roblox update\`.`, allowedMentions: { parse: [] } });
  }

  if (sub === "unbind") {
    const role = i.options.getRole("role");
    const before = cfg.binds.length;
    cfg.binds = cfg.binds.filter((b) => b.roleId !== role.id);
    saveConfig();
    return i.reply({ content: before === cfg.binds.length ? "No bind for that role." : `🗑️ Removed binds for ${role}.`, allowedMentions: { parse: [] } });
  }
}

export default {
  name: "roblox",
  commands: [command],
  execute: { roblox },
  buttons: { rbxverify: verifyButton },
  events: { guildMemberAdd: onJoin },
  _test: { findUniverse, findUser, groupIdFrom },
};

