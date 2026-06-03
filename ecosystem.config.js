// PM2 process configuration for Documenso.
//
// Apply with:
//   pm2 delete documenso 2>/dev/null; pm2 start ecosystem.config.js && pm2 save
//
// `time: true` prefixes every captured stdout/stderr line in
// ~/.pm2/logs/documenso-{out,error}.log with an ISO timestamp, covering both
// pino output and raw console.* / framework logging.
module.exports = {
  apps: [
    {
      name: 'documenso',
      cwd: '/var/www/documenso/apps/remix',
      script: 'npm',
      args: 'start',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      merge_logs: true,
    },
  ],
};
