/**
 * SECURITY ENGINE
 *
 * Handles three core responsibilities:
 *   1. Rotating verification keys (HMAC-SHA256 with time-windowed rotation)
 *   2. Rule checking (spending limits, contact/domain allow/blocklists, action permissions)
 *   3. Daily spend tracking
 *
 * The rotating key mechanism:
 *   - A 256-bit secret is generated on first run and persisted in the config directory
 *   - The current key = HMAC-SHA256(secret, floor(timestamp / rotation_window))
 *   - When the time window advances, the key automatically rotates
 *   - The previous window's key is still accepted (grace period) to avoid race conditions
 *   - A prompt injection can't reproduce the key because the secret never enters the context
 */
import { ConfigManager } from "./config.js";
interface ActionCheck {
    action_type: string;
    target: string;
    amount: number;
    description: string;
}
interface RuleResult {
    allowed: boolean;
    requiresConfirmation: boolean;
    reason: string;
    rulesChecked: string[];
    dailySpendRemaining: number;
}
interface SecurityStatus {
    keyValid: boolean;
    keyAgeMinutes: number;
    keyRotatesInMinutes: number;
    dailySpendLimit: number;
    dailySpendUsed: number;
    dailySpendRemaining: number;
}
export declare class SecurityEngine {
    private config;
    private secret;
    private rotationMinutes;
    private dailySpendUsed;
    private dailySpendResetDate;
    private initTime;
    constructor(config: ConfigManager);
    /**
     * Initialize the security engine.
     * Loads or generates the signing secret and sets up rotation parameters.
     */
    initialize(): void;
    /**
     * Load the signing secret from disk, or generate a new one if none exists.
     * The secret is stored in ~/.carapace/.secret (not in the config file,
     * which may be synced via the dashboard).
     */
    private loadOrCreateSecret;
    /**
     * Generate a verification key for the current time window.
     *
     * The key is: HMAC-SHA256(secret, time_window_index)
     * where time_window_index = floor(now / (rotation_minutes * 60 * 1000))
     *
     * We return the first 16 hex characters for brevity — enough for
     * verification without being unwieldy in the context window.
     */
    generateKey(): string;
    /**
     * Validate a key. Accepts the current window OR the previous window
     * (grace period to handle calls that straddle a rotation boundary).
     */
    validateKey(key: string): boolean;
    /**
     * Check an action against all configured rules.
     * Returns whether the action is allowed and details about which rules were checked.
     */
    checkRules(action: ActionCheck): RuleResult;
    /**
     * Record a spend amount for daily tracking.
     */
    recordSpend(amount: number): void;
    /**
     * Get current security status for the status tool.
     */
    getStatus(): SecurityStatus;
    private getCurrentWindowIndex;
    private computeKey;
    private getDailySpendRemaining;
    private resetDailySpendIfNeeded;
}
export {};
//# sourceMappingURL=security.d.ts.map