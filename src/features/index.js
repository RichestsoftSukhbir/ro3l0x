// Every feature module, in the order message handlers run (moderation first so it can block spam).
import alerts from "./alerts.js";
import community from "./community.js";
import creator from "./creator.js";
import economy from "./economy.js";
import fun from "./fun.js";
import gaming from "./gaming.js";
import help from "./help.js";
import levels from "./levels.js";
import moderation from "./moderation.js";
import protection from "./protection.js";
import roblox from "./roblox.js";
import server from "./server.js";
import utility from "./utility.js";
import voice from "./voice.js";

export const modules = [moderation, protection, levels, economy, fun, community, server, utility, voice, roblox, alerts, gaming, creator, help];

export const allCommands = () => modules.flatMap((m) => m.commands);
