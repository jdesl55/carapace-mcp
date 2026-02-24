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
import fs from "fs";
import path from "path";
import os from "os";
// ─────────────────────────────────────────────
// Default configuration
// ─────────────────────────────────────────────
// These are safe, sensible defaults that protect the user out of the box.
// The user can customize everything via the dashboard or by editing the file.
const DEFAULT_CONFIG = {
    // ── Security rules ──
    security: {
        // Rotating key settings
        keyRotationMinutes: 30, // How often the verification key rotates
        // Spending limits
        spendingLimits: {
            perAction: 50, // Max dollars per single action
            daily: 200, // Max total dollars per day
            warnAbove: 20, // Warn (but allow) above this amount
        },
        // Contact rules for messaging actions
        contacts: {
            mode: "blocklist", // "blocklist" or "allowlist"
            allowed: [], // If mode=allowlist, only these contacts are permitted
            blocked: [], // These contacts are always blocked
        },
        // Domain rules for web browsing and API access
        domains: {
            mode: "blocklist", // "blocklist" or "allowlist"
            allowed: [], // If mode=allowlist, only these domains are permitted
            blocked: [], // These domains are always blocked
        },
        // Action types that are completely disabled
        blockedActions: [],
        // Possible values: "send_message", "send_email", "make_purchase",
        // "delete_file", "api_write", "install_package", "browse_new_domain",
        // "account_change", "shell_command", "file_write", "calendar_modify"
        // Custom if/then rules for advanced users
        // Example: { if: { field: "amount", operator: "greater_than", value: 100 },
        //            then: "block", reason: "Purchases over $100 require manual approval" }
        customRules: [],
    },
    // ── Goal anchor settings ──
    anchor: {
        refreshIntervalMinutes: 15, // How often the anchor context is reinserted
        // The user's goals and priorities (natural language)
        goals: [
            "Manage inbox and respond to important emails",
            "Keep my calendar organized",
        ],
        // Priority ranking (1 = highest)
        priorities: [
            { rank: 1, text: "Never spend money without explicit confirmation" },
            { rank: 2, text: "Protect my private information" },
            { rank: 3, text: "Stay focused on the tasks I've assigned" },
        ],
        // Hard constraints the agent must never violate
        constraints: [
            "Never share personal information with unknown contacts",
            "Never delete files without confirmation",
            "Never send messages on my behalf without showing me first",
        ],
        // Operating context (what the agent should know about the user's situation)
        context: "",
        // Example: "I'm preparing for a Thursday meeting with the board.
        //           Focus on gathering the Q4 report data and scheduling prep time."
        // Categories for drift detection (matched against action types)
        goalCategories: ["email", "calendar", "productivity"],
    },
    // ── Monitoring settings ──
    monitoring: {
        logRetentionDays: 30, // How long to keep action logs
        alertOnUnverifiedTier1: true, // Flag if Tier 1 actions happen without verification
        maxActionsBeforeAnchor: 20, // Suggest anchor refresh after N actions
    },
};
// ─────────────────────────────────────────────
// ConfigManager class
// ─────────────────────────────────────────────
export class ConfigManager {
    config = {};
    configDir;
    configPath;
    constructor() {
        // Config lives in ~/.carapace/
        this.configDir = path.join(os.homedir(), ".carapace");
        this.configPath = path.join(this.configDir, "config.json");
    }
    /**
     * Load configuration from disk, or create default config if none exists.
     */
    async load() {
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, "utf-8");
                const userConfig = JSON.parse(raw);
                // Deep merge user config with defaults (user overrides take precedence)
                this.config = this.deepMerge(DEFAULT_CONFIG, userConfig);
                console.error(`[Carapace] Config loaded from ${this.configPath}`);
            }
            else {
                // No config exists — create one with defaults
                this.config = { ...DEFAULT_CONFIG };
                this.save();
                console.error(`[Carapace] Default config created at ${this.configPath}`);
                console.error("[Carapace] Edit this file or use the web dashboard to customize your settings.");
            }
        }
        catch (error) {
            console.error(`[Carapace] Error loading config: ${error}. Using defaults.`);
            this.config = { ...DEFAULT_CONFIG };
        }
    }
    /**
     * Save current configuration to disk.
     */
    save() {
        try {
            if (!fs.existsSync(this.configDir)) {
                fs.mkdirSync(this.configDir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), { mode: 0o600 } // Owner read/write only
            );
        }
        catch (error) {
            console.error(`[Carapace] Error saving config: ${error}`);
        }
    }
    /**
     * Get a config value by dot-notation path.
     * Example: get("security.spendingLimits.daily", 200)
     */
    get(path, defaultValue) {
        const keys = path.split(".");
        let current = this.config;
        for (const key of keys) {
            if (current === undefined || current === null) {
                return defaultValue;
            }
            current = current[key];
        }
        return current !== undefined ? current : defaultValue;
    }
    /**
     * Get the full config object (for status reporting).
     */
    getAll() {
        return { ...this.config };
    }
    /**
     * Get the config directory path.
     */
    getConfigDir() {
        return this.configDir;
    }
    /**
     * Get the config file path.
     */
    getConfigPath() {
        return this.configPath;
    }
    /**
     * Deep merge two objects. Source values override target values.
     */
    deepMerge(target, source) {
        const result = { ...target };
        for (const key of Object.keys(source)) {
            if (source[key] &&
                typeof source[key] === "object" &&
                !Array.isArray(source[key]) &&
                target[key] &&
                typeof target[key] === "object" &&
                !Array.isArray(target[key])) {
                result[key] = this.deepMerge(target[key], source[key]);
            }
            else {
                result[key] = source[key];
            }
        }
        return result;
    }
}
//# sourceMappingURL=config.js.map