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
import { CATEGORY_KEYWORDS } from "./anchor.js";
import fs from "fs";
import path from "path";
import os from "os";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

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
    tier_breakdown: { tier1: number; tier2: number; tier3: number };
  };
  highlights: {
    best_actions: Array<{ action_type: string; target: string; description: string }>;
    drift_moments: Array<{ action_type: string; target: string; description: string }>;
    blocked_actions: Array<{ action_type: string; target: string; reason: string }>;
    unverified_risks: Array<{ action_type: string; target: string; description: string }>;
  };
  insights: string[];
}

interface ActionRow {
  id: number;
  timestamp: string;
  session_id: string;
  action_type: string;
  target: string;
  amount: number;
  description: string;
  verdict: string;
  reason: string;
  key_was_valid: number; // SQLite integer: 0 or 1
  tier: number;
  created_at: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Tokenize a string into lowercase words (3+ characters).
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);
}

/**
 * Check if any tokens match any keyword in the given categories.
 */
function matchesGoalCategories(
  tokens: string[],
  goalCategories: string[]
): boolean {
  for (const category of goalCategories) {
    const keywords = CATEGORY_KEYWORDS[category] || [];
    for (const token of tokens) {
      for (const keyword of keywords) {
        if (keyword.includes(token) || token.includes(keyword)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Find the most-represented category in a set of actions.
 */
function topActualCategory(actions: ActionRow[]): string {
  const counts: Record<string, number> = {};

  for (const action of actions) {
    const tokens = tokenize(`${action.action_type} ${action.description}`);
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const token of tokens) {
        if (keywords.some((kw) => kw.includes(token) || token.includes(kw))) {
          counts[category] = (counts[category] || 0) + 1;
          break; // count each action at most once per category
        }
      }
    }
  }

  let best = "unknown";
  let bestCount = 0;
  for (const [cat, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = cat;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Map a numeric score (0-100) to a letter grade.
 */
function letterGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// ─────────────────────────────────────────────
// ReviewEngine class
// ─────────────────────────────────────────────

export class ReviewEngine {
  private config: ConfigManager;
  private logs: LogStore;

  constructor(config: ConfigManager, logs: LogStore) {
    this.config = config;
    this.logs = logs;
  }

  /**
   * Generate a full session review.
   *
   * If no sessionId is provided, uses the most recent session_id found
   * in the actions table.
   */
  async generateReview(sessionId?: string): Promise<SessionReview> {
    // ── 1. Load actions ──
    let resolvedSessionId = sessionId;

    if (!resolvedSessionId) {
      const recent = this.logs.getRecentActions(1) as ActionRow[];
      resolvedSessionId = recent.length > 0 ? recent[0].session_id : "";
    }

    const actions = this.logs.getActionsBySession(resolvedSessionId) as ActionRow[];
    const goalCategories: string[] = this.config.get(
      "anchor.goalCategories",
      ["email", "calendar", "productivity"]
    );

    // ── 2. Action summary stats ──
    const total = actions.length;
    const verified = actions.filter((a) => a.key_was_valid === 1).length;
    const blocked = actions.filter((a) => a.verdict === "block").length;
    const tier1 = actions.filter((a) => a.tier === 1).length;
    const tier2 = actions.filter((a) => a.tier === 2).length;
    const tier3 = actions.filter((a) => a.tier === 3).length;

    // ── 3. Goal Alignment Score (0-100) ──
    const goalAlignment = this.scoreGoalAlignment(actions, goalCategories);

    // ── 4. Security Compliance Score (0-100) ──
    const securityCompliance = this.scoreSecurityCompliance(actions);

    // ── 5. Constraint Adherence Score (0-100) ──
    const constraintAdherence = this.scoreConstraintAdherence(actions);

    // ── 6. Overall Score ──
    const overallScore = Math.round(
      goalAlignment * 0.4 + securityCompliance * 0.4 + constraintAdherence * 0.2
    );

    // ── 7. Letter Grade ──
    const grade = letterGrade(overallScore);

    // ── 8. Highlights ──
    const highlights = this.buildHighlights(actions, goalCategories);

    // ── 9. Insights ──
    const insights = this.buildInsights(
      goalAlignment,
      securityCompliance,
      constraintAdherence,
      actions,
      goalCategories
    );

    return {
      timestamp: new Date().toISOString(),
      session_id: resolvedSessionId,
      overall_grade: grade,
      overall_score: overallScore,
      scores: {
        goal_alignment: goalAlignment,
        security_compliance: securityCompliance,
        constraint_adherence: constraintAdherence,
      },
      action_summary: {
        total,
        verified,
        blocked,
        tier_breakdown: { tier1, tier2, tier3 },
      },
      highlights,
      insights,
    };
  }

  // ─────────────────────────────────────────────
  // Scoring methods
  // ─────────────────────────────────────────────

  /**
   * Goal Alignment: what fraction of actions relate to configured goal categories.
   */
  private scoreGoalAlignment(actions: ActionRow[], goalCategories: string[]): number {
    if (actions.length === 0) return 100;

    let aligned = 0;
    for (const action of actions) {
      const tokens = tokenize(`${action.action_type} ${action.description}`);
      if (matchesGoalCategories(tokens, goalCategories)) {
        aligned++;
      }
    }

    return Math.round((aligned / actions.length) * 100);
  }

  /**
   * Security Compliance: start at 100, deduct for risky patterns.
   *   - Tier 1 unverified: -15
   *   - Tier 2 unverified: -5
   *   - Blocked action retried within 5 minutes: -20
   */
  private scoreSecurityCompliance(actions: ActionRow[]): number {
    let score = 100;

    for (const action of actions) {
      if (action.tier === 1 && action.key_was_valid === 0) {
        score -= 15;
      }
      if (action.tier === 2 && action.key_was_valid === 0) {
        score -= 5;
      }
    }

    // Check for blocked-then-retried patterns
    const blockedActions = actions.filter((a) => a.verdict === "block");
    for (const blocked of blockedActions) {
      const blockedTime = new Date(blocked.timestamp).getTime();
      const retried = actions.some(
        (a) =>
          a.id !== blocked.id &&
          a.action_type === blocked.action_type &&
          a.verdict !== "block" &&
          new Date(a.timestamp).getTime() > blockedTime &&
          new Date(a.timestamp).getTime() - blockedTime <= 5 * 60 * 1000
      );
      if (retried) {
        score -= 20;
      }
    }

    return Math.max(0, score);
  }

  /**
   * Constraint Adherence: start at 100, deduct for potential violations.
   *
   * For each constraint, extract keywords. If an action's description shares
   * keywords with a constraint AND its verdict is "block" (suggesting the
   * guardrails caught a violation), deduct 25.
   */
  private scoreConstraintAdherence(actions: ActionRow[]): number {
    const constraints: string[] = this.config.get("anchor.constraints", []);
    if (constraints.length === 0) return 100;

    // Extract keyword sets for each constraint
    const constraintKeywordSets = constraints.map((c) =>
      tokenize(c).filter((w) => w.length > 3)
    );

    let score = 100;

    for (const action of actions) {
      const actionTokens = tokenize(`${action.action_type} ${action.description}`);

      for (const kwSet of constraintKeywordSets) {
        const overlap = actionTokens.some((t) => kwSet.includes(t));
        if (overlap && action.verdict === "block") {
          score -= 25;
          break; // one deduction per action
        }
      }
    }

    return Math.max(0, score);
  }

  // ─────────────────────────────────────────────
  // Highlights
  // ─────────────────────────────────────────────

  private buildHighlights(
    actions: ActionRow[],
    goalCategories: string[]
  ): SessionReview["highlights"] {
    // Best actions: verified, passed, and goal-aligned (up to 3)
    const bestActions = actions
      .filter((a) => {
        if (a.key_was_valid !== 1 || a.verdict !== "pass") return false;
        const tokens = tokenize(`${a.action_type} ${a.description}`);
        return matchesGoalCategories(tokens, goalCategories);
      })
      .slice(0, 3)
      .map((a) => ({
        action_type: a.action_type,
        target: a.target,
        description: a.description,
      }));

    // Drift moments: actions whose keywords don't match any goal category
    const driftMoments = actions
      .filter((a) => {
        const tokens = tokenize(`${a.action_type} ${a.description}`);
        return !matchesGoalCategories(tokens, goalCategories);
      })
      .map((a) => ({
        action_type: a.action_type,
        target: a.target,
        description: a.description,
      }));

    // Blocked actions: all actions with verdict="block"
    const blockedActions = actions
      .filter((a) => a.verdict === "block")
      .map((a) => ({
        action_type: a.action_type,
        target: a.target,
        reason: a.reason,
      }));

    // Unverified risks: Tier 1 actions with key_was_valid=0
    const unverifiedRisks = actions
      .filter((a) => a.tier === 1 && a.key_was_valid === 0)
      .map((a) => ({
        action_type: a.action_type,
        target: a.target,
        description: a.description,
      }));

    return {
      best_actions: bestActions,
      drift_moments: driftMoments,
      blocked_actions: blockedActions,
      unverified_risks: unverifiedRisks,
    };
  }

  // ─────────────────────────────────────────────
  // Insights
  // ─────────────────────────────────────────────

  private buildInsights(
    alignment: number,
    security: number,
    adherence: number,
    actions: ActionRow[],
    goalCategories: string[]
  ): string[] {
    const insights: string[] = [];

    if (alignment < 70) {
      const top = topActualCategory(actions);
      insights.push(
        `Activity drifted from configured goals. Most actions were in ${top} ` +
          `but goals prioritize ${goalCategories.join(", ")}.`
      );
    }

    if (security < 90) {
      const unverifiedCount = actions.filter(
        (a) => a.tier <= 2 && a.key_was_valid === 0
      ).length;
      insights.push(
        `${unverifiedCount} sensitive actions were executed without verification. ` +
          `Always use carapace_verify before Tier 1 actions.`
      );
    }

    // Check for blocked workaround attempts
    const blockedTypes = actions
      .filter((a) => a.verdict === "block")
      .map((a) => a.action_type);
    const retriedAfterBlock = actions.some(
      (a) =>
        a.verdict !== "block" &&
        blockedTypes.includes(a.action_type) &&
        actions.some(
          (b) =>
            b.verdict === "block" &&
            b.action_type === a.action_type &&
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() > 0 &&
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() <=
              5 * 60 * 1000
        )
    );
    if (retriedAfterBlock) {
      insights.push(
        "Blocked actions were retried without user approval. " +
          "When blocked, ask the user before attempting alternatives."
      );
    }

    if (alignment > 85 && security > 85 && adherence > 85) {
      insights.push(
        "Strong session. Goal alignment and security compliance were both high."
      );
    }

    return insights;
  }

  // ─────────────────────────────────────────────
  // Insights file persistence
  // ─────────────────────────────────────────────

  /**
   * Write review insights to ~/.carapace/insights.md.
   * Prepends the new entry and keeps only the last 10 session blocks.
   */
  async writeInsights(review: SessionReview): Promise<void> {
    const insightsPath = path.join(os.homedir(), ".carapace", "insights.md");

    // Read existing content
    let existing = "";
    if (fs.existsSync(insightsPath)) {
      existing = fs.readFileSync(insightsPath, "utf-8");
    }

    // Build the new entry
    const date = review.timestamp.split("T")[0];
    let entry = `## Session Review — ${date} | Grade: ${review.overall_grade} (${review.overall_score}/100)\n`;
    for (const insight of review.insights) {
      entry += `- ${insight}\n`;
    }
    entry += "\n";

    // Prepend to existing content
    const combined = entry + existing;

    // Keep only the last 10 "## Session Review" blocks
    const blocks = combined.split(/(?=## Session Review)/);
    const trimmed = blocks
      .filter((b) => b.trim().length > 0)
      .slice(0, 10)
      .join("");

    // Ensure directory exists
    const dir = path.dirname(insightsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(insightsPath, trimmed, "utf-8");
  }
}
