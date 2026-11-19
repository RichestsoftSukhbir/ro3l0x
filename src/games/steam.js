// Steam: profiles, levels, owned/recent games. Needs a free key in STEAM_API_KEY.
import { EmbedBuilder } from "discord.js";
import { ApiError, NotFoundError, getJSON } from "./http.js";

const BLUE = 0x1b2838;
const API = "https://api.steampowered.com";
const key = () => process.env.STEAM_API_KEY;
export const steamEnabled = () => Boolean(key());

const call = (path, params, ttl) =>
  getJSON(`${API}/${path}/?key=${key()}&${new URLSearchParams(params)}`, { ttl, service: "Steam" });

function requireKey() {
  if (!steamEnabled()) throw new ApiError("Steam isn't set up on this bot yet. The bot owner needs to add a free `STEAM_API_KEY` (see README).");
}

// Accepts a SteamID64, a profile URL, or a custom URL name. Returns { id, name }.
export async function findSteamUser(input) {
  requireKey();
  const text = input.trim();
  let id = text.match(/(?:profiles\/)?(\d{17})/)?.[1];
  if (!id) {
    const vanity = text.match(/steamcommunity\.com\/id\/([^/?#]+)/)?.[1] || text;
    const r = await call("ISteamUser/ResolveVanityURL/v1", { vanityurl: vanity }, 60 * 60_000);
    if (r.response?.success !== 1) throw new NotFoundError("no such vanity");
    id = r.response.steamid;
  }
  const player = await summary(id);
  return { id, name: player.personaname };
}

async function summary(id) {
  const r = await call("ISteamUser/GetPlayerSummaries/v2", { steamids: id }, 2 * 60_000);
  const player = r.response?.players?.[0];
  if (!player) throw new NotFoundError("no such id");
  return player;
}

async function owned(id) {
  const r = await call("IPlayerService/GetOwnedGames/v1", { steamid: id, include_appinfo: 1, include_played_free_games: 1 }, 10 * 60_000);
  return r.response?.games ? r.response : null; // null = private game details
}

export async function level(id) {
  const r = await call("IPlayerService/GetSteamLevel/v1", { steamid: id }, 30 * 60_000);
  return r.response?.player_level ?? null;
}

const hours = (minutes) => Math.round(minutes / 60).toLocaleString("en-US");
const STATES = ["⚫ Offline", "🟢 Online", "🔴 Busy", "🟡 Away", "🟡 Snooze", "🟢 Looking to trade", "🟢 Looking to play"];
const PRIVATE_NOTE = "🔒 Game details are private. In Steam: *Profile → Edit Profile → Privacy Settings → Game details: Public*.";

export async function profileEmbed(id) {
  requireKey();
  const [p, lvl, games] = await Promise.all([summary(id), level(id).catch(() => null), owned(id).catch(() => null)]);
  const embed = new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(`🎮 ${p.personaname}`)
    .setURL(p.profileurl)
    .setThumbnail(p.avatarfull)
    .addFields({ name: "Status", value: p.gameextrainfo ? `🎮 Playing **${p.gameextrainfo}**` : STATES[p.personastate] || "Unknown", inline: true });

  if (lvl !== null) embed.addFields({ name: "Level", value: String(lvl), inline: true });
  if (p.timecreated) embed.addFields({ name: "Member since", value: `<t:${p.timecreated}:D>`, inline: true });

  if (p.communityvisibilitystate !== 3) {
    embed.setDescription("🔒 This profile is private, so only basic info is visible.");
  } else if (!games) {
    embed.setDescription(PRIVATE_NOTE);
  } else {
    const total = games.games.reduce((s, g) => s + g.playtime_forever, 0);
    const recent = games.games.filter((g) => g.playtime_2weeks).sort((a, b) => b.playtime_2weeks - a.playtime_2weeks).slice(0, 3);
    const top = [...games.games].sort((a, b) => b.playtime_forever - a.playtime_forever).slice(0, 5);
    embed.addFields(
      { name: "Games owned", value: games.game_count.toLocaleString("en-US"), inline: true },
      { name: "Total playtime", value: `${hours(total)} hrs`, inline: true },
      { name: "​", value: "​", inline: true },
      { name: "🏆 Most played", value: top.map((g, i) => `${i + 1}. **${g.name}**: ${hours(g.playtime_forever)} hrs`).join("\n") || "Nothing yet" },
    );
    if (recent.length) {
      embed.addFields({ name: "🕹️ Last 2 weeks", value: recent.map((g) => `**${g.name}**: ${hours(g.playtime_2weeks)} hrs`).join("\n") });
    }
  }
  return embed;
}

export async function gamesEmbed(id) {
  requireKey();
  const [p, games] = await Promise.all([summary(id), owned(id)]);
  const embed = new EmbedBuilder().setColor(BLUE).setTitle(`📚 ${p.personaname}'s games`).setURL(`${p.profileurl}games/`).setThumbnail(p.avatarfull);
  if (!games) return embed.setDescription(PRIVATE_NOTE);
  const top = [...games.games].sort((a, b) => b.playtime_forever - a.playtime_forever).slice(0, 15);
  const never = games.games.filter((g) => g.playtime_forever === 0).length;
  return embed
    .setDescription(top.map((g, i) => `\`${String(i + 1).padStart(2)}\` **${g.name}**: ${hours(g.playtime_forever)} hrs`).join("\n"))
    .setFooter({ text: `${games.game_count} games owned • ${never} never played` });
}

// For leaderboards.
export async function stat(id, which) {
  if (which === "level") return level(id);
  const games = await owned(id);
  if (!games) return null;
  return which === "games" ? games.game_count : Math.round(games.games.reduce((s, g) => s + g.playtime_forever, 0) / 60);
}
