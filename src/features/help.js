// /help with one page per category.
import { ActionRowBuilder, EmbedBuilder, SlashCommandBuilder, StringSelectMenuBuilder } from "discord.js";
import { COLORS, EPHEMERAL } from "../util.js";

const PAGES = {
  levels: {
    title: "📈 Levels & XP",
    lines: [
      "`/rank` your level, XP and rank",
      "`/top` server XP leaderboard",
      "`/levels settings` turn XP / level-up messages on or off, set channel & message *(admin)*",
      "`/levels reward-add` give a role at a level *(admin)*",
      "`/levels ignore` no XP in a channel • `/levels set` set someone's level *(admin)*",
    ],
  },
  economy: {
    title: "🪙 Economy",
    lines: [
      "`/balance` `/daily` `/work` `/pay` `/richest`",
      "`/coinflip` `/slots` bet your coins",
      "`/shop view` `/shop buy` buy roles with coins",
      "`/shop add` `/shop remove` sell roles *(admin)* • `/eco give|take|reset` *(admin)*",
    ],
  },
  fun: {
    title: "🎲 Games & fun",
    lines: [
      "`/trivia` first correct answer wins coins",
      "`/rps` rock paper scissors vs me or a friend",
      "`/8ball` `/roll` `/choose` `/coinflip`",
      "`/counting set` counting channel game *(admin)*",
    ],
  },
  community: {
    title: "🏡 Community",
    lines: [
      "`/welcome set|goodbye|test|off` welcome & goodbye messages *(admin)*",
      "`/autorole add|remove|list` roles for new members *(admin)*",
      "`/rolemenu` buttons for self-assign roles *(admin)*",
      "`/giveaway start|end|reroll|list` *(admin)*",
      "`/poll` native Discord polls",
      "`/remind me|list|cancel` reminders",
      "`/starboard set|off` repost ⭐ messages *(admin)*",
      "`/birthday set|upcoming|remove` • `/birthday channel` *(admin)*",
    ],
  },
  moderation: {
    title: "🛡️ Moderation",
    lines: [
      "`/warn` `/warnings` `/clearwarns`",
      "`/timeout` `/untimeout` `/kick` `/ban` `/unban`",
      "`/purge` bulk delete • `/slowmode`",
      "`/modlog` log channel for all actions",
      "`/automod settings` anti-spam, link filter, mention limit • `/automod badword-add|remove|status`",
    ],
  },
  gaming: {
    title: "🎮 Game stats & deals",
    lines: [
      "`/link` connect Minecraft, Steam, Chess.com or Lichess • `/accounts` `/unlink`",
      "`/steam profile|games` • `/chess` • `/minecraft player|server|setserver`",
      "`/leaderboard` rank the server by chess rating, Steam hours…",
      "`/deals free` free games on Epic & Steam • `/deals steam` best sales",
      "`/deals setup` auto-post free games to a channel *(admin)*",
    ],
  },
  alerts: {
    title: "🔔 Social alerts",
    lines: ["`/alerts youtube` post new uploads *(admin)*", "`/alerts twitch` post when someone goes live *(admin)*", "`/alerts list|remove`"],
  },
  creator: {
    title: "💡 Creator tools",
    lines: ["`/idea` viral ideas • `/titles` • `/hooks` • `/rate` your idea", "`/formats` • `/song` • `/roblox` game ideas • `/random` • `/tip`"],
  },
};

function page(key, botName) {
  if (key && PAGES[key]) {
    return new EmbedBuilder().setColor(COLORS.main).setTitle(PAGES[key].title).setDescription(PAGES[key].lines.join("\n"));
  }
  return new EmbedBuilder()
    .setColor(COLORS.main)
    .setTitle(`🤖 ${botName}: everything in one free bot`)
    .setDescription("Pick a category below to see its commands. Everything is free: no premium, no paywalls.")
    .addFields(Object.values(PAGES).map((p) => ({ name: p.title, value: p.lines[0].replace(/\*\(admin\)\*/g, ""), inline: false })));
}

const menu = () =>
  new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("help")
      .setPlaceholder("Choose a category")
      .addOptions(Object.entries(PAGES).map(([value, p]) => ({ label: p.title.replace(/^\S+\s/, ""), value, emoji: p.title.split(" ")[0] }))),
  );

export default {
  name: "help",
  commands: [new SlashCommandBuilder().setName("help").setDescription("Everything this bot can do")],
  execute: { help: (i) => i.reply({ embeds: [page(null, i.client.user.username)], components: [menu()], flags: EPHEMERAL }) },
  selects: { help: (i) => i.update({ embeds: [page(i.values[0], i.client.user.username)], components: [menu()] }) },
};
