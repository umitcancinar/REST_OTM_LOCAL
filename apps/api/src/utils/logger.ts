// ==========================================
// Logger Utility
// ==========================================

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info: (message: string, ...args: unknown[]) => {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.blue}INFO${colors.reset}  ${message}`, ...args);
  },
  success: (message: string, ...args: unknown[]) => {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.green}OK${colors.reset}    ${message}`, ...args);
  },
  warn: (message: string, ...args: unknown[]) => {
    console.warn(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.yellow}WARN${colors.reset}  ${message}`, ...args);
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.red}ERROR${colors.reset} ${message}`, ...args);
  },
  debug: (message: string, ...args: unknown[]) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.magenta}DEBUG${colors.reset} ${message}`, ...args);
    }
  },
  http: (message: string) => {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.cyan}HTTP${colors.reset}  ${message}`);
  },
};
