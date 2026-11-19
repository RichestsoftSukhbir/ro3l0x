// Registers slash commands with Discord. Run with: npm run deploy
// Set GUILD_ID in .env for instant updates on one server; leave it empty to register globally (can take up to an hour).
import "dotenv/config";
import { REST, Routes } from "discord.js";
import { allCommands } from "./features/index.js";

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in .env");
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);
const body = allCommands().map((c) => c.toJSON());
const route = GUILD_ID ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) : Routes.applicationCommands(CLIENT_ID);

try {
  const result = await rest.put(route, { body });
  console.log(`Registered ${result.length} commands ${GUILD_ID ? `on server ${GUILD_ID}` : "globally"}.`);
} catch (err) {
  console.error("Failed to register commands:", err.message);
  process.exit(1);
}
