import pino from 'pino';
import { config } from '../config/index.js';

const isDevelopment = config.nodeEnv === 'development';

export const logger = pino({
  level: config.logLevel,
  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
  base: {
    service: 'payment-processing-service',
    env: config.nodeEnv,
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Redact sensitive fields from logs
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'body.password',
      'body.encryptionKey',
      '*.email',
      '*.name',
      '*.payment_method',
      '*.card_number',
    ],
    censor: '[REDACTED]',
  },
});

/**
 * Create a child logger with request context
 */
export function createRequestLogger(requestId: string): pino.Logger {
  return logger.child({ requestId });
}

/**
 * Create a child logger for queue workers
 */
export function createWorkerLogger(workerId: string): pino.Logger {
  return logger.child({ workerId, component: 'worker' });
}

export type Logger = pino.Logger;
