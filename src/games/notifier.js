// Posts new free games (and optionally big Steam sales) to each server's chosen channel,
// with prices for that server's region.
import { getGuild, setGuild } from "../storage.js";
import * as deals from "./deals.js";

const EVERY_MS = 2 * 60 * 60_000; // check every 2 hours
const SALE_REPOST_MS = 14 * 24 * 60 * 60_000; // don't repost the same sale within 14 days
const KEEP_MS = 60 * 24 * 60 * 60_000; // forget posted items after 60 days

const regionOf = (guildId) => getGuild(guildId).region || "us";

async function currentItems(region, wantSales) {
  const [epic, steamFree, sales] = await Promise.all([
    deals.epicFreeGames(region).catch((e) => (console.error("[deals] epic:", e.message), { now: [] })),
    deals.steamFreeGames(region).catch((e) => (console.error("[deals] steam free:", e.message), [])),
    wantSales ? deals.steamSales({ region, minDiscount: 75, limit: 8 }).catch(() => []) : [],
  ]);
  return [
    ...epic.now.map((g) => ({ key: g.key, free: true, embed: deals.epicEmbed(g) })),
    ...steamFree.map((g) => ({ key: `steamfree:${g.appId}`, free: true, embed: deals.steamFreeEmbed(g) })),
    ...sales.filter((g) => (g.rating ?? 0) >= 80).slice(0, 3).map((g) => ({ key: `sale:${g.appId}`, free: false, embed: deals.steamSaleEmbed(g) })),
  ];
}

async function checkGuild(client, guildId, items) {
  const cfg = getGuild(guildId).deals;
  if (!cfg?.channelId) return;
  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const posted = { ...(cfg.posted || {}) };
  const now = Date.now();
  for (const [k, t] of Object.entries(posted)) if (now - t > KEEP_MS) delete posted[k];

  const fresh = (items ?? (await currentItems(regionOf(guildId), cfg.sales))).filter((it) => {
    if (!cfg.sales && !it.free) return false;
    const last = posted[it.key];
    return !last || (!it.free && now - last > SALE_REPOST_MS);
  });

  for (const it of fresh) {
    const ping = it.free && cfg.roleId ? `<@&${cfg.roleId}> ` : "";
    try {
      await channel.send({
        content: `${ping}${it.free ? "🎁 **Free game alert!**" : "🔥 **Big Steam sale!**"}`,
        embeds: [it.embed],
        allowedMentions: { roles: cfg.roleId ? [cfg.roleId] : [] },
      });
      posted[it.key] = now;
    } catch (err) {
      console.error(`[deals] couldn't post in ${guildId}:`, err.message);
      break; // probably lost permissions; try again next cycle
    }
  }
  // Re-read in case settings changed while we were posting.
  const latest = getGuild(guildId).deals;
  if (latest?.channelId) setGuild(guildId, { deals: { ...latest, posted } });
}

export function startDealNotifier(client) {
  const checkAll = async () => {
    const ids = [...client.guilds.cache.keys()].filter((id) => getGuild(id).deals?.channelId);
    const byRegion = new Map(); // fetch each region's deals once, shared by all servers using it
    for (const id of ids) {
      const region = regionOf(id);
      if (!byRegion.has(region)) byRegion.set(region, await currentItems(region, true));
      await checkGuild(client, id, byRegion.get(region)).catch((e) => console.error("[deals]", e));
    }
  };
  setTimeout(checkAll, 30_000);
  setInterval(checkAll, EVERY_MS);
  // Called right after /deals setup so the channel gets current freebies immediately.
  return (guildId) => setTimeout(() => checkGuild(client, guildId).catch((e) => console.error("[deals]", e)), 2_000);
}
