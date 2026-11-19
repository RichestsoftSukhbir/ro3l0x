// Slash command definitions and how each one maps to a generator.
import { SlashCommandBuilder } from "discord.js";
import * as gen from "./ideas.js";

const platformChoices = gen.formatPlatforms.map((p) => ({ name: p, value: p }));

export const creatorCommands = [
  new SlashCommandBuilder()
    .setName("idea")
    .setDescription("Get 3 viral content ideas")
    .addStringOption((o) => o.setName("category").setDescription("What kind of content?").setRequired(true).addChoices(...gen.ideaCategories))
    .addStringOption((o) => o.setName("niche").setDescription("Your topic, e.g. 'Minecraft' or 'cooking' (optional)").setMaxLength(60))
    .addStringOption((o) => o.setName("audience").setDescription("Who it's for, e.g. 'teen gamers' (optional)").setMaxLength(60)),

  new SlashCommandBuilder()
    .setName("titles")
    .setDescription("Catchy titles + thumbnail ideas")
    .addStringOption((o) => o.setName("topic").setDescription("What's it about? Keep it short, e.g. 'Minecraft speedruns'").setRequired(true).setMaxLength(60))
    .addStringOption((o) => o.setName("platform").setDescription("Platform (optional)").addChoices(...platformChoices)),

  new SlashCommandBuilder()
    .setName("hooks")
    .setDescription("Scroll-stopping openers for your first 3 seconds")
    .addStringOption((o) => o.setName("topic").setDescription("What's it about? e.g. 'guitar', 'Fortnite'").setRequired(true).setMaxLength(60)),

  new SlashCommandBuilder()
    .setName("rate")
    .setDescription("Rate your idea's viral potential and improve it")
    .addStringOption((o) => o.setName("idea").setDescription("Your idea in one sentence").setRequired(true).setMaxLength(300)),

  new SlashCommandBuilder()
    .setName("formats")
    .setDescription("Proven formats for a platform, with fresh twists")
    .addStringOption((o) => o.setName("platform").setDescription("Platform").setRequired(true).addChoices(...platformChoices)),

  new SlashCommandBuilder()
    .setName("song")
    .setDescription("A song concept with a chorus hook")
    .addStringOption((o) => o.setName("genre").setDescription("e.g. phonk, pop, drill, lo-fi").setRequired(true).setMaxLength(30))
    .addStringOption((o) => o.setName("theme").setDescription("What's it about? (optional)").setMaxLength(30)),

  new SlashCommandBuilder()
    .setName("robloxideas")
    .setDescription("Roblox game ideas that could blow up")
    .addStringOption((o) =>
      o.setName("genre").setDescription("Genre (optional)").addChoices(
        ...["obby", "tycoon", "simulator", "horror", "roleplay", "survival", "tower defense"].map((g) => ({ name: g, value: g })),
      ),
    ),

  new SlashCommandBuilder().setName("random").setDescription("A random viral idea from any category"),
  new SlashCommandBuilder().setName("tip").setDescription("A quick tip for growing as a creator"),
];

// name -> { read options from the interaction, generate { title, text } }
export const handlers = {
  idea: { read: (i) => ({ category: i.options.getString("category"), niche: i.options.getString("niche"), audience: i.options.getString("audience") }), run: gen.idea },
  titles: { read: (i) => ({ topic: i.options.getString("topic"), platform: i.options.getString("platform") }), run: gen.titles },
  hooks: { read: (i) => ({ topic: i.options.getString("topic") }), run: gen.hooks },
  rate: { read: (i) => ({ idea: i.options.getString("idea") }), run: gen.rate },
  formats: { read: (i) => ({ platform: i.options.getString("platform") }), run: gen.formats },
  song: { read: (i) => ({ genre: i.options.getString("genre"), theme: i.options.getString("theme") }), run: gen.song },
  robloxideas: { read: (i) => ({ genre: i.options.getString("genre") }), run: gen.roblox },
  random: { read: () => ({}), run: gen.random },
  tip: { read: () => ({}), run: gen.tip },
};

// /rate gives the same score every time, so it doesn't get an "Another one" button.
export const noRerun = new Set(["rate"]);
