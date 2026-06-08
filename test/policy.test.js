process.env.TRUSTGATE_SKIP_DOTENV = "1";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  demoState,
  resetDemoState,
  scoreBreakdown,
  decide,
  readinessReport
} = require("../server.js");

function liveFivetran(overrides = {}) {
  return {
    source: "fivetran_rest_live",
    connection_id: "fulfill_pageant",
    connection_id_source: "env",
    service: "google_sheets",
    setup_state: "connected",
    sync_state_summary: "scheduled",
    last_successful_sync: null,
    schema_change_detected: true,
    schema_config_hash: "94355a9a3a12a6dd",
    schema_change_handling: "ALLOW_ALL",
    optional_call_status: {
      state: "Fivetran /v1/connections/fulfill_pageant/state returned 405: HTTP 405 Method Not Allowed",
      schemas: "ok"
    },
    raw_refs: [
      "/v1/connections/fulfill_pageant",
      "/v1/connections/fulfill_pageant/state",
      "/v1/connections/fulfill_pageant/schemas"
    ],
    ...overrides
  };
}

function liveBigQuery(overrides = {}) {
  return {
    source: "bigquery_rest_live",
    query_id: "job_test",
    table: "trustgate-hackathon.trustgate_demo.customers",
    customer_id: "C-1042",
    customer_tier: "premium",
    open_ticket_count: 1,
    last_order_status: "late_delivery",
    refund_amount: 75,
    reason: "late_delivery",
    demo_note: "Safe baseline row",
    total_rows: 3,
    selected_by: "target_tier=premium; amount=75",
    auth_source: "cloud_run_metadata",
    available_columns: [
      "_row",
      "_fivetran_synced",
      "customer_id",
      "reason",
      "customer_tier",
      "refund_amount",
      "last_order_status",
      "open_ticket_count",
      "demo_note"
    ],
    observed_enum_values: ["standard", "premium", "enterprise"],
    mapping_warning: null,
    ...overrides
  };
}

function refundAction(overrides = {}) {
  return {
    agent_id: "customer_recovery_agent",
    action_type: "approve_refund",
    customer_id: "C-1042",
    amount: 75,
    reason: "late_delivery",
    ...overrides
  };
}

function rules(receipt) {
  return receipt.risk_breakdown.map((item) => item.rule);
}

test("allows a baseline refund when Fivetran and BigQuery evidence are live", () => {
  resetDemoState();

  const receipt = decide(refundAction(), liveFivetran(), liveBigQuery());

  assert.equal(receipt.decision, "ALLOW");
  assert.equal(receipt.risk_score, 0);
  assert.deepEqual(receipt.risk_breakdown, []);
  assert.equal(receipt.evidence.fivetran.source, "fivetran_rest_live");
  assert.equal(receipt.evidence.bigquery.source, "bigquery_rest_live");
});

test("keeps Fivetran /state 405 optional for this connector", () => {
  resetDemoState();

  const receipt = decide(refundAction(), liveFivetran(), liveBigQuery());

  assert.equal(receipt.decision, "ALLOW");
  assert.match(receipt.evidence.fivetran.optional_call_status.state, /405/);
  assert.deepEqual(receipt.violations, []);
});

test("requires approval for a high refund even when the data evidence is live", () => {
  resetDemoState();

  const receipt = decide(refundAction({ amount: 150 }), liveFivetran(), liveBigQuery());

  assert.equal(receipt.decision, "APPROVAL_REQUIRED");
  assert.deepEqual(rules(receipt), ["high_refund_amount"]);
  assert.equal(receipt.risk_score, 20);
});

test("applies a scoped approval under $50 and keeps larger refunds gated", () => {
  resetDemoState();
  const scopedApproval = {
    approval_id: "appr_test",
    max_amount: 50,
    allowed_customer_tier: "retention_experiment",
    expires_at: new Date(Date.now() + 60_000).toISOString()
  };
  const driftedCustomer = liveBigQuery({
    customer_tier: "retention_experiment",
    observed_enum_values: ["standard", "premium", "enterprise", "retention_experiment"]
  });

  const smallRefund = decide(
    refundAction({ amount: 40, approval: scopedApproval }),
    liveFivetran(),
    driftedCustomer
  );
  const largeRefund = decide(
    refundAction({ amount: 480, approval: scopedApproval }),
    liveFivetran(),
    driftedCustomer
  );

  assert.equal(smallRefund.decision, "ALLOW");
  assert.equal(smallRefund.approval_applied, true);
  assert.deepEqual(rules(smallRefund), ["conditional_approval_applied"]);

  assert.equal(largeRefund.decision, "APPROVAL_REQUIRED");
  assert.equal(largeRefund.approval_applied, false);
  assert.deepEqual(rules(largeRefund), ["unseen_customer_tier_enum", "high_refund_amount"]);
});

test("flags a stale Fivetran sync from the BigQuery freshness signal", () => {
  resetDemoState();
  const staleRow = liveBigQuery({ freshness_minutes: 42, freshness_sla_minutes: 15 });

  const receipt = decide(refundAction(), liveFivetran(), staleRow);

  assert.equal(receipt.decision, "ALLOW");
  assert.ok(rules(receipt).includes("stale_sync_supporting_signal"));
  assert.equal(receipt.risk_score, 10);
});

test("does not flag freshness when the BigQuery sync age is within SLA", () => {
  resetDemoState();
  const freshRow = liveBigQuery({ freshness_minutes: 5, freshness_sla_minutes: 15 });

  const receipt = decide(refundAction(), liveFivetran(), freshRow);

  assert.equal(receipt.decision, "ALLOW");
  assert.deepEqual(rules(receipt), []);
});

test("blocks when a critical schema failure is injected", () => {
  resetDemoState();
  demoState.criticalFailure = true;

  const receipt = decide(refundAction(), liveFivetran(), liveBigQuery());

  assert.equal(receipt.decision, "BLOCK");
  assert.deepEqual(rules(receipt), ["required_schema_break"]);
  assert.equal(receipt.risk_score, 100);

  resetDemoState();
});

test("risk_score is the sum of transparent rule weights", () => {
  resetDemoState();
  const breakdown = scoreBreakdown(["unseen_customer_tier_enum", "high_refund_amount"]);
  const summed = breakdown.reduce((sum, item) => sum + item.points, 0);

  assert.deepEqual(breakdown, [
    { rule: "unseen_customer_tier_enum", points: 40 },
    { rule: "high_refund_amount", points: 20 }
  ]);
  assert.equal(summed, 60);
});

test("readiness report returns config status without secret values", () => {
  resetDemoState();

  const report = readinessReport();

  assert.equal(report.ok, true);
  assert.equal(report.service, "trustgate");
  assert.equal(report.checks.vertex_gemini.model, "gemini-3.5-flash");
  assert.ok(Array.isArray(report.checks.fivetran_rest.missing_env));
  assert.ok(Object.keys(report.checks).includes("bigquery"));
});
