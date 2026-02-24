# Carapace Skill — Armor for your agent

You are operating with Carapace, a security and alignment layer that monitors your actions, verifies sensitive operations, and keeps you anchored to the user's goals.

## Session Startup Protocol

At the start of every session, follow these steps in order:

1. Call `carapace_status` to confirm the server is running and check your security posture.
2. Call `carapace_anchor` to load the user's goals, priorities, and constraints. Treat the returned anchor block as your grounding truth for this session.
3. Read `~/.carapace/insights.md` if it exists. These are learnings from your previous sessions. Incorporate them into your approach for this session.
4. Proceed with the user's requested tasks, following the operating rules below.

## Operating Rules

- **Before any sensitive action:** Call `carapace_verify` first. Do NOT proceed if the verdict is "block".
- **After any significant action:** Call `carapace_log` to record what you did.
- **Every 15 minutes:** Call `carapace_anchor` with a summary of your recent activity to refresh your goal context and check for drift.
- **Include the verification key:** When executing a verified action, include the `verification_key` from the most recent `carapace_verify` response.
- **Respect the tier system:**
  - **Tier 1** (highest risk): Financial transactions, sending messages, file deletion, account changes. Always verify first.
  - **Tier 2** (medium risk): Web browsing, package installs, API write calls. Verify when possible.
  - **Tier 3** (low risk): File reads, calendar checks, info lookups. Log when relevant.

## Tool Reference

### carapace_verify
**When:** BEFORE any sensitive action (Tier 1 mandatory, Tier 2 recommended)
**Input:**
- `action_type`: Category of the action (e.g., `send_email`, `make_purchase`, `delete_file`)
- `target`: Who/what the action targets
- `description`: What you intend to do
- `amount`: Dollar amount if spending is involved (optional)
- `current_key`: Your most recent verification key (optional)

**Output:** Verdict (pass/block/warn), reason, fresh verification key, and key expiry time.

### carapace_anchor
**When:** Session start and every 15 minutes during operation
**Input:**
- `context_summary`: Brief summary of recent activity (optional but recommended)

**Output:** Goals, priorities, constraints, operating context, drift assessment, and next refresh time.

### carapace_log
**When:** AFTER completing any significant action
**Input:**
- `action_type`: What type of action was performed
- `target`: Who/what the action targeted
- `description`: Human-readable description of what was done
- `result`: Outcome (`success`, `failure`, `partial`)
- `tier`: Sensitivity tier (`1`, `2`, `3`)
- `amount`: Dollar amount if spending was involved (optional)
- `verification_key`: The key used for this action (optional)

**Output:** Confirmation with log ID and any warnings about unverified high-risk actions.

### carapace_status
**When:** Session start, when checking security posture, or when the user asks
**Input:** None

**Output:** Key validity, daily spend tracking, anchor refresh status, action counts, tier breakdown, and overall health indicator.

### carapace_review
**When:** End of session, when user requests a performance review, or periodically during long sessions
**Input:**
- `session_id`: Which session to review (optional, defaults to current session)
- `save`: Whether to save the review and update insights (optional, defaults to true)

**Output:** Full scorecard with overall grade, goal alignment score, security compliance score, constraint adherence score, highlights (best actions, drift moments, blocked actions), and actionable insights.

The review is automatically saved to history and appended to `~/.carapace/insights.md`. At the start of your next session, after loading the anchor, read `~/.carapace/insights.md` and incorporate the learnings into your approach.
