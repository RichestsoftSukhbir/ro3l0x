// Free games (Epic + Steam) and Steam sales, priced for the viewer's country. No API keys needed.
// Which games are on sale: CheapShark (deal-rated) + Steam's own regional "specials".
// Prices: Steam's store API in the region's currency, so ₹ for India, € for Europe, etc.
import { EmbedBuilder } from "discord.js";
import { getJSON } from "./http.js";

// Steam store regions people can pick. `cc` is the Steam/Epic country code.
export const REGIONS = {
  in: { name: "India", flag: "🇮🇳" },
  us: { name: "United States", flag: "🇺🇸" },
  gb: { name: "United Kingdom", flag: "🇬🇧" },
  de: { name: "Europe (Euro)", flag: "🇪🇺" },
  pl: { name: "Poland", flag: "🇵🇱" },
  ca: { name: "Canada", flag: "🇨🇦" },
  au: { name: "Australia", flag: "🇦🇺" },
  br: { name: "Brazil", flag: "🇧🇷" },
  mx: { name: "Mexico", flag: "🇲🇽" },
  ar: { name: "Argentina / LatAm", flag: "🇦🇷" },
  tr: { name: "Turkey / MENA", flag: "🇹🇷" },
  ae: { name: "UAE", flag: "🇦🇪" },
  sa: { name: "Saudi Arabia", flag: "🇸🇦" },
  pk: { name: "Pakistan / South Asia", flag: "🇵🇰" },
  bd: { name: "Bangladesh", flag: "🇧🇩" },
  id: { name: "Indonesia", flag: "🇮🇩" },
  ph: { name: "Philippines", flag: "🇵🇭" },
  my: { name: "Malaysia", flag: "🇲🇾" },
  sg: { name: "Singapore", flag: "🇸🇬" },
  th: { name: "Thailand", flag: "🇹🇭" },
  vn: { name: "Vietnam", flag: "🇻🇳" },
  jp: { name: "Japan", flag: "🇯🇵" },
  kr: { name: "South Korea", flag: "🇰🇷" },
  za: { name: "South Africa", flag: "🇿🇦" },
  ua: { name: "Ukraine / CIS", flag: "🇺🇦" },
};
export const regionChoices = Object.entries(REGIONS).map(([value, r]) => ({ name: `${r.flag} ${r.name}`, value }));
export const regionLabel = (cc) => (REGIONS[cc] ? `${REGIONS[cc].flag} ${REGIONS[cc].name}` : cc.toUpperCase());

const EPIC_COLOR = 0x2a2a2a;
const STEAM_COLOR = 0x1b2838;
const steamUrl = (id) => `https://store.steampowered.com/app/${id}/`;
const steamImg = (id) => `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;
const unix = (iso) => Math.floor(new Date(iso).getTime() / 1000);

// ---- Epic -----------------------------------------------------------------

function epicSlug(e) {
  const page = (e.catalogNs?.mappings || []).find((m) => m.pageType === "productHome") || e.catalogNs?.mappings?.[0];
  return page?.pageSlug || e.offerMappings?.[0]?.pageSlug || e.productSlug?.replace(/\/home$/, "") || e.urlSlug;
}

// Returns { now: [...], next: [...] } of { key, title, url, image, start, end, worth }.
export async function epicFreeGames(region = "us") {
  const country = region.toUpperCase();
  const d = await getJSON(`https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=${country}&allowCountries=${country}`, {
    ttl: 30 * 60_000,
    service: "Epic Games Store",
  });
  const now = [];
  const next = [];
  for (const e of d?.data?.Catalog?.searchStore?.elements || []) {
    if (/mystery/i.test(e.title)) continue;
    const slug = epicSlug(e);
    const img = (e.keyImages || []).find((k) => k.type === "OfferImageWide") || (e.keyImages || []).find((k) => k.type === "Thumbnail");
    const price = e.price?.totalPrice;
    const base = {
      title: e.title,
      url: slug ? `https://store.epicgames.com/en-US/p/${slug}` : "https://store.epicgames.com/en-US/free-games",
      image: img?.url,
      worth: price?.fmtPrice?.originalPrice && price.originalPrice > 0 ? price.fmtPrice.originalPrice : null,
    };
    const free = (o) => o.discountSetting?.discountPercentage === 0; // Epic encodes 100% off as 0
    const cur = (e.promotions?.promotionalOffers || []).flatMap((g) => g.promotionalOffers).find(free);
    const up = (e.promotions?.upcomingPromotionalOffers || []).flatMap((g) => g.promotionalOffers).find(free);
    if (cur && price?.discountPrice === 0) now.push({ ...base, key: `epic:${e.id}:${cur.startDate}`, start: cur.startDate, end: cur.endDate });
    else if (up) next.push({ ...base, key: `epic-next:${e.id}:${up.startDate}`, start: up.startDate, end: up.endDate });
  }
  return { now, next };
}

export function epicEmbed(g) {
  const e = new EmbedBuilder()
    .setColor(EPIC_COLOR)
    .setAuthor({ name: "Epic Games Store • FREE" })
    .setTitle(`🎁 ${g.title}`)
    .setURL(g.url)
    .setDescription(`${g.worth ? `~~${g.worth}~~ → ` : ""}**FREE** to keep\nEnds <t:${unix(g.end)}:R> (<t:${unix(g.end)}:f>)\n\n**[👉 Claim on Epic](${g.url})**`);
  if (g.image) e.setImage(g.image);
  return e;
}

// ---- Steam ----------------------------------------------------------------

const cheapshark = (params) =>
  getJSON(`https://www.cheapshark.com/api/1.0/deals?storeID=1&${new URLSearchParams(params)}`, { ttl: 30 * 60_000, service: "the deals API" });

const steamFeatured = (cc) => getJSON(`https://store.steampowered.com/api/featuredcategories?cc=${cc}&l=en`, { ttl: 30 * 60_000, service: "Steam store" });

/** Regional prices for many apps: Map(appId -> price_overview | null). Batched, cached 30 min. */
async function steamPrices(appIds, cc) {
  const out = new Map();
  const ids = [...new Set(appIds.map(String))];
  for (let k = 0; k < ids.length; k += 25) {
    const chunk = ids.slice(k, k + 25);
    const d = await getJSON(`https://store.steampowered.com/api/appdetails?appids=${chunk.join(",")}&cc=${cc}&filters=price_overview`, {
      ttl: 30 * 60_000,
      service: "Steam store",
    }).catch(() => ({}));
    for (const id of chunk) {
      const po = d?.[id]?.data?.price_overview;
      out.set(id, po && typeof po === "object" ? po : null);
    }
  }
  return out;
}

// Candidate sale games: CheapShark's best-rated deals plus Steam's own regional specials.
async function candidates(cc, cheapsharkParams) {
  const [shark, featured] = await Promise.all([cheapshark(cheapsharkParams).catch(() => []), steamFeatured(cc).catch(() => null)]);
  const list = shark
    .filter((d) => d.steamAppID)
    .map((d) => ({ appId: String(d.steamAppID), title: d.title, rating: Number(d.steamRatingPercent) || null, reviews: d.steamRatingText, metacritic: Number(d.metacriticScore) || null }));
  for (const f of featured?.specials?.items || []) {
    if (f.discounted && !list.some((x) => x.appId === String(f.id))) list.push({ appId: String(f.id), title: f.name, rating: null, reviews: null, metacritic: null });
  }
  return list;
}

function toItem(c, po, cc) {
  return {
    ...c,
    key: `steam:${c.appId}:${cc}:${po.final}`,
    url: steamUrl(c.appId),
    image: steamImg(c.appId),
    was: po.initial_formatted || po.final_formatted,
    now: po.final_formatted,
    price: po.final / 100,
    savings: po.discount_percent,
    region: cc,
  };
}

/** Paid Steam games that are currently 100% off (free to keep) in this region. */
export async function steamFreeGames(region = "us") {
  const list = await candidates(region, { upperPrice: 0, pageSize: 20, onSale: 1 });
  if (!list.length) return [];
  const prices = await steamPrices(list.map((c) => c.appId), region);
  return list.flatMap((c) => {
    const po = prices.get(c.appId);
    return po && po.final === 0 && po.initial > 0 ? [toItem(c, po, region)] : [];
  });
}

/** Good Steam sales in this region. maxPrice is in the region's currency. */
export async function steamSales({ region = "us", maxPrice, minDiscount = 50, limit = 10 } = {}) {
  const list = await candidates(region, { sortBy: "Deal Rating", pageSize: 60, onSale: 1, steamRating: 70 });
  const prices = await steamPrices(list.map((c) => c.appId), region);
  const out = [];
  for (const c of list) {
    const po = prices.get(c.appId);
    if (!po || po.final === 0 || po.discount_percent < minDiscount) continue;
    if (maxPrice !== undefined && maxPrice !== null && po.final / 100 > maxPrice) continue;
    out.push(toItem(c, po, region));
    if (out.length >= limit) break;
  }
  return out;
}

export function steamFreeEmbed(g) {
  return new EmbedBuilder()
    .setColor(STEAM_COLOR)
    .setAuthor({ name: "Steam • FREE" })
    .setTitle(`🎁 ${g.title}`)
    .setURL(g.url)
    .setDescription(`~~${g.was}~~ → **FREE** to keep for a limited time\n\n**[👉 Get it on Steam](${g.url})**`)
    .setImage(g.image);
}

export function steamSaleEmbed(g) {
  const e = new EmbedBuilder()
    .setColor(STEAM_COLOR)
    .setAuthor({ name: `Steam sale • -${g.savings}% • ${regionLabel(g.region)}` })
    .setTitle(`🔥 ${g.title}`)
    .setURL(g.url)
    .setDescription(`~~${g.was}~~ → **${g.now}** (-${g.savings}%)\n\n**[👉 View on Steam](${g.url})**`)
    .setImage(g.image);
  if (g.rating) e.addFields({ name: "Reviews", value: `${g.reviews || ""} (${g.rating}%)`, inline: true });
  if (g.metacritic) e.addFields({ name: "Metacritic", value: String(g.metacritic), inline: true });
  return e;
}

export function salesListEmbed(sales, region, title = "🔥 Best Steam deals right now") {
  return new EmbedBuilder()
    .setColor(STEAM_COLOR)
    .setTitle(title)
    .setURL("https://store.steampowered.com/specials")
    .setDescription(
      sales
        .map((g, i) => `**${i + 1}. [${g.title}](${g.url})**\n~~${g.was}~~ → **${g.now}** (-${g.savings}%)${g.rating ? ` • 👍 ${g.rating}%` : ""}`)
        .join("\n\n")
        .slice(0, 4000) || "No deals found right now for this region.",
    )
    .setThumbnail(sales[0]?.image || null)
    .setFooter({ text: `Prices for ${REGIONS[region]?.name || region.toUpperCase()} • change with /region set` });
}
