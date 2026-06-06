# Submission Checklist

Last checked: 2026-06-07.

Official references:

- Devpost rules: https://rapid-agent.devpost.com/rules
- Fivetran resources: https://rapid-agent.devpost.com/details/fivetran-resources

## Hard Requirements

| Item | Status | Notes |
| --- | --- | --- |
| Build a functional agent | PASS | Hosted `/api/agent/run` shows Gemini requesting `proposeTrustGateAction`. |
| Use Gemini / Google Cloud AI | PASS | Hosted `/api/agent/run` and the backup script use `gemini-3.5-flash`. |
| Use Google Cloud | PASS | API is hosted on Cloud Run in project `trustgate-hackathon`. |
| Web, Android, or iOS platform | PASS | Web app is hosted by the Cloud Run service. |
| Use Fivetran for the Fivetran track | PASS | Receipt includes live Fivetran REST evidence: `fivetran_rest_live`, connection `fulfill_pageant`. |
| Show Fivetran-synced data in BigQuery | PASS | Live endpoint and receipts show `evidence.bigquery.source=bigquery_rest_live`, not `bigquery_rest_live_partial`. |
| Partner MCP requirement | YELLOW | The general rules say partner MCP server. The Fivetran resource page lists REST API as an alternative integration option. Do not hide that the working evidence path is REST. |
| Hosted project URL | PASS | `https://trustgate-24801890031.us-central1.run.app` |
| Cloud Run stateless approval flow | PASS | Approval receipt can be sent with the next action call; it no longer depends only on in-memory decision history. |
| Hosted Gemini tool-call flow | PASS | Dashboard shows `Gemini Agent Run`, `proposeTrustGateAction`, TrustGate receipt, and Gemini final answer. |
| Public code repository | PENDING | Publish the repo before submission. |
| Open-source license visible in repo | PASS locally / PENDING on GitHub | `LICENSE` is present locally. GitHub still needs the public repo. |
| Demo video, public YouTube/Vimeo | PENDING | Record under 3 minutes; English or English subtitles. |
| Written submission in English | PENDING | Use the README/Devpost wording, not the old strategy document. |
| Built during contest period | PENDING | Mention solo build and include `BUILD_LOG.md`. |
| No disallowed AI tools in runtime | PASS based on code scan | Runtime uses Gemini/Vertex only. Do not add non-Google LLM APIs. |

## Do Not Claim

- Do not claim production-ready.
- Do not claim invisible semantic-drift detection.
- Do not claim MCP if the demo receipt shows REST.
- Do not claim the Agent Builder UI imported OpenAPI unless that exact screen is recorded.
- Do not describe `risk_score` as AI confidence.

## What To Show In Devpost

1. Hosted app URL.
2. Public GitHub repo with `LICENSE`.
3. Demo video under 3 minutes.
4. Fivetran connection page with successful sync.
5. Cloud Run endpoint returning `fivetran_rest_live`.
6. Cloud Run endpoint returning `bigquery_rest_live`.
7. Dashboard `Gemini Agent Run` panel showing `proposeTrustGateAction`.
8. TrustGate receipt showing decision, evidence, and rule breakdown.

## Biggest Remaining Risk

The strongest requirement risk is wording around Agent Builder and MCP. The safest phrasing is:

```text
TrustGate uses Gemini function calling through Vertex AI to call a Cloud Run tool endpoint. The working Fivetran evidence path is REST, which Fivetran's hackathon resource page lists as an integration option. The repo also includes an OpenAPI spec for Agent Builder imports when available.
```

This is less flashy, but it is harder for a judge to attack.
