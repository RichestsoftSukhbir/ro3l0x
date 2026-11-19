#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu server. Run from the bot folder:  bash scripts/setup-server.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "❌ .env is missing. Copy your .env into $(pwd) first."; exit 1
fi

echo "==> Installing Node.js (via nvm)"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
. "$NVM_DIR/nvm.sh"
nvm install
nvm use

echo "==> Installing bot packages"
npm ci --omit=dev

echo "==> Registering slash commands"
npm run deploy

echo "==> Starting the bot with pm2"
npm install -g pm2
pm2 delete discord-bot >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save

echo "==> Making it start automatically after reboots"
sudo env PATH="$PATH" "$(which pm2)" startup systemd -u "$USER" --hp "$HOME" | tail -1
pm2 save

echo ""
echo "✅ Done! The bot runs 24/7 now."
echo "   Logs:     pm2 logs discord-bot"
echo "   Restart:  pm2 restart discord-bot"
echo "   Status:   pm2 status"
