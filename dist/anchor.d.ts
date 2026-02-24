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
import { ConfigManager } from "./config.js";
interface AnchorBlock {
    goals: string[];
    priorities: Array<{
        rank: number;
        text: string;
    }>;
    constraints: string[];
    context: string;
    message: string;
}
interface DriftAssessment {
    level: "none" | "low" | "medium" | "high";
    score: number;
    explanation: string;
    aligned_categories: string[];
    unaligned_terms: string[];
}
interface AnchorStatus {
    lastRefresh: string | null;
    refreshIntervalMinutes: number;
    minutesSinceRefresh: number;
    goalsConfigured: number;
    currentDriftLevel: string;
}
export declare const CATEGORY_KEYWORDS: Record<string, string[]>;
export declare class AnchorEngine {
    private config;
    private lastRefresh;
    private currentDriftLevel;
    constructor(config: ConfigManager);
    /**
     * Compose and return the full anchor context block.
     * This is what gets reinserted into the agent's context window.
     */
    getAnchorBlock(): AnchorBlock;
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
    assessDrift(activitySummary: string): DriftAssessment;
    /**
     * Get current anchor status for the status tool.
     */
    getStatus(): AnchorStatus;
    /**
     * Compose a human-readable anchor message that the agent can directly
     * read and understand in its context window.
     */
    private composeHumanReadableAnchor;
}
export {};
//# sourceMappingURL=anchor.d.ts.map