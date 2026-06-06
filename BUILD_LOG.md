# Build Log

This is the short version of what I actually built and what broke while wiring TrustGate together.

## What I Built

I built TrustGate as a Cloud Run API plus a small React dashboard. The core endpoint is:

```text
POST /api/actions/propose
```

I also added the hosted Gemini path:

```text
POST /api/agent/run
```

That route calls Vertex AI Gemini with a `proposeTrustGateAction` function declaration. Gemini asks for the tool call, TrustGate evaluates it, and the route passes the receipt back to Gemini for the final explanation. The dashboard shows this as a separate `Gemini Agent Run` panel so I can point to the AI part directly in the demo.

The endpoint takes a proposed agent action and returns a receipt with:

- `decision`: `ALLOW`, `APPROVAL_REQUIRED`, or `BLOCK`
- `risk_breakdown`: the rules that fired
- `risk_score`: the sum of rule weights, not an ML score
- `evidence.fivetran`: live Fivetran REST metadata when credentials are configured
- `evidence.bigquery`: a live BigQuery row from the Fivetran-synced table when Cloud Run has BigQuery IAM
- `evidence.contract`: the input-contract check used by the policy engine

The policy engine decides. Gemini explains the receipt.

## Things That Broke

1. Agent Builder / Agent Studio UI did not show an OpenAPI import path in the Tools panel I had access to.

   I saw Google Search, URL Context, and MCP Server. I did not see a `Create Tool` or OpenAPI import button. I switched to the Vertex AI Python SDK and represented TrustGate as a Gemini function tool.

2. The current hosted route uses `gemini-3.5-flash`.

   Earlier in the build, I first got function calling working with `gemini-2.5-flash`. After checking current Agent Platform model docs, I switched the hosted Gemini route and backup script to `gemini-3.5-flash` with `VERTEX_LOCATION=global`.

3. Fivetran `/state` returned `405` for my Google Sheets connector.

   I kept `/state` as optional. TrustGate still reads connection details and schema config, and the receipt records whether the optional state call worked.

4. Cloud Run Secret Manager gave `401` at first.

   The Fivetran credentials were correct, but the secret versions had newline/encoding problems. Recreating the secret versions as no-newline ASCII values fixed the Cloud Run authentication issue.

5. The first approval endpoint depended on in-memory decision history.

   A live Cloud Run test returned `decision_not_found` because the approval request can hit a different instance than the request that created the decision. I changed the approval flow so the approval receipt can be carried into the next action call. That keeps the demo honest about Cloud Run being stateless.

## Current Working Evidence

Hosted Cloud Run URL:

```text
https://trustgate-24801890031.us-central1.run.app
```

Fivetran connection used by the demo:

```text
fulfill_pageant
```

Evidence source seen in the TrustGate receipt:

```text
fivetran_rest_live
```

BigQuery source currently shown by the hosted demo:

```text
bigquery_rest_live
```

Working agent bridge:

```text
python scripts/vertex_trustgate_agent_demo.py
```

Hosted agent run:

```text
POST https://trustgate-24801890031.us-central1.run.app/api/agent/run
```

Expected terminal proof:

```text
Function call requested: proposeTrustGateAction
TrustGate decision: ALLOW
Fivetran source: fivetran_rest_live
Fivetran connection: fulfill_pageant
```

Expected dashboard proof:

```text
Gemini Agent Run -> Tool requested: proposeTrustGateAction
TrustGate Evidence Passed Back -> Fivetran: fivetran_rest_live
Gemini Final Answer -> cites the TrustGate receipt instead of inventing a decision
```

## Boundaries

I am not claiming the demo detects invisible semantic changes. The demo only reacts to observable contract signals: a new enum value, schema/config change, stale sync signal, or critical connector/schema failure.

I am not claiming the working path is Fivetran MCP if the receipt says REST. Fivetran's hackathon resource page lists REST API as an integration option, but the Devpost pitch still needs to be honest about which path is shown.

I am not claiming production readiness. This is a working hackathon prototype with a narrow refund scenario.
