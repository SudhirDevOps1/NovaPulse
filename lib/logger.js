const LEVELS = { silent: -1, error: 0, warn: 1, info: 2, debug: 3 };

const isProduction = process.env.NODE_ENV === 'production';
const levelName = (process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug')).toLowerCase();
const threshold = LEVELS[levelName] ?? LEVELS.info;
const pretty = (process.env.LOG_FORMAT || (isProduction ? 'json' : 'pretty')).toLowerCase() === 'pretty';

function write(level, message, meta) {
	if ((LEVELS[level] ?? 2) > threshold) return;
	const time = new Date().toISOString();

	if (pretty) {
		const tag = { error: '✖', warn: '⚠', info: '•', debug: '·' }[level] || '•';
		const extra = meta ? ` ${JSON.stringify(meta)}` : '';
		process.stdout.write(`${time} ${tag} ${message}${extra}\n`);
		return;
	}

	const line = { t: time, level, message, ...(meta ? { meta } : {}) };
	process.stdout.write(`${JSON.stringify(line)}\n`);
}

const logger = {
	error: (message, meta) => write('error', message, meta),
	warn: (message, meta) => write('warn', message, meta),
	info: (message, meta) => write('info', message, meta),
	debug: (message, meta) => write('debug', message, meta),
	child: (base) => ({
		error: (m, meta) => write('error', m, { ...base, ...meta }),
		warn: (m, meta) => write('warn', m, { ...base, ...meta }),
		info: (m, meta) => write('info', m, { ...base, ...meta }),
		debug: (m, meta) => write('debug', m, { ...base, ...meta }),
	}),
};

module.exports = logger;
