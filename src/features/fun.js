// Mini-games: trivia (wins coins), rock-paper-scissors, 8ball, dice, choose, and a counting channel.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { randomUUID } from "node:crypto";
import { config, saveConfig } from "../storage.js";
import { COLORS, EPHEMERAL, UserError, assertCanPost, n, pick, rand, requireGuild } from "../util.js";
import { COIN, addCoins } from "./economy.js";

// ---- trivia ---------------------------------------------------------------

const TRIVIA_CATEGORIES = { "General knowledge": 9, "Video games": 15, Film: 11, Music: 12, Science: 17, Computers: 18, Sports: 21, Geography: 22, History: 23, Anime: 31, Animals: 27 };
const REWARD = { easy: 25, medium: 50, hard: 100 };
const trivia = new Map(); // gameId -> { correct, wrong:Set, done, reward }
let lastTriviaFetch = 0;

async function fetchQuestion(category, difficulty) {
  const wait = 5200 - (Date.now() - lastTriviaFetch); // OpenTDB allows 1 request per 5s
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastTriviaFetch = Date.now();
  const params = new URLSearchParams({ amount: 1, type: "multiple", encode: "url3986" });
  if (category) params.set("category", category);
  if (difficulty) params.set("difficulty", difficulty);
  const res = await fetch(`https://opentdb.com/api.php?${params}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const data = await res?.json().catch(() => null);
  const q = data?.results?.[0];
  if (!q) throw new UserError("Couldn't get a trivia question right now. Try again in a few seconds.");
  const d = (s) => decodeURIComponent(s);
  return { question: d(q.question), correct: d(q.correct_answer), answers: [q.correct_answer, ...q.incorrect_answers].map(d), difficulty: q.difficulty, category: d(q.category) };
}

async function startTrivia(i) {
  await i.deferReply();
  const q = await fetchQuestion(i.options.getInteger("category"), i.options.getString("difficulty"));
  const answers = q.answers.sort(() => Math.random() - 0.5);
  const id = randomUUID().slice(0, 8);
  const reward = REWARD[q.difficulty] || 25;
  const game = { correct: answers.indexOf(q.correct), answers, wrong: new Set(), done: false, reward, q, guildId: i.guildId };
  trivia.set(id, game);

  const letters = ["🇦", "🇧", "🇨", "🇩"];
  const e = new EmbedBuilder()
    .setColor(COLORS.main)
    .setTitle(`🧠 ${q.question}`)
    .setDescription(answers.map((a, k) => `${letters[k]} ${a}`).join("\n"))
    .setFooter({ text: `${q.category} • ${q.difficulty} • first correct answer wins ${reward} coins • 30s` });
  const row = new ActionRowBuilder().addComponents(answers.map((a, k) => new ButtonBuilder().setCustomId(`trivia:${id}:${k}`).setEmoji(letters[k]).setStyle(ButtonStyle.Secondary)));
  await i.editReply({ embeds: [e], components: [row] });

  setTimeout(async () => {
    if (game.done) return;
    game.done = true;
    trivia.delete(id);
    await i.editReply({ embeds: [e.setColor(COLORS.bad).addFields({ name: "⏰ Time's up!", value: `The answer was **${q.correct}**.` })], components: [disabled(row, game.correct)] }).catch(() => {});
  }, 30_000);
}

function disabled(row, correctIdx) {
  return new ActionRowBuilder().addComponents(
    row.components.map((b, k) => ButtonBuilder.from(b).setDisabled(true).setStyle(k === correctIdx ? ButtonStyle.Success : ButtonStyle.Secondary)),
  );
}

async function triviaButton(i, [id, choice]) {
  const game = trivia.get(id);
  if (!game || game.done) return i.reply({ content: "This question is over.", flags: EPHEMERAL });
  if (game.wrong.has(i.user.id)) return i.reply({ content: "You already guessed wrong on this one!", flags: EPHEMERAL });
  if (Number(choice) !== game.correct) {
    game.wrong.add(i.user.id);
    return i.reply({ content: "❌ Wrong! You're out for this question.", flags: EPHEMERAL });
  }
  game.done = true;
  trivia.delete(id);
  const total = i.inGuild() ? addCoins(i.guildId, i.user.id, game.reward) : null;
  const e = EmbedBuilder.from(i.message.embeds[0])
    .setColor(COLORS.ok)
    .addFields({ name: "✅ Correct!", value: `${i.user} got it: **${game.q.correct}**${total !== null ? `\n+${COIN} ${game.reward} (balance ${n(total)})` : ""}` });
  return i.update({ embeds: [e], components: [disabled(ActionRowBuilder.from(i.message.components[0]), game.correct)] });
}

// ---- rock paper scissors --------------------------------------------------

const RPS = { rock: "🪨", paper: "📄", scissors: "✂️" };
const beats = { rock: "scissors", paper: "rock", scissors: "paper" };
const rpsGames = new Map(); // id -> { a, b, picks: {} }

const rpsRow = (id) =>
  new ActionRowBuilder().addComponents(Object.entries(RPS).map(([k, emoji]) => new ButtonBuilder().setCustomId(`rps:${id}:${k}`).setEmoji(emoji).setLabel(k).setStyle(ButtonStyle.Primary)));

function rpsResult(a, pa, b, pb) {
  const line = `${a} ${RPS[pa]} vs ${RPS[pb]} ${b}`;
  if (pa === pb) return `${line}\n**It's a tie!**`;
  return `${line}\n**${beats[pa] === pb ? a : b} wins!**`;
}

async function startRps(i) {
  const opponent = i.options.getUser("opponent");
  const id = randomUUID().slice(0, 8);
  if (!opponent || opponent.id === i.client.user.id) {
    rpsGames.set(id, { a: i.user.id, bot: true, picks: {} });
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.main).setDescription(`✊ ${i.user}, pick your move!`)], components: [rpsRow(id)] });
  }
  if (opponent.bot) throw new UserError("You can only challenge real people (or me, with no opponent).");
  if (opponent.id === i.user.id) throw new UserError("You can't play yourself!");
  rpsGames.set(id, { a: i.user.id, b: opponent.id, picks: {} });
  setTimeout(() => rpsGames.delete(id), 5 * 60_000);
  return i.reply({
    content: `${opponent}, you've been challenged!`,
    embeds: [new EmbedBuilder().setColor(COLORS.main).setDescription(`✊ ${i.user} vs ${opponent}\nBoth players: pick your move. Picks are secret until both choose.`)],
    components: [rpsRow(id)],
    allowedMentions: { users: [opponent.id] },
  });
}

async function rpsButton(i, [id, move]) {
  const g = rpsGames.get(id);
  if (!g) return i.reply({ content: "This game is over.", flags: EPHEMERAL });
  if (g.bot) {
    if (i.user.id !== g.a) return i.reply({ content: "This isn't your game. Start your own with `/rps`.", flags: EPHEMERAL });
    rpsGames.delete(id);
    const botMove = pick(Object.keys(RPS));
    return i.update({ embeds: [new EmbedBuilder().setColor(COLORS.ok).setDescription(rpsResult(`<@${g.a}>`, move, "me", botMove))], components: [] });
  }
  if (![g.a, g.b].includes(i.user.id)) return i.reply({ content: "You're not in this game.", flags: EPHEMERAL });
  if (g.picks[i.user.id]) return i.reply({ content: "You already picked!", flags: EPHEMERAL });
  g.picks[i.user.id] = move;
  if (!g.picks[g.a] || !g.picks[g.b]) return i.reply({ content: `You picked ${RPS[move]}. Waiting for the other player…`, flags: EPHEMERAL });
  rpsGames.delete(id);
  return i.update({ content: "", embeds: [new EmbedBuilder().setColor(COLORS.ok).setDescription(rpsResult(`<@${g.a}>`, g.picks[g.a], `<@${g.b}>`, g.picks[g.b]))], components: [] });
}

// ---- counting -------------------------------------------------------------

async function onMessage(msg) {
  if (!msg.guild || msg.author.bot) return;
  const c = config(msg.guild.id).counting;
  if (!c?.channelId || msg.channel.id !== c.channelId) return;
  const text = msg.content.trim();
  if (!/^\d+$/.test(text)) return; // ignore chatter
  const num = Number(text);
  const expected = (c.current || 0) + 1;
  if (num === expected && msg.author.id !== c.lastUser) {
    c.current = num;
    c.lastUser = msg.author.id;
    if (num > (c.best || 0)) c.best = num;
    saveConfig();
    return msg.react(num % 100 === 0 ? "💯" : "✅").catch(() => {});
  }
  const reason = msg.author.id === c.lastUser ? "you can't count twice in a row" : `the next number was **${expected}**`;
  const reached = c.current || 0;
  c.current = 0;
  c.lastUser = null;
  saveConfig();
  await msg.react("❌").catch(() => {});
  return msg.reply(`💥 ${msg.author} ruined it at **${reached}**: ${reason}! Start again from **1**. (Best: ${c.best || 0})`).catch(() => {});
}

// ---- commands -------------------------------------------------------------

const ANSWERS = ["It is certain.", "Without a doubt.", "Yes, definitely.", "You may rely on it.", "Most likely.", "Outlook good.", "Signs point to yes.", "Reply hazy, try again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.", "Don't count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful."];

const commands = [
  new SlashCommandBuilder()
    .setName("trivia")
    .setDescription("Trivia question: first correct answer wins coins")
    .addIntegerOption((o) => o.setName("category").setDescription("Category").addChoices(...Object.entries(TRIVIA_CATEGORIES).map(([name, value]) => ({ name, value }))))
    .addStringOption((o) => o.setName("difficulty").setDescription("Difficulty").addChoices({ name: "Easy (25)", value: "easy" }, { name: "Medium (50)", value: "medium" }, { name: "Hard (100)", value: "hard" })),
  new SlashCommandBuilder().setName("rps").setDescription("Rock paper scissors").addUserOption((o) => o.setName("opponent").setDescription("Challenge someone (leave empty to play me)")),
  new SlashCommandBuilder().setName("8ball").setDescription("Ask the magic 8-ball").addStringOption((o) => o.setName("question").setDescription("Your question").setRequired(true).setMaxLength(200)),
  new SlashCommandBuilder().setName("roll").setDescription("Roll dice, e.g. 2d6").addStringOption((o) => o.setName("dice").setDescription("Like 1d20 or 3d6 (default 1d6)").setMaxLength(10)),
  new SlashCommandBuilder().setName("choose").setDescription("Can't decide? I'll pick").addStringOption((o) => o.setName("options").setDescription("Separate with commas: pizza, tacos, sushi").setRequired(true).setMaxLength(300)),
  new SlashCommandBuilder()
    .setName("counting")
    .setDescription("Counting channel game (admins)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName("set").setDescription("Make a channel the counting channel").addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true)))
    .addSubcommand((s) => s.setName("off").setDescription("Turn off the counting game")),
];

const execute = {
  trivia: startTrivia,
  rps: startRps,
  "8ball": (i) => i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.main).setDescription(`🎱 **${i.options.getString("question")}**\n${pick(ANSWERS)}`)] }),

  roll(i) {
    const spec = (i.options.getString("dice") || "1d6").toLowerCase().replace(/\s/g, "");
    const m = spec.match(/^(\d{0,2})d(\d{1,4})$/);
    if (!m) throw new UserError("Use a format like `1d20` or `3d6`.");
    const count = Math.min(Number(m[1] || 1), 20);
    const sides = Math.max(2, Math.min(Number(m[2]), 1000));
    const rolls = Array.from({ length: count }, () => rand(1, sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.main).setDescription(`🎲 **${count}d${sides}**: ${rolls.join(", ")}${count > 1 ? `\nTotal: **${total}**` : ""}`)] });
  },

  choose(i) {
    const opts = i.options.getString("options").split(/[,|]/).map((s) => s.trim()).filter(Boolean);
    if (opts.length < 2) throw new UserError("Give me at least 2 options separated by commas.");
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.main).setDescription(`🤔 I choose… **${pick(opts)}**`)] });
  },

  counting(i) {
    requireGuild(i);
    const cfg = config(i.guildId);
    if (i.options.getSubcommand() === "off") {
      delete cfg.counting;
      saveConfig();
      return i.reply("🔢 Counting game turned off.");
    }
    const ch = i.options.getChannel("channel");
    if (!ch.isTextBased()) throw new UserError("Pick a text channel.");
    assertCanPost(ch, i.guild);
    cfg.counting = { channelId: ch.id, current: 0, lastUser: null, best: cfg.counting?.best || 0 };
    saveConfig();
    return i.reply(`🔢 ${ch} is now the counting channel! Start at **1**. No counting twice in a row.`);
  },
};

export default {
  name: "fun",
  commands,
  execute,
  buttons: { trivia: triviaButton, rps: rpsButton },
  events: { messageCreate: onMessage },
};
