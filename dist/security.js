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
import crypto from "crypto";
import fs from "fs";
import path from "path";
// ─────────────────────────────────────────────
// SecurityEngine class
// ─────────────────────────────────────────────
export class SecurityEngine {
    config;
    secret = "";
    rotationMinutes = 30;
    dailySpendUsed = 0;
    dailySpendResetDate = "";
    initTime = Date.now();
    constructor(config) {
        this.config = config;
    }
    /**
     * Initialize the security engine.
     * Loads or generates the signing secret and sets up rotation parameters.
     */
    initialize() {
        this.rotationMinutes = this.config.get("security.keyRotationMinutes", 30);
        this.secret = this.loadOrCreateSecret();
        this.dailySpendUsed = 0;
        this.dailySpendResetDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        this.initTime = Date.now();
    }
    /**
     * Load the signing secret from disk, or generate a new one if none exists.
     * The secret is stored in ~/.carapace/.secret (not in the config file,
     * which may be synced via the dashboard).
     */
    loadOrCreateSecret() {
        const secretPath = path.join(this.config.getConfigDir(), ".secret");
        try {
            if (fs.existsSync(secretPath)) {
                return fs.readFileSync(secretPath, "utf-8").trim();
            }
        }
        catch {
            // File doesn't exist or isn't readable, generate new
        }
        // Generate a new 256-bit secret
        const newSecret = crypto.randomBytes(32).toString("hex");
        // Ensure the directory exists
        const dir = path.dirname(secretPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Write with restrictive permissions (owner read/write only)
        fs.writeFileSync(secretPath, newSecret, { mode: 0o600 });
        return newSecret;
    }
    /**
     * Generate a verification key for the current time window.
     *
     * The key is: HMAC-SHA256(secret, time_window_index)
     * where time_window_index = floor(now / (rotation_minutes * 60 * 1000))
     *
     * We return the first 16 hex characters for brevity — enough for
     * verification without being unwieldy in the context window.
     */
    generateKey() {
        const windowIndex = this.getCurrentWindowIndex();
        return this.computeKey(windowIndex);
    }
    /**
     * Validate a key. Accepts the current window OR the previous window
     * (grace period to handle calls that straddle a rotation boundary).
     */
    validateKey(key) {
        const currentWindow = this.getCurrentWindowIndex();
        const currentKey = this.computeKey(currentWindow);
        const previousKey = this.computeKey(currentWindow - 1);
        return key === currentKey || key === previousKey;
    }
    /**
     * Check an action against all configured rules.
     * Returns whether the action is allowed and details about which rules were checked.
     */
    checkRules(action) {
        const rulesChecked = [];
        let allowed = true;
        let requiresConfirmation = false;
        let reason = "";
        // ── Rule 1: Spending limits ──
        if (action.amount > 0) {
            rulesChecked.push("spending_limit");
            // Check per-action limit
            const perActionLimit = this.config.get("security.spendingLimits.perAction", 50);
            if (action.amount > perActionLimit) {
                allowed = false;
                reason = `Amount $${action.amount} exceeds per-action limit of $${perActionLimit}.`;
                return {
                    allowed,
                    requiresConfirmation: false,
                    reason,
                    rulesChecked,
                    dailySpendRemaining: this.getDailySpendRemaining(),
                };
            }
            // Check daily limit
            const dailyLimit = this.config.get("security.spendingLimits.daily", 200);
            this.resetDailySpendIfNeeded();
            if (this.dailySpendUsed + action.amount > dailyLimit) {
                allowed = false;
                reason = `This purchase ($${action.amount}) would exceed daily spend limit of $${dailyLimit}. ` +
                    `Already spent today: $${this.dailySpendUsed.toFixed(2)}.`;
                return {
                    allowed,
                    requiresConfirmation: false,
                    reason,
                    rulesChecked,
                    dailySpendRemaining: this.getDailySpendRemaining(),
                };
            }
            // Warn threshold (e.g., above $20 but under the limit)
            const warnThreshold = this.config.get("security.spendingLimits.warnAbove", 20);
            if (action.amount > warnThreshold) {
                requiresConfirmation = true;
                reason = `Amount $${action.amount} is above the warning threshold of $${warnThreshold}. ` +
                    `Please confirm with the user before proceeding.`;
            }
        }
        // ── Rule 2: Contact allowlist/blocklist ──
        if (["send_message", "send_email"].includes(action.action_type)) {
            rulesChecked.push("contact_rules");
            const blockedContacts = this.config.get("security.contacts.blocked", []);
            const allowedContacts = this.config.get("security.contacts.allowed", []);
            const contactMode = this.config.get("security.contacts.mode", "blocklist");
            // "blocklist" = everyone allowed except blocked
            // "allowlist" = only allowed contacts permitted
            const targetLower = action.target.toLowerCase();
            if (contactMode === "allowlist" && allowedContacts.length > 0) {
                const isAllowed = allowedContacts.some((c) => targetLower.includes(c.toLowerCase()));
                if (!isAllowed) {
                    allowed = false;
                    reason = `Contact "${action.target}" is not on the approved contacts list. ` +
                        `In allowlist mode, messages can only be sent to approved contacts.`;
                    return {
                        allowed,
                        requiresConfirmation: false,
                        reason,
                        rulesChecked,
                        dailySpendRemaining: this.getDailySpendRemaining(),
                    };
                }
            }
            const isBlocked = blockedContacts.some((c) => targetLower.includes(c.toLowerCase()));
            if (isBlocked) {
                allowed = false;
                reason = `Contact "${action.target}" is on the blocked contacts list.`;
                return {
                    allowed,
                    requiresConfirmation: false,
                    reason,
                    rulesChecked,
                    dailySpendRemaining: this.getDailySpendRemaining(),
                };
            }
        }
        // ── Rule 3: Domain allowlist/blocklist ──
        if (["browse_new_domain", "api_write"].includes(action.action_type)) {
            rulesChecked.push("domain_rules");
            const blockedDomains = this.config.get("security.domains.blocked", []);
            const allowedDomains = this.config.get("security.domains.allowed", []);
            const domainMode = this.config.get("security.domains.mode", "blocklist");
            const targetLower = action.target.toLowerCase();
            if (domainMode === "allowlist" && allowedDomains.length > 0) {
                const isAllowed = allowedDomains.some((d) => targetLower.includes(d.toLowerCase()));
                if (!isAllowed) {
                    allowed = false;
                    reason = `Domain "${action.target}" is not on the approved domains list.`;
                    return {
                        allowed,
                        requiresConfirmation: false,
                        reason,
                        rulesChecked,
                        dailySpendRemaining: this.getDailySpendRemaining(),
                    };
                }
            }
            const isBlocked = blockedDomains.some((d) => targetLower.includes(d.toLowerCase()));
            if (isBlocked) {
                allowed = false;
                reason = `Domain "${action.target}" is blocked by your security rules.`;
                return {
                    allowed,
                    requiresConfirmation: false,
                    reason,
                    rulesChecked,
                    dailySpendRemaining: this.getDailySpendRemaining(),
                };
            }
        }
        // ── Rule 4: Action type permissions ──
        rulesChecked.push("action_permissions");
        const blockedActions = this.config.get("security.blockedActions", []);
        if (blockedActions.includes(action.action_type)) {
            allowed = false;
            reason = `Action type "${action.action_type}" is disabled in your security configuration.`;
            return {
                allowed,
                requiresConfirmation: false,
                reason,
                rulesChecked,
                dailySpendRemaining: this.getDailySpendRemaining(),
            };
        }
        // ── Rule 5: Custom rules (if/then) ──
        const customRules = this.config.get("security.customRules", []);
        if (customRules.length > 0) {
            rulesChecked.push("custom_rules");
            for (const rule of customRules) {
                const fieldValue = action[rule.if.field];
                let matches = false;
                switch (rule.if.operator) {
                    case "equals":
                        matches = fieldValue === rule.if.value;
                        break;
                    case "contains":
                        matches = String(fieldValue)
                            .toLowerCase()
                            .includes(String(rule.if.value).toLowerCase());
                        break;
                    case "greater_than":
                        matches = Number(fieldValue) > Number(rule.if.value);
                        break;
                    case "less_than":
                        matches = Number(fieldValue) < Number(rule.if.value);
                        break;
                }
                if (matches) {
                    if (rule.then === "block") {
                        allowed = false;
                        reason = rule.reason || `Blocked by custom rule on ${rule.if.field}.`;
                        return {
                            allowed,
                            requiresConfirmation: false,
                            reason,
                            rulesChecked,
                            dailySpendRemaining: this.getDailySpendRemaining(),
                        };
                    }
                    else if (rule.then === "warn") {
                        requiresConfirmation = true;
                        reason = rule.reason || `Custom rule warning on ${rule.if.field}.`;
                    }
                }
            }
        }
        // ── All rules passed ──
        if (!reason) {
            reason = "Action permitted by all configured rules.";
        }
        return {
            allowed,
            requiresConfirmation,
            reason,
            rulesChecked,
            dailySpendRemaining: this.getDailySpendRemaining(),
        };
    }
    /**
     * Record a spend amount for daily tracking.
     */
    recordSpend(amount) {
        this.resetDailySpendIfNeeded();
        this.dailySpendUsed += amount;
    }
    /**
     * Get current security status for the status tool.
     */
    getStatus() {
        const currentWindow = this.getCurrentWindowIndex();
        const windowStart = currentWindow * this.rotationMinutes * 60 * 1000;
        const now = Date.now();
        const ageMs = now - windowStart;
        const ageMinutes = Math.floor(ageMs / 60000);
        const rotatesIn = this.rotationMinutes - ageMinutes;
        return {
            keyValid: true,
            keyAgeMinutes: ageMinutes,
            keyRotatesInMinutes: Math.max(0, rotatesIn),
            dailySpendLimit: this.config.get("security.spendingLimits.daily", 200),
            dailySpendUsed: this.dailySpendUsed,
            dailySpendRemaining: this.getDailySpendRemaining(),
        };
    }
    // ── Private helpers ──
    getCurrentWindowIndex() {
        return Math.floor(Date.now() / (this.rotationMinutes * 60 * 1000));
    }
    computeKey(windowIndex) {
        const hmac = crypto.createHmac("sha256", this.secret);
        hmac.update(String(windowIndex));
        return hmac.digest("hex").substring(0, 16);
    }
    getDailySpendRemaining() {
        this.resetDailySpendIfNeeded();
        const limit = this.config.get("security.spendingLimits.daily", 200);
        return Math.max(0, limit - this.dailySpendUsed);
    }
    resetDailySpendIfNeeded() {
        const today = new Date().toISOString().split("T")[0];
        if (today !== this.dailySpendResetDate) {
            this.dailySpendUsed = 0;
            this.dailySpendResetDate = today;
        }
    }
}
//# sourceMappingURL=security.js.map