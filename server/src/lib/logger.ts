import pino from 'pino';
import util from 'node:util';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const enableStructured = process.env.NODE_ENV === 'production';
export const logger = pino({
  level,
  base: {
    service: 'ayphr-server'
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  enabled: enableStructured
});

const LEVEL_COLOR: Record<string, string> = {
  trace: '\u001b[34m',
  debug: '\u001b[36m',
  info: '\u001b[32m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
  fatal: '\u001b[35m',
};
const RESET = '\u001b[0m';

function prettyFormat(levelName: string, component: string | undefined, msg: string, meta?: unknown) {
  const now = new Date();
  const ts = process.env.NODE_ENV === 'production'
    ? now.toISOString()
    : formatPrettyTs(now);
  const levelColor = LEVEL_COLOR[levelName] ?? '';
  const comp = component ? `${component}` : 'app';
  let out = `${levelColor}[${ts}] ${levelName.toUpperCase()} ${comp}:${RESET} ${msg}`;

  if (meta !== undefined && meta !== null && (typeof meta === 'object' || Array.isArray(meta))) {
    // If meta is a plain object with only primitive values, show inline (e.g. "port=8080").
    if (!Array.isArray(meta)) {
      const entries = Object.entries(meta as Record<string, unknown>);
      const allPrimitive = entries.length > 0 && entries.every(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
      if (allPrimitive) {
        const kv = entries.map(([k, v]) => {
          if (typeof v === 'string') return `${k}="${v}"`;
          return `${k}=${String(v)}`;
        }).join(' ');
        out += ` ${kv}`;
      } else {
        const inspected = util.inspect(meta, { colors: true, depth: 4, compact: false });
        out += `\n${inspected}`;
      }
    } else {
      const inspected = util.inspect(meta, { colors: true, depth: 4, compact: false });
      out += `\n${inspected}`;
    }
  } else if (meta !== undefined) {
    out += ` ${String(meta)}`;
  }

  return out;
}

function formatPrettyTs(d: Date) {
  const day = d.getDate();
  const month = d.toLocaleString('en-US', { month: 'short' });
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${day} ${month} ${hours}:${minutes}${ampm}`;
}

function makePrettyLogger(childName?: string) {
  return {
    trace: (obj?: any, msg?: string) => {
      const message = typeof obj === 'string' ? obj : (msg ?? (obj && obj.msg) ?? '');
      const meta = typeof obj === 'object' && !Array.isArray(obj) ? obj : undefined;
      console.debug(prettyFormat('trace', childName, message, meta));
    },
    debug: (obj?: any, msg?: string) => {
      const message = typeof obj === 'string' ? obj : (msg ?? (obj && obj.msg) ?? '');
      const meta = typeof obj === 'object' && !Array.isArray(obj) ? obj : undefined;
      console.debug(prettyFormat('debug', childName, message, meta));
    },
    info: (obj?: any, msg?: string) => {
      const message = typeof obj === 'string' ? obj : (msg ?? (obj && obj.msg) ?? '');
      const meta = typeof obj === 'object' && !Array.isArray(obj) ? obj : undefined;
      console.log(prettyFormat('info', childName, message, meta));
    },
    warn: (obj?: any, msg?: string) => {
      const message = typeof obj === 'string' ? obj : (msg ?? (obj && obj.msg) ?? '');
      const meta = typeof obj === 'object' && !Array.isArray(obj) ? obj : undefined;
      console.warn(prettyFormat('warn', childName, message, meta));
    },
    error: (obj?: any, msg?: string) => {
      const message = typeof obj === 'string' ? obj : (msg ?? (obj && obj.msg) ?? '');
      const meta = typeof obj === 'object' && !Array.isArray(obj) ? obj : undefined;
      console.error(prettyFormat('error', childName, message, meta));
    },
    fatal: (obj?: any, msg?: string) => {
      const message = typeof obj === 'string' ? obj : (msg ?? (obj && obj.msg) ?? '');
      const meta = typeof obj === 'object' && !Array.isArray(obj) ? obj : undefined;
      console.error(prettyFormat('fatal', childName, message, meta));
    },
    child: (props: Record<string, unknown>) => makePrettyLogger(String(props.component ?? childName)),
  } as Record<string, any>;
}

export function createLogger(name: string) {
  const pinoChild = logger.child({ component: name });
  if (process.env.NODE_ENV === 'production') return pinoChild;

  // In non-production, return an adapter that logs to both pino (structured) and a pretty console output
  const pretty = makePrettyLogger(name);

  const adapt = {} as Record<string, any>;
  for (const lvl of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
    adapt[lvl] = (...args: any[]) => {
      try {
        // pino: logger[level](meta?, msg?)
        (pinoChild as any)[lvl](...args);
      } catch {
        // ignore pino errors in pretty mode
      }
      try {
        (pretty as any)[lvl](...args);
      } catch {
        // ignore
      }
    };
  }

  adapt.child = (props: Record<string, unknown>) => createLogger(String(props.component ?? name));

  return adapt as unknown as pino.Logger;
}
