# TrustGate for AI Agents

TrustGate is a runtime gate I built between a Gemini agent and a refund action. The agent proposes the action; TrustGate checks live Fivetran evidence, a local input contract, and a deterministic policy before returning `ALLOW`, `APPROVAL_REQUIRED`, or `BLOCK`.

This repo is intentionally scoped as a hackathon proof, not a production platform claim. The part I care about proving is the loop:

I am keeping the build log, demo script, and setup notes public so judges and other builders can reproduce the flow instead of only watching the video.

```text
Gemini / Vertex AI function call
-> proposeTrustGateAction
-> Cloud Run TrustGate API
-> live Fivetran REST evidence
-> live BigQuery row evidence from the Fivetran-synced table
-> deterministic policy decision
-> receipt returned to the agent
```

## Current Proof

- Hosted app/API: `https://trustgate-24801890031.us-central1.run.app`
- Gemini agent endpoint: `POST /api/agent/run`
- Action endpoint: `POST /api/actions/propose`
- OpenAPI spec for tool imports when available: `/openapi.json`
- Live Fivetran evidence observed in receipts: `source=fivetran_rest_live`
- Live BigQuery evidence observed in hosted receipts: `source=bigquery_rest_live`
- Fivetran connection used in the demo: `fulfill_pageant`
- Working Gemini paths: hosted `/api/agent/run` and `scripts/vertex_trustgate_agent_demo.py`
- Build notes with the things that broke: `BUILD_LOG.md`
- Exact video flow: `DEMO_SCRIPT.md`
- Submission risk checklist: `SUBMISSION_CHECKLIST.md`

## What It Does

The demo is a customer recovery agent deciding whether a refund may proceed.

1. Safe data and a normal refund amount return `ALLOW`.
2. A new observed `customer_tier` value outside contract v1 returns `APPROVAL_REQUIRED`.
3. A scoped human approval can allow refunds under `$50` until contract v2 is reviewed.
4. A critical schema/connection failure returns `BLOCK`.

Gemini explains the receipt. Gemini does not decide the policy.

`risk_score` is not a model confidence score. It is a transparent sum of triggered rule weights, shown as `risk_breakdown` in the receipt.

## Run Locally

```bash
npm run check
npm test
npm start
```

Open `http://localhost:8080`.

Without Fivetran credentials, the app uses clearly labeled demo evidence. With credentials, it reads Fivetran REST evidence.

Small reliability endpoints:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/healthz
curl http://localhost:8080/readyz
```

`/health` and `/api/healthz` are simple liveness checks. `/readyz` reports configuration status by env var name only. It does not return secret values or call external APIs.

## Fivetran Evidence

For the Fivetran track, I used the REST API option listed in the hackathon Fivetran resources: `https://rapid-agent.devpost.com/details/fivetran-resources`.

Create `.env` from `.env.example` and add a scoped Fivetran API key:

```bash
FIVETRAN_API_KEY=...
FIVETRAN_API_SECRET=...
FIVETRAN_CONNECTION_ID=fulfill_pageant
```

TrustGate reads Fivetran:

- `GET /v1/connections/{connectionId}`
- `GET /v1/connections/{connectionId}/schemas`
- `GET /v1/connections/{connectionId}/state` only when the connector supports it

For my Google Sheets connection, `/state` returned `405`, so the server treats that call as optional and keeps the receipt honest.

Test the evidence endpoint:

```bash
curl http://localhost:8080/api/fivetran/evidence
```

The important proof is the real Fivetran field inside the action receipt.

## BigQuery Evidence

The hosted service queries the Fivetran-synced BigQuery table:

```text
trustgate-hackathon.trustgate_demo.customers
```

The receipt includes `evidence.bigquery.source`. Strong demo proof is:

```text
bigquery_rest_live
```

If the hosted endpoint says `bigquery_rest_live_partial`, BigQuery is readable but the Fivetran table column names do not include a recognizable `customer_tier`. The response includes `available_columns` so I can fix the sheet/schema instead of guessing.

For local development without Google credentials, TrustGate falls back to clearly labeled `demo_bigquery_contract_query`.

## Gemini Tool Path

I first looked for an OpenAPI import in the Agent Builder / Agent Studio UI I had access to. That UI showed Google Search, URL Context, and MCP Server, but I did not see an OpenAPI import path.

The hosted app now has a visible Gemini run endpoint:

```text
POST /api/agent/run
```

That endpoint calls Vertex AI Gemini, gives Gemini the `proposeTrustGateAction` function declaration, executes the requested TrustGate action on Cloud Run, and sends the receipt back to Gemini for the final explanation. The dashboard has a `Gemini Agent Run` panel so the video can show the actual function call, the TrustGate receipt, and Gemini's final answer in one place.

I also kept the original Cloud Shell script because it is useful as a separate terminal proof:

```bash
python scripts/vertex_trustgate_agent_demo.py
```

That script defines `proposeTrustGateAction`, lets `gemini-3.5-flash` request the tool call, POSTs the arguments to Cloud Run, and passes the TrustGate receipt back with `Part.from_function_response`.

Docs:

- `docs/vertex-agent-function-calling.md`
- `docs/cloud-run-agent-builder.md`
- `docs/openapi-tool.yaml`

## Deploy

```bash
scripts/deploy-cloud-run.sh
```

```powershell
.\scripts\deploy-cloud-run.ps1
```

The deploy scripts grant the Cloud Run service account BigQuery read/query roles and `roles/aiplatform.user` so the hosted `/api/agent/run` route can call Gemini from Cloud Run metadata auth.

If Cloud Run authentication is enabled later, the calling agent service account needs `roles/run.invoker`.

## Production Hardening Path

I am not calling this production-ready. The current build proves the runtime decision loop for the hackathon. The next engineering work I would do before trusting this in a real workflow:

- Protect mutating endpoints like `/api/actions/propose`, `/api/demo/*`, and `/api/approvals/*` with IAM, IAP, or signed internal calls.
- Move the policy and input contract into versioned config files instead of keeping all demo policy rules in `server.js`.
- Persist decision receipts and approval receipts in immutable storage so a later review can replay the same input, evidence, policy version, and result.
- Add Cloud Logging metrics for `ALLOW`, `APPROVAL_REQUIRED`, `BLOCK`, evidence failures, and Gemini tool-call failures.
- Add CI with syntax checks, policy tests, and secret scanning before every push.
- Replace the public demo reset/inject routes with a separate demo mode flag.

## Claims I Am Not Making

- I am not claiming this is production-ready.
- I am not claiming TrustGate detects invisible meaning changes when schema and values are unchanged.
- I am not claiming the live demo uses Fivetran MCP if the shown receipt says REST.
- I am not claiming `risk_score` is ML.
- I am not claiming the Agent Builder UI OpenAPI path worked for me unless I record that exact path.
