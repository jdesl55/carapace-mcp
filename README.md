# 🛡️ Carapace MCP Server

**Armor for your AI agent.**

Carapace is a local-first security system for autonomous AI agents. It plugs into any MCP-compatible agent (OpenClaw, Claude Code, Codex, and others) and provides security verification, goal anchoring, drift detection, action logging, and session grading — all running on your machine with zero cloud dependencies.

---

## The Problem

Autonomous AI agents can take real actions: send emails, make purchases, delete files, browse the web. Two critical risks come with this power:

**Prompt Injection** — Malicious instructions hidden in emails, web pages, or documents trick your agent into executing actions you never authorized. CrowdStrike and Cisco have both published warnings about this happening to OpenClaw users.

**Goal Drift** — Your agent starts organizing your inbox, and three hours later it's browsing Reddit because it followed a chain of links and lost focus. No malice involved — just a lack of persistent grounding.

Carapace solves both.

---

## How It Works

Carapace runs as an MCP server on your machine. Your agent connects to it and calls its tools before, during, and after taking actions.

**Security Checkpoint** — Before any sensitive action (spending money, sending messages, deleting files), the agent checks with Carapace. You set the rules ("never spend more than $50," "never message these people"). Carapace blocks anything that violates your rules.

**Rotating Key Anti-Hijacking** — Every 30 minutes, Carapace generates a cryptographic verification key using a secret that never enters the agent's context window. The real agent has the key. A prompt injection can't forge it. Like a bouncer checking wristbands at a venue.

**Goal Anchoring** — Every 15 minutes, Carapace re-reads your goals, priorities, and constraints to the agent. It detects when the agent wanders off-task and flags drift before it becomes a problem.

**Session Grading** — At the end of each session, Carapace grades the agent's performance against your configured goals. Scores across goal alignment, security compliance, and constraint adherence. Generates actionable insights that feed back into the next session, making your agent sharper over time.

---

## Tools

Carapace exposes 5 tools via the Model Context Protocol:

| Tool | Purpose |
|------|---------|
| `carapace_verify` | Security checkpoint. Validates actions against your rules, returns pass/block verdict with rotating key. |
| `carapace_anchor` | Goal journal. Returns your goals, priorities, and constraints. Detects drift by comparing agent activity against configured categories. |
| `carapace_log` | Action logger. Records what the agent did, flags unverified sensitive actions. |
| `carapace_status` | Security posture summary. Health status, action counts, key rotation timing, drift level. |
| `carapace_review` | Session grader. Analyzes all actions against goals, produces a scorecard with grades, highlights, and improvement insights. |

---

## Install

```bash
git clone https://github.com/jdesl55/carapace-mcp.git
cd carapace-mcp
npm install
npm run build
```

On first run, Carapace creates `~/.carapace/` with your config, database, and security secret.

### Add to OpenClaw

Add to your OpenClaw MCP config (`~/.config/openclaw/mcp.json`):

```json
{
  "mcpServers": {
    "carapace": {
      "command": "node",
      "args": ["/path/to/carapace-mcp/dist/index.js"]
    }
  }
}
```

### Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

---

## Configuration

All configuration lives in `~/.carapace/config.json`. Edit it by hand or use the [Carapace Dashboard](https://github.com/jdesl55/carapace-dashboard) for a visual interface.

```json
{
  "security": {
    "keyRotationMinutes": 30,
    "spendingLimits": {
      "perAction": 50,
      "daily": 200,
      "warnAbove": 20
    },
    "contacts": {
      "mode": "blocklist",
      "blocked": ["scammer@evil.com"]
    },
    "domains": {
      "mode": "blocklist",
      "blocked": []
    },
    "blockedActions": [],
    "customRules": []
  },
  "anchor": {
    "refreshIntervalMinutes": 15,
    "goals": ["Manage inbox and respond to important emails"],
    "priorities": [{ "rank": 1, "text": "Never spend money without confirmation" }],
    "constraints": ["Never share personal information with unknown contacts"],
    "goalCategories": ["email", "calendar", "productivity"]
  }
}
```

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   AI Agent      │────▶│  Carapace MCP Server  │────▶│  ~/.carapace/   │
│  (OpenClaw)     │◀────│  (local, stdio)       │◀────│  config.json    │
└─────────────────┘     └──────────────────────┘     │  logs.db        │
                                                      │  .secret        │
┌─────────────────┐                                   │  insights.md    │
│   Dashboard     │──────────────────────────────────▶│                 │
│  (localhost)    │◀──────────────────────────────────│                 │
└─────────────────┘                                   └─────────────────┘
```

The MCP server and dashboard are completely decoupled. They communicate through shared local files — never directly. The dashboard writes config, the server reads it. The server writes logs, the dashboard reads them.

---

## Local Files

| File | Purpose | Written by | Read by |
|------|---------|-----------|---------|
| `~/.carapace/config.json` | Security rules, goals, priorities | Dashboard | MCP Server |
| `~/.carapace/logs.db` | Action log, session reviews | MCP Server | Dashboard |
| `~/.carapace/.secret` | HMAC signing key (600 permissions) | MCP Server | MCP Server only |
| `~/.carapace/insights.md` | Session learnings for agent improvement | MCP Server | Agent (at session start) |

---

## Feedback Loop

Carapace creates a continuous improvement cycle for your agent:

1. **Agent works** — takes actions, Carapace logs everything
2. **Session ends** — `carapace_review` grades the session against your goals
3. **Insights generated** — actionable learnings written to `insights.md`
4. **Next session starts** — agent reads `insights.md` and incorporates the learnings
5. **Agent improves** — progressively sharper at your specific tasks

The agent doesn't need to remember or self-improve. Carapace observes from the outside and feeds structured instructions back in.

---

## Dashboard

For a visual interface to configure rules, edit goals, monitor activity, and view performance scorecards, see the [Carapace Dashboard](https://github.com/jdesl55/carapace-dashboard).

---

## Tech Stack

- TypeScript / Node.js
- MCP SDK (`@anthropic-ai/sdk`)
- better-sqlite3 for local logging
- HMAC-SHA256 for rotating key verification
- Zero external dependencies for core security operations

---

## License

MIT

---

## Security

Carapace is a security tool. If you discover a vulnerability, please report it responsibly by opening a GitHub issue or contacting the maintainer directly.

The HMAC secret at `~/.carapace/.secret` is created with 600 file permissions (owner read/write only). It never enters the agent's context window and is never transmitted over any network.
