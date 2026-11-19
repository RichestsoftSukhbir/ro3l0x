// Social alerts: YouTube uploads (free RSS, no key) and Twitch go-live (free Twitch app keys).
import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { config, saveConfig } from "../storage.js";
import { COLORS, EPHEMERAL, UserError, assertCanPost, requireGuild, sendTo } from "../util.js";

let client = null;
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const alertsOf = (guildId) => (config(guildId).alerts ??= { youtube: [], twitch: [] });

async function get(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(12_000) }).catch(() => null);
  if (!res) throw new UserError("Couldn't reach the service. Try again in a bit.");
  return res;
}

// ---- YouTube --------------------------------------------------------------

async function ytFeed(channelId) {
  const res = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (!res.ok) return null;
  const xml = await res.text();
  const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const name = unescape(xml.match(/<author>\s*<name>([^<]*)<\/name>/)?.[1] || "");
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: e.match(/<yt:videoId>([^<]+)</)?.[1],
    title: unescape(e.match(/<title>([^<]*)</)?.[1] || ""),
    published: Date.parse(e.match(/<published>([^<]+)</)?.[1] || 0),
  })).filter((v) => v.id);
  return { name, videos };
}

/** Accepts a channel URL, @handle, or UC... channel ID. Returns { id, name }. */
async function resolveYouTube(input) {
  const text = input.trim();
  let id = text.match(/(UC[\w-]{22})/)?.[1];
  if (!id) {
    const handle = text.match(/youtube\.com\/(@[\w.-]+|c\/[\w.-]+|user\/[\w.-]+)/i)?.[1] || (text.startsWith("@") ? text : `@${text}`);
    const res = await get(`https://www.youtube.com/${handle}`, { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en-US", Cookie: "CONSENT=YES+1" } });
    if (!res.ok) throw new UserError("Couldn't find that YouTube channel. Paste the channel link (like `https://youtube.com/@name`).");
    const html = await res.text();
    // The page's own channel ID appears far more often than any other.
    const counts = {};
    for (const [, c] of html.matchAll(/"(?:browseId|channelId|externalId)":"(UC[\w-]{22})"/g)) counts[c] = (counts[c] || 0) + 1;
    id = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  const feed = id && (await ytFeed(id));
  if (!feed) throw new UserError("Couldn't find that YouTube channel. Paste the channel link (like `https://youtube.com/@name`).");
  return { id, name: feed.name, seen: feed.videos.map((v) => v.id) };
}

async function checkYouTube() {
  const feeds = new Map();
  for (const guild of client.guilds.cache.values()) {
    const subs = config(guild.id).alerts?.youtube || [];
    let changed = false;
    for (const s of subs) {
      if (!feeds.has(s.id)) feeds.set(s.id, await ytFeed(s.id).catch(() => null));
      const feed = feeds.get(s.id);
      if (!feed) continue;
      // New = not seen before and published after we started following (ignores old videos resurfacing).
      const fresh = feed.videos.filter((v) => !s.seen.includes(v.id) && v.published > (s.since || 0)).reverse();
      for (const v of fresh.slice(-3)) {
        const ping = s.roleId ? `<@&${s.roleId}> ` : "";
        await sendTo(client, s.channelId, {
          content: `${ping}📺 **${feed.name || s.name}** just uploaded: **${v.title}**\nhttps://www.youtube.com/watch?v=${v.id}`,
          allowedMentions: { roles: s.roleId ? [s.roleId] : [] },
        });
      }
      if (fresh.length) {
        s.seen = [...new Set([...feed.videos.map((v) => v.id), ...s.seen])].slice(0, 50);
        changed = true;
      }
    }
    if (changed) saveConfig();
  }
}

// ---- Twitch ---------------------------------------------------------------

const twitchEnabled = () => Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
let twitchToken = { value: null, expires: 0 };

async function helix(path) {
  if (!twitchEnabled()) throw new UserError("Twitch alerts aren't set up yet. The bot owner needs to add free `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` keys (see README).");
  if (!twitchToken.value || twitchToken.expires < Date.now() + 60_000) {
    const res = await get(`https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!data.access_token) throw new UserError("Twitch rejected the bot's keys. Check TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET.");
    twitchToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  }
  const res = await get(`https://api.twitch.tv/helix/${path}`, { headers: { "Client-Id": process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${twitchToken.value}` } });
  if (res.status === 401) twitchToken.value = null;
  if (!res.ok) throw new UserError(`Twitch returned an error (${res.status}).`);
  return res.json();
}

async function checkTwitch() {
  if (!twitchEnabled()) return;
  const logins = new Set();
  for (const guild of client.guilds.cache.values()) for (const s of config(guild.id).alerts?.twitch || []) logins.add(s.login);
  if (!logins.size) return;
  const live = new Map();
  const all = [...logins];
  for (let k = 0; k < all.length; k += 100) {
    const data = await helix(`streams?${all.slice(k, k + 100).map((l) => `user_login=${encodeURIComponent(l)}`).join("&")}`).catch(() => null);
    for (const st of data?.data || []) live.set(st.user_login.toLowerCase(), st);
  }
  for (const guild of client.guilds.cache.values()) {
    let changed = false;
    for (const s of config(guild.id).alerts?.twitch || []) {
      const st = live.get(s.login);
      if (!st || s.lastStream === st.id) continue;
      s.lastStream = st.id;
      changed = true;
      const url = `https://www.twitch.tv/${st.user_login}`;
      const e = new EmbedBuilder()
        .setColor(0x9146ff)
        .setAuthor({ name: `${st.user_name} is live on Twitch!`, url })
        .setTitle(st.title || "Live now")
        .setURL(url)
        .addFields({ name: "Game", value: st.game_name || "Unknown", inline: true }, { name: "Viewers", value: String(st.viewer_count), inline: true })
        .setImage(`${st.thumbnail_url.replace("{width}", "1280").replace("{height}", "720")}?t=${Date.now()}`)
        .setFooter({ text: "Started" })
        .setTimestamp(new Date(st.started_at));
      await sendTo(client, s.channelId, {
        content: `${s.roleId ? `<@&${s.roleId}> ` : ""}🔴 **${st.user_name}** is live! ${url}`,
        embeds: [e],
        allowedMentions: { roles: s.roleId ? [s.roleId] : [] },
      });
    }
    if (changed) saveConfig();
  }
}

// ---- commands -------------------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("alerts")
    .setDescription("YouTube upload & Twitch live alerts (admins)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName("youtube").setDescription("Post when a YouTube channel uploads")
        .addStringOption((o) => o.setName("channel").setDescription("YouTube channel link or @handle").setRequired(true).setMaxLength(200))
        .addChannelOption((o) => o.setName("post_in").setDescription("Discord channel to post in").setRequired(true))
        .addRoleOption((o) => o.setName("ping").setDescription("Role to ping (optional)")),
    )
    .addSubcommand((s) =>
      s.setName("twitch").setDescription("Post when a Twitch streamer goes live")
        .addStringOption((o) => o.setName("username").setDescription("Twitch username").setRequired(true).setMaxLength(25))
        .addChannelOption((o) => o.setName("post_in").setDescription("Discord channel to post in").setRequired(true))
        .addRoleOption((o) => o.setName("ping").setDescription("Role to ping (optional)")),
    )
    .addSubcommand((s) => s.setName("list").setDescription("Show all alerts"))
    .addSubcommand((s) =>
      s.setName("remove").setDescription("Remove an alert")
        .addStringOption((o) => o.setName("name").setDescription("YouTube channel name or Twitch username (see /alerts list)").setRequired(true).setMaxLength(100)),
    ),
];

const execute = {
  async alerts(i) {
    requireGuild(i);
    const a = alertsOf(i.guildId);
    const sub = i.options.getSubcommand();

    if (sub === "list") {
      const yt = a.youtube.map((s) => `📺 **${s.name}** → <#${s.channelId}>${s.roleId ? ` (pings <@&${s.roleId}>)` : ""}`);
      const tw = a.twitch.map((s) => `🟣 **${s.login}** → <#${s.channelId}>${s.roleId ? ` (pings <@&${s.roleId}>)` : ""}`);
      const e = new EmbedBuilder().setColor(COLORS.main).setTitle("🔔 Alerts").setDescription([...yt, ...tw].join("\n") || "No alerts yet. Add one with `/alerts youtube` or `/alerts twitch`.");
      if (!twitchEnabled()) e.setFooter({ text: "Twitch alerts need TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET in .env" });
      return i.reply({ embeds: [e], flags: EPHEMERAL });
    }

    if (sub === "remove") {
      const name = i.options.getString("name").toLowerCase().trim();
      const before = a.youtube.length + a.twitch.length;
      a.youtube = a.youtube.filter((s) => s.name.toLowerCase() !== name && s.id.toLowerCase() !== name);
      a.twitch = a.twitch.filter((s) => s.login !== name);
      if (before === a.youtube.length + a.twitch.length) throw new UserError("No alert with that name. See `/alerts list`.");
      saveConfig();
      return i.reply({ content: "🗑️ Alert removed.", flags: EPHEMERAL });
    }

    const post = i.options.getChannel("post_in");
    assertCanPost(post, i.guild);
    const roleId = i.options.getRole("ping")?.id || null;
    if (a.youtube.length + a.twitch.length >= 25) throw new UserError("You can have up to 25 alerts per server.");
    await i.deferReply({ flags: EPHEMERAL });

    if (sub === "youtube") {
      const ch = await resolveYouTube(i.options.getString("channel"));
      a.youtube = a.youtube.filter((s) => !(s.id === ch.id && s.channelId === post.id));
      a.youtube.push({ id: ch.id, name: ch.name, channelId: post.id, roleId, seen: ch.seen, since: Date.now() });
      saveConfig();
      return i.editReply(`✅ I'll post in ${post} when **${ch.name}** uploads. (Checked every 10 minutes.)`);
    }

    // twitch
    const login = i.options.getString("username").toLowerCase().replace(/^@/, "").trim();
    const users = await helix(`users?login=${encodeURIComponent(login)}`);
    const u = users.data?.[0];
    if (!u) throw new UserError(`No Twitch user named **${login}**.`);
    const streams = await helix(`streams?user_login=${encodeURIComponent(u.login)}`);
    a.twitch = a.twitch.filter((s) => !(s.login === u.login && s.channelId === post.id));
    a.twitch.push({ login: u.login, name: u.display_name, channelId: post.id, roleId, lastStream: streams.data?.[0]?.id || null });
    saveConfig();
    return i.editReply(`✅ I'll post in ${post} when **${u.display_name}** goes live. (Checked every 3 minutes.)${streams.data?.[0] ? ` They're live right now, so the first alert comes next stream.` : ""}`);
  },
};

export default {
  name: "alerts",
  commands,
  execute,
  ready(c) {
    client = c;
    setInterval(() => checkYouTube().catch((e) => console.error("[youtube]", e.message)), 10 * 60_000);
    setInterval(() => checkTwitch().catch((e) => console.error("[twitch]", e.message)), 3 * 60_000);
    setTimeout(() => checkYouTube().catch(() => {}), 60_000);
  },
  _test: { resolveYouTube, ytFeed },
};

