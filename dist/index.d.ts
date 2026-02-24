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
export {};
//# sourceMappingURL=index.d.ts.map