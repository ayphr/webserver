import pino from 'pino';
import { LOG_LEVEL } from '../env';

const level = LOG_LEVEL;

function serializeError(value: unknown) {
  if (value instanceof Error) {
    const { name, message, stack } = value;
    return {
      type: name,
      message,
      stack,
      ...Object.fromEntries(
        Object.entries(value as unknown as Record<string, unknown>).filter(
          ([key]) => !['name', 'message', 'stack'].includes(key),
        ),
      ),
    };
  }

  if (typeof value === 'object' && value !== null) {
    return value;
  }

  return { message: String(value) };
}

const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:d mmm h:MMtt',
    ignore: 'pid,hostname,component',
    messageFormat: '{component}: {msg}',
  },
});

export const logger = pino(
  {
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      error: serializeError,
      err: serializeError,
    },
  },
  transport
);

/**
 * Creates a child logger with a specific component name.
 * @param name The name of the component
 * @returns A child logger instance
 */
export function createLogger(name: string) {
  return logger.child({ component: name });
}
