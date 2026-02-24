/**
 * CONFIG MANAGER
 *
 * Handles loading, reading, and managing the user's Carapace configuration.
 *
 * Config file location: ~/.carapace/config.json
 *
 * The config file is either:
 *   1. Written by the web dashboard (downloaded/synced)
 *   2. Created manually by the user
 *   3. Auto-generated with safe defaults on first run
 *
 * Config structure (see DEFAULT_CONFIG below for the full schema):
 *   - security: spending limits, contact rules, domain rules, action permissions
 *   - anchor: goals, priorities, constraints, refresh interval
 *   - monitoring: log retention, alert thresholds
 */
export declare class ConfigManager {
    private config;
    private configDir;
    private configPath;
    constructor();
    /**
     * Load configuration from disk, or create default config if none exists.
     */
    load(): Promise<void>;
    /**
     * Save current configuration to disk.
     */
    save(): void;
    /**
     * Get a config value by dot-notation path.
     * Example: get("security.spendingLimits.daily", 200)
     */
    get<T>(path: string, defaultValue: T): T;
    /**
     * Get the full config object (for status reporting).
     */
    getAll(): Record<string, any>;
    /**
     * Get the config directory path.
     */
    getConfigDir(): string;
    /**
     * Get the config file path.
     */
    getConfigPath(): string;
    /**
     * Deep merge two objects. Source values override target values.
     */
    private deepMerge;
}
//# sourceMappingURL=config.d.ts.map