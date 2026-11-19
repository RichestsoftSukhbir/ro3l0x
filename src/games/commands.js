// Slash commands for linking game accounts, stats, leaderboards and deals.
import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { allLinks, config, db, getGuild, getLink, getLinks, persist, removeLink, saveConfig, setGuild, setLink } from "../storage.js";
import * as chess from "./chess.js";
import * as deals from "./deals.js";
import { ApiError, NotFoundError, mapLimit } from "./http.js";
import * as mc from "./minecraft.js";
import * as steam from "./steam.js";

const GAMES = {
  minecraft: { label: "Minecraft", emoji: "⛏️", find: mc.findPlayer, show: (a) => a.name, hint: "your Minecraft Java username" },
  steam: { label: "Steam", emoji: "🎮", find: steam.findSteamUser, show: (a) => a.name, hint: "your Steam profile link, custom URL name, or SteamID64" },
  chesscom: { label: "Chess.com", emoji: "♟️", find: chess.findChessCom, show: (a) => a.username, hint: "your Chess.com username" },
  lichess: { label: "Lichess", emoji: "♞", find: chess.findLichess, show: (a) => a.username, hint: "your Lichess username" },
};
const gameChoices = Object.entries(GAMES).map(([value, g]) => ({ name: g.label, value }));

const LEADERBOARDS = {
  chesscom_rapid: { label: "Chess.com Rapid", game: "chesscom", get: (a) => chess.rating("chesscom", a.username, "rapid") },
  chesscom_blitz: { label: "Chess.com Blitz", game: "chesscom", get: (a) => chess.rating("chesscom", a.username, "blitz") },
  chesscom_bullet: { label: "Chess.com Bullet", game: "chesscom", get: (a) => chess.rating("chesscom", a.username, "bullet") },
  lichess_rapid: { label: "Lichess Rapid", game: "lichess", get: (a) => chess.rating("lichess", a.username, "rapid") },
  lichess_blitz: { label: "Lichess Blitz", game: "lichess", get: (a) => chess.rating("lichess", a.username, "blitz") },
  lichess_bullet: { label: "Lichess Bullet", game: "lichess", get: (a) => chess.rating("lichess", a.username, "bullet") },
  steam_hours: { label: "Steam hours played", game: "steam", unit: "hrs", get: (a) => steam.stat(a.id, "hours") },
  steam_games: { label: "Steam games owned", game: "steam", unit: "games", get: (a) => steam.stat(a.id, "games") },
  steam_level: { label: "Steam level", game: "steam", get: (a) => steam.stat(a.id, "level") },
};

// ---- definitions ----------------------------------------------------------

const memberOpt = (o) => o.setName("member").setDescription("Check someone else's linked account");

export const gameCommandData = [
  new SlashCommandBuilder()
    .setName("link")
    .setDescription("Connect your game account so you (and others) can check your stats")
    .addStringOption((o) => o.setName("game").setDescription("Which game?").setRequired(true).addChoices(...gameChoices))
    .addStringOption((o) => o.setName("account").setDescription("Username, or Steam profile link").setRequired(true).setMaxLength(120)),

  new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Disconnect one of your game accounts")
    .addStringOption((o) => o.setName("game").setDescription("Which game?").setRequired(true).addChoices(...gameChoices)),

  new SlashCommandBuilder()
    .setName("accounts")
    .setDescription("See linked game accounts")
    .addUserOption((o) => o.setName("member").setDescription("Whose accounts? (default: yours)")),

  new SlashCommandBuilder()
    .setName("minecraft")
    .setDescription("Minecraft players and servers")
    .addSubcommand((s) =>
      s.setName("player").setDescription("Skin and info for a player")
        .addStringOption((o) => o.setName("username").setDescription("Minecraft username (default: your linked one)").setMaxLength(16))
        .addUserOption(memberOpt),
    )
    .addSubcommand((s) =>
      s.setName("server").setDescription("Live status of a server (default: this Discord's server)")
        .addStringOption((o) => o.setName("address").setDescription("e.g. play.hypixel.net").setMaxLength(100))
        .addStringOption((o) => o.setName("edition").setDescription("Java or Bedrock").addChoices({ name: "Java", value: "java" }, { name: "Bedrock", value: "bedrock" })),
    )
    .addSubcommand((s) =>
      s.setName("setserver").setDescription("Set this Discord's Minecraft server (Manage Server only)")
        .addStringOption((o) => o.setName("address").setDescription("e.g. play.myserver.net").setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName("edition").setDescription("Java or Bedrock").addChoices({ name: "Java", value: "java" }, { name: "Bedrock", value: "bedrock" })),
    ),

  new SlashCommandBuilder()
    .setName("steam")
    .setDescription("Steam profiles and games")
    .addSubcommand((s) =>
      s.setName("profile").setDescription("Level, status, playtime and most played games")
        .addStringOption((o) => o.setName("account").setDescription("Profile link / custom URL / SteamID (default: linked)").setMaxLength(120))
        .addUserOption(memberOpt),
    )
    .addSubcommand((s) =>
      s.setName("games").setDescription("Top 15 most played games")
        .addStringOption((o) => o.setName("account").setDescription("Profile link / custom URL / SteamID (default: linked)").setMaxLength(120))
        .addUserOption(memberOpt),
    ),

  new SlashCommandBuilder()
    .setName("chess")
    .setDescription("Chess.com or Lichess ratings")
    .addStringOption((o) => o.setName("site").setDescription("Which site? (default: whichever you linked)").addChoices({ name: "Chess.com", value: "chesscom" }, { name: "Lichess", value: "lichess" }))
    .addStringOption((o) => o.setName("username").setDescription("Username (default: your linked one)").setMaxLength(30))
    .addUserOption(memberOpt),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Rank this server's linked players")
    .addStringOption((o) => o.setName("stat").setDescription("What to rank").setRequired(true).addChoices(...Object.entries(LEADERBOARDS).map(([value, l]) => ({ name: l.label, value })))),

  new SlashCommandBuilder()
    .setName("deals")
    .setDescription("Free games and Steam sales with direct links")
    .addSubcommand((s) =>
      s.setName("free").setDescription("Games you can get FREE right now on Epic and Steam")
        .addStringOption((o) => o.setName("region").setDescription("Country (default: your /region)").addChoices(...deals.regionChoices)),
    )
    .addSubcommand((s) =>
      s.setName("steam").setDescription("Best Steam sales right now, in your currency")
        .addNumberOption((o) => o.setName("max_price").setDescription("Only games under this price (in your region's currency)").setMinValue(0))
        .addStringOption((o) => o.setName("region").setDescription("Country (default: your /region)").addChoices(...deals.regionChoices)),
    )
    .addSubcommand((s) =>
      s.setName("setup").setDescription("Auto-post new free games here (Manage Server only)")
        .addChannelOption((o) => o.setName("channel").setDescription("Where to post").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption((o) => o.setName("sales").setDescription("Also post big Steam sales (75%+ off, well reviewed)?"))
        .addRoleOption((o) => o.setName("ping").setDescription("Role to ping for free games (optional)"))
        .addStringOption((o) => o.setName("region").setDescription("Prices for which country? (default: server region)").addChoices(...deals.regionChoices)),
    )
    .addSubcommand((s) => s.setName("off").setDescription("Stop auto-posting deals (Manage Server only)")),

  new SlashCommandBuilder()
    .setName("region")
    .setDescription("Your country for game prices (₹, €, £…)")
    .addSubcommand((s) =>
      s.setName("set").setDescription("Set your country")
        .addStringOption((o) => o.setName("country").setDescription("Country").setRequired(true).addChoices(...deals.regionChoices)),
    )
    .addSubcommand((s) =>
      s.setName("server").setDescription("Set this server's default country (Manage Server)")
        .addStringOption((o) => o.setName("country").setDescription("Country").setRequired(true).addChoices(...deals.regionChoices)),
    )
    .addSubcommand((s) => s.setName("view").setDescription("See which country you're using")),
];

// ---- helpers --------------------------------------------------------------

class UserError extends Error {}

// Region priority: command option > your /region > server default > US.
export const serverRegion = (guildId) => (guildId && config(guildId).region) || "us";
function regionFor(i) {
  return i.options.getString("region") || db("prefs")[i.user.id]?.region || serverRegion(i.guildId);
}
const isManager = (i) => i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

// Figures out whose account to show: typed name > @member's link > your own link.
async function target(interaction, game, typedOpt) {
  const typed = interaction.options.getString(typedOpt);
  if (typed) {
    try {
      return await GAMES[game].find(typed);
    } catch (err) {
      if (err instanceof NotFoundError) throw new UserError(`Couldn't find **${typed}** on ${GAMES[game].label}.`);
      throw err;
    }
  }
  const member = interaction.options.getUser("member");
  const who = member || interaction.user;
  const linked = getLink(who.id, game);
  if (linked) return linked;
  throw new UserError(
    member
      ? `${member} hasn't linked a ${GAMES[game].label} account.`
      : `You haven't linked a ${GAMES[game].label} account. Use \`/link game:${GAMES[game].label} account:...\` or type a username.`,
  );
}

// ---- handlers -------------------------------------------------------------

const run = {
  async link(i) {
    const game = i.options.getString("game");
    const input = i.options.getString("account");
    let account;
    try {
      account = await GAMES[game].find(input);
    } catch (err) {
      if (err instanceof NotFoundError) throw new UserError(`Couldn't find that ${GAMES[game].label} account. Enter ${GAMES[game].hint}.`);
      throw err;
    }
    setLink(i.user.id, game, account);
    return { content: `✅ Linked ${GAMES[game].emoji} **${GAMES[game].label}**: **${GAMES[game].show(account)}**. Others can now see your stats with \`member:\`, and you'll show up on \`/leaderboard\`.` };
  },

  async unlink(i) {
    const game = i.options.getString("game");
    const ok = removeLink(i.user.id, game);
    return { content: ok ? `🗑️ Unlinked your ${GAMES[game].label} account.` : `You don't have a ${GAMES[game].label} account linked.`, ephemeral: true };
  },

  async accounts(i) {
    const user = i.options.getUser("member") || i.user;
    const links = getLinks(user.id);
    const lines = Object.entries(GAMES)
      .filter(([k]) => links[k])
      .map(([k, g]) => `${g.emoji} **${g.label}:** ${g.show(links[k])}`);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: `${user.username}'s game accounts`, iconURL: user.displayAvatarURL() })
      .setDescription(lines.join("\n") || "No accounts linked yet. Use `/link` to connect one!");
    return { embeds: [embed] };
  },

  async minecraft(i) {
    const sub = i.options.getSubcommand();
    if (sub === "player") return { embeds: [mc.playerEmbed(await target(i, "minecraft", "username"))] };

    if (sub === "setserver") {
      if (!i.inGuild()) throw new UserError("This only works in a server.");
      if (!isManager(i)) throw new UserError("You need the **Manage Server** permission to set the server.");
      const address = i.options.getString("address");
      const edition = i.options.getString("edition") || "java";
      setGuild(i.guildId, { mcServer: { address, edition } });
      const status = await mc.serverStatus(address, edition);
      return { content: `✅ Saved! Anyone can now run \`/minecraft server\` to check **${address}**.`, ...status };
    }

    // server
    let address = i.options.getString("address");
    let edition = i.options.getString("edition");
    if (!address) {
      const saved = i.inGuild() ? getGuild(i.guildId).mcServer : null;
      if (!saved) throw new UserError("Give an `address`, or ask an admin to run `/minecraft setserver` to save this Discord's server.");
      address = saved.address;
      edition ||= saved.edition;
    }
    return mc.serverStatus(address, edition || "java");
  },

  async steam(i) {
    const account = await target(i, "steam", "account");
    const sub = i.options.getSubcommand();
    return { embeds: [sub === "games" ? await steam.gamesEmbed(account.id) : await steam.profileEmbed(account.id)] };
  },

  async chess(i) {
    let site = i.options.getString("site");
    if (!site) {
      const who = i.options.getUser("member") || i.user;
      site = getLink(who.id, "chesscom") || !getLink(who.id, "lichess") ? "chesscom" : "lichess";
    }
    const account = await target(i, site, "username");
    return { embeds: [site === "chesscom" ? await chess.chessComEmbed(account.username) : await chess.lichessEmbed(account.username)] };
  },

  async leaderboard(i) {
    if (!i.inGuild()) throw new UserError("Leaderboards only work in a server.");
    const board = LEADERBOARDS[i.options.getString("stat")];
    const candidates = allLinks().filter(([, l]) => l[board.game]);
    // Keep only people who are in this server (max 100 checks).
    const inGuild = await mapLimit(candidates.slice(0, 100), 5, async ([id, l]) => ((await i.guild.members.fetch(id).catch(() => null)) ? [id, l] : null));
    const members = inGuild.filter(Boolean);
    const values = await mapLimit(members, 4, async ([id, l]) => ({ id, value: await board.get(l[board.game]) }));
    const ranked = values.filter((v) => v && typeof v.value === "number").sort((a, b) => b.value - a.value).slice(0, 10);

    const medals = ["🥇", "🥈", "🥉"];
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`🏆 ${i.guild.name}: ${board.label}`)
      .setDescription(
        ranked.map((r, n) => `${medals[n] || `\`#${n + 1}\``} <@${r.id}> — **${r.value.toLocaleString("en-US")}**${board.unit ? ` ${board.unit}` : ""}`).join("\n") ||
          `Nobody here has linked ${GAMES[board.game].label} yet. Be the first with \`/link\`!`,
      )
      .setFooter({ text: `${members.length} linked player(s) • link yours with /link` });
    return { embeds: [embed], allowedMentions: { parse: [] } };
  },

  async deals(i) {
    const sub = i.options.getSubcommand();

    if (sub === "free") {
      const region = regionFor(i);
      const [epic, steamFree] = await Promise.all([deals.epicFreeGames(region), deals.steamFreeGames(region).catch(() => [])]);
      const embeds = [...epic.now.map(deals.epicEmbed), ...steamFree.slice(0, 3).map(deals.steamFreeEmbed)];
      const notes = [`📍 Prices for **${deals.regionLabel(region)}** • change with \`/region set\``];
      if (!steamFree.length) notes.push("No paid Steam games are 100% off right now.");
      if (epic.next.length) notes.push(`⏭️ **Next on Epic:** ${epic.next.map((g) => `[${g.title}](${g.url}) (<t:${Math.floor(new Date(g.start) / 1000)}:R>)`).join(", ")}`);
      if (!embeds.length) notes.push("No free games right now. Check back soon!");
      return { content: notes.join("\n"), embeds: embeds.slice(0, 10) };
    }

    if (sub === "steam") {
      const region = regionFor(i);
      const max = i.options.getNumber("max_price");
      const sales = await deals.steamSales({ region, maxPrice: max ?? undefined });
      const title = max != null ? `🔥 Best Steam deals under ${max} (${deals.REGIONS[region]?.name || region})` : `🔥 Best Steam deals • ${deals.regionLabel(region)}`;
      return { embeds: [deals.salesListEmbed(sales, region, title)] };
    }

    if (!i.inGuild()) throw new UserError("This only works in a server.");
    if (!isManager(i)) throw new UserError("You need the **Manage Server** permission to change deal alerts.");

    if (sub === "off") {
      setGuild(i.guildId, { deals: null });
      return { content: "🔕 Deal alerts turned off." };
    }

    // setup
    const channel = i.options.getChannel("channel");
    const perms = channel.permissionsFor(i.guild.members.me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      throw new UserError(`I can't post in ${channel}. Give me **View Channel**, **Send Messages** and **Embed Links** there.`);
    }
    const sales = i.options.getBoolean("sales") ?? false;
    const role = i.options.getRole("ping");
    const region = i.options.getString("region") || serverRegion(i.guildId);
    setGuild(i.guildId, { region, deals: { channelId: channel.id, sales, roleId: role?.id || null, posted: getGuild(i.guildId).deals?.posted || {} } });
    checkDealsSoon?.(i.guildId);
    return {
      content: `✅ I'll post new free games from **Epic** and **Steam**${sales ? " and big **Steam sales**" : ""} in ${channel}${role ? `, pinging ${role}` : ""}, with prices for **${deals.regionLabel(region)}**. Current free games are being posted now.`,
      allowedMentions: { parse: [] },
    };
  },
};

run.region = async (i) => {
  const sub = i.options.getSubcommand();
  if (sub === "view") {
    const mine = db("prefs")[i.user.id]?.region;
    const server = i.inGuild() ? serverRegion(i.guildId) : null;
    return {
      content: `📍 Your prices: **${deals.regionLabel(mine || server || "us")}**${mine ? "" : " (server default)"}${server ? `\n🏠 Server default: **${deals.regionLabel(server)}**` : ""}`,
      ephemeral: true,
    };
  }
  const country = i.options.getString("country");
  if (sub === "server") {
    if (!i.inGuild()) throw new UserError("This only works in a server.");
    if (!isManager(i)) throw new UserError("You need the **Manage Server** permission to set the server's country.");
    config(i.guildId).region = country;
    saveConfig();
    return { content: `🏠 Server default set to **${deals.regionLabel(country)}**. Deal alerts and anyone without their own \`/region\` will see these prices.` };
  }
  const prefs = db("prefs");
  prefs[i.user.id] = { ...prefs[i.user.id], region: country };
  persist("prefs", 0);
  return { content: `📍 Got it! You'll see prices for **${deals.regionLabel(country)}** in \`/deals\`.`, ephemeral: true };
};

let checkDealsSoon = null;
export function onDealsSetup(fn) {
  checkDealsSoon = fn;
}

// Runs a game command: defers (APIs can be slow), then edits in the result or a friendly error.
export async function executeGameCommand(interaction) {
  const handler = run[interaction.commandName];
  if (!handler) return false;
  const quick = interaction.commandName === "unlink" || interaction.commandName === "region";
  await interaction.deferReply(quick ? { flags: MessageFlags.Ephemeral } : {});
  try {
    const { ephemeral, ...result } = await handler(interaction);
    await interaction.editReply(result);
  } catch (err) {
    const known = err instanceof UserError || err instanceof ApiError;
    if (!known) console.error(`[/${interaction.commandName}]`, err);
    await interaction.editReply({ content: `⚠️ ${known ? err.message : "Something went wrong. Try again."}`, embeds: [], files: [] });
  }
  return true;
}

export const gameCommandNames = new Set(Object.keys(run));
export { GAMES };
