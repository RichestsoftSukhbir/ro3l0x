# RO3L0X: the free all-in-one Discord bot

Leveling, economy, games, moderation, giveaways, welcome messages, social alerts, game stats and free-game alerts in one bot. Other bots charge for many of these features; here they're all free. No premium tier, and no paid APIs.

Run `/help` in Discord for a menu of every command.

## Features

| Category | Commands |
|---|---|
| 📈 **Levels** | `/rank`, `/top`, `/levels settings / reward-add / reward-remove / rewards / ignore / set` |
| 🪙 **Economy** | `/balance`, `/daily` (streak bonus), `/work`, `/pay`, `/richest`, `/coinflip`, `/slots`, `/shop view / buy / add / remove`, `/eco give / take / reset` |
| 🎲 **Games** | `/trivia` (wins coins), `/rps` (vs bot or a friend), `/8ball`, `/roll`, `/choose`, `/counting set / off` |
| 🏡 **Community** | `/welcome set / goodbye / test / off`, `/autorole`, `/rolemenu` (button roles), `/giveaway start / end / reroll / list`, `/poll`, `/remind me / list / cancel`, `/starboard`, `/birthday` |
| 🛡️ **Moderation** | `/warn`, `/warnings`, `/clearwarns`, `/timeout`, `/untimeout`, `/kick`, `/ban`, `/unban`, `/purge`, `/slowmode`, `/modlog`, `/automod settings / badword-add / badword-remove / status` |
| 🔔 **Alerts** | `/alerts youtube` (new uploads), `/alerts twitch` (go-live), `/alerts list / remove` |
| 🎮 **Game stats** | `/link`, `/accounts`, `/unlink`, `/steam profile / games`, `/chess`, `/minecraft player / server / setserver`, `/leaderboard` |
| 🎁 **Deals** | `/deals free` (Epic + Steam), `/deals steam`, `/deals setup` (auto-post), `/deals off` |
| 💡 **Creator** | `/idea`, `/titles`, `/hooks`, `/rate`, `/formats`, `/song`, `/roblox`, `/random`, `/tip` |

Admin commands are hidden from regular members by default. Server owners can change who sees them under *Server Settings → Integrations → RO3L0X*.

## Setup

Needs Node 18+ (this project uses 24.14.0, see `.nvmrc`).

### 1. Discord Developer Portal (https://discord.com/developers/applications → your app)

- **Bot** tab → *Reset Token* → copy it into `DISCORD_TOKEN` in `.env`.
- **Bot** tab → under *Privileged Gateway Intents*, turn ON:
  - **Server Members Intent**: needed for welcome/goodbye, auto-roles and birthdays
  - **Message Content Intent**: needed for automod, counting and XP

  Without these the bot still starts, but those features are off.
- **General Information** → copy *Application ID* into `CLIENT_ID`.

### 2. Invite the bot with the right permissions

Replace `CLIENT_ID` with your Application ID:

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=564049733872726
```

That grants: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Add Reactions, Use External Emojis, Manage Messages, Manage Channels (for slowmode), Manage Roles, Kick, Ban, Timeout Members, Create Polls.

**Important:** In *Server Settings → Roles*, drag the bot's role **above** any role you want it to give (level rewards, shop roles, auto-roles, role menus) and above members you want it to moderate.

### 3. Optional free keys

| Key | For | Get it |
|---|---|---|
| `STEAM_API_KEY` | Steam stats | https://steamcommunity.com/dev/apikey (enter any domain, for example `localhost`) |
| `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` | Twitch live alerts | https://dev.twitch.tv/console/apps → *Register Your Application* (OAuth redirect `http://localhost`, category *Chat Bot*) → *New Secret* |

### 4. Run

```bash
nvm use
npm install
npm run deploy   # register slash commands (rerun after adding/changing commands)
npm start
```

Set `GUILD_ID` in `.env` to update commands instantly on one server. Leave it empty to register globally, which can take up to an hour.

## How things work

- **XP:** 15–25 XP per message, at most once a minute per person (so spamming doesn't help). The XP needed per level grows: 100, 155, 220…
- **Economy:** `/daily` gives 200 coins plus 25 per streak day (up to +250). `/work` gives 60–180 coins once an hour. Coins are per server.
- **Automod:** skips anyone with *Manage Messages*. Anti-spam triggers at 6 messages in 5 seconds. The action is either delete, or delete plus a 5-minute timeout. Everything is logged to `/modlog`.
- **Giveaways, reminders, birthdays and alerts** are saved to disk, so they survive restarts. Birthdays are announced at midnight UTC. YouTube is checked every 10 minutes, Twitch every 3, and deals every 2 hours.

## Data sources (all free)

YouTube RSS feeds • Twitch Helix API • Open Trivia DB • Mojang / PlayerDB • mcstatus.io / mcsrvstat.us • Steam Web API • Chess.com & Lichess APIs • Epic Games Store feed • CheapShark

Everything is saved as JSON in `data/`. Back that folder up if you move the bot.

## Code layout

```
src/
  index.js            startup, intents, routes commands/buttons/events to modules
  deploy-commands.js  registers slash commands
  storage.js          JSON storage with batched writes
  util.js             shared helpers (durations, permissions, templates)
  features/           one file per feature area; index.js lists them
    levels.js economy.js fun.js community.js moderation.js alerts.js
    gaming.js creator.js help.js
  games/              game stats + deals APIs (used by features/gaming.js)
  commands.js ideas.js  creator-tool templates (used by features/creator.js)
```

To add a feature, create `src/features/yourthing.js` that exports `{ name, commands, execute, buttons?, events?, ready? }`, add it to `features/index.js`, then run `npm run deploy`.
