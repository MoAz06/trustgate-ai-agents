# Three-Minute Demo Script

This is the script I used to record the demo. I am keeping it public so judges and other builders can reproduce the flow.

Target length: 2:45 to 3:00. Keep it in English or add English subtitles.

What this video must prove, in order:

1. A real agent built in Google Cloud Agent Builder (Agent Designer), powered by Gemini.
2. That agent reaches TrustGate through an MCP Server tool.
3. TrustGate's decision depends on live Fivetran REST and BigQuery evidence.
4. Three outcomes: ALLOW, APPROVAL_REQUIRED, BLOCK.

The single most important shot is the Agent Designer run at 0:45-1:20. Do not cut it.

## Before you record (preflight)

The deploy script now sets `--min-instances 1`, so the live service should stay warm. Still, run a warm-up call right before recording so the first on-camera request is fast, and confirm BigQuery is fully live (not partial):

```bash
curl -s https://trustgate-24801890031.us-central1.run.app/api/bigquery/evidence
```

Confirm the response shows `"source": "bigquery_rest_live"` and not `bigquery_rest_live_partial`. Then click `Reset demo` in the dashboard and start a fresh Agent Designer session. Do not record until both are true.

## 0:00-0:20 - Problem

Say:

```text
I built TrustGate because agent safety is not only a prompt problem. If an agent is about to approve a refund, the action should depend on whether the data behind that decision is fresh, contract-compliant, and traceable.
```

Show the TrustGate dashboard.

## 0:20-0:45 - Real Fivetran Evidence

Show the Fivetran connection page:

```text
trustgate_demo.customers
```

Point at:

- successful sync
- Google Sheets source
- BigQuery destination
- connection id used by TrustGate: `fulfill_pageant`

Then show:

```text
https://trustgate-24801890031.us-central1.run.app/api/fivetran/evidence
```

Also show:

```text
https://trustgate-24801890031.us-central1.run.app/api/bigquery/evidence
```

Say:

```text
This is not just demo text in the UI. TrustGate is reading Fivetran REST evidence and a BigQuery row from the Fivetran-synced table, then puts both into the action receipt.
```

## 0:45-1:20 - Agent Builder Calls The MCP Tool

This is the headline AI proof. Show it in Google Cloud Agent Platform / Agent Designer, not only the dashboard.

Open:

```text
Agent Platform -> Studio -> Agents -> Customer Recovery Agent -> Preview
```

The agent already has TrustGate connected as a tool through:

```text
Add tools -> MCP Server -> https://trustgate-24801890031.us-central1.run.app/mcp
```

Type the prompt:

```text
Review customer C-1042, angry about late delivery, consider a $75 refund and ask TrustGate.
```

Show the agent run steps on screen:

```text
Tool requested: proposeTrustGateAction
TrustGate decision: ALLOW
Fivetran Evidence Source: fivetran_rest_live
Fivetran Connection ID: fulfill_pageant
Final answer: cites the TrustGate receipt id, not an invented decision
```

Say:

```text
This is the AI part, and it runs inside Google Cloud Agent Builder. The agent is powered by Gemini and built in Agent Designer. It reaches TrustGate through an MCP Server tool. Gemini is not deciding the refund. Gemini requests the proposeTrustGateAction tool call, TrustGate on Cloud Run evaluates the policy using live Fivetran and BigQuery evidence, and Gemini explains the returned receipt.
```

Honest wording to keep on screen and in the voiceover:

```text
TrustGate exposes its own MCP-compatible tool endpoint for agents. The Fivetran evidence path inside TrustGate uses Fivetran REST.
```

Optional second proof, only if time allows: switch to the dashboard `Gemini Agent Run` panel to show the same flow as a hosted Vertex function-calling backup. Do not let this replace the Agent Designer shot.

## 1:20-1:55 - ALLOW (the receipt)

Switch to the TrustGate dashboard to show the receipt behind that ALLOW. Click `Reset demo`, keep refund amount at `75`.

Show the receipt:

- decision: `ALLOW`
- Fivetran source: `fivetran_rest_live`
- BigQuery source: `bigquery_rest_live`
- customer tier: `premium`
- risk_score: `0`, empty risk breakdown

Say:

```text
This is the receipt the agent just cited. When the customer tier matches contract v1 and the amount is inside automatic policy, TrustGate allows the action, and the risk breakdown is empty.
```

## 1:55-2:30 - APPROVAL_REQUIRED

Click:

```text
Simulate new customer tier
```

Then run a refund again.

Show:

- observed tier: `retention_experiment`
- allowed tiers: `standard, premium, enterprise`
- decision: `APPROVAL_REQUIRED`
- BigQuery row tier: `retention_experiment`
- risk breakdown

If BigQuery shows `bigquery_rest_live_partial`, stop and fix the sheet headers before recording. The winning video should not rely on partial mapping.

Say:

```text
This is the main point. I am not claiming TrustGate detects invisible meaning changes. The demo uses an observable contract break: a new enum value that contract v1 does not authorize for automatic refund decisions.
```

Click:

```text
Conditional approve under $50
```

Then set amount to `40` and click `Run Gemini agent` again. Show `ALLOW` with approval applied. In the UI, the approval receipt is carried into the next action call so the demo does not depend on Cloud Run instance memory.

## Optional beat - Stale sync (only if you have time, may push past 3:00)

This shows the third Fivetran signal: data freshness. Only include it if you can stay under 3:00; otherwise skip it.

Click:

```text
Simulate stale sync
```

Run a refund again and point at the BigQuery Row Evidence `freshness` line:

```text
freshness: 42 min since Fivetran sync (SLA 15) — SIMULATED stale
```

Say:

```text
TrustGate reads the real Fivetran sync age from the _fivetran_synced column in BigQuery. This button injects a simulated stale sync, clearly labeled in the receipt, so the freshness rule is visible. When the data is older than the contract SLA, TrustGate raises a supporting risk signal.
```

Then click `Reset demo` before continuing.

## 2:30-2:50 - BLOCK

Click:

```text
Simulate schema failure
```

Run the refund again and show `BLOCK`.

Say:

```text
Approval is for limited uncertainty. A critical schema or connection failure becomes a hard block.
```

## 2:50-3:00 - Close

Say:

```text
A Gemini agent built in Google Cloud Agent Builder reaches TrustGate through an MCP tool, and TrustGate makes live Fivetran evidence part of runtime authorization for the action. Gemini explains, but the policy engine decides.
```

End on the Decision Detail panel, not the raw JSON. Point at the fields that tell the story cleanly:

```text
decision: ALLOW / APPROVAL_REQUIRED / BLOCK
Fivetran source: fivetran_rest_live
BigQuery source: bigquery_rest_live
risk breakdown: the rules that fired, with points
```

If you do show the Audit Receipt JSON, do not linger on `last_successful_sync` (this connector reports `not_reported_by_connector`) or `schema_change_detected` on a clean ALLOW. The Decision Detail panel is the cleaner closing shot.
