export const API_BASE_URL = 'v1/projects/home';
export const ROOMS = 'rooms';
export const INFO = 'info';
export const DEVICES = 'devices';
export const RECIPES = 'recipes';
export const SCENARIOS = 'scenarios';
export const MACROS = 'macros';
export const COMMANDS = 'commands';
export const ISACTIVE = 'isactive';
export const EXECUTE = 'execute';
export const TRIGGER = 'trigger';

// Fallback polling (safety net while Socket.IO push is the primary state source)
export const FALLBACK_POLL_INTERVAL = 300;
export const MIN_POLL_INTERVAL = 30;

// Debounce times for push-triggered updates
export const REFRESH_DEBOUNCE_MS = 1500;
export const RESYNC_DEBOUNCE_MS = 5000;

// HTTP timeout for all brain requests
export const HTTP_TIMEOUT_MS = 5000;

// Legacy custom config path (v1.x) - no longer used, kept for the migration hint
export const LEGACY_CUSTOM_PATH = '0_userdata.0.neeo';
