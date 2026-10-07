/**
 * PM2 process file — for VPS deployments without Docker.
 *
 *   npm install --omit=dev (or: pnpm install --prod)
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup   # survive reboots
 */
module.exports = {
	apps: [
		{
			name: 'kestrel',
			script: 'server.js',
			instances: 1, // the JSON store is single-writer: never run more than one instance
			exec_mode: 'fork',
			autorestart: true,
			max_restarts: 20,
			min_uptime: '10s',
			max_memory_restart: '250M',
			out_file: 'logs/out.log',
			error_file: 'logs/error.log',
			merge_logs: true,
			time: true,
			env: {
				NODE_ENV: 'production',
				HOST: '0.0.0.0',
				PORT: '3000',
				UPTIME_DATA_DIR: './data',
				LOG_FORMAT: 'json',
			},
		},
	],
};
