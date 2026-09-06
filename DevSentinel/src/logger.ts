type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

interface LogFields {
  [key: string]: unknown;
}

function write(level: LogLevel, msg: string, fields?: LogFields): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const out = level === "error" || level === "fatal" ? console.error : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
  fatal: (msg: string, fields?: LogFields) => write("fatal", msg, fields),
};

export function withCorrelationId(correlationId: string) {
  return {
    debug: (msg: string, fields?: LogFields) => write("debug", msg, { correlationId, ...fields }),
    info: (msg: string, fields?: LogFields) => write("info", msg, { correlationId, ...fields }),
    warn: (msg: string, fields?: LogFields) => write("warn", msg, { correlationId, ...fields }),
    error: (msg: string, fields?: LogFields) => write("error", msg, { correlationId, ...fields }),
  };
}
