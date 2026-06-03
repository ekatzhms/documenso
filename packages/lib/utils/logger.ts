import { join } from 'node:path';
import { type TransportTargetOptions, pino } from 'pino';

import type { BaseApiLog } from '../types/api-logs';
import { extractRequestMetadata } from '../universal/extract-request-metadata';
import { env } from './env';

// The minimum level to log. Set `NEXT_PRIVATE_LOGGER_LEVEL` to one of pino's
// levels (trace, debug, info, warn, error, fatal, silent) to adjust verbosity
// without a code change. `debug`/`trace` are more verbose than the `info`
// default; `warn`/`error` are quieter. Falls back to `info` if unset or invalid.
const PINO_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
const configuredLevel = env('NEXT_PRIVATE_LOGGER_LEVEL');
const level = configuredLevel && PINO_LEVELS.includes(configuredLevel) ? configuredLevel : 'info';

const transports: TransportTargetOptions[] = [];

if (env('NODE_ENV') !== 'production' && !env('INTERNAL_FORCE_JSON_LOGGER')) {
  transports.push({
    target: 'pino-pretty',
    level,
    options: {
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l o',
    },
  });
}

const loggingFilePath = env('NEXT_PRIVATE_LOGGER_FILE_PATH');

if (loggingFilePath) {
  // Roll the log file daily, producing files named `documenso.YYYY-MM-DD.1.log`
  // (pino-roll hardcodes a `.` before the date and always appends a rotation
  // index, which stays `1` for daily-only rotation). A `current.log` symlink in
  // the same directory always points at the active file.
  // `NEXT_PRIVATE_LOGGER_FILE_PATH` is the directory to write these files into.
  transports.push({
    target: 'pino-roll',
    level,
    options: {
      file: join(loggingFilePath, 'documenso'),
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      extension: '.log',
      mkdir: true,
      symlink: true,
    },
  });
}

export const logger = pino({
  level,
  // Emit ISO-8601 timestamps (e.g. "2026-06-03T20:29:23.496Z") instead of the
  // default epoch milliseconds so JSON/file logs are human-readable and easy to
  // correlate with issues. pino-pretty output is configured via translateTime above.
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    transports.length > 0
      ? {
          targets: transports,
        }
      : undefined,
});

export const logDocumentAccess = ({
  request,
  documentId,
  userId,
}: {
  request: Request;
  documentId: number;
  userId: number;
}) => {
  const metadata = extractRequestMetadata(request);

  const data: BaseApiLog = {
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
    path: new URL(request.url).pathname,
    auth: 'session',
    source: 'app',
    userId,
  };

  logger.info({
    ...data,
    input: {
      documentId,
    },
  });
};
