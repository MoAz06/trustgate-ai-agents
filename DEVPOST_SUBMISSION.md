# Devpost Submission — copy/paste ready

Track: **Fivetran**
Paste each block into the matching Devpost field. Wording is deliberately honest about MCP vs REST so a judge cannot attack it.

---

## Project title

```text
TrustGate: Fivetran-Powered Runtime Authorization for AI Agents
```

## Tagline / elevator pitch (one line)

```text
TrustGate turns Fivetran data trust into runtime permission for AI-agent actions: it allows, escalates, or blocks an agent's action based on live Fivetran and BigQuery evidence.
```

---

## Inspiration

```text
AI agents are moving from answering questions to taking actions: approving refunds, escalating accounts, adjusting finance holds. Those actions are only as safe as the data behind them. If a pipeline is stale, a schema changes, or a new value appears that the old input contract never authorized, an agent can still act with full confidence and cause real damage.

Model guardrails do not fix this, because the problem is not the prompt — it is the data supply chain. Fivetran already positions itself as the data foundation for AI agents, so we asked a sharper question: what if an agent is only allowed to act when the Fivetran-backed data behind that action can be trusted?
```

## What it does

```text
TrustGate is a runtime authorization layer that sits between a Gemini agent and a real action. The demo is a customer recovery agent deciding whether a refund may proceed.

Before the action runs, TrustGate checks the data supply chain behind the decision:
- Fivetran connection and sync evidence (REST)
- A live BigQuery row from the Fivetran-synced table
- A local input contract (allowed customer tiers, freshness, amount policy)
- A deterministic policy engine

It then returns exactly one of three decisions:
- ALLOW: safe data and an in-policy refund proceed.
- APPROVAL_REQUIRED: an observable contract break, such as a new customer_tier enum value outside contract v1, is routed to scoped human approval before damage happens.
- BLOCK: a critical schema or connection failure is a hard stop.

Gemini explains the decision and cites the receipt. Gemini does not decide the policy. The policy engine decides. Every decision produces an auditable receipt with the evidence, the contract version, and a transparent risk breakdown.
```

## How we built it

```text
- Agent: a Customer Recovery Agent built in Google Cloud Agent Builder (Agent Designer / Agent Platform), powered by Gemini (gemini-3.5-flash).
- Tool integration: the agent reaches TrustGate through an MCP Server tool. TrustGate exposes its own MCP-compatible tool endpoint (/mcp, streamable HTTP JSON-RPC) that publishes one tool, proposeTrustGateAction.
- Backend: a stateless TrustGate API on Cloud Run that evaluates the proposed action.
- Fivetran evidence: TrustGate reads the Fivetran REST API for connection details, sync state, and schema configuration, on a Google Sheets -> BigQuery connection.
- BigQuery evidence: TrustGate queries the Fivetran-synced table trustgate-hackathon.trustgate_demo.customers for the live customer row used in the decision.
- Policy engine: a deterministic rule set with transparent weights. risk_score is the sum of triggered rule weights, not a model confidence score.
- Tests: 16 automated tests covering the policy decisions, the freshness signal, and the MCP endpoint.

Honest scope note: TrustGate exposes its OWN MCP-compatible tool endpoint for agents. The Fivetran evidence path inside TrustGate uses the Fivetran REST API, which the hackathon Fivetran resource page lists as an integration option. We do not claim to use Fivetran's own MCP server.
```

## Challenges we ran into

```text
- The Agent Designer Tools panel we had access to exposed Google Search, URL Context, and an MCP Server option, but no OpenAPI import path. We turned TrustGate into an MCP-compatible tool endpoint and connected it through Add tools -> MCP Server, which let us build the agent inside Agent Builder as required.
- Fivetran /state returned 405 for the Google Sheets connector, so TrustGate treats that call as optional and keeps the receipt honest about which calls succeeded.
- Cloud Run is stateless, so an approval request can hit a different instance than the request that created the decision. We changed the approval flow so the approval receipt is carried into the next action call instead of relying on instance memory.
- Cloud Run Secret Manager returned 401 at first because the secret versions had newline/encoding issues; recreating them as no-newline ASCII fixed it.
```

## Accomplishments that we're proud of

```text
- The full loop is real and live: a Gemini agent in Agent Builder calls an MCP tool, TrustGate on Cloud Run evaluates the action using live Fivetran REST and live BigQuery evidence, and the decision is returned with an auditable receipt.
- The Fivetran evidence demonstrably changes the outcome. A new, unseen customer_tier value flips the decision from ALLOW to APPROVAL_REQUIRED. Fivetran is not decorative.
- The design is honest. The model explains; a deterministic policy engine decides. We document exactly what we are not claiming.
```

## What we learned

```text
Agent safety is a data problem as much as a model problem. The most useful control point for an autonomous agent is the moment just before it acts, where you can still check whether the data supply chain behind the action is trustworthy and route to a human when it is not.
```

## What's next

```text
- Authenticated agent identity on every proposed action.
- Immutable, replayable audit receipts with evidence, policy version, and contract version.
- Versioned input contracts with policy tests before a contract goes live.
- Enterprise approval workflow with approver identity, expiry, and scoped exceptions.
- More action types: discounts, account changes, invoice adjustments, access changes.
```

## Built with (tech tags)

```text
google-cloud, vertex-ai, gemini, agent-builder, cloud-run, bigquery, fivetran, mcp, node-js, javascript
```

---

## Submission fields

```text
Hosted project URL: https://trustgate-24801890031.us-central1.run.app
Public repository:   https://github.com/MoAz06/trustgate-ai-agents
Open-source license: MIT (visible in repo)
Demo video:          <paste YouTube/Vimeo link, <= 3 minutes, English>
Track:               Fivetran
Project built solo during the contest period. See BUILD_LOG.md for the build history.
```

## Screenshots to upload (in this order)

```text
1. Fivetran connection page: trustgate_demo.customers, successful sync (Google Sheets -> BigQuery).
2. Agent Designer preview: the Customer Recovery Agent calling proposeTrustGateAction, decision ALLOW, fivetran_rest_live, fulfill_pageant. (Strongest shot.)
3. Cloud Run endpoint /api/fivetran/evidence returning source: fivetran_rest_live.
4. Cloud Run endpoint /api/bigquery/evidence returning source: bigquery_rest_live.
5. TrustGate receipt JSON: decision, risk_breakdown, evidence.fivetran, evidence.bigquery.
6. APPROVAL_REQUIRED state with observed tier retention_experiment.
```

## Do not claim (guardrails for the written submission)

```text
- Do not claim production-ready.
- Do not claim Fivetran MCP. /mcp is TrustGate's own MCP surface; Fivetran evidence is REST.
- Do not claim invisible semantic-drift detection. The demo reacts to observable contract signals only.
- Do not describe risk_score as AI/ML confidence.
```
