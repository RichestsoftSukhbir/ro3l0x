// pm2 config: keeps the bot running, restarts it if it crashes, and starts it on boot.
module.exports = {
  apps: [
    {
      name: "discord-bot",
      script: "src/index.js",
      cwd: __dirname,
      max_memory_restart: "400M",
      restart_delay: 5000,
      kill_timeout: 5000, // gives the bot time to save data on shutdown
    },
  ],
};
