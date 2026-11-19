// Server economy: coins, daily/work, paying others, a role shop, and coin games.
import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { bucket, config, persist, saveConfig } from "../storage.js";
import { COLORS, UserError, assertCanManage, n, pick, rand, requireGuild, requireManager, ts } from "../util.js";

const COIN = "🪙";
const DAY = 86_400_000;
const HOUR = 3_600_000;

function wallet(guildId, userId) {
  const w = bucket("economy", guildId);
  return (w[userId] ??= { coins: 0, lastDaily: 0, streak: 0, lastWork: 0 });
}

export function addCoins(guildId, userId, amount) {
  const w = wallet(guildId, userId);
  w.coins = Math.max(0, w.coins + amount);
  persist("economy");
  return w.coins;
}

function takeBet(i, amount) {
  const w = wallet(i.guildId, i.user.id);
  if (amount > w.coins) throw new UserError(`You only have ${COIN} **${n(w.coins)}**. Earn more with \`/daily\` and \`/work\`.`);
  return w;
}

const JOBS = [
  "streamed for 3 hours and got donations",
  "fixed a bug in someone's Roblox game",
  "edited a YouTube video for a creator",
  "walked dogs around the neighborhood",
  "delivered pizzas in the rain",
  "coached a noob to their first win",
  "designed a thumbnail that went viral",
  "mined diamonds all night",
  "sold lemonade at a LAN party",
  "moderated a chaotic Discord server",
  "made a beat that a rapper bought",
  "tested a new game for a studio",
];

const commands = [
  new SlashCommandBuilder().setName("balance").setDescription("Check coins").addUserOption((o) => o.setName("member").setDescription("Whose balance?")),
  new SlashCommandBuilder().setName("daily").setDescription("Claim your daily coins (streaks give bonuses!)"),
  new SlashCommandBuilder().setName("work").setDescription("Work for coins (every hour)"),
  new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Give coins to someone")
    .addUserOption((o) => o.setName("member").setDescription("Who to pay").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("How many coins").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName("richest").setDescription("Richest members in the server"),
  new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Flip a coin, optionally bet coins on it")
    .addIntegerOption((o) => o.setName("bet").setDescription("Coins to bet").setMinValue(10))
    .addStringOption((o) => o.setName("side").setDescription("Your call").addChoices({ name: "Heads", value: "heads" }, { name: "Tails", value: "tails" })),
  new SlashCommandBuilder()
    .setName("slots")
    .setDescription("Spin the slot machine")
    .addIntegerOption((o) => o.setName("bet").setDescription("Coins to bet").setRequired(true).setMinValue(10)),
  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Buy roles with coins")
    .addSubcommand((s) => s.setName("view").setDescription("See what's for sale"))
    .addSubcommand((s) => s.setName("buy").setDescription("Buy a role").addRoleOption((o) => o.setName("role").setDescription("Role to buy").setRequired(true)))
    .addSubcommand((s) =>
      s.setName("add").setDescription("Put a role up for sale (Manage Server)")
        .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true))
        .addIntegerOption((o) => o.setName("price").setDescription("Price in coins").setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName("description").setDescription("What it's for").setMaxLength(100)),
    )
    .addSubcommand((s) => s.setName("remove").setDescription("Remove a role from the shop (Manage Server)").addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true))),
  new SlashCommandBuilder()
    .setName("eco")
    .setDescription("Manage coins (admins)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName("give").setDescription("Give coins")
        .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
        .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s.setName("take").setDescription("Take coins")
        .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
        .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) => s.setName("reset").setDescription("Reset someone's coins to 0").addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))),
];

const coinEmbed = (text, color = COLORS.gold) => new EmbedBuilder().setColor(color).setDescription(text);

const execute = {
  async balance(i) {
    requireGuild(i);
    const user = i.options.getUser("member") || i.user;
    const w = wallet(i.guildId, user.id);
    return i.reply({ embeds: [coinEmbed(`${user}'s balance: ${COIN} **${n(w.coins)}**${w.streak ? `\n🔥 Daily streak: **${w.streak}**` : ""}`)], allowedMentions: { parse: [] } });
  },

  async daily(i) {
    requireGuild(i);
    const w = wallet(i.guildId, i.user.id);
    const now = Date.now();
    if (now - w.lastDaily < DAY) throw new UserError(`You already claimed today. Come back ${ts(w.lastDaily + DAY)}.`);
    w.streak = now - w.lastDaily < 2 * DAY ? w.streak + 1 : 1;
    const amount = 200 + Math.min(w.streak - 1, 10) * 25;
    w.coins += amount;
    w.lastDaily = now;
    persist("economy");
    return i.reply({ embeds: [coinEmbed(`📅 You claimed ${COIN} **${n(amount)}**!\n🔥 Streak: **${w.streak}** day(s)${w.streak > 1 ? ` (+${n(amount - 200)} bonus)` : ""}\nBalance: ${COIN} **${n(w.coins)}**`)] });
  },

  async work(i) {
    requireGuild(i);
    const w = wallet(i.guildId, i.user.id);
    const now = Date.now();
    if (now - w.lastWork < HOUR) throw new UserError(`You're tired. Work again ${ts(w.lastWork + HOUR)}.`);
    const amount = rand(60, 180);
    w.coins += amount;
    w.lastWork = now;
    persist("economy");
    return i.reply({ embeds: [coinEmbed(`💼 You ${pick(JOBS)} and earned ${COIN} **${amount}**.\nBalance: ${COIN} **${n(w.coins)}**`)] });
  },

  async pay(i) {
    requireGuild(i);
    const to = i.options.getUser("member");
    const amount = i.options.getInteger("amount");
    if (to.id === i.user.id) throw new UserError("You can't pay yourself.");
    if (to.bot) throw new UserError("Bots don't need coins.");
    const w = takeBet(i, amount);
    w.coins -= amount;
    wallet(i.guildId, to.id).coins += amount;
    persist("economy");
    return i.reply({ embeds: [coinEmbed(`💸 ${i.user} paid ${to} ${COIN} **${n(amount)}**.`)], allowedMentions: { users: [to.id] } });
  },

  async richest(i) {
    requireGuild(i);
    const list = Object.entries(bucket("economy", i.guildId)).filter(([, w]) => w.coins > 0).sort((a, b) => b[1].coins - a[1].coins).slice(0, 10);
    const medals = ["🥇", "🥈", "🥉"];
    const e = new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle(`💰 Richest in ${i.guild.name}`)
      .setDescription(list.map(([id, w], k) => `${medals[k] || `\`#${k + 1}\``} <@${id}> • ${COIN} **${n(w.coins)}**`).join("\n") || "Everyone's broke. Try `/daily`!");
    return i.reply({ embeds: [e], allowedMentions: { parse: [] } });
  },

  async coinflip(i) {
    const result = Math.random() < 0.5 ? "heads" : "tails";
    const bet = i.options.getInteger("bet");
    if (!bet) return i.reply({ embeds: [coinEmbed(`🪙 It's **${result}**!`)] });
    requireGuild(i);
    const side = i.options.getString("side") || "heads";
    const w = takeBet(i, bet);
    const won = side === result;
    w.coins += won ? bet : -bet;
    persist("economy");
    return i.reply({
      embeds: [coinEmbed(`🪙 It's **${result}**! You ${won ? `won ${COIN} **${n(bet)}** 🎉` : `lost ${COIN} **${n(bet)}**`}.\nBalance: ${COIN} **${n(w.coins)}**`, won ? COLORS.ok : COLORS.bad)],
    });
  },

  async slots(i) {
    requireGuild(i);
    const bet = i.options.getInteger("bet");
    const w = takeBet(i, bet);
    const reels = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣"];
    const weights = [30, 25, 20, 13, 8, 4];
    const spin = () => {
      let r = Math.random() * 100;
      for (let k = 0; k < reels.length; k++) if ((r -= weights[k]) < 0) return reels[k];
      return reels[0];
    };
    const row = [spin(), spin(), spin()];
    const triple = { "🍒": 3, "🍋": 4, "🍇": 5, "🔔": 8, "💎": 15, "7️⃣": 30 };
    let mult = 0;
    if (row[0] === row[1] && row[1] === row[2]) mult = triple[row[0]];
    else if (row[0] === row[1] || row[1] === row[2] || row[0] === row[2]) mult = 1.5;
    const payout = Math.floor(bet * mult);
    w.coins += payout - bet;
    persist("economy");
    const verdict = mult >= 3 ? `🎰 **JACKPOT x${mult}!** You won ${COIN} **${n(payout)}**!` : mult ? `Nice pair! You get ${COIN} **${n(payout)}** back.` : `No luck. You lost ${COIN} **${n(bet)}**.`;
    return i.reply({ embeds: [coinEmbed(`**[ ${row.join(" | ")} ]**\n\n${verdict}\nBalance: ${COIN} **${n(w.coins)}**`, mult ? COLORS.ok : COLORS.bad)] });
  },

  async shop(i) {
    requireGuild(i);
    const cfg = config(i.guildId);
    cfg.shop ??= [];
    const sub = i.options.getSubcommand();

    if (sub === "view") {
      const items = cfg.shop.filter((it) => i.guild.roles.cache.has(it.roleId)).sort((a, b) => a.price - b.price);
      const e = new EmbedBuilder()
        .setColor(COLORS.gold)
        .setTitle(`🛒 ${i.guild.name} shop`)
        .setDescription(items.map((it) => `<@&${it.roleId}> • ${COIN} **${n(it.price)}**${it.desc ? `\n↳ ${it.desc}` : ""}`).join("\n\n") || "The shop is empty. Admins can add roles with `/shop add`.")
        .setFooter({ text: "Buy with /shop buy" });
      return i.reply({ embeds: [e], allowedMentions: { parse: [] } });
    }

    const role = i.options.getRole("role");
    if (sub === "buy") {
      const item = cfg.shop.find((it) => it.roleId === role.id);
      if (!item) throw new UserError(`${role} isn't for sale. See \`/shop view\`.`);
      if (i.member.roles.cache.has(role.id)) throw new UserError(`You already have ${role}.`);
      assertCanManage(i.guild, role);
      const w = takeBet(i, item.price);
      await i.member.roles.add(role, "Bought in shop");
      w.coins -= item.price;
      persist("economy");
      return i.reply({ embeds: [coinEmbed(`🛍️ You bought ${role} for ${COIN} **${n(item.price)}**!\nBalance: ${COIN} **${n(w.coins)}**`, COLORS.ok)] });
    }

    requireManager(i);
    if (sub === "add") {
      assertCanManage(i.guild, role);
      cfg.shop = cfg.shop.filter((it) => it.roleId !== role.id);
      cfg.shop.push({ roleId: role.id, price: i.options.getInteger("price"), desc: i.options.getString("description") || "" });
      saveConfig();
      return i.reply({ content: `✅ ${role} is now for sale for ${COIN} **${n(i.options.getInteger("price"))}**.`, allowedMentions: { parse: [] } });
    }
    // remove
    const before = cfg.shop.length;
    cfg.shop = cfg.shop.filter((it) => it.roleId !== role.id);
    saveConfig();
    return i.reply({ content: before === cfg.shop.length ? `${role} wasn't in the shop.` : `🗑️ Removed ${role} from the shop.`, allowedMentions: { parse: [] } });
  },

  async eco(i) {
    const sub = i.options.getSubcommand();
    const user = i.options.getUser("member");
    if (user.bot) throw new UserError("Bots don't have wallets.");
    const w = wallet(i.guildId, user.id);
    if (sub === "give") w.coins += i.options.getInteger("amount");
    if (sub === "take") w.coins = Math.max(0, w.coins - i.options.getInteger("amount"));
    if (sub === "reset") w.coins = 0;
    persist("economy");
    return i.reply({ content: `✅ ${user} now has ${COIN} **${n(w.coins)}**.`, allowedMentions: { parse: [] } });
  },
};

export default { name: "economy", commands, execute };
export { COIN };
