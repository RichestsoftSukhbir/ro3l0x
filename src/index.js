import "dotenv/config";
import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags, Partials } from "discord.js";
import { modules } from "./features/index.js";
import { ApiError } from "./games/http.js";
import { flushAll } from "./storage.js";
import { UserError } from "./util.js";

if (!process.env.DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN in .env (see README.md for how to get one).");
  process.exit(1);
}

const I = GatewayIntentBits;
const BASE_INTENTS = [I.Guilds, I.GuildMessages, I.GuildMessageReactions, I.DirectMessages, I.GuildVoiceStates, I.GuildInvites, I.GuildModeration];
// Privileged intents must be switched on in the Developer Portal (Bot tab).
const PRIVILEGED = [I.GuildMembers, I.MessageContent];

// Index commands, buttons and select menus by name.
const commands = new Map();
const buttons = new Map();
const selects = new Map();
const modals = new Map();
for (const m of modules) {
  for (const [prefix, fn] of Object.entries(m.modals || {})) modals.set(prefix, fn);
  for (const [name, fn] of Object.entries(m.execute || {})) commands.set(name, fn);
  for (const [prefix, fn] of Object.entries(m.buttons || {})) buttons.set(prefix, fn);
  for (const [id, fn] of Object.entries(m.selects || {})) selects.set(id, fn);
}

async function showError(interaction, err) {
  const known = err instanceof UserError || err instanceof ApiError;
  if (!known) console.error(`[${interaction.commandName || interaction.customId}]`, err);
  const content = `⚠️ ${known ? err.message : "Something went wrong. Try again."}`;
  try {
    if (interaction.deferred) await interaction.editReply({ content, embeds: [], components: [], files: [] });
    else if (interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch {
    /* interaction expired */
  }
}

function createClient(intents) {
  const client = new Client({
    intents,
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
  });

  client.once(Events.ClientReady, (c) => {
    const missing = PRIVILEGED.filter((p) => !intents.includes(p));
    console.log(`✅ Logged in as ${c.user.tag}, serving ${c.guilds.cache.size} server(s).`);
    console.log(`   Steam: ${process.env.STEAM_API_KEY ? "on" : "off"} • Twitch: ${process.env.TWITCH_CLIENT_ID ? "on" : "off"}`);
    if (missing.length) {
      console.warn("⚠️  Privileged intents are OFF, so welcome messages, auto-roles, automod and counting won't work.");
      console.warn("   Turn on SERVER MEMBERS INTENT and MESSAGE CONTENT INTENT in the Developer Portal → Bot, then restart.");
    }
    c.user.setActivity("/help • free everything", { type: ActivityType.Playing });
    for (const m of modules) m.ready?.(c);
  });

  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isChatInputCommand()) return await commands.get(i.commandName)?.(i);
      if (i.isButton()) {
        const [prefix, ...parts] = i.customId.split(":");
        return await buttons.get(prefix)?.(i, parts);
      }
      if (i.isStringSelectMenu()) return await selects.get(i.customId)?.(i);
      if (i.isModalSubmit()) {
        const [prefix, ...parts] = i.customId.split(":");
        return await modals.get(prefix)?.(i, parts);
      }
    } catch (err) {
      await showError(i, err);
    }
  });

  // Fan each gateway event out to the modules that handle it.
  const events = {
    [Events.MessageCreate]: "messageCreate",
    [Events.GuildMemberAdd]: "guildMemberAdd",
    [Events.GuildMemberRemove]: "guildMemberRemove",
    [Events.MessageReactionAdd]: "messageReactionAdd",
    [Events.MessageReactionRemove]: "messageReactionRemove",
    [Events.MessageDelete]: "messageDelete",
    [Events.MessageUpdate]: "messageUpdate",
    [Events.GuildMemberUpdate]: "guildMemberUpdate",
    [Events.VoiceStateUpdate]: "voiceStateUpdate",
    [Events.ChannelCreate]: "channelCreate",
    [Events.ChannelDelete]: "channelDelete",
    [Events.GuildBanAdd]: "guildBanAdd",
    [Events.InviteCreate]: "inviteCreate",
    [Events.InviteDelete]: "inviteDelete",
  };
  for (const [event, key] of Object.entries(events)) {
    const handlers = modules.map((m) => m.events?.[key]).filter(Boolean);
    if (!handlers.length) continue;
    client.on(event, async (...args) => {
      for (const h of handlers) {
        try {
          if ((await h(...args)) === true) break; // a handler returning true stops the rest (e.g. automod deleted it)
        } catch (err) {
          console.error(`[${key}]`, err);
        }
      }
    });
  }
  return client;
}

async function start() {
  let client = createClient([...BASE_INTENTS, ...PRIVILEGED]);
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    if (!/disallowed intents/i.test(err.message)) throw err;
    console.warn("⚠️  Discord refused privileged intents; starting with limited features.");
    await client.destroy();
    client = createClient(BASE_INTENTS);
    await client.login(process.env.DISCORD_TOKEN);
  }
}

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    flushAll();
    process.exit(0);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});
