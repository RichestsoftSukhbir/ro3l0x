// 24/7 internet radio in voice channels (free Radio Browser directory) + join-to-create temp voice channels.
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from "@discordjs/voice";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder } from "discord.js";
import ffmpegStatic from "ffmpeg-static";
import { spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { getJSON } from "../games/http.js";
import { config, saveConfig } from "../storage.js";
import { COLORS, EPHEMERAL, UserError, requireGuild } from "../util.js";

// Prefer a system ffmpeg if one exists; fall back to the bundled binary.
const FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 ? "ffmpeg" : ffmpegStatic;
const RADIO_API = "https://de1.api.radio-browser.info/json";
const GENRES = ["lofi", "pop", "hiphop", "rock", "edm", "phonk", "jazz", "classical", "bollywood", "kpop", "anime", "gaming", "chillout", "news"];

// ---- radio playback -------------------------------------------------------

const sessions = new Map(); // guildId -> { player, connection, station, volume, results, ffmpeg, abort, channelId, textChannelId, retries }

async function searchStations({ query, genre, country, limit = 10 }) {
  const params = new URLSearchParams({ limit: String(limit), hidebroken: "true", order: "clickcount", reverse: "true" });
  if (query) params.set("name", query);
  if (genre) params.set("tag", genre);
  if (country) params.set("countrycode", country.toUpperCase());
  const list = await getJSON(`${RADIO_API}/stations/search?${params}`, { ttl: 30 * 60_000, service: "the radio directory" });
  return list.filter((s) => s.url_resolved && s.lastcheckok === 1 && !/\.m3u8?$|\.pls$/i.test(s.url_resolved));
}

function stopStream(s) {
  s.abort?.abort();
  if (s.ffmpeg && !s.ffmpeg.killed) s.ffmpeg.kill("SIGKILL");
  s.ffmpeg = null;
}

/** Starts streaming `s.station` into the voice connection. Node fetches the stream, ffmpeg converts it to Opus. */
async function startStream(s) {
  stopStream(s);
  const abort = new AbortController();
  s.abort = abort;
  const res = await fetch(s.station.url_resolved, { headers: { "User-Agent": "RO3L0XBot/1.0", "Icy-MetaData": "0" }, signal: abort.signal }).catch(() => null);
  if (!res?.ok || !res.body) throw new UserError(`**${s.station.name}** isn't responding right now. Try another station.`);
  const ff = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-af", `volume=${s.volume / 100}`, "-c:a", "libopus", "-b:a", "96k", "-ar", "48000", "-ac", "2", "-f", "ogg", "pipe:1"]);
  s.ffmpeg = ff;
  const body = Readable.fromWeb(res.body);
  body.on("error", () => {});
  ff.stdin.on("error", () => {});
  ff.stdout.on("error", () => {});
  body.pipe(ff.stdin);
  ff.on("close", () => body.destroy());
  s.player.play(createAudioResource(ff.stdout, { inputType: StreamType.OggOpus }));
}

function nowPlaying(s) {
  const st = s.station;
  const e = new EmbedBuilder()
    .setColor(COLORS.pink)
    .setAuthor({ name: "📻 Now playing" })
    .setTitle(st.name.slice(0, 250))
    .setDescription([st.tags && `🏷️ ${st.tags.split(",").slice(0, 5).join(", ")}`, st.country && `🌍 ${st.country}`, `🔊 Volume ${s.volume}%`, `🔈 <#${s.channelId}>`].filter(Boolean).join("\n"))
    .setFooter({ text: "Live internet radio via radio-browser.info" });
  if (st.favicon?.startsWith("https://")) e.setThumbnail(st.favicon);
  if (st.homepage?.startsWith("http")) e.setURL(st.homepage);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("radio:next").setEmoji("⏭️").setLabel("Next station").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("radio:vol:-20").setEmoji("🔉").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("radio:vol:20").setEmoji("🔊").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("radio:stop").setEmoji("⏹️").setLabel("Stop").setStyle(ButtonStyle.Danger),
  );
  return { embeds: [e], components: [row] };
}

async function play(i, results, index = 0) {
  const voice = i.member.voice?.channel;
  if (!voice) throw new UserError("Join a voice channel first!");
  const me = i.guild.members.me;
  if (!voice.permissionsFor(me).has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) throw new UserError(`I need **Connect** and **Speak** permissions in ${voice}.`);
  if (!results.length) throw new UserError("No working stations found. Try another search or genre.");

  let s = sessions.get(i.guildId);
  if (s && s.channelId !== voice.id) {
    destroy(i.guildId);
    s = null;
  }
  if (!s) {
    const connection = joinVoiceChannel({ channelId: voice.id, guildId: i.guildId, adapterCreator: i.guild.voiceAdapterCreator, selfDeaf: true });
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    connection.subscribe(player);
    s = { player, connection, volume: 60, channelId: voice.id, textChannelId: i.channelId, retries: 0 };
    sessions.set(i.guildId, s);
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]);
      } catch {
        destroy(i.guildId);
      }
    });
    // If the stream drops, reconnect a few times before giving up.
    player.on(AudioPlayerStatus.Idle, () => {
      const cur = sessions.get(i.guildId);
      if (!cur || cur.stopping) return;
      if (cur.retries++ < 5) setTimeout(() => startStream(cur).catch(() => {}), 3000);
    });
    player.on("error", (e) => console.error("[radio]", e.message));
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000).catch(() => {
      destroy(i.guildId);
      throw new UserError("Couldn't connect to the voice channel. Try again.");
    });
  }
  s.results = results;
  s.index = index;
  s.station = results[index];
  s.retries = 0;
  await startStream(s);
  fetch(`${RADIO_API}/url/${s.station.stationuuid}`).catch(() => {}); // counts a "click" for the station (directory etiquette)
  return s;
}

function destroy(guildId) {
  const s = sessions.get(guildId);
  if (s) {
    s.stopping = true;
    stopStream(s);
    s.player.stop(true);
  }
  getVoiceConnection(guildId)?.destroy();
  sessions.delete(guildId);
}

async function radioButton(i, [action, amount]) {
  const s = sessions.get(i.guildId);
  if (!s) return i.reply({ content: "Nothing is playing. Start with `/radio play`.", flags: EPHEMERAL });
  if (i.member.voice?.channelId !== s.channelId) return i.reply({ content: "Join my voice channel to control the radio.", flags: EPHEMERAL });
  if (action === "stop") {
    destroy(i.guildId);
    return i.update({ embeds: [new EmbedBuilder().setColor(COLORS.bad).setDescription(`⏹️ Radio stopped by ${i.user}.`)], components: [] });
  }
  if (action === "vol") s.volume = Math.max(10, Math.min(150, s.volume + Number(amount)));
  if (action === "next") {
    s.index = (s.index + 1) % s.results.length;
    s.station = s.results[s.index];
  }
  await i.deferUpdate();
  s.retries = 0;
  await startStream(s).catch(() => {});
  return i.editReply(nowPlaying(s));
}

async function radioSelect(i) {
  requireGuild(i);
  const s0 = sessions.get(`pick:${i.user.id}`);
  const results = s0?.results;
  if (!results) return i.reply({ content: "This search expired. Run `/radio search` again.", flags: EPHEMERAL });
  await i.deferUpdate();
  const s = await play(i, results, Number(i.values[0]));
  return i.editReply(nowPlaying(s));
}

// Leave when everyone else leaves the channel.
function onVoice(oldState, newState) {
  for (const state of [oldState, newState]) {
    const s = sessions.get(state.guild.id);
    if (!s) continue;
    const ch = state.guild.channels.cache.get(s.channelId);
    const humans = ch?.members?.filter((m) => !m.user.bot).size ?? 0;
    const always = config(state.guild.id).radio247;
    if (!humans && !always) setTimeout(() => {
      const again = state.guild.channels.cache.get(s.channelId)?.members?.filter((m) => !m.user.bot).size ?? 0;
      if (!again && sessions.get(state.guild.id) === s) destroy(state.guild.id);
    }, 60_000);
  }
}

// ---- join-to-create temp voice --------------------------------------------

async function onVoiceTemp(oldState, newState) {
  const cfg = config(newState.guild.id).tempvoice;
  if (!cfg?.hubId) return;
  const temps = (cfg.channels ??= []);

  // Joined the hub → create a personal channel and move them in.
  if (newState.channelId === cfg.hubId && newState.member && !newState.member.user.bot) {
    const hub = newState.channel;
    const member = newState.member;
    const ch = await newState.guild.channels
      .create({
        name: `🔊 ${member.displayName}'s room`.slice(0, 100),
        type: ChannelType.GuildVoice,
        parent: hub.parentId ?? undefined,
        userLimit: cfg.limit || 0,
        permissionOverwrites: [
          ...hub.permissionOverwrites.cache.values(),
          { id: member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect] },
        ].map((o) => ({ id: o.id, allow: o.allow, deny: o.deny, type: o.type })),
      })
      .catch((e) => (console.error("[tempvoice]", e.message), null));
    if (!ch) return;
    temps.push(ch.id);
    saveConfig();
    await member.voice.setChannel(ch).catch(() => ch.delete().catch(() => {}));
  }

  // Left a temp channel → delete it once empty.
  const left = oldState.channel;
  if (left && temps.includes(left.id) && left.members.size === 0) {
    await left.delete("Temp voice empty").catch(() => {});
    cfg.channels = temps.filter((id) => id !== left.id);
    saveConfig();
  }
}

// ---- commands -------------------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("radio")
    .setDescription("24/7 internet radio in voice")
    .addSubcommand((s) =>
      s.setName("play").setDescription("Play a radio station (join a voice channel first)")
        .addStringOption((o) => o.setName("genre").setDescription("Genre").addChoices(...GENRES.map((g) => ({ name: g, value: g }))))
        .addStringOption((o) => o.setName("station").setDescription("Station name to search, e.g. 'Radio Mirchi'").setMaxLength(80))
        .addStringOption((o) => o.setName("country").setDescription("2-letter country code, e.g. IN, US, GB").setMinLength(2).setMaxLength(2)),
    )
    .addSubcommand((s) =>
      s.setName("search").setDescription("Search stations and pick one")
        .addStringOption((o) => o.setName("query").setDescription("Station name").setMaxLength(80))
        .addStringOption((o) => o.setName("genre").setDescription("Genre").addChoices(...GENRES.map((g) => ({ name: g, value: g }))))
        .addStringOption((o) => o.setName("country").setDescription("2-letter country code, e.g. IN").setMinLength(2).setMaxLength(2)),
    )
    .addSubcommand((s) => s.setName("now").setDescription("What's playing"))
    .addSubcommand((s) => s.setName("volume").setDescription("Set volume").addIntegerOption((o) => o.setName("percent").setDescription("10-150").setRequired(true).setMinValue(10).setMaxValue(150)))
    .addSubcommand((s) => s.setName("stop").setDescription("Stop and leave"))
    .addSubcommand((s) => s.setName("247").setDescription("Stay in voice even when empty (Manage Server)").addBooleanOption((o) => o.setName("enabled").setDescription("On/off").setRequired(true))),

  new SlashCommandBuilder()
    .setName("tempvoice")
    .setDescription("Join-to-create voice channels (admins)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((s) =>
      s.setName("setup").setDescription("Pick the 'Join to create' channel")
        .addChannelOption((o) => o.setName("channel").setDescription("A voice channel people join to get their own room").setRequired(true).addChannelTypes(ChannelType.GuildVoice))
        .addIntegerOption((o) => o.setName("limit").setDescription("User limit for new rooms (0 = none)").setMinValue(0).setMaxValue(99)),
    )
    .addSubcommand((s) => s.setName("off").setDescription("Turn off join-to-create")),
];

const execute = {
  async radio(i) {
    requireGuild(i);
    const sub = i.options.getSubcommand();
    const s = sessions.get(i.guildId);

    if (sub === "play") {
      await i.deferReply();
      const genre = i.options.getString("genre");
      const query = i.options.getString("station");
      const country = i.options.getString("country");
      const results = await searchStations({ query, genre: genre || (!query && !country ? "lofi" : undefined), country });
      const started = await play(i, results);
      return i.editReply(nowPlaying(started));
    }

    if (sub === "search") {
      await i.deferReply({ flags: EPHEMERAL });
      const results = (await searchStations({ query: i.options.getString("query"), genre: i.options.getString("genre"), country: i.options.getString("country"), limit: 25 })).slice(0, 25);
      if (!results.length) throw new UserError("No stations found. Try a different name, genre or country.");
      sessions.set(`pick:${i.user.id}`, { results });
      setTimeout(() => sessions.delete(`pick:${i.user.id}`), 10 * 60_000);
      const menu = new StringSelectMenuBuilder()
        .setCustomId("radiopick")
        .setPlaceholder("Pick a station to play")
        .addOptions(results.map((st, k) => ({ label: st.name.slice(0, 100) || "Unnamed", value: String(k), description: [st.countrycode, st.tags?.split(",").slice(0, 3).join(", ")].filter(Boolean).join(" • ").slice(0, 100) || undefined })));
      return i.editReply({ content: `📻 Found **${results.length}** stations. Join a voice channel, then pick one:`, components: [new ActionRowBuilder().addComponents(menu)] });
    }

    if (sub === "247") {
      if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError("You need **Manage Server** for that.");
      config(i.guildId).radio247 = i.options.getBoolean("enabled");
      saveConfig();
      return i.reply(i.options.getBoolean("enabled") ? "📻 24/7 mode on: I'll stay in voice even when everyone leaves." : "📻 24/7 mode off: I'll leave a minute after the channel empties.");
    }

    if (!s) throw new UserError("Nothing is playing. Start with `/radio play`.");
    if (sub === "now") return i.reply(nowPlaying(s));
    if (i.member.voice?.channelId !== s.channelId) throw new UserError("Join my voice channel to control the radio.");
    if (sub === "stop") {
      destroy(i.guildId);
      return i.reply("⏹️ Radio stopped.");
    }
    // volume
    s.volume = i.options.getInteger("percent");
    await i.deferReply();
    await startStream(s);
    return i.editReply(nowPlaying(s));
  },

  async tempvoice(i) {
    requireGuild(i);
    const cfg = config(i.guildId);
    if (i.options.getSubcommand() === "off") {
      delete cfg.tempvoice;
      saveConfig();
      return i.reply("🔇 Join-to-create turned off.");
    }
    const ch = i.options.getChannel("channel");
    const me = i.guild.members.me;
    if (!me.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers])) throw new UserError("I need **Manage Channels** and **Move Members** permissions.");
    cfg.tempvoice = { hubId: ch.id, limit: i.options.getInteger("limit") || 0, channels: cfg.tempvoice?.channels || [] };
    saveConfig();
    return i.reply(`✅ Anyone who joins ${ch} gets their own voice room (deleted when empty). They can rename it and set limits.`);
  },
};

export default {
  name: "voice",
  commands,
  execute,
  buttons: { radio: radioButton },
  selects: { radiopick: radioSelect },
  events: { voiceStateUpdate: async (o, n) => (onVoice(o, n), onVoiceTemp(o, n)) },
  _test: { searchStations },
};
