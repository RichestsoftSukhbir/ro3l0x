// Chess.com and Lichess public stats. No API keys needed.
import { EmbedBuilder } from "discord.js";
import { NotFoundError, getJSON } from "./http.js";

const validName = (u) => /^[\w-]{2,30}$/.test(u);

// ---- Chess.com ------------------------------------------------------------

export async function findChessCom(username) {
  if (!validName(username)) throw new NotFoundError("bad name");
  const p = await getJSON(`https://api.chess.com/pub/player/${username.toLowerCase()}`, { ttl: 30 * 60_000, service: "Chess.com" });
  return { username: p.username || username };
}

const ccStats = (u) => getJSON(`https://api.chess.com/pub/player/${u.toLowerCase()}/stats`, { service: "Chess.com" });
const record = (r) => (r ? `${r.win}W / ${r.loss}L / ${r.draw}D` : "");

export async function chessComEmbed(username) {
  const [p, s] = await Promise.all([
    getJSON(`https://api.chess.com/pub/player/${username.toLowerCase()}`, { ttl: 30 * 60_000, service: "Chess.com" }),
    ccStats(username),
  ]);
  const embed = new EmbedBuilder()
    .setColor(0x81b64c)
    .setTitle(`♟️ ${p.title ? `${p.title} ` : ""}${p.username} on Chess.com`)
    .setURL(p.url)
    .setFooter({ text: `Joined ${new Date(p.joined * 1000).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` });
  if (p.avatar) embed.setThumbnail(p.avatar);

  for (const [label, k] of [["⚡ Bullet", "chess_bullet"], ["🔥 Blitz", "chess_blitz"], ["⏱️ Rapid", "chess_rapid"], ["📅 Daily", "chess_daily"]]) {
    const m = s[k];
    if (!m?.last) continue;
    embed.addFields({ name: label, value: `**${m.last.rating}** (best ${m.best?.rating ?? "–"})\n${record(m.record)}`, inline: true });
  }
  const extra = [s.tactics?.highest && `🧩 Puzzles best: **${s.tactics.highest.rating}**`, s.puzzle_rush?.best && `🏃 Puzzle Rush best: **${s.puzzle_rush.best.score}**`].filter(Boolean);
  if (extra.length) embed.addFields({ name: "Puzzles", value: extra.join("\n") });
  if (!embed.data.fields?.length) embed.setDescription("No rated games yet.");
  return embed;
}

// ---- Lichess --------------------------------------------------------------

const liUser = (u) => getJSON(`https://lichess.org/api/user/${encodeURIComponent(u)}`, { service: "Lichess" });

export async function findLichess(username) {
  if (!validName(username)) throw new NotFoundError("bad name");
  const u = await liUser(username);
  if (u.disabled) throw new NotFoundError("closed");
  return { username: u.username };
}

export async function lichessEmbed(username) {
  const u = await liUser(username);
  const embed = new EmbedBuilder()
    .setColor(0xf0f0f0)
    .setTitle(`♞ ${u.title ? `${u.title} ` : ""}${u.username} on Lichess`)
    .setURL(u.url)
    .setFooter({ text: `Joined ${new Date(u.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` });

  for (const [label, k] of [["⚡ Bullet", "bullet"], ["🔥 Blitz", "blitz"], ["⏱️ Rapid", "rapid"], ["🐢 Classical", "classical"], ["🧩 Puzzles", "puzzle"]]) {
    const m = u.perfs?.[k];
    if (!m?.games) continue;
    embed.addFields({ name: label, value: `**${m.rating}${m.prov ? "?" : ""}**\n${m.games.toLocaleString("en-US")} ${k === "puzzle" ? "puzzles" : "games"}`, inline: true });
  }
  if (u.count) {
    const hrs = Math.round((u.playTime?.total || 0) / 3600);
    embed.addFields({ name: "Record", value: `${u.count.win.toLocaleString("en-US")}W / ${u.count.loss.toLocaleString("en-US")}L / ${u.count.draw.toLocaleString("en-US")}D • ${hrs.toLocaleString("en-US")} hrs played` });
  }
  if (!embed.data.fields?.length) embed.setDescription("No rated games yet.");
  return embed;
}

// For leaderboards: returns a rating number or null.
export async function rating(site, username, mode) {
  if (site === "chesscom") return (await ccStats(username))[`chess_${mode}`]?.last?.rating ?? null;
  const m = (await liUser(username)).perfs?.[mode];
  return m?.games ? m.rating : null;
}
