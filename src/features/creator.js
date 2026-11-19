// Creator tools (/idea, /titles, /hooks …) as a feature module.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { randomUUID } from "node:crypto";
import { creatorCommands, handlers, noRerun } from "../commands.js";
import { EPHEMERAL } from "../util.js";

// Remembers what produced each answer so "Another one" can rerun it. Oldest entries are dropped.
const reruns = new Map();

function buildReply(name, args, user) {
  const { title, text } = handlers[name].run(args);
  const embed = new EmbedBuilder()
    .setColor(0xff3d6e)
    .setTitle(title.slice(0, 250))
    .setDescription(text.slice(0, 4000))
    .setFooter({ text: `Requested by ${user.username}` });
  if (noRerun.has(name)) return { embeds: [embed] };
  const id = randomUUID();
  reruns.set(id, { name, args });
  if (reruns.size > 1000) reruns.delete(reruns.keys().next().value);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`again:${id}`).setLabel("Another one").setEmoji("🔄").setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

const execute = Object.fromEntries(Object.keys(handlers).map((name) => [name, (i) => i.reply(buildReply(name, handlers[name].read(i), i.user))]));

export default {
  name: "creator",
  commands: creatorCommands,
  execute,
  buttons: {
    again(i, [id]) {
      const entry = reruns.get(id);
      if (!entry) return i.reply({ content: "That button expired, run the command again.", flags: EPHEMERAL });
      return i.reply(buildReply(entry.name, entry.args, i.user));
    },
  },
};
