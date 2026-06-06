# Fivetran REST setup for TrustGate

This is the practical setup path I used for the hackathon spike.

## 1. Create a Scoped API key

In Fivetran:

1. Open the dashboard.
2. Click your username.
3. Click `API Key`.
4. Click `Generate API key`.
5. Copy the API key and API secret immediately. The secret disappears after you leave the page.

TrustGate uses HTTP Basic auth with:

```text
api_key:api_secret
```

The app encodes that pair and sends it as:

```text
Authorization: Basic <base64(api_key:api_secret)>
```

## 2. Configure environment variables

```bash
FIVETRAN_API_KEY=...
FIVETRAN_API_SECRET=...
FIVETRAN_CONNECTION_ID=...
```

`FIVETRAN_CONNECTION_ID` is optional for the first spike. If it is empty, TrustGate calls:

```text
GET https://api.fivetran.com/v1/connections?limit=1
```

and uses the first returned connection.

## 3. Test the REST read before Agent Builder

Start the app:

```bash
npm start
```

Then call:

```bash
curl http://localhost:8080/api/fivetran/evidence
```

Good enough for day 1:

```json
{
  "source": "fivetran_rest_live",
  "connection_id": "...",
  "service": "...",
  "sync_state_summary": "...",
  "schema_config_hash": "..."
}
```

If you see `demo_seeded_fivetran_evidence`, the env vars are not configured.

If you see `fivetran_rest_error`, the API key/secret, permissions, or connection id need fixing.

If you see `fivetran_rest_no_connections`, the key works but the account/scope has no visible connections.

## 4. Why `/state` is optional

TrustGate always tries connection details and schema config first. The `/state` endpoint is useful, but Fivetran documents it as supported only for Function and Connection SDK connectors, so the app treats it as optional evidence.

Observed on the demo connection `fulfill_pageant`: `/state` returned `405`. That is why the receipt records the optional call status instead of pretending the state call worked.

Primary evidence:

```text
GET /v1/connections/{connectionId}
GET /v1/connections/{connectionId}/schemas
```

Optional evidence:

```text
GET /v1/connections/{connectionId}/state
```

## 5. What to show judges

In the TrustGate receipt, point to:

- `source: fivetran_rest_live`
- `connection_id`
- `service`
- `sync_state_summary`
- `schema_config_hash`
- `schema_change_handling`
- `raw_refs`

The key proof is not that Fivetran exists in the README. The proof is that a live Fivetran field appears inside the action authorization receipt.
