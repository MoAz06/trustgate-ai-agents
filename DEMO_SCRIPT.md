# Three-Minute Demo Script

Target length: 2:45 to 3:00. Keep it in English or add English subtitles.

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

## 0:45-1:20 - Gemini Calls The Tool

In the dashboard, set refund amount to `75` and click:

```text
Run Gemini agent
```

Show the `Gemini Agent Run` panel:

```text
Tool requested: proposeTrustGateAction
TrustGate decision: ALLOW
Fivetran: fivetran_rest_live
BigQuery: bigquery_rest_live
Gemini Final Answer: cites the TrustGate receipt
```

Say:

```text
This is the AI part. Gemini is not deciding the refund. Gemini requests the TrustGate tool call, Cloud Run evaluates the policy using Fivetran and BigQuery evidence, and Gemini explains the returned receipt.
```

## 1:20-1:55 - ALLOW

In the dashboard, click `Reset demo`, keep refund amount at `75`, then click `Run Gemini agent` again if needed.

Show:

- decision: `ALLOW`
- Fivetran source: `fivetran_rest_live`
- BigQuery source: `bigquery_rest_live`
- customer tier: `premium`
- rule score and empty/minimal risk breakdown

Say:

```text
When the customer tier matches contract v1 and the action is inside policy, TrustGate allows the action.
```

## 1:55-2:30 - APPROVAL_REQUIRED

Click:

```text
Inject new customer_tier enum
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

## 2:30-2:50 - BLOCK

Click:

```text
Inject critical schema failure
```

Run the refund again and show `BLOCK`.

Say:

```text
Approval is for limited uncertainty. A critical schema or connection failure becomes a hard block.
```

## 2:50-3:00 - Close

Say:

```text
TrustGate makes Fivetran data evidence part of runtime authorization for agent actions. Gemini explains, but the policy engine decides.
```

End on the receipt JSON with `fivetran_rest_live`, `fulfill_pageant`, `risk_breakdown`, and `decision`.
