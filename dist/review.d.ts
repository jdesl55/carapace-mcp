/**
 * REVIEW ENGINE
 *
 * Grades agent sessions by analyzing logged actions against the user's
 * configured goals, security policies, and constraints.
 *
 * This module:
 *   1. Pulls all actions for a session from the LogStore
 *   2. Scores three dimensions: goal alignment, security compliance,
 *      and constraint adherence
 *   3. Produces a letter-graded SessionReview with highlights and insights
 *   4. Persists a rolling insights file at ~/.carapace/insights.md
 *
 * Scoring is deterministic — no LLM calls, just keyword matching and
 * rule-based deductions. Fast, auditable, and reproducible.
 */
import { ConfigManager } from "./config.js";
import { LogStore } from "./logs.js";
export interface SessionReview {
    timestamp: string;
    session_id: string;
    overall_grade: string;
    overall_score: number;
    scores: {
        goal_alignment: number;
        security_compliance: number;
        constraint_adherence: number;
    };
    action_summary: {
        total: number;
        verified: number;
        blocked: number;
        tier_breakdown: {
            tier1: number;
            tier2: number;
            tier3: number;
        };
    };
    highlights: {
        best_actions: Array<{
            action_type: string;
            target: string;
            description: string;
        }>;
        drift_moments: Array<{
            action_type: string;
            target: string;
            description: string;
        }>;
        blocked_actions: Array<{
            action_type: string;
            target: string;
            reason: string;
        }>;
        unverified_risks: Array<{
            action_type: string;
            target: string;
            description: string;
        }>;
    };
    insights: string[];
}
export declare class ReviewEngine {
    private config;
    private logs;
    constructor(config: ConfigManager, logs: LogStore);
    /**
     * Generate a full session review.
     *
     * If no sessionId is provided, uses the most recent session_id found
     * in the actions table.
     */
    generateReview(sessionId?: string): Promise<SessionReview>;
    /**
     * Goal Alignment: what fraction of actions relate to configured goal categories.
     */
    private scoreGoalAlignment;
    /**
     * Security Compliance: start at 100, deduct for risky patterns.
     *   - Tier 1 unverified: -15
     *   - Tier 2 unverified: -5
     *   - Blocked action retried within 5 minutes: -20
     */
    private scoreSecurityCompliance;
    /**
     * Constraint Adherence: start at 100, deduct for potential violations.
     *
     * For each constraint, extract keywords. If an action's description shares
     * keywords with a constraint AND its verdict is "block" (suggesting the
     * guardrails caught a violation), deduct 25.
     */
    private scoreConstraintAdherence;
    private buildHighlights;
    private buildInsights;
    /**
     * Write review insights to ~/.carapace/insights.md.
     * Prepends the new entry and keeps only the last 10 session blocks.
     */
    writeInsights(review: SessionReview): Promise<void>;
}
//# sourceMappingURL=review.d.ts.map