(function () {
  const e = React.createElement;
  const { useEffect, useMemo, useState } = React;

  async function api(path, options) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Request failed: ${response.status}`);
    }
    return payload;
  }

  function badgeClass(decision) {
    if (decision === "ALLOW") return "badge allow";
    if (decision === "APPROVAL_REQUIRED") return "badge approval";
    return "badge block";
  }

  function App() {
    const [decisions, setDecisions] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [state, setState] = useState(null);
    const [amount, setAmount] = useState(75);
    const [activeApproval, setActiveApproval] = useState(null);
    const [agentRun, setAgentRun] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const selected = useMemo(
      () => decisions.find((item) => item.decision_id === selectedId) || decisions[0],
      [decisions, selectedId]
    );
    const fivetranLive = selected && selected.evidence.fivetran.source === "fivetran_rest_live";
    const bigQueryLive = selected && selected.evidence.bigquery.source === "bigquery_rest_live";

    async function refresh() {
      const [decisionPayload, statePayload] = await Promise.all([
        api("/api/decisions"),
        api("/api/state")
      ]);
      setDecisions(decisionPayload.decisions);
      setState(statePayload.demo_state);
      if (statePayload.demo_state && statePayload.demo_state.activeApproval) {
        setActiveApproval(statePayload.demo_state.activeApproval);
      }
      if (!selectedId && decisionPayload.decisions[0]) {
        setSelectedId(decisionPayload.decisions[0].decision_id);
      }
    }

    async function run(label, body) {
      setBusy(true);
      setError("");
      try {
        const receipt = await api("/api/actions/propose", {
          method: "POST",
          body: JSON.stringify({
            agent_id: "customer_recovery_agent",
            action_type: "approve_refund",
            customer_id: "C-1042",
            amount: Number(body.amount || amount),
            reason: label,
            customer_tier: body.customer_tier,
            approval: activeApproval
          })
        });
        await refresh();
        setSelectedId(receipt.decision_id);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    }

    async function runAgent(label, body) {
      setBusy(true);
      setError("");
      try {
        const payload = await api("/api/agent/run", {
          method: "POST",
          body: JSON.stringify({
            agent_id: "customer_recovery_agent",
            action_type: "approve_refund",
            customer_id: "C-1042",
            amount: Number(body.amount || amount),
            reason: label,
            customer_tier: body.customer_tier,
            approval: activeApproval
          })
        });
        setAgentRun(payload);
        await refresh();
        setSelectedId(payload.trustgate_receipt.decision_id);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    }

    async function mutate(path) {
      setBusy(true);
      setError("");
      try {
        await api(path, { method: "POST", body: "{}" });
        if (path.includes("/api/demo/reset")) setActiveApproval(null);
        await refresh();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    }

    async function approve(decision) {
      setBusy(true);
      setError("");
      try {
        const payload = await api(`/api/approvals/${decision.decision_id}`, {
          method: "POST",
          body: JSON.stringify({
            max_amount: 50,
            allowed_customer_tier: decision.evidence.bigquery.customer_tier,
            rationale: "Allow refunds under $50 until contract v2 is reviewed."
          })
        });
        setActiveApproval(payload.approval);
        await refresh();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    }

    useEffect(() => {
      refresh().catch((err) => setError(err.message));
    }, []);

    return e("div", { className: "app" },
      e("header", { className: "topbar" },
        e("div", { className: "brand" },
          e("div", { className: "mark" }, "TG"),
          e("div", null, "TrustGate for AI Agents")
        ),
        e("div", { className: "status-strip" },
          e("span", null, agentRun ? `Gemini: ${agentRun.model}` : "Gemini: 3.5 Flash"),
          e("span", null, "|"),
          e("span", null, selected ? `Fivetran: ${fivetranLive ? "live" : selected.evidence.fivetran.source}` : "Fivetran: waiting"),
          e("span", null, "|"),
          e("span", null, selected ? `BigQuery: ${bigQueryLive ? "live" : selected.evidence.bigquery.source}` : "BigQuery: waiting"),
          e("span", null, "|"),
          e("span", null, "Policy: deterministic"),
          e("span", null, "|"),
          e("span", null, activeApproval || (state && state.activeApproval) ? "Scoped approval active" : "No scoped approval")
        )
      ),
      e("main", { className: "layout" },
        e("aside", { className: "panel" },
          e("div", { className: "panel-header" }, e("h2", null, "Action Console")),
          e("div", { className: "panel-body stack" },
            e("label", { className: "field" },
              e("span", null, "Refund amount"),
              e("input", {
                type: "number",
                value: amount,
                min: 1,
                onChange: (event) => setAmount(event.target.value)
              })
            ),
            e("div", { className: "button-grid" },
              e("button", {
                className: "primary",
                disabled: busy,
                onClick: () => runAgent(Number(amount) > 100 ? "service_failure" : "late_delivery", { amount })
              }, "Run Gemini agent"),
              e("button", {
                disabled: busy,
                onClick: () => run("late_delivery", { amount })
              }, "Run policy only"),
              e("button", {
                className: "warn",
                disabled: busy,
                onClick: () => mutate("/api/demo/inject-enum-drift")
              }, "Simulate new customer tier"),
              e("button", {
                disabled: busy,
                onClick: () => mutate("/api/demo/inject-stale-sync")
              }, "Simulate stale sync"),
              e("button", {
                className: "danger",
                disabled: busy,
                onClick: () => mutate("/api/demo/inject-critical-failure")
              }, "Simulate schema failure"),
              e("button", {
                disabled: busy,
                onClick: () => mutate("/api/demo/reset")
              }, "Reset demo")
            ),
            error ? e("div", { className: "badge block" }, error) : null
          )
        ),
        e("section", { className: "main-grid" },
          e("div", { className: "panel" },
            e("div", { className: "panel-header" },
              e("h2", null, "Decision Detail"),
              selected ? e("span", { className: badgeClass(selected.decision) }, selected.decision) : null
            ),
            e("div", { className: "panel-body" },
              selected ? e(DecisionDetail, { decision: selected, onApprove: approve, busy }) : e("div", { className: "empty" }, "No receipt selected yet. New decisions will show policy, Fivetran, BigQuery, and contract evidence here.")
            )
          ),
          e("div", { className: "panel" },
            e("div", { className: "panel-header" }, e("h2", null, "Gemini Agent Run")),
            e("div", { className: "panel-body" },
              agentRun ? e(AgentRunDetail, { agentRun }) : e("div", { className: "empty" }, "No Gemini run yet. The agent trace will show the tool request, TrustGate receipt, and final explanation.")
            )
          ),
          e("div", { className: "panel" },
            e("div", { className: "panel-header" }, e("h2", null, "Audit Receipt JSON")),
            e("div", { className: "panel-body" },
              selected ? e("pre", null, JSON.stringify(selected, null, 2)) : e("pre", null, "{}")
            )
          )
        ),
        e("aside", { className: "panel right-rail" },
          e("div", { className: "panel-header" }, e("h2", null, "Action Queue")),
          e("div", { className: "panel-body decision-list" },
            decisions.length
              ? decisions.map((decision) => e("button", {
                key: decision.decision_id,
                className: `decision-item ${decision.decision_id === (selected && selected.decision_id) ? "active" : ""}`,
                onClick: () => setSelectedId(decision.decision_id)
              },
                e("div", { className: "meta-row" },
                  e("span", { className: badgeClass(decision.decision) }, decision.decision),
                  e("span", { className: "muted" }, `${decision.risk_score} rule points`)
                ),
                e("div", null, decision.evidence.contract.observed_customer_tier),
                e("small", { className: "muted" }, new Date(decision.created_at).toLocaleString())
              ))
              : e("div", { className: "empty" }, "Receipts will appear here after each proposed action.")
          )
        )
      )
    );
  }

  function DecisionDetail({ decision, onApprove, busy }) {
    const evidence = decision.evidence;
    return e("div", { className: "hero-decision" },
      e("div", { className: "decision-title" },
        e("h1", null, "Approve refund"),
        e("span", { className: badgeClass(decision.decision) }, decision.decision)
      ),
      e("p", { className: "muted" }, decision.explanation),
      e("div", { className: "metric-grid" },
        e(Metric, { label: "Customer tier", value: evidence.contract.observed_customer_tier }),
        e(Metric, { label: "Rule score", value: `${decision.risk_score} rule points` }),
        e(Metric, { label: "Fivetran source", value: evidence.fivetran.source }),
        e(Metric, { label: "BigQuery source", value: evidence.bigquery.source })
      ),
      e("div", { className: "evidence-grid" },
        e(EvidenceBox, {
          title: "Fivetran REST Evidence",
          rows: [
            ["connection", evidence.fivetran.connection_id],
            ["sync", evidence.fivetran.sync_state_summary],
            ["schema hash", evidence.fivetran.schema_config_hash],
            ["schema status", schemaStatusLabel(evidence.fivetran)],
            ["schema handling", evidence.fivetran.schema_change_handling],
            ["API refs", summarizeRefs(evidence.fivetran.raw_refs)]
          ]
        }),
        e(EvidenceBox, {
          title: "BigQuery Row Evidence",
          rows: [
            ["source", evidence.bigquery.source],
            ["table", evidence.bigquery.table],
            ["row tier", evidence.bigquery.customer_tier],
            ["row amount", evidence.bigquery.refund_amount ? `$${evidence.bigquery.refund_amount}` : "unknown"],
            ["selected by", evidence.bigquery.selected_by],
            ["columns", summarizeColumns(evidence.bigquery.available_columns)],
            ["warning", evidence.bigquery.mapping_warning || "none"]
          ]
        })
      ),
      e("div", { className: "evidence-grid" },
        e(EvidenceBox, {
          title: "Contract Diff",
          rows: [
            ["allowed", evidence.contract.allowed_customer_tiers.join(", ")],
            ["observed", evidence.contract.observed_customer_tier],
            ["amount", `$${evidence.contract.amount}`],
            ["version", decision.contract_version]
          ]
        }),
        e(EvidenceBox, {
          title: "Risk Breakdown",
          rows: decision.risk_breakdown.length
            ? decision.risk_breakdown.map((item) => [item.rule, `${item.points} points`])
            : [["none", "0 points"]]
        }),
        e(EvidenceBox, {
          title: "Policy Result",
          rows: [
            ["decision", decision.decision],
            ["policy", decision.policy_version],
            ["approval applied", String(decision.approval_applied)]
          ]
        })
      ),
      decision.decision === "APPROVAL_REQUIRED"
        ? e("div", { className: "receipt-actions" },
          e("button", { className: "primary", disabled: busy, onClick: () => onApprove(decision) }, "Conditional approve under $50")
        )
        : null,
      decision.human_approval
        ? e("pre", null, JSON.stringify(decision.human_approval, null, 2))
        : null
    );
  }

  function AgentRunDetail({ agentRun }) {
    return e("div", { className: "stack" },
      e("div", { className: "metric-grid" },
        e(Metric, { label: "Model", value: agentRun.model }),
        e(Metric, { label: "Tool requested", value: agentRun.function_call_requested.name }),
        e(Metric, { label: "TrustGate decision", value: agentRun.trustgate_receipt.decision }),
        e(Metric, { label: "Auth source", value: agentRun.auth_source })
      ),
      e("div", { className: "evidence-grid" },
        e(EvidenceBox, {
          title: "Gemini Function Call",
          rows: [
            ["agent_id", agentRun.function_call_sent_to_trustgate.agent_id],
            ["action", agentRun.function_call_sent_to_trustgate.action_type],
            ["customer", agentRun.function_call_sent_to_trustgate.customer_id],
            ["amount", `$${agentRun.function_call_sent_to_trustgate.amount}`],
            ["reason", agentRun.function_call_sent_to_trustgate.reason]
          ]
        }),
        e(EvidenceBox, {
          title: "TrustGate Evidence Passed Back",
          rows: [
            ["receipt", agentRun.trustgate_receipt.decision_id],
            ["Fivetran", agentRun.trustgate_receipt.evidence.fivetran.source],
            ["BigQuery", agentRun.trustgate_receipt.evidence.bigquery.source],
            ["rule score", `${agentRun.trustgate_receipt.risk_score} points`]
          ]
        })
      ),
      e("div", { className: "metric" },
        e("div", { className: "label" }, "Gemini Final Answer"),
        e("p", { className: "agent-answer" }, cleanAgentAnswer(agentRun.final_answer) || "Gemini returned no text.")
      )
    );
  }

  function cleanAgentAnswer(answer) {
    return String(answer || "")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .trim();
  }

  function schemaStatusLabel(fivetran) {
    if (fivetran.source !== "fivetran_rest_live") {
      return "demo schema signal";
    }
    return "config captured from REST";
  }

  function summarizeRefs(refs) {
    if (!refs || !refs.length) return "unknown";
    return `${refs.length} Fivetran REST endpoints`;
  }

  function summarizeColumns(columns) {
    if (!columns || !columns.length) return "unknown";
    const important = ["customer_id", "customer_tier", "refund_amount", "last_order_status", "open_ticket_count"];
    const present = important.filter((column) => columns.includes(column));
    if (!present.length) return `${columns.length} columns`;
    return `${columns.length} columns; key fields: ${present.join(", ")}`;
  }

  function Metric({ label, value }) {
    return e("div", { className: "metric" },
      e("div", { className: "label" }, label),
      e("div", { className: "value" }, value || "unknown")
    );
  }

  function EvidenceBox({ title, rows }) {
    return e("div", { className: "metric" },
      e("div", { className: "label" }, title),
      e("div", { className: "stack", style: { marginTop: 8 } },
        rows.map(([key, value]) => e("div", { key, className: "meta-row" },
          e("span", { className: "muted" }, key),
          e("strong", null, value || "unknown")
        ))
      )
    );
  }

  ReactDOM.createRoot(document.getElementById("root")).render(e(App));
})();
