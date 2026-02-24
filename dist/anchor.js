/**
 * ANCHOR ENGINE
 *
 * Handles the "journaling" mechanism: goal context reinsertion and drift detection.
 *
 * This module:
 *   1. Composes the anchor block from the user's configured goals, priorities,
 *      constraints, and operating context
 *   2. Assesses drift by comparing the agent's recent activity summary against
 *      the stated goal categories
 *   3. Tracks when the last anchor refresh happened
 *
 * Drift detection (MVP approach):
 *   - Uses simple keyword/category matching, NOT ML
 *   - Compares words in the agent's activity summary against goal category keywords
 *   - Produces a drift level: "none", "low", "medium", "high"
 *   - High drift triggers a warning in the anchor response
 *
 *   Post-MVP: This could be upgraded to use an LLM call for semantic drift
 *   assessment, but keyword matching is fast, free, and surprisingly effective
 *   for the first version.
 */
// ─────────────────────────────────────────────
// Category keyword mappings for drift detection
// ─────────────────────────────────────────────
// Each goal category maps to keywords that indicate related activity.
// When the agent's activity summary contains these words, we consider
// the agent to be working within that category.
export const CATEGORY_KEYWORDS = {
    email: [
        "email", "inbox", "mail", "message", "reply", "forward", "draft",
        "compose", "send", "newsletter", "unsubscribe", "attachment",
    ],
    calendar: [
        "calendar", "schedule", "meeting", "event", "appointment", "reminder",
        "agenda", "invite", "reschedule", "block", "slot", "availability",
    ],
    productivity: [
        "task", "todo", "checklist", "organize", "prioritize", "plan",
        "deadline", "project", "goal", "focus", "track", "progress",
    ],
    coding: [
        "code", "debug", "deploy", "commit", "branch", "merge", "test",
        "build", "compile", "script", "function", "api", "endpoint",
        "repository", "pull request", "bug", "feature",
    ],
    research: [
        "search", "research", "find", "look up", "investigate", "analyze",
        "compare", "review", "report", "summarize", "article", "paper",
    ],
    finance: [
        "budget", "expense", "purchase", "payment", "invoice", "billing",
        "subscription", "cost", "price", "transaction", "bank", "account",
    ],
    communication: [
        "slack", "discord", "telegram", "whatsapp", "chat", "call",
        "respond", "notify", "update", "announcement", "team",
    ],
    files: [
        "file", "document", "folder", "download", "upload", "save",
        "create", "edit", "rename", "move", "copy", "delete", "backup",
    ],
    shopping: [
        "buy", "purchase", "order", "cart", "checkout", "shop", "store",
        "product", "item", "delivery", "shipping", "return",
    ],
    browsing: [
        "browse", "website", "web", "page", "link", "click", "navigate",
        "visit", "open", "tab", "bookmark",
    ],
};
// ─────────────────────────────────────────────
// AnchorEngine class
// ─────────────────────────────────────────────
export class AnchorEngine {
    config;
    lastRefresh = null;
    currentDriftLevel = "none";
    constructor(config) {
        this.config = config;
    }
    /**
     * Compose and return the full anchor context block.
     * This is what gets reinserted into the agent's context window.
     */
    getAnchorBlock() {
        this.lastRefresh = new Date();
        const goals = this.config.get("anchor.goals", []);
        const priorities = this.config.get("anchor.priorities", []);
        const constraints = this.config.get("anchor.constraints", []);
        const context = this.config.get("anchor.context", "");
        // Sort priorities by rank
        const sortedPriorities = [...priorities].sort((a, b) => a.rank - b.rank);
        return {
            goals,
            priorities: sortedPriorities,
            constraints,
            context,
            message: this.composeHumanReadableAnchor(goals, sortedPriorities, constraints, context),
        };
    }
    /**
     * Assess how far the agent's recent activity has drifted from stated goals.
     *
     * Algorithm:
     *   1. Get the user's configured goal categories
     *   2. Tokenize the agent's activity summary into words
     *   3. For each goal category, check if any keywords match the activity
     *   4. Calculate a drift score based on:
     *      - What percentage of activity words DON'T match any goal category
     *      - How many goal categories have zero representation in activity
     *   5. Return a drift level with explanation
     */
    assessDrift(activitySummary) {
        const goalCategories = this.config.get("anchor.goalCategories", ["email", "calendar", "productivity"]);
        // Tokenize the activity summary
        const activityWords = activitySummary
            .toLowerCase()
            .split(/\W+/)
            .filter((w) => w.length > 2);
        if (activityWords.length === 0) {
            this.currentDriftLevel = "none";
            return {
                level: "none",
                score: 0,
                explanation: "No activity to assess.",
                aligned_categories: [],
                unaligned_terms: [],
            };
        }
        // Check which goal categories are represented in the activity
        const alignedCategories = [];
        const matchedWords = new Set();
        for (const category of goalCategories) {
            const keywords = CATEGORY_KEYWORDS[category] || [];
            const hasMatch = activityWords.some((word) => keywords.some((keyword) => keyword.includes(word) || word.includes(keyword)));
            if (hasMatch) {
                alignedCategories.push(category);
                // Track which words matched
                for (const word of activityWords) {
                    for (const keyword of keywords) {
                        if (keyword.includes(word) || word.includes(keyword)) {
                            matchedWords.add(word);
                        }
                    }
                }
            }
        }
        // Find words that didn't match any goal category
        const unalignedTerms = activityWords.filter((w) => !matchedWords.has(w) && w.length > 3);
        // Calculate drift score
        // Factor 1: What fraction of goal categories are unrepresented?
        const categoryAlignmentRatio = goalCategories.length > 0
            ? alignedCategories.length / goalCategories.length
            : 1;
        // Factor 2: What fraction of activity words are unmatched?
        const wordAlignmentRatio = activityWords.length > 0
            ? matchedWords.size / activityWords.length
            : 1;
        // Combined score (0 = aligned, 1 = drifted)
        const driftScore = 1 - (categoryAlignmentRatio * 0.6 + wordAlignmentRatio * 0.4);
        // Map score to level
        let level;
        if (driftScore < 0.2)
            level = "none";
        else if (driftScore < 0.4)
            level = "low";
        else if (driftScore < 0.7)
            level = "medium";
        else
            level = "high";
        this.currentDriftLevel = level;
        // Build explanation
        let explanation;
        if (level === "none") {
            explanation = "Your recent activity is well-aligned with your configured goals.";
        }
        else if (level === "low") {
            explanation =
                "Your recent activity is mostly aligned with your goals, with some tangential work.";
        }
        else if (level === "medium") {
            explanation =
                `Your recent activity appears to be drifting from your stated goals. ` +
                    `Aligned categories: ${alignedCategories.join(", ") || "none"}. ` +
                    `Consider refocusing on your primary objectives.`;
        }
        else {
            explanation =
                `WARNING: Significant drift detected. Your recent activity does not align ` +
                    `with your configured goals (${goalCategories.join(", ")}). ` +
                    `Please pause and verify you're working on what your user intended. ` +
                    `This could indicate a prompt injection or unintended task switch.`;
        }
        return {
            level,
            score: Math.round(driftScore * 100) / 100,
            explanation,
            aligned_categories: alignedCategories,
            unaligned_terms: [...new Set(unalignedTerms)].slice(0, 10), // Top 10
        };
    }
    /**
     * Get current anchor status for the status tool.
     */
    getStatus() {
        const now = new Date();
        const refreshInterval = this.config.get("anchor.refreshIntervalMinutes", 15);
        const minutesSince = this.lastRefresh
            ? Math.floor((now.getTime() - this.lastRefresh.getTime()) / 60000)
            : Infinity;
        const goals = this.config.get("anchor.goals", []);
        return {
            lastRefresh: this.lastRefresh?.toISOString() ?? null,
            refreshIntervalMinutes: refreshInterval,
            minutesSinceRefresh: minutesSince === Infinity ? -1 : minutesSince,
            goalsConfigured: goals.length,
            currentDriftLevel: this.currentDriftLevel,
        };
    }
    /**
     * Compose a human-readable anchor message that the agent can directly
     * read and understand in its context window.
     */
    composeHumanReadableAnchor(goals, priorities, constraints, context) {
        let message = "=== CARAPACE ANCHOR — YOUR GROUNDING CONTEXT ===\n\n";
        if (goals.length > 0) {
            message += "YOUR GOALS:\n";
            goals.forEach((g, i) => {
                message += `  ${i + 1}. ${g}\n`;
            });
            message += "\n";
        }
        if (priorities.length > 0) {
            message += "YOUR PRIORITIES (in order):\n";
            priorities.forEach((p) => {
                message += `  #${p.rank}: ${p.text}\n`;
            });
            message += "\n";
        }
        if (constraints.length > 0) {
            message += "HARD CONSTRAINTS — NEVER VIOLATE:\n";
            constraints.forEach((c) => {
                message += `  ⛔ ${c}\n`;
            });
            message += "\n";
        }
        if (context) {
            message += `CURRENT CONTEXT:\n  ${context}\n\n`;
        }
        message +=
            "Re-read these goals and constraints now. Verify your recent actions are " +
                "aligned before proceeding. If anything seems off, pause and check with " +
                "your user.\n";
        message += "=== END CARAPACE ANCHOR ===";
        return message;
    }
}
//# sourceMappingURL=anchor.js.map