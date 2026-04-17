import fs from "fs";
import path from "path";

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  data?: unknown;
}

const LOG_DIR = process.env.LOG_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "campsense.log");
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch {
    // Fall back to console if we can't create log dir
  }
}

function rotateIfNeeded() {
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size >= MAX_LOG_SIZE) {
      const rotated = LOG_FILE + ".1";
      if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
      fs.renameSync(LOG_FILE, rotated);
    }
  } catch {
    // File doesn't exist yet or rotation failed — fine
  }
}

function writeLog(entry: LogEntry) {
  const line = JSON.stringify(entry) + "\n";
  try {
    ensureLogDir();
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // Last resort: write to stderr so systemd journal still captures it
    process.stderr.write(line);
  }
}

function formatData(args: unknown[]): unknown | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 1) {
    const v = args[0];
    if (v instanceof Error) return { error: v.message, stack: v.stack };
    return v;
  }
  return args.map((v) => (v instanceof Error ? { error: v.message, stack: v.stack } : v));
}

export const logger = {
  info(context: string, message: string, ...data: unknown[]) {
    writeLog({
      timestamp: new Date().toISOString(),
      level: "info",
      context,
      message,
      data: formatData(data),
    });
  },

  warn(context: string, message: string, ...data: unknown[]) {
    writeLog({
      timestamp: new Date().toISOString(),
      level: "warn",
      context,
      message,
      data: formatData(data),
    });
  },

  error(context: string, message: string, ...data: unknown[]) {
    writeLog({
      timestamp: new Date().toISOString(),
      level: "error",
      context,
      message,
      data: formatData(data),
    });
  },
};
