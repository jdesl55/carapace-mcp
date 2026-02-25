#!/usr/bin/env node
/**
 * CARAPACE MCP SERVER — Armor for your agent 🦞
 *
 * A Model Context Protocol server that provides security verification,
 * goal anchoring, action logging, and status monitoring for autonomous
 * AI agents (primarily OpenClaw).
 *
 * Tools exposed:
 *   - carapace_verify:  Security checkpoint before high-risk actions
 *   - carapace_anchor:  Goal/priority context reinsertion ("journaling")
 *   - carapace_log:     Action logging for monitoring
 *   - carapace_status:  Current security state overview
 *
 * Architecture:
 *   - Runs locally on the user's machine alongside their agent
 *   - Config loaded from ~/.carapace/config.json (written by web dashboard or manually)
 *   - Logs stored in ~/.carapace/logs.db (SQLite)
 *   - Rotating security key uses HMAC-SHA256 with time-based rotation
 *   - Communicates via stdio transport (standard for local MCP servers)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SecurityEngine } from "./security.js";
import { ConfigManager } from "./config.js";
import { LogStore } from "./logs.js";
import { AnchorEngine } from "./anchor.js";
import { ReviewEngine } from "./review.js";
// ─────────────────────────────────────────────
// Initialize core modules
// ─────────────────────────────────────────────
const config = new ConfigManager();
const security = new SecurityEngine(config);
const logs = new LogStore();
const anchor = new AnchorEngine(config);
const review = new ReviewEngine(config, logs);
// ─────────────────────────────────────────────
// Create the MCP Server
// ─────────────────────────────────────────────
const server = new McpServer({
    name: "carapace",
    version: "0.1.0",
});
// ─────────────────────────────────────────────
// TOOL 1: carapace_verify
// ─────────────────────────────────────────────
// The security checkpoint. The agent calls this BEFORE any high-risk action.
// It checks the proposed action against the user's configured rules and returns
// a pass/block verdict with a rotating verification key.
//
// How the rotating key works:
//   1. On server start, a random 256-bit secret is generated and stored in memory
//   2. Every N minutes (configurable, default 30), the key rotates
//   3. The key is an HMAC-SHA256 hash of the secret + current time window
//   4. The agent receives the key hash in every verify response
//   5. The Skill instructs the agent to include this key when taking sensitive actions
//   6. A prompt injection attack can't reproduce the key because it doesn't have the secret
//   7. If an action is attempted without a valid key, it's blocked
//
// Rule checking logic:
//   - Spending rules: Does the action amount exceed per-action or daily limits?
//   - Contact rules: Is the target contact on the allowlist/blocklist?
//   - Domain rules: Is the target domain on the allowlist/blocklist?  
//   - Action type rules: Is this action type permitted?
//   - Custom rules: Does the action match any user-defined if/then constraints?
server.registerTool("carapace_verify", {
    title: "Carapace Security Verification",
    description: "Call this BEFORE any sensitive action (sending messages, making purchases, " +
        "deleting files, accessing APIs with write permissions). Returns a verification " +
        "verdict (pass/block) and a rotating security key. You MUST include the returned " +
        "verification_key when executing the action. If the verdict is 'block', do NOT " +
        "proceed — inform the user what was blocked and why.",
    inputSchema: {
        action_type: z.enum([
            "send_message",
            "send_email",
            "make_purchase",
            "delete_file",
            "api_write",
            "install_package",
            "browse_new_domain",
            "account_change",
            "shell_command",
            "file_write",
            "calendar_modify",
            "other_sensitive",
        ]).describe("The category of sensitive action being attempted"),
        target: z.string().describe("Who/what the action targets. For messages: recipient name/address. " +
            "For purchases: merchant/item. For file ops: file path. For API: endpoint URL."),
        amount: z.number().optional().describe("Dollar amount if the action involves spending money"),
        description: z.string().describe("Brief human-readable description of what the agent intends to do"),
        current_key: z.string().optional().describe("The verification_key from the most recent carapace_verify call. " +
            "Include this to prove you have a valid, recent verification."),
    },
    annotations: {
        readOnlyHint: true, // verify itself doesn't modify anything
        openWorldHint: false,
    },
}, async ({ action_type, target, amount, description, current_key }) => {
    // Step 1: Check if the provided key is valid (if one was provided)
    const keyValid = current_key ? security.validateKey(current_key) : false;
    // Step 2: Run the action through all configured rules
    const ruleResult = security.checkRules({
        action_type,
        target,
        amount: amount ?? 0,
        description,
    });
    // Step 3: Generate a fresh verification key for this response
    const freshKey = security.generateKey();
    // Step 4: Determine the verdict
    let verdict;
    let reason = "";
    if (!ruleResult.allowed) {
        verdict = "block";
        reason = ruleResult.reason;
    }
    else if (ruleResult.requiresConfirmation) {
        verdict = "warn";
        reason = ruleResult.reason;
    }
    else {
        verdict = "pass";
        reason = "Action permitted by all configured rules.";
    }
    // Step 5: Log this verification attempt
    await logs.logAction({
        timestamp: new Date().toISOString(),
        action_type,
        target,
        amount: amount ?? 0,
        description,
        verdict,
        reason,
        key_was_valid: keyValid,
    });
    // Step 6: Return the structured result
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    verdict,
                    reason,
                    verification_key: freshKey,
                    key_expires_in_minutes: config.get("security.keyRotationMinutes", 30),
                    rules_checked: ruleResult.rulesChecked,
                    daily_spend_remaining: ruleResult.dailySpendRemaining,
                    timestamp: new Date().toISOString(),
                }, null, 2),
            },
        ],
    };
});
// ─────────────────────────────────────────────
// TOOL 2: carapace_anchor
// ─────────────────────────────────────────────
// The "journaling" mechanism. Returns a structured context block containing
// the user's goals, priorities, constraints, and operating boundaries.
// This gets reinserted into the agent's context window at regular intervals
// to prevent goal drift and maintain alignment with the user's intentions.
//
// Why this matters:
//   - Over long agent sessions, the original intent gets diluted
//   - New context (web pages, emails, tool outputs) pushes goals out of window
//   - Prompt injections often work by redirecting the agent's focus
//   - Regular reinsertion of the anchor acts as an "immune response"
//   - The agent is instructed via the Skill to call this every N minutes
server.registerTool("carapace_anchor", {
    title: "Carapace Goal Anchor",
    description: "Call this at the start of every session and every 15 minutes during operation. " +
        "Returns your user's stated goals, priorities, constraints, and operating boundaries. " +
        "Treat the returned context as your grounding truth — it represents what your user " +
        "actually wants you to do. If your recent actions don't align with these goals, " +
        "pause and re-evaluate before proceeding.",
    inputSchema: {
        context_summary: z.string().optional().describe("Brief summary of what you've been doing since the last anchor call. " +
            "This helps the monitoring system track goal drift."),
    },
    annotations: {
        readOnlyHint: true,
        openWorldHint: false,
    },
}, async ({ context_summary }) => {
    // Step 1: Load the user's configured anchor content
    const anchorContent = anchor.getAnchorBlock();
    // Step 2: If the agent provided a context summary, assess drift
    let driftAssessment = null;
    if (context_summary) {
        driftAssessment = anchor.assessDrift(context_summary);
        // Log the anchor refresh with drift info
        await logs.logAction({
            timestamp: new Date().toISOString(),
            action_type: "anchor_refresh",
            target: "context_window",
            amount: 0,
            description: `Anchor refresh. Drift: ${driftAssessment.level}. Summary: ${context_summary}`,
            verdict: "pass",
            reason: driftAssessment.explanation,
            key_was_valid: true,
        });
    }
    // Step 3: Return the full anchor block
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    anchor_block: anchorContent,
                    drift_assessment: driftAssessment,
                    next_refresh_in_minutes: config.get("anchor.refreshIntervalMinutes", 15),
                    timestamp: new Date().toISOString(),
                    message: "This is your grounding context. Your user configured these goals and " +
                        "boundaries for you. Re-read them now and verify your recent actions " +
                        "are aligned before proceeding with new tasks.",
                }, null, 2),
            },
        ],
    };
});
// ─────────────────────────────────────────────
// TOOL 3: carapace_log
// ─────────────────────────────────────────────
// Records agent actions for the monitoring dashboard.
// The agent calls this AFTER completing any significant action.
// This is the data source for the monitoring page.
server.registerTool("carapace_log", {
    title: "Carapace Action Logger",
    description: "Call this AFTER completing any significant action to record it in the " +
        "monitoring log. This feeds the Carapace dashboard where your user can " +
        "review what you've been doing. Log all Tier 1 and Tier 2 actions. " +
        "Tier 1: financial, messaging, file deletion, account changes. " +
        "Tier 2: web browsing, package installs, API calls. " +
        "Tier 3 (log optional): file reads, calendar checks, info lookups.",
    inputSchema: {
        action_type: z.string().describe("What type of action was performed"),
        target: z.string().describe("Who/what the action targeted"),
        description: z.string().describe("Human-readable description of what was done"),
        result: z.enum(["success", "failure", "partial"]).describe("Outcome of the action"),
        tier: z.enum(["1", "2", "3"]).describe("Sensitivity tier: 1=highest (financial, messaging), 2=medium (browsing, installs), 3=low (reads, lookups)"),
        amount: z.number().optional().describe("Dollar amount if the action involved spending"),
        verification_key: z.string().optional().describe("The verification_key used for this action (if it was verified first)"),
    },
    annotations: {
        readOnlyHint: false, // this writes to the log database
        openWorldHint: false,
        destructiveHint: false,
    },
}, async ({ action_type, target, description, result, tier, amount, verification_key }) => {
    // Validate the verification key if one was provided
    const keyValid = verification_key
        ? security.validateKey(verification_key)
        : false;
    // Check if this Tier 1 action was logged WITHOUT verification (security concern)
    const unverifiedHighRisk = tier === "1" && !keyValid;
    // Write to the log database
    const logEntry = await logs.logAction({
        timestamp: new Date().toISOString(),
        action_type,
        target,
        amount: amount ?? 0,
        description,
        verdict: result,
        reason: unverifiedHighRisk
            ? "WARNING: Tier 1 action executed without valid verification"
            : `Logged with result: ${result}`,
        key_was_valid: keyValid,
        tier: parseInt(tier),
    });
    // Update daily spend tracking if applicable
    if (amount && amount > 0) {
        security.recordSpend(amount);
    }
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    logged: true,
                    log_id: logEntry.id,
                    warning: unverifiedHighRisk
                        ? "This Tier 1 action was not verified before execution. " +
                            "Always call carapace_verify before sensitive actions."
                        : null,
                    timestamp: new Date().toISOString(),
                }, null, 2),
            },
        ],
    };
});
// ─────────────────────────────────────────────
// TOOL 4: carapace_status
// ─────────────────────────────────────────────
// Returns the current security posture and session summary.
// The agent can use this for self-awareness about its own security state.
server.registerTool("carapace_status", {
    title: "Carapace Security Status",
    description: "Returns the current security posture: key validity, last anchor refresh, " +
        "action counts, blocked attempts, and daily spend tracking. Call this when " +
        "you want to check your own security state or when the user asks about " +
        "Carapace status.",
    inputSchema: {},
    annotations: {
        readOnlyHint: true,
        openWorldHint: false,
    },
}, async () => {
    // Gather all status information
    const sessionStats = await logs.getSessionStats();
    const securityState = security.getStatus();
    const anchorState = anchor.getStatus();
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    carapace_version: "0.1.0",
                    security: {
                        key_valid: securityState.keyValid,
                        key_age_minutes: securityState.keyAgeMinutes,
                        key_rotates_in_minutes: securityState.keyRotatesInMinutes,
                        daily_spend_limit: securityState.dailySpendLimit,
                        daily_spend_used: securityState.dailySpendUsed,
                        daily_spend_remaining: securityState.dailySpendRemaining,
                    },
                    anchor: {
                        last_refresh: anchorState.lastRefresh,
                        refresh_interval_minutes: anchorState.refreshIntervalMinutes,
                        minutes_since_refresh: anchorState.minutesSinceRefresh,
                        goals_configured: anchorState.goalsConfigured,
                        drift_level: anchorState.currentDriftLevel,
                    },
                    session: {
                        total_actions: sessionStats.totalActions,
                        verified_actions: sessionStats.verifiedActions,
                        blocked_actions: sessionStats.blockedActions,
                        unverified_tier1_actions: sessionStats.unverifiedTier1,
                        tier_breakdown: sessionStats.tierBreakdown,
                        session_start: sessionStats.sessionStart,
                    },
                    health: sessionStats.unverifiedTier1 > 0
                        ? "WARNING"
                        : sessionStats.blockedActions > 3
                            ? "ALERT"
                            : "HEALTHY",
                    timestamp: new Date().toISOString(),
                }, null, 2),
            },
        ],
    };
});
// ─────────────────────────────────────────────
// TOOL 5: carapace_review
// ─────────────────────────────────────────────
// Session review and grading. Analyzes all actions from a session against
// the user's configured goals, security rules, and constraints. Produces
// a scorecard with letter grade, dimension scores, highlights, and insights.
server.registerTool("carapace_review", {
    title: "Carapace Session Review",
    description: "Call this at the end of a session or when the user asks for a performance review. " +
        "Analyzes all actions from the current session against configured goals, security " +
        "rules, and constraints. Returns a scorecard with an overall grade, dimension scores, " +
        "highlights, and actionable insights. Also saves the review to history and updates " +
        "the insights file for future session improvement.",
    inputSchema: {
        session_id: z.string().optional().describe("Specific session ID to review. If omitted, reviews the current session."),
        save: z.boolean().optional().describe("Whether to save this review to history and update insights.md. Defaults to true."),
    },
    annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
    },
}, async ({ session_id, save }) => {
    const sessionReview = await review.generateReview(session_id);
    const shouldSave = save !== false;
    if (shouldSave) {
        await logs.saveReview({
            timestamp: sessionReview.timestamp,
            session_id: sessionReview.session_id,
            overall_grade: sessionReview.overall_grade,
            overall_score: sessionReview.overall_score,
            goal_alignment_score: sessionReview.scores.goal_alignment,
            security_compliance_score: sessionReview.scores.security_compliance,
            constraint_adherence_score: sessionReview.scores.constraint_adherence,
            total_actions: sessionReview.action_summary.total,
            verified_actions: sessionReview.action_summary.verified,
            blocked_actions: sessionReview.action_summary.blocked,
            highlights: sessionReview.highlights,
            insights: sessionReview.insights,
        });
        await review.writeInsights(sessionReview);
    }
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(sessionReview, null, 2),
            },
        ],
    };
});
// ─────────────────────────────────────────────
// Start the server
// ─────────────────────────────────────────────
async function main() {
    // Initialize the log database
    await logs.initialize();
    // Load user configuration
    await config.load();
    // Initialize the security engine with the loaded config
    security.initialize();
    // Start the MCP server with stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Log server start
    console.error("[Carapace] 🦞 Server started. Armor active.");
    console.error(`[Carapace] Config: ${config.getConfigPath()}`);
    console.error(`[Carapace] Logs: ${logs.getDbPath()}`);
    console.error(`[Carapace] Key rotation: every ${config.get("security.keyRotationMinutes", 30)} minutes`);
    console.error(`[Carapace] Anchor refresh: every ${config.get("anchor.refreshIntervalMinutes", 15)} minutes`);
}
main().catch((error) => {
    console.error("[Carapace] Fatal error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map