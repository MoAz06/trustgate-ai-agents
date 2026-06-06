# BigQuery Evidence Setup

TrustGate can add live BigQuery row evidence to each action receipt. This is the part that proves the policy decision is reading from the Fivetran-synced table, not only from local demo state.

## Expected Table

Default table:

```text
trustgate-hackathon.trustgate_demo.customers
```

Override with:

```bash
BIGQUERY_PROJECT_ID=trustgate-hackathon
BIGQUERY_DATASET=trustgate_demo
BIGQUERY_TABLE=customers
```

## What TrustGate Queries

For a proposed refund action, TrustGate now queries live rows with:

```sql
SELECT *
FROM `project.dataset.table`
WHERE customer_id = @customer_id
LIMIT 25
```

Then it maps the returned columns in code. I changed it this way because Fivetran/BigQuery can normalize Google Sheets column names differently than the exact names in the local workbook.

TrustGate chooses the row that best matches the current demo target:

1. matching `customer_tier`
2. matching `refund_amount`
3. matching `reason`

This lets the same Fivetran-synced sheet prove both paths:

- `premium` -> `ALLOW`
- `retention_experiment` -> `APPROVAL_REQUIRED`

## Required Cloud Run IAM

The Cloud Run service account needs:

```text
roles/bigquery.jobUser
roles/bigquery.dataViewer
```

If BigQuery IAM is missing, the app falls back to:

```text
demo_bigquery_contract_query
```

That fallback keeps the demo usable, but it is weaker for judging. The video should show:

```text
bigquery_rest_live
```

If the table is readable but `customer_tier` is missing or named differently, the endpoint returns:

```text
bigquery_rest_live_partial
```

and includes `available_columns`. Use that list to fix the Google Sheet header or update the aliases in `server.js`.

With partial live evidence, TrustGate routes the proposed action to `APPROVAL_REQUIRED`. That is intentional: a live BigQuery row without the business columns is not enough contract evidence for an automatic action.

## Fix For The Current Fivetran Sheet

If `available_columns` only shows:

```text
_row
_fivetran_synced
customer_id
```

then Fivetran is only syncing one business column. Fix the Google Sheets named range:

1. Open the demo Google Sheet.
2. Make row 1 exactly:

```text
customer_id | customer_tier | last_order_status | open_ticket_count | refund_amount | reason | demo_note
```

3. Select the full range with headers and rows:

```text
A1:G6
```

4. Go to Data -> Named ranges.
5. Create/update the named range used by Fivetran so it points to the full range, not only column A.
6. In Fivetran, test/save the connector and run a sync.
7. If Fivetran does not add the new columns, create a new destination table name or delete/recreate the demo table and run a historical sync.

## Test

Hosted:

```bash
curl https://trustgate-24801890031.us-central1.run.app/api/bigquery/evidence
```

Local with a temporary OAuth token:

```bash
$env:BIGQUERY_ACCESS_TOKEN = gcloud auth print-access-token
npm start
```

Then:

```bash
curl http://localhost:8080/api/bigquery/evidence
```
