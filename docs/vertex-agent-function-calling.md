# Vertex AI function-calling bridge

This is the path I used when the Agent Builder / Agent Studio UI did not expose an OpenAPI tool import.

## What happened

The UI Tools section only showed:

- Google Search
- URL Context
- MCP Server

There was no visible `Create Tool` button and no OpenAPI import path in the current UI. To keep the hackathon requirement moving, I used the Vertex AI Python SDK from Cloud Shell and represented TrustGate as a Gemini function tool.

The current hosted route and backup script use `gemini-3.5-flash` with `VERTEX_LOCATION=global`. Earlier in the build, I first got function calling working with `gemini-2.5-flash`; I keep that note here only as build history.

I later added the same idea to the hosted Cloud Run app as:

```text
POST /api/agent/run
```

That route calls Vertex AI over REST, lets Gemini request `proposeTrustGateAction`, evaluates the requested action inside TrustGate, and sends the receipt back to Gemini for the final answer.

## Working stack

Cloud project:

```text
trustgate-hackathon
```

Model that worked:

```text
gemini-3.5-flash
```

TrustGate hosted endpoint:

```text
https://trustgate-24801890031.us-central1.run.app/api/actions/propose
```

Hosted Gemini run endpoint:

```text
https://trustgate-24801890031.us-central1.run.app/api/agent/run
```

Install command:

```bash
pip install "google-cloud-aiplatform[adk]"
```

## Tool definition

The Gemini tool is named:

```text
proposeTrustGateAction
```

It takes exactly these fields:

- `agent_id`
- `action_type`
- `customer_id`
- `amount`
- `reason`

The Python bridge sends the function call arguments to TrustGate over HTTP:

```text
POST https://trustgate-24801890031.us-central1.run.app/api/actions/propose
```

Then it sends the TrustGate JSON response back to Gemini using `Part.from_function_response`.

The hosted `/api/agent/run` route does the same flow inside the Node server so the dashboard can show:

```text
Gemini function call -> TrustGate receipt -> Gemini final answer
```

## Required proof

The working proof is:

1. Gemini automatically calls `proposeTrustGateAction`.
2. TrustGate returns `ALLOW`.
3. The TrustGate receipt includes:

```json
{
  "evidence": {
    "fivetran": {
      "source": "fivetran_rest_live",
      "connection_id": "fulfill_pageant"
    }
  }
}
```

4. Gemini cites both `fivetran_rest_live` and `fulfill_pageant` in its answer.

## Why this is still useful for the demo

The important technical proof is that a Gemini-powered agent uses a tool to call the deployed TrustGate API, and that TrustGate uses live Fivetran evidence in the decision receipt.

For Devpost wording, I should still be careful: this is a Vertex AI function-calling bridge, not proof that the visible Agent Builder UI imported my OpenAPI file.

This bridge proves:

```text
Gemini agent -> function tool -> Cloud Run TrustGate -> live Fivetran REST evidence -> agent explanation
```

## Cloud Shell command

Use the reproducible script:

```bash
python scripts/vertex_trustgate_agent_demo.py
```

Expected output includes:

```text
Function call requested: proposeTrustGateAction
TrustGate decision: ALLOW
Fivetran source: fivetran_rest_live
Fivetran connection: fulfill_pageant
```
