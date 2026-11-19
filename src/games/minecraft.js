// Minecraft: player lookup (Mojang) and server status (mcsrvstat.us). No API keys needed.
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { ApiError, NotFoundError, getJSON } from "./http.js";

const GREEN = 0x5b8731;
const dashed = (id) => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

// Returns { name, uuid } or throws NotFoundError.
export async function findPlayer(username) {
  if (!/^\w{3,16}$/.test(username)) throw new NotFoundError("bad name");
  try {
    const data = await getJSON(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`, { ttl: 30 * 60_000, service: "Mojang" });
    return { name: data.name, uuid: data.id };
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    // Mojang rate-limits often; PlayerDB is a free mirror.
    const res = await fetch(`https://playerdb.co/api/player/minecraft/${encodeURIComponent(username)}`, {
      headers: { "User-Agent": "DiscordStatsBot/1.0" },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    const p = body?.data?.player;
    if (p?.raw_id) return { name: p.username, uuid: p.raw_id };
    if (body?.code === "minecraft.invalid_username" || body?.code === "minecraft.api_failure") throw new NotFoundError("not found");
    throw err;
  }
}

// Normalizes mcstatus.io (primary) and mcsrvstat.us (backup) into one shape.
async function fetchStatus(host, edition) {
  const fromMcstatus = async () => {
    const d = await getJSON(`https://api.mcstatus.io/v2/status/${edition}/${encodeURIComponent(host)}`, { ttl: 60_000, service: "the server status API" });
    return {
      online: d.online,
      players: d.players?.online ?? 0,
      max: d.players?.max ?? 0,
      names: (d.players?.list || []).map((p) => p.name_clean || p.name_raw).filter(Boolean),
      version: d.version?.name_clean || d.version?.name || null,
      motd: d.motd?.clean || "",
      icon: d.icon,
    };
  };
  const fromMcsrvstat = async () => {
    const d = await getJSON(`https://api.mcsrvstat.us/${edition === "bedrock" ? "bedrock/3" : "3"}/${encodeURIComponent(host)}`, { ttl: 60_000, service: "the server status API" });
    return {
      online: d.online,
      players: d.players?.online ?? 0,
      max: d.players?.max ?? 0,
      names: (d.players?.list || []).map((p) => p.name).filter(Boolean),
      version: d.version || null,
      motd: (d.motd?.clean || []).join("\n"),
      icon: d.icon,
    };
  };
  const first = await fromMcstatus().catch(() => null);
  if (first?.online) return first;
  const second = await fromMcsrvstat().catch(() => null);
  if (second?.online) return second;
  if (!first && !second) throw new ApiError("Couldn't reach the server status services. Try again in a bit.");
  return { online: false };
}

export function playerEmbed({ name, uuid }) {
  return new EmbedBuilder()
    .setColor(GREEN)
    .setTitle(`⛏️ ${name}`)
    .setURL(`https://namemc.com/profile/${uuid}`)
    .setThumbnail(`https://mc-heads.net/avatar/${uuid}/128`)
    .setImage(`https://mc-heads.net/body/${uuid}/right`)
    .addFields(
      { name: "UUID", value: `\`${dashed(uuid)}\`` },
      { name: "Links", value: `[NameMC](https://namemc.com/profile/${uuid}) • [Download skin](https://mc-heads.net/skin/${uuid})` },
    );
}

// Returns { embeds, files } describing the server's live status.
export async function serverStatus(address, edition = "java") {
  const host = address.trim().toLowerCase();
  if (!/^[a-z0-9.\-:]{3,100}$/.test(host)) throw new ApiError("That doesn't look like a server address (example: `play.hypixel.net`).");
  const d = await fetchStatus(host, edition === "bedrock" ? "bedrock" : "java");

  const embed = new EmbedBuilder().setTitle(`🖥️ ${host}`).setFooter({ text: `${edition === "bedrock" ? "Bedrock" : "Java"} Edition • updates every minute` });
  if (!d.online) {
    return { embeds: [embed.setColor(0xd9534f).setDescription("🔴 **Offline** (or the address is wrong).")], files: [] };
  }

  const motd = d.motd.split("\n").map((l) => l.trim()).filter(Boolean).join("\n").replace(/`/g, "'");
  embed
    .setColor(GREEN)
    .setDescription(`🟢 **Online**${motd ? `\n\`\`\`\n${motd.slice(0, 500)}\n\`\`\`` : ""}`)
    .addFields(
      { name: "Players", value: `${d.players.toLocaleString("en-US")} / ${d.max.toLocaleString("en-US")}`, inline: true },
      { name: "Version", value: String(d.version || "unknown").slice(0, 100), inline: true },
    );
  const names = d.names.slice(0, 20);
  if (names.length) embed.addFields({ name: "Online now", value: names.join(", ").slice(0, 1000) });

  const files = [];
  if (typeof d.icon === "string" && d.icon.startsWith("data:image/png;base64,")) {
    files.push(new AttachmentBuilder(Buffer.from(d.icon.split(",")[1], "base64"), { name: "icon.png" }));
    embed.setThumbnail("attachment://icon.png");
  }
  return { embeds: [embed], files };
}
