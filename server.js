const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, "public");

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt === -1) continue;
    const key = trimmed.slice(0, equalsAt).trim();
    const value = trimmed.slice(equalsAt + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

if (process.env.TRUSTGATE_SKIP_DOTENV !== "1") {
  loadDotEnv();
}

function requiredEnvStatus(names) {
  const missing = names.filter((name) => !process.env[name]);
  return {
    configured: missing.length === 0,
    missing
  };
}

function readinessReport() {
  const fivetran = requiredEnvStatus(["FIVETRAN_API_KEY", "FIVETRAN_API_SECRET"]);
  const vertexEnv = requiredEnvStatus(["VERTEX_PROJECT_ID", "VERTEX_LOCATION", "VERTEX_MODEL"]);
  const hasVertexAuth = Boolean(process.env.VERTEX_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN || process.env.K_SERVICE);
  const hasBigQueryAuth = Boolean(process.env.BIGQUERY_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN || process.env.K_SERVICE);

  return {
    ok: true,
    service: "trustgate",
    time: new Date().toISOString(),
    checks: {
      fivetran_rest: {
        status: fivetran.configured ? "live_configured" : "demo_fallback_available",
        missing_env: fivetran.missing
      },
      vertex_gemini: {
        status: hasVertexAuth ? "auth_available" : "local_auth_missing",
        missing_env: vertexEnv.missing,
        model: process.env.VERTEX_MODEL || "gemini-3.5-flash",
        location: process.env.VERTEX_LOCATION || "global"
      },
      bigquery: {
        status: hasBigQueryAuth ? "auth_available" : "local_auth_missing",
        table: bigQueryTableRef().tableId
      }
    },
    note: "No secret values are returned. Live external calls are checked by the evidence endpoints."
  };
}

function logStartupConfig() {
  const report = readinessReport();
  const summary = Object.fromEntries(
    Object.entries(report.checks).map(([name, check]) => [name, check.status])
  );
  console.log(`TrustGate config status: ${JSON.stringify(summary)}`);
}

const contract = {
  contract_id: "customer_refund_input",
  version: "v1",
  allowed_customer_tiers: ["standard", "premium", "enterprise"],
  freshness_sla_minutes: 15,
  required_fields: ["customer_id", "customer_tier", "last_order_status", "open_ticket_count"]
};

const demoDefaults = {
  customerTier: "premium",
  lastSyncMinutesAgo: 4,
  fivetranStatus: "healthy",
  schemaConfigHash: "schema_v1_hash",
  schemaChangeDetected: false,
  criticalFailure: false,
  decisions: [],
  activeApproval: null
};

const demoState = structuredClone(demoDefaults);

function resetDemoState() {
  Object.assign(demoState, structuredClone(demoDefaults));
}

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  });
  res.end(body);
}

function text(res, status, body, contentType = "text/plain") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function notFound(res) {
  json(res, 404, { error: "not_found" });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error("invalid JSON body"));
      }
    });
  });
}

function decisionId() {
  return `dec_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

function hashObject(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

async function fivetranRequest(endpoint) {
  const key = process.env.FIVETRAN_API_KEY;
  const secret = process.env.FIVETRAN_API_SECRET;
  if (!key || !secret) {
    throw new Error("FIVETRAN_API_KEY and FIVETRAN_API_SECRET are not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");

  try {
    const response = await fetch(`https://api.fivetran.com${endpoint}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json;version=2",
        "Content-Type": "application/json"
      },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Fivetran ${endpoint} returned ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function optionalFivetranRequest(endpoint) {
  try {
    return { ok: true, payload: await fivetranRequest(endpoint) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function metadataAccessToken() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
        signal: controller.signal
      }
    );
    if (!response.ok) {
      throw new Error(`metadata token returned ${response.status}`);
    }
    const payload = await response.json();
    if (!payload.access_token) {
      throw new Error("metadata token response did not include access_token");
    }
    return { token: payload.access_token, source: "cloud_run_metadata" };
  } finally {
    clearTimeout(timeout);
  }
}

async function bigQueryAccessToken() {
  const envToken = process.env.BIGQUERY_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (envToken) return { token: envToken, source: "env_access_token" };
  if (!process.env.K_SERVICE) {
    throw new Error("BIGQUERY_ACCESS_TOKEN not configured and Cloud Run metadata is unavailable locally");
  }
  return metadataAccessToken();
}

async function vertexAccessToken() {
  const envToken = process.env.VERTEX_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (envToken) return { token: envToken, source: "env_access_token" };
  if (!process.env.K_SERVICE) {
    throw new Error("VERTEX_ACCESS_TOKEN not configured and Cloud Run metadata is unavailable locally");
  }
  return metadataAccessToken();
}

function firstConnectionFromList(payload) {
  const data = payload.data || {};
  if (Array.isArray(data.items) && data.items[0]) return data.items[0];
  if (Array.isArray(data.connections) && data.connections[0]) return data.connections[0];
  if (Array.isArray(data) && data[0]) return data[0];
  return null;
}

async function resolveFivetranConnection() {
  if (process.env.FIVETRAN_CONNECTION_ID) {
    return {
      connectionId: process.env.FIVETRAN_CONNECTION_ID,
      source: "env",
      listPayload: null
    };
  }

  const listPayload = await fivetranRequest("/v1/connections?limit=1");
  const firstConnection = firstConnectionFromList(listPayload);
  if (!firstConnection || !firstConnection.id) {
    return {
      connectionId: null,
      source: "list_connections_empty",
      listPayload
    };
  }

  return {
    connectionId: firstConnection.id,
    source: "list_connections_first",
    listPayload
  };
}

async function getFivetranEvidence() {
  if (process.env.FIVETRAN_API_KEY && process.env.FIVETRAN_API_SECRET) {
    try {
      const resolved = await resolveFivetranConnection();
      const connectionId = resolved.connectionId;
      if (!connectionId) {
        return {
          source: "fivetran_rest_no_connections",
          connection_id: null,
          sync_state_summary: "no_connection_found",
          schema_config_hash: demoState.schemaConfigHash,
          schema_change_detected: demoState.schemaChangeDetected,
          connection_id_source: resolved.source,
          raw_refs: ["/v1/connections?limit=1"]
        };
      }

      const connection = await fivetranRequest(`/v1/connections/${connectionId}`);
      const [stateResult, schemaResult] = await Promise.all([
        optionalFivetranRequest(`/v1/connections/${connectionId}/state`),
        optionalFivetranRequest(`/v1/connections/${connectionId}/schemas`)
      ]);

      const connectionData = connection.data || {};
      const schemaData = schemaResult.ok ? schemaResult.payload.data || {} : {};
      const status = connectionData.status || {};
      const syncState = stateResult.ok ? stateResult.payload.data || {} : {};
      const schemaConfigHash = hashObject(schemaData);

      return {
        source: "fivetran_rest_live",
        connection_id: connectionId,
        connection_id_source: resolved.source,
        service: connectionData.service || "unknown",
        sync_state: syncState,
        setup_state: status.setup_state || "unknown",
        sync_state_summary: status.sync_state || "unknown",
        last_successful_sync: status.succeeded_at || status.updated_at || null,
        schema_change_detected: schemaConfigHash !== demoState.schemaConfigHash,
        schema_config_hash: schemaConfigHash,
        schema_change_handling: schemaData.schema_change_handling || "unknown",
        optional_call_status: {
          state: stateResult.ok ? "ok" : stateResult.error,
          schemas: schemaResult.ok ? "ok" : schemaResult.error
        },
        raw_refs: [
          `/v1/connections/${connectionId}`,
          `/v1/connections/${connectionId}/state`,
          `/v1/connections/${connectionId}/schemas`,
          ...(resolved.source === "list_connections_first" ? ["/v1/connections?limit=1"] : [])
        ]
      };
    } catch (error) {
      return {
        source: "fivetran_rest_error",
        connection_id: process.env.FIVETRAN_CONNECTION_ID || null,
        sync_state_summary: "error",
        schema_config_hash: demoState.schemaConfigHash,
        schema_change_detected: demoState.schemaChangeDetected,
        error: error.message
      };
    }
  }

  return {
    source: "demo_seeded_fivetran_evidence",
    connection_id: "conn_customer_support_demo",
    service: "google_sheets",
    sync_state_summary: demoState.fivetranStatus,
    last_successful_sync: new Date(Date.now() - demoState.lastSyncMinutesAgo * 60_000).toISOString(),
    last_successful_sync_minutes_ago: demoState.lastSyncMinutesAgo,
    schema_config_hash: demoState.schemaConfigHash,
    schema_change_detected: demoState.schemaChangeDetected,
    schema_change_handling: "ALLOW_ALL",
    raw_refs: ["demo_state"]
  };
}

function demoBigQueryEvidence(action, customerTier, error) {
  return {
    source: "demo_bigquery_contract_query",
    query_id: `bq_${crypto.randomBytes(4).toString("hex")}`,
    table: "trustgate_demo.customers",
    customer_id: action.customer_id || "C-1042",
    customer_tier: customerTier,
    open_ticket_count: 1,
    last_order_status: "late_delivery",
    refund_amount: Number(action.amount || 75),
    reason: action.reason || "late_delivery",
    observed_enum_values: [...new Set([...contract.allowed_customer_tiers, customerTier])],
    selected_by: "local_demo_state",
    error
  };
}

function cleanBigQueryId(value, fallback) {
  const candidate = String(value || fallback || "").trim();
  if (!/^[A-Za-z0-9_ -]+$/.test(candidate)) return fallback;
  return candidate;
}

function bigQueryTableRef() {
  const projectId = cleanBigQueryId(
    process.env.BIGQUERY_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
    "trustgate-hackathon"
  );
  const dataset = cleanBigQueryId(process.env.BIGQUERY_DATASET, "trustgate_demo");
  const table = cleanBigQueryId(process.env.BIGQUERY_TABLE, "customers");
  return { projectId, dataset, table, tableId: `${projectId}.${dataset}.${table}` };
}

function rowFromBigQuery(schema, row) {
  const fields = (schema && schema.fields) || [];
  const cells = (row && row.f) || [];
  return fields.reduce((object, field, index) => {
    const raw = cells[index] ? cells[index].v : null;
    object[field.name] = raw;
    return object;
  }, {});
}

function normalizeFieldName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fieldValue(row, aliases) {
  const wanted = aliases.map(normalizeFieldName);
  for (const [key, value] of Object.entries(row)) {
    if (wanted.includes(normalizeFieldName(key))) return value;
  }
  return null;
}

function bestBigQueryRow(rows, targetTier, amount, reason) {
  if (!rows.length) return {};
  return rows
    .map((row) => {
      const tier = fieldValue(row, ["customer_tier", "customertier", "tier", "segment", "customer segment"]);
      const rowAmount = numberOrNull(fieldValue(row, ["refund_amount", "refundamount", "amount", "refund"]));
      const rowReason = fieldValue(row, ["reason", "refund_reason", "refundreason", "demo_reason"]);
      let score = 0;
      if (tier && String(tier) === String(targetTier)) score += 10;
      if (rowAmount !== null && rowAmount === amount) score += 4;
      if (rowReason && String(rowReason) === String(reason)) score += 2;
      return { row, score };
    })
    .sort((a, b) => b.score - a.score)[0].row;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function bigQueryRequest(projectId, body) {
  const access = await bigQueryAccessToken();
  const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`BigQuery query returned ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return { payload, auth_source: access.source };
}

async function getLiveBigQueryEvidence(action) {
  const targetTier = action.customer_tier || demoState.customerTier;
  const amount = Number(action.amount || 75);
  const reason = action.reason || "late_delivery";
  const table = bigQueryTableRef();
  const query = `
    SELECT *
    FROM \`${table.tableId}\`
    WHERE customer_id = @customer_id
    LIMIT 25
  `;

  const { payload, auth_source: authSource } = await bigQueryRequest(table.projectId, {
    query,
    useLegacySql: false,
    parameterMode: "NAMED",
    queryParameters: [
      {
        name: "customer_id",
        parameterType: { type: "STRING" },
        parameterValue: { value: action.customer_id || "C-1042" }
      }
    ]
  });

  const availableColumns = ((payload.schema && payload.schema.fields) || []).map((field) => field.name);
  const rows = (payload.rows || []).map((row) => rowFromBigQuery(payload.schema, row));
  const row = bestBigQueryRow(rows, targetTier, amount, reason);
  const mappedTier = fieldValue(row, ["customer_tier", "customertier", "tier", "segment", "customer segment"]);
  const mappedCustomerId = fieldValue(row, ["customer_id", "customerid", "id"]);
  const mappedOpenTicketCount = fieldValue(row, ["open_ticket_count", "openticketcount", "tickets", "ticket_count"]);
  const mappedLastOrderStatus = fieldValue(row, ["last_order_status", "lastorderstatus", "order_status", "status"]);
  const mappedRefundAmount = fieldValue(row, ["refund_amount", "refundamount", "amount", "refund"]);
  const mappedReason = fieldValue(row, ["reason", "refund_reason", "refundreason", "demo_reason"]);
  const mappedDemoNote = fieldValue(row, ["demo_note", "demonote", "note", "notes"]);

  if (!row.customer_id) {
    return {
      source: "bigquery_rest_live_no_row",
      query_id: payload.jobReference && payload.jobReference.jobId,
      table: table.tableId,
      customer_id: action.customer_id || "C-1042",
      customer_tier: targetTier,
      refund_amount: amount,
      reason,
      total_rows: Number(payload.totalRows || 0),
      selected_by: "no_matching_row_fallback_to_demo_state",
      auth_source: authSource,
      available_columns: availableColumns,
      observed_enum_values: [...new Set([...contract.allowed_customer_tiers, targetTier])]
    };
  }

  const tierFromBigQuery = mappedTier || targetTier;
  const source = mappedTier ? "bigquery_rest_live" : "bigquery_rest_live_partial";

  return {
    source,
    query_id: payload.jobReference && payload.jobReference.jobId,
    table: table.tableId,
    customer_id: mappedCustomerId || action.customer_id || "C-1042",
    customer_tier: tierFromBigQuery,
    open_ticket_count: numberOrNull(mappedOpenTicketCount),
    last_order_status: mappedLastOrderStatus || "unknown",
    refund_amount: numberOrNull(mappedRefundAmount),
    reason: mappedReason || reason,
    demo_note: mappedDemoNote || null,
    total_rows: Number(payload.totalRows || 0),
    selected_by: `target_tier=${targetTier}; amount=${amount}`,
    auth_source: authSource,
    available_columns: availableColumns,
    observed_enum_values: [...new Set([...contract.allowed_customer_tiers, tierFromBigQuery])],
    mapping_warning: mappedTier ? null : "customer_tier column was not found; TrustGate used demo target tier after reading the live BigQuery row"
  };
}

async function getBigQueryEvidence(action) {
  try {
    return await getLiveBigQueryEvidence(action);
  } catch (error) {
    const customerTier = action.customer_tier || demoState.customerTier;
    return demoBigQueryEvidence(action, customerTier, error.message);
  }
}

function actionFromBody(body) {
  return {
    agent_id: body.agent_id || "customer_recovery_agent",
    action_type: body.action_type || "approve_refund",
    customer_id: body.customer_id || "C-1042",
    amount: Number(body.amount || body.refund_amount || 75),
    reason: body.reason || "late_delivery",
    customer_tier: body.customer_tier,
    approval: body.approval || body.active_approval || null
  };
}

async function evaluateAction(action) {
  const fivetranEvidence = await getFivetranEvidence();
  const bigQueryEvidence = await getBigQueryEvidence(action);
  return decide(action, fivetranEvidence, bigQueryEvidence);
}

function applicableApproval(action, bigqueryEvidence) {
  const approval = action.approval || demoState.activeApproval;
  if (!approval) return null;
  if (approval.expires_at && Date.parse(approval.expires_at) < Date.now()) return null;
  if (action.action_type !== "approve_refund") return null;
  if (Number(action.amount || 0) > Number(approval.max_amount || 0)) return null;
  if (approval.allowed_customer_tier && bigqueryEvidence.customer_tier !== approval.allowed_customer_tier) return null;
  return approval;
}

function scoreBreakdown(rules) {
  const weights = {
    unseen_customer_tier_enum: 40,
    high_refund_amount: 20,
    partial_contract_evidence: 12,
    partial_bigquery_contract_evidence: 30,
    fivetran_connection_unhealthy: 50,
    required_schema_break: 100,
    stale_sync_supporting_signal: 10
  };

  return rules.map((rule) => ({
    rule,
    points: weights[rule] || 0
  }));
}

function decide(action, fivetranEvidence, bigqueryEvidence) {
  const amount = Number(action.amount || action.refund_amount || 0);
  const customerTier = bigqueryEvidence.customer_tier;
  const unseenTier = !contract.allowed_customer_tiers.includes(customerTier);
  const partialBigQueryEvidence =
    bigqueryEvidence.source === "bigquery_rest_live_partial" ||
    bigqueryEvidence.source === "bigquery_rest_live_no_row" ||
    Boolean(bigqueryEvidence.mapping_warning);
  const rules = [];
  const appliedApproval = applicableApproval(
    { ...action, amount, action_type: action.action_type || "approve_refund" },
    bigqueryEvidence
  );

  if (demoState.criticalFailure || fivetranEvidence.sync_state_summary === "error") {
    rules.push(demoState.criticalFailure ? "required_schema_break" : "fivetran_connection_unhealthy");
    return buildDecision("BLOCK", rules, amount, customerTier, fivetranEvidence, bigqueryEvidence, appliedApproval);
  }

  if (unseenTier) rules.push("unseen_customer_tier_enum");
  if (amount > 100) rules.push("high_refund_amount");
  if (partialBigQueryEvidence) rules.push("partial_bigquery_contract_evidence");
  if (fivetranEvidence.source.includes("demo")) rules.push("partial_contract_evidence");
  if ((fivetranEvidence.last_successful_sync_minutes_ago || 0) > contract.freshness_sla_minutes) {
    rules.push("stale_sync_supporting_signal");
  }

  if (appliedApproval) {
    return buildDecision("ALLOW", ["conditional_approval_applied"], amount, customerTier, fivetranEvidence, bigqueryEvidence, appliedApproval);
  }

  if (unseenTier || amount > 100 || partialBigQueryEvidence) {
    return buildDecision("APPROVAL_REQUIRED", rules, amount, customerTier, fivetranEvidence, bigqueryEvidence, appliedApproval);
  }

  return buildDecision("ALLOW", [], amount, customerTier, fivetranEvidence, bigqueryEvidence, appliedApproval);
}

function buildDecision(decision, triggeredRules, amount, customerTier, fivetranEvidence, bigqueryEvidence, appliedApproval) {
  const breakdown = scoreBreakdown(triggeredRules);
  const riskScore = breakdown.reduce((sum, item) => sum + item.points, 0);
  const id = decisionId();
  const receipt = {
    decision_id: id,
    action_id: `act_refund_${Date.now()}`,
    agent_id: "customer_recovery_agent",
    action_type: "approve_refund",
    decision,
    risk_score: riskScore,
    risk_breakdown: breakdown,
    policy_version: "refund_policy_v1",
    contract_version: contract.version,
    violations: triggeredRules,
    approval_applied: Boolean(appliedApproval),
    conditional_approval: appliedApproval || null,
    evidence: {
      fivetran: fivetranEvidence,
      bigquery: bigqueryEvidence,
      contract: {
        contract_id: contract.contract_id,
        allowed_customer_tiers: contract.allowed_customer_tiers,
        observed_customer_tier: customerTier,
        amount
      }
    },
    explanation: explainDecision(decision, triggeredRules, amount, customerTier, fivetranEvidence),
    created_at: new Date().toISOString()
  };

  demoState.decisions.unshift(receipt);
  demoState.decisions.splice(25);
  return receipt;
}

function explainDecision(decision, rules, amount, tier, fivetranEvidence) {
  if (decision === "ALLOW" && rules.includes("conditional_approval_applied")) {
    return `Allowed under scoped human approval: refund amount ${amount} is within the active approval limit for customer_tier=${tier}.`;
  }
  if (decision === "ALLOW") {
    return `Allowed: customer_tier=${tier} matches contract ${contract.version}, amount ${amount} is within automatic policy, and Fivetran evidence source=${fivetranEvidence.source}.`;
  }
  if (decision === "APPROVAL_REQUIRED") {
    return `Approval required: customer_tier=${tier} or amount ${amount} is outside automatic policy. Suggested fallback: allow refunds under $50 until contract v2 is reviewed.`;
  }
  return `Blocked: critical data supply-chain evidence failed. Do not execute this action until the connector/schema issue is resolved.`;
}

const AGENT_SYSTEM_INSTRUCTION = `You are a customer recovery agent. You may review refund requests, but you must never approve a refund directly.

Before any refund decision, call proposeTrustGateAction with agent_id, action_type, customer_id, amount, and reason.
Use agent_id=customer_recovery_agent for this demo agent.

After TrustGate responds:
- If decision is ALLOW, say the refund can proceed and cite the TrustGate receipt id.
- If decision is APPROVAL_REQUIRED, explain that human approval is required and cite the risk breakdown.
- If decision is BLOCK, explain that the action is blocked because the data supply-chain evidence is not trusted.

Always mention the Fivetran evidence source and BigQuery evidence source from the receipt. Do not invent policy decisions. TrustGate decides; you explain.

Format the final answer as plain text for a dashboard, not Markdown.
Do not use bold markers, backticks, tables, or long paragraphs.
Keep it under 90 words.
Use this shape:
TrustGate allowed the refund.
Decision: ALLOW
Customer: C-1042
Amount: $75
Why: customer_tier=premium matches contract v1, and $75 is within the automatic refund policy.
Evidence: Fivetran REST live on fulfill_pageant; BigQuery live on trustgate-hackathon.trustgate_demo.customers.
Receipt: dec_xxx`;

function vertexConfig() {
  return {
    projectId:
      process.env.VERTEX_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      "trustgate-hackathon",
    location: process.env.VERTEX_LOCATION || "global",
    model: process.env.VERTEX_MODEL || "gemini-3.5-flash"
  };
}

function trustGateFunctionDeclarations() {
  return [
    {
      name: "proposeTrustGateAction",
      description: "Ask TrustGate whether a proposed customer refund action is allowed, needs human approval, or must be blocked.",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "Identifier of the Gemini agent proposing the action."
          },
          action_type: {
            type: "string",
            enum: ["approve_refund"],
            description: "The business action being proposed."
          },
          customer_id: {
            type: "string",
            description: "Customer id for the refund request."
          },
          amount: {
            type: "number",
            description: "Refund amount in USD."
          },
          reason: {
            type: "string",
            description: "Reason for the proposed refund."
          }
        },
        required: ["agent_id", "action_type", "customer_id", "amount", "reason"]
      }
    }
  ];
}

async function vertexGenerateContent(requestBody) {
  const config = vertexConfig();
  const access = await vertexAccessToken();
  const host = config.location === "global" ? "aiplatform.googleapis.com" : `${config.location}-aiplatform.googleapis.com`;
  const endpoint = `https://${host}/v1beta1/projects/${config.projectId}/locations/${config.location}/publishers/google/models/${config.model}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Vertex AI Gemini returned ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return {
    payload,
    endpoint,
    token_source: access.source,
    model: config.model,
    location: config.location,
    project_id: config.projectId
  };
}

function firstGeminiFunctionCall(payload) {
  const parts = (payload.candidates && payload.candidates[0] && payload.candidates[0].content && payload.candidates[0].content.parts) || [];
  const part = parts.find((item) => item.functionCall || item.function_call);
  return part ? part.functionCall || part.function_call : null;
}

function firstGeminiText(payload) {
  const parts = (payload.candidates && payload.candidates[0] && payload.candidates[0].content && payload.candidates[0].content.parts) || [];
  return parts.map((part) => part.text).filter(Boolean).join("\n").trim();
}

function firstModelContent(payload, functionCall) {
  const content = payload.candidates && payload.candidates[0] && payload.candidates[0].content;
  if (content) return { role: content.role || "model", parts: content.parts || [] };
  return { role: "model", parts: [{ functionCall }] };
}

function agentPrompt(action) {
  return `Review customer ${action.customer_id}. The customer reason is ${action.reason}. Consider a $${action.amount} refund and ask TrustGate whether the action is allowed.`;
}

async function runGeminiAgent(req, res) {
  try {
    const body = await readRequestBody(req);
    const seedAction = actionFromBody(body);
    const prompt = body.prompt || agentPrompt(seedAction);
    const declarations = trustGateFunctionDeclarations();
    const firstTurn = await vertexGenerateContent({
      systemInstruction: { parts: [{ text: AGENT_SYSTEM_INSTRUCTION }] },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      tools: [{ functionDeclarations: declarations }],
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: ["proposeTrustGateAction"]
        }
      },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048
      }
    });

    const functionCall = firstGeminiFunctionCall(firstTurn.payload);
    if (!functionCall) {
      json(res, 502, {
        error: "gemini_did_not_request_tool_call",
        model: firstTurn.model,
        first_response_text: firstGeminiText(firstTurn.payload),
        raw_first_response: firstTurn.payload
      });
      return;
    }

    const toolArgs = actionFromBody({
      ...(functionCall.args || {}),
      ...seedAction,
      approval: seedAction.approval
    });
    const receipt = await evaluateAction(toolArgs);
    const modelContent = firstModelContent(firstTurn.payload, functionCall);

    const finalTurn = await vertexGenerateContent({
      systemInstruction: { parts: [{ text: AGENT_SYSTEM_INSTRUCTION }] },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        },
        modelContent,
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: functionCall.name,
                response: {
                  content: receipt
                }
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048
      }
    });

    json(res, 200, {
      prompt,
      model: firstTurn.model,
      location: firstTurn.location,
      auth_source: firstTurn.token_source,
      function_call_requested: {
        name: functionCall.name,
        args: functionCall.args || {}
      },
      function_call_sent_to_trustgate: toolArgs,
      trustgate_receipt: receipt,
      final_answer: firstGeminiText(finalTurn.payload),
      raw_refs: {
        vertex_generate_content: firstTurn.endpoint,
        trustgate_endpoint: "/api/actions/propose"
      }
    });
  } catch (error) {
    json(res, 400, { error: error.message });
  }
}

async function proposeAction(req, res) {
  try {
    const body = await readRequestBody(req);
    const action = actionFromBody(body);
    const receipt = await evaluateAction(action);
    json(res, 200, receipt);
  } catch (error) {
    json(res, 400, { error: error.message });
  }
}

async function approveDecision(req, res, decisionIdParam) {
  const body = await readRequestBody(req);
  const decision = demoState.decisions.find((item) => item.decision_id === decisionIdParam);
  const allowedTier =
    body.allowed_customer_tier ||
    (decision && decision.evidence && decision.evidence.bigquery && decision.evidence.bigquery.customer_tier) ||
    demoState.customerTier ||
    "retention_experiment";

  const approval = {
    approval_id: `appr_${Date.now()}`,
    decision_id: decisionIdParam,
    decision_found: Boolean(decision),
    approver_id: body.approver_id || "ops_lead_demo",
    approval_decision: body.approval_decision || "CONDITIONAL_APPROVE",
    rationale: body.rationale || "Allow a narrow fallback while contract v2 is reviewed.",
    max_amount: Number(body.max_amount || 50),
    allowed_customer_tier: allowedTier,
    expires_at: body.expires_at || new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    created_at: new Date().toISOString()
  };

  demoState.activeApproval = approval;
  if (decision) decision.human_approval = approval;
  json(res, 200, { approval, active_approval: demoState.activeApproval });
}

function serveStatic(req, res) {
  const requestPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    notFound(res);
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      notFound(res);
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".svg": "image/svg+xml"
    };
    text(res, 200, contents, types[ext] || "application/octet-stream");
  });
}

function openApiSpec(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || `localhost:${PORT}`;
  const baseUrl = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
  const decisionReceiptSchema = {
    type: "object",
    required: ["decision_id", "decision", "risk_score", "risk_breakdown", "explanation", "evidence"],
    properties: {
      decision_id: { type: "string" },
      action_id: { type: "string" },
      agent_id: { type: "string" },
      action_type: { type: "string", enum: ["approve_refund"] },
      decision: { type: "string", enum: ["ALLOW", "APPROVAL_REQUIRED", "BLOCK"] },
      risk_score: { type: "integer" },
      risk_breakdown: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rule: { type: "string" },
            points: { type: "integer" }
          }
        }
      },
      policy_version: { type: "string" },
      contract_version: { type: "string" },
      violations: {
        type: "array",
        items: { type: "string" }
      },
      approval_applied: { type: "boolean" },
      explanation: { type: "string" },
      evidence: {
        type: "object",
        properties: {
          fivetran: {
            type: "object",
            properties: {
              source: { type: "string" },
              connection_id: { type: "string" },
              connection_id_source: { type: "string" },
              service: { type: "string" },
              setup_state: { type: "string" },
              sync_state_summary: { type: "string" },
              schema_config_hash: { type: "string" },
              schema_change_detected: { type: "boolean" }
            }
          },
          bigquery: {
            type: "object",
            properties: {
              source: { type: "string" },
              query_id: { type: "string" },
              table: { type: "string" },
              customer_id: { type: "string" },
              customer_tier: { type: "string" },
              open_ticket_count: { type: "integer" },
              last_order_status: { type: "string" },
              refund_amount: { type: "number" },
              reason: { type: "string" },
              demo_note: { type: "string" },
              total_rows: { type: "integer" },
              selected_by: { type: "string" },
              auth_source: { type: "string" },
              observed_enum_values: {
                type: "array",
                items: { type: "string" }
              },
              available_columns: {
                type: "array",
                items: { type: "string" }
              },
              mapping_warning: { type: "string" }
            }
          },
          contract: {
            type: "object",
            properties: {
              contract_id: { type: "string" },
              observed_customer_tier: { type: "string" },
              amount: { type: "number" }
            }
          }
        }
      },
      created_at: { type: "string" }
    }
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "TrustGate Action Proposal Tool",
      version: "0.1.0",
      description: "Single-operation tool spec for Gemini/Agent Builder imports when available. The agent proposes a business action; TrustGate returns ALLOW, APPROVAL_REQUIRED, or BLOCK with evidence."
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/actions/propose": {
        post: {
          operationId: "proposeTrustGateAction",
          summary: "Ask TrustGate to authorize a proposed agent action",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["action_type", "customer_id", "amount", "reason"],
                  properties: {
                    agent_id: { type: "string" },
                    action_type: { type: "string", enum: ["approve_refund"] },
                    customer_id: { type: "string" },
                    amount: { type: "number" },
                    reason: { type: "string" },
                    customer_tier: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "TrustGate decision receipt",
              content: {
                "application/json": {
                  schema: decisionReceiptSchema
                }
              }
            }
          }
        }
      }
    }
  };
}

const MCP_PROTOCOL_VERSION = "2025-06-18";

function mcpToolDefinitions() {
  return trustGateFunctionDeclarations().map((fn) => ({
    name: fn.name,
    description: fn.description,
    inputSchema: fn.parameters
  }));
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMcpMessage(message) {
  const { id, method, params } = message || {};
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    const clientVersion = params && params.protocolVersion;
    return jsonRpcResult(id, {
      protocolVersion: clientVersion || MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "trustgate-mcp", version: "0.1.0" }
    });
  }

  if (method === "ping") {
    return jsonRpcResult(id, {});
  }

  if (method && method.startsWith("notifications/")) {
    return null;
  }

  if (method === "tools/list") {
    return jsonRpcResult(id, { tools: mcpToolDefinitions() });
  }

  if (method === "tools/call") {
    const toolName = params && params.name;
    const args = (params && params.arguments) || {};
    if (toolName !== "proposeTrustGateAction") {
      return jsonRpcResult(id, {
        isError: true,
        content: [{ type: "text", text: "Unknown tool: " + toolName }]
      });
    }
    try {
      const action = actionFromBody(args);
      const receipt = await evaluateAction(action);
      return jsonRpcResult(id, {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(receipt, null, 2) }],
        structuredContent: receipt
      });
    } catch (error) {
      return jsonRpcResult(id, {
        isError: true,
        content: [{ type: "text", text: "TrustGate evaluation failed: " + error.message }]
      });
    }
  }

  if (isNotification) {
    return null;
  }
  return jsonRpcError(id, -32601, "Method not found: " + method);
}

async function handleMcp(req, res) {
  if (req.method === "GET") {
    json(res, 200, {
      service: "trustgate-mcp",
      protocolVersion: MCP_PROTOCOL_VERSION,
      transport: "streamable-http",
      tools: mcpToolDefinitions().map((tool) => tool.name)
    });
    return;
  }

  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    json(res, 400, jsonRpcError(null, -32700, error.message));
    return;
  }

  if (Array.isArray(body)) {
    const responses = [];
    for (const message of body) {
      const response = await handleMcpMessage(message);
      if (response) responses.push(response);
    }
    if (responses.length === 0) {
      res.writeHead(202, { "Access-Control-Allow-Origin": "*" });
      res.end();
      return;
    }
    json(res, 200, responses);
    return;
  }

  const response = await handleMcpMessage(body);
  if (!response) {
    res.writeHead(202, { "Access-Control-Allow-Origin": "*" });
    res.end();
    return;
  }
  json(res, 200, response);
}

async function router(req, res) {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "GET" && (pathname === "/health" || pathname === "/healthz" || pathname === "/api/healthz")) {
    json(res, 200, { ok: true, service: "trustgate", time: new Date().toISOString() });
    return;
  }

  if (req.method === "GET" && pathname === "/readyz") {
    json(res, 200, readinessReport());
    return;
  }

  if (req.method === "GET" && pathname === "/openapi.json") {
    json(res, 200, openApiSpec(req));
    return;
  }

  if (pathname === "/mcp" && (req.method === "POST" || req.method === "GET")) {
    await handleMcp(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/actions/propose") {
    await proposeAction(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/agent/run") {
    await runGeminiAgent(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/state") {
    json(res, 200, { demo_state: demoState, contract });
    return;
  }

  if (req.method === "GET" && pathname === "/api/fivetran/evidence") {
    json(res, 200, await getFivetranEvidence());
    return;
  }

  if (req.method === "GET" && pathname === "/api/bigquery/evidence") {
    const action = {
      customer_id: url.searchParams.get("customer_id") || "C-1042",
      amount: Number(url.searchParams.get("amount") || 75),
      reason: url.searchParams.get("reason") || "late_delivery",
      customer_tier: url.searchParams.get("customer_tier") || undefined
    };
    json(res, 200, await getBigQueryEvidence(action));
    return;
  }

  if (req.method === "GET" && pathname === "/api/decisions") {
    json(res, 200, { decisions: demoState.decisions });
    return;
  }

  const decisionMatch = pathname.match(/^\/api\/decisions\/([^/]+)$/);
  if (req.method === "GET" && decisionMatch) {
    const decision = demoState.decisions.find((item) => item.decision_id === decisionMatch[1]);
    if (!decision) {
      notFound(res);
      return;
    }
    json(res, 200, decision);
    return;
  }

  const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)$/);
  if (req.method === "POST" && approvalMatch) {
    await approveDecision(req, res, approvalMatch[1]);
    return;
  }

  if (req.method === "POST" && pathname === "/api/demo/reset") {
    resetDemoState();
    json(res, 200, { ok: true, demo_state: demoState });
    return;
  }

  if (req.method === "POST" && pathname === "/api/demo/inject-enum-drift") {
    demoState.customerTier = "retention_experiment";
    demoState.schemaConfigHash = "schema_v2_hash";
    demoState.schemaChangeDetected = true;
    json(res, 200, { ok: true, demo_state: demoState });
    return;
  }

  if (req.method === "POST" && pathname === "/api/demo/inject-stale-sync") {
    demoState.lastSyncMinutesAgo = 42;
    json(res, 200, { ok: true, demo_state: demoState });
    return;
  }

  if (req.method === "POST" && pathname === "/api/demo/inject-critical-failure") {
    demoState.criticalFailure = true;
    demoState.fivetranStatus = "failed";
    json(res, 200, { ok: true, demo_state: demoState });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/")) {
    notFound(res);
    return;
  }

  serveStatic(req, res);
}

const server = http.createServer((req, res) => {
  router(req, res).catch((error) => {
    json(res, 500, { error: error.message });
  });
});

function startServer() {
  server.listen(PORT, () => {
    logStartupConfig();
    console.log(`TrustGate listening on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  contract,
  demoState,
  resetDemoState,
  scoreBreakdown,
  decide,
  readinessReport,
  router,
  server,
  startServer,
  mcpToolDefinitions,
  handleMcpMessage
};
