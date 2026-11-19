// Game stats + deals (from src/games) as a feature module.
import { executeGameCommand, gameCommandData, gameCommandNames, onDealsSetup } from "../games/commands.js";
import { startDealNotifier } from "../games/notifier.js";

export default {
  name: "gaming",
  commands: gameCommandData,
  execute: Object.fromEntries([...gameCommandNames].map((name) => [name, executeGameCommand])),
  ready(client) {
    onDealsSetup(startDealNotifier(client));
  },
};
