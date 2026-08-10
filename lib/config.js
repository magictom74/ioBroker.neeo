"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_CUSTOM_PATH = exports.HTTP_TIMEOUT_MS = exports.RESYNC_DEBOUNCE_MS = exports.REFRESH_DEBOUNCE_MS = exports.MIN_POLL_INTERVAL = exports.FALLBACK_POLL_INTERVAL = exports.TRIGGER = exports.EXECUTE = exports.ISACTIVE = exports.COMMANDS = exports.MACROS = exports.SCENARIOS = exports.RECIPES = exports.DEVICES = exports.INFO = exports.ROOMS = exports.API_BASE_URL = void 0;
exports.API_BASE_URL = 'v1/projects/home';
exports.ROOMS = 'rooms';
exports.INFO = 'info';
exports.DEVICES = 'devices';
exports.RECIPES = 'recipes';
exports.SCENARIOS = 'scenarios';
exports.MACROS = 'macros';
exports.COMMANDS = 'commands';
exports.ISACTIVE = 'isactive';
exports.EXECUTE = 'execute';
exports.TRIGGER = 'trigger';
// Fallback polling (safety net while Socket.IO push is the primary state source)
exports.FALLBACK_POLL_INTERVAL = 300;
exports.MIN_POLL_INTERVAL = 30;
// Debounce times for push-triggered updates
exports.REFRESH_DEBOUNCE_MS = 1500;
exports.RESYNC_DEBOUNCE_MS = 5000;
// HTTP timeout for all brain requests
exports.HTTP_TIMEOUT_MS = 5000;
// Legacy custom config path (v1.x) - no longer used, kept for the migration hint
exports.LEGACY_CUSTOM_PATH = '0_userdata.0.neeo';
