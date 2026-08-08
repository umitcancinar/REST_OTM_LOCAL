"use strict";
// ==========================================
// Logger Utility
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
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
function timestamp() {
    return new Date().toISOString();
}
exports.logger = {
    info: (message, ...args) => {
        console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.blue}INFO${colors.reset}  ${message}`, ...args);
    },
    success: (message, ...args) => {
        console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.green}OK${colors.reset}    ${message}`, ...args);
    },
    warn: (message, ...args) => {
        console.warn(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.yellow}WARN${colors.reset}  ${message}`, ...args);
    },
    error: (message, ...args) => {
        console.error(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.red}ERROR${colors.reset} ${message}`, ...args);
    },
    debug: (message, ...args) => {
        if (process.env.NODE_ENV === 'development') {
            console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.magenta}DEBUG${colors.reset} ${message}`, ...args);
        }
    },
    http: (message) => {
        console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.cyan}HTTP${colors.reset}  ${message}`);
    },
};
//# sourceMappingURL=logger.js.map