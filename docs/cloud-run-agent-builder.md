# Cloud Run + Gemini tool setup

This file records the Cloud Run deployment path and the agent-tool paths I tried. The deployed API works. The agent call that worked for me is the Vertex AI function-calling bridge, documented in `docs/vertex-agent-function-calling.md`.

## Current known values

Google Cloud project:

```text
trustgate-hackathon
```

Fivetran connection id detected by TrustGate:

```text
fulfill_pageant
```

TrustGate hosted API is already proven:

```text
GET /api/fivetran/evidence -> source: fivetran_rest_live
POST /api/actions/propose -> receipt uses fivetran_rest_live
POST /api/agent/run -> Gemini requests proposeTrustGateAction, then explains the TrustGate receipt
```

## What still has to be true for submission

The hosted Cloud Run URL must be called by a Gemini/Agent Platform agent tool. For the current working demo, that is done by the Vertex AI Python SDK function-calling bridge.

If the UI surface exposes OpenAPI import later, keep it to one operation:

```text
POST /api/actions/propose
```

## Deploy to Cloud Run

Run this from a machine or Cloud Shell where `gcloud` is available.

Set project:

```bash
gcloud config set project trustgate-hackathon
```

Enable services:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com bigquery.googleapis.com aiplatform.googleapis.com
```

Create secrets:

```bash
printf "%s" "PASTE_FIVETRAN_API_KEY" | gcloud secrets create fivetran-api-key --data-file=-
printf "%s" "PASTE_FIVETRAN_API_SECRET" | gcloud secrets create fivetran-api-secret --data-file=-
```

Deploy:

```bash
gcloud run deploy trustgate \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars FIVETRAN_CONNECTION_ID=fulfill_pageant,VERTEX_PROJECT_ID=trustgate-hackathon,VERTEX_LOCATION=global,VERTEX_MODEL=gemini-3.5-flash \
  --set-secrets FIVETRAN_API_KEY=fivetran-api-key:latest,FIVETRAN_API_SECRET=fivetran-api-secret:latest
```

For the hosted Gemini route, the Cloud Run service account also needs:

```text
roles/aiplatform.user
```

After deploy, copy the Cloud Run service URL. It should look like:

```text
https://trustgate-24801890031.us-central1.run.app
```

Test:

```bash
curl https://YOUR_CLOUD_RUN_URL/health
curl https://YOUR_CLOUD_RUN_URL/api/fivetran/evidence
curl -X POST https://YOUR_CLOUD_RUN_URL/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"customer_recovery_agent","action_type":"approve_refund","customer_id":"C-1042","amount":75,"reason":"late_delivery"}'
curl -X POST https://YOUR_CLOUD_RUN_URL/api/actions/propose \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"customer_recovery_agent","action_type":"approve_refund","customer_id":"C-1042","amount":75,"reason":"late_delivery"}'
```

Required proof:

```json
{
  "decision": "ALLOW",
  "evidence": {
    "fivetran": {
      "source": "fivetran_rest_live",
      "connection_id": "fulfill_pageant"
    }
  }
}
```

## Agent tool path

Observed UI limitation:

In the Agent Builder / Agent Studio UI I had access to, the Tools section showed Google Search, URL Context, and MCP Server, but no visible OpenAPI import path. The fallback that worked was the Vertex AI Python SDK function-calling bridge documented in:

```text
docs/vertex-agent-function-calling.md
```

### Preferred path: connect TrustGate as an MCP Server tool

Because the Agent Designer UI exposes `Add tools -> MCP Server`, the cleanest way to build the agent inside Agent Builder is to point that tool at TrustGate's own MCP endpoint:

```text
https://trustgate-24801890031.us-central1.run.app/mcp
```

Steps in Vertex AI Agent Designer (project `trustgate-hackathon`):

1. Create an agent named `Customer Recovery Agent` using the instruction text below.
2. Click `Add tools` -> `MCP Server`.
3. Display name: `TrustGate`. Endpoint URL: the `/mcp` URL above. Click `Save`.
4. Agent Designer discovers `proposeTrustGateAction` automatically.
5. Run the preview prompt and screenshot the tool call for the demo.

Notes:

- The Agent Designer UI only supports MCP servers that do not require authentication. The Cloud Run service is deployed `--allow-unauthenticated`, so `/mcp` works without auth headers.
- `/mcp` is TrustGate's own MCP tool surface, not Fivetran's MCP server. The Fivetran evidence path inside TrustGate is REST. Do not pitch this as "we use Fivetran MCP".
- The endpoint speaks MCP streamable-HTTP JSON-RPC and responds to `initialize`, `tools/list`, and `tools/call`.

Use this hosted OpenAPI JSON only if the UI exposes OpenAPI tools:


```text
https://trustgate-24801890031.us-central1.run.app/openapi.json
```

If Agent Builder wants an uploaded file instead, use:

```text
docs/openapi-tool.yaml
```

Replace this line in the YAML before upload:

```yaml
servers:
  - url: https://trustgate-24801890031.us-central1.run.app
```

## Agent instructions

Agent name:

```text
Customer Recovery Agent
```

System / instruction text:

```text
You are a customer recovery agent. You may review customer refund requests, but you must never execute or approve a refund directly.

Before any refund decision, call the TrustGate tool proposeTrustGateAction with:
- agent_id
- action_type = approve_refund
- customer_id
- amount
- reason

After TrustGate responds:
- If decision is ALLOW, tell the user the refund can proceed and cite the TrustGate receipt id.
- If decision is APPROVAL_REQUIRED, explain that human approval is required and cite the risk breakdown.
- If decision is BLOCK, explain that the action is blocked because the data supply chain evidence is not trusted.

Always mention the Fivetran evidence source and connection id from the receipt.
Do not invent policy decisions. TrustGate decides; you explain.
```

## Agent test prompt

Use this prompt in the Gemini/Vertex agent run, or in an Agent Builder preview if the tool import path is available:

```text
Review customer C-1042. The customer is angry because of a late delivery. Consider a $75 refund and ask TrustGate whether the action is allowed.
```

Expected result:

```text
The agent calls proposeTrustGateAction.
TrustGate returns ALLOW.
The response mentions fivetran_rest_live and connection_id fulfill_pageant.
```

Second test:

```text
Review customer C-1042. The customer had a service failure. Consider a $480 refund and ask TrustGate whether the action is allowed.
```

Expected result after demo enum drift is injected:

```text
The agent calls proposeTrustGateAction.
TrustGate returns APPROVAL_REQUIRED.
The response mentions the risk breakdown and Fivetran evidence.
```

Approval note:

Cloud Run can send sequential HTTP requests to different instances. The approval endpoint therefore returns an approval receipt, and the next action call can include that receipt as `approval`. The frontend does this automatically.

## The demo proof to record

Show these four things in the video:

1. Fivetran connection page: `trustgate_demo.customers` successful sync.
2. Cloud Run URL: `/api/fivetran/evidence` returns `fivetran_rest_live`.
3. Dashboard `Gemini Agent Run`: the agent requests `proposeTrustGateAction`.
4. TrustGate dashboard: receipt shows the same decision and Fivetran evidence.
