/**
 * LOG STORE
 *
 * SQLite-based action logging for the monitoring dashboard.
 *
 * Database location: ~/.carapace/logs.db
 *
 * This module handles:
 *   - Creating and managing the SQLite database
 *   - Writing action log entries
 *   - Querying session statistics for the status tool
 *   - Log retention/cleanup
 *
 * The monitoring dashboard reads directly from this database file
 * to render the action feed, security summary, and drift indicators.
 *
 * We use better-sqlite3 for synchronous, fast, local-only access.
 * No network calls, no external dependencies beyond the npm package.
 */
interface LogEntry {
    timestamp: string;
    action_type: string;
    target: string;
    amount: number;
    description: string;
    verdict: string;
    reason: string;
    key_was_valid: boolean;
    tier?: number;
}
interface LogResult {
    id: number;
}
interface SessionStats {
    totalActions: number;
    verifiedActions: number;
    blockedActions: number;
    unverifiedTier1: number;
    tierBreakdown: {
        tier1: number;
        tier2: number;
        tier3: number;
    };
    sessionStart: string;
}
interface ReviewEntry {
    timestamp: string;
    session_id: string;
    overall_grade: string;
    overall_score: number;
    goal_alignment_score: number;
    security_compliance_score: number;
    constraint_adherence_score: number;
    total_actions: number;
    verified_actions: number;
    blocked_actions: number;
    highlights: any[];
    insights: any[];
}
export declare class LogStore {
    private db;
    private dbPath;
    private sessionStart;
    constructor();
    /**
     * Initialize the database. Creates the tables if they don't exist.
     */
    initialize(): Promise<void>;
    /**
     * Log an action to the database.
     */
    logAction(entry: LogEntry): Promise<LogResult>;
    /**
     * Get statistics for the current session (used by carapace_status).
     */
    getSessionStats(): Promise<SessionStats>;
    /**
     * Get recent actions for the monitoring dashboard (API endpoint).
     * This would be called by the dashboard's localhost API.
     */
    getRecentActions(limit?: number): any[];
    /**
     * Get actions within a time range (for dashboard filtering).
     */
    getActionsByTimeRange(start: string, end: string): any[];
    /**
     * Clean up old logs based on retention policy.
     */
    cleanupOldLogs(retentionDays?: number): number;
    /**
     * Save a review to the database.
     */
    saveReview(review: ReviewEntry): Promise<LogResult>;
    /**
     * Get recent reviews, with highlights and insights parsed from JSON.
     */
    getReviews(limit?: number): any[];
    /**
     * Get reviews within a date range, with highlights and insights parsed from JSON.
     */
    getReviewsByDateRange(startDate: string, endDate: string): any[];
    /**
     * Get all actions for a given session, ordered by timestamp ascending.
     */
    getActionsBySession(sessionId: string): any[];
    /**
     * Get the database file path (for status reporting).
     */
    getDbPath(): string;
}
export {};
//# sourceMappingURL=logs.d.ts.map