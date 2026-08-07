// PM2 process definition for running the ADASOS dev server as a persistent
// background daemon, independent of any terminal, VS Code window, or Claude
// Code session that happened to start it. See ../RUN_GUIDE.md.
module.exports = {
  apps: [
    {
      name: "adasos-web",
      cwd: __dirname,
      script: "scripts/pm2-dev.mjs",
      interpreter: "node",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      watch: false,
      out_file: "./.pm2/out.log",
      error_file: "./.pm2/error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
