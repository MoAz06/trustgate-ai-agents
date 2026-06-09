(function () {
  const { useEffect, useMemo, useState } = React;
  const html = htm.bind(React.createElement);
  const DEFAULT_CUSTOMER_TIER = "premium";
  const ENUM_DRIFT_CUSTOMER_TIER = "retention_experiment";

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

  function toneOf(decision) {
    if (decision === "ALLOW") return "allow";
    if (decision === "APPROVAL_REQUIRED") return "approval";
    return "block";
  }

  function glyphOf(decision) {
    if (decision === "ALLOW") return "✓";
    if (decision === "APPROVAL_REQUIRED") return "!";
    return "✕";
  }

  function isLive(source) {
    return typeof source === "string" && source.endsWith("_rest_live");
  }

  function cleanAgentAnswer(answer) {
    return String(answer || "").replace(/\*\*/g, "").replace(/`/g, "").trim();
  }

  function freshnessLabel(bigquery) {
    if (!bigquery || bigquery.freshness_minutes === undefined || bigquery.freshness_minutes === null) {
      return "unknown";
    }
    const sla = bigquery.freshness_sla_minutes;
    const base = `${bigquery.freshness_minutes} min since sync${sla ? ` (SLA ${sla})` : ""}`;
    return bigquery.freshness_simulated ? `${base} - SIMULATED stale` : base;
  }

  function summarizeColumns(columns) {
    if (!columns || !columns.length) return "unknown";
    const important = ["customer_id", "customer_tier", "refund_amount", "last_order_status", "open_ticket_count"];
    const present = important.filter((c) => columns.includes(c));
    if (!present.length) return `${columns.length} columns`;
    return `${columns.length} columns; key: ${present.join(", ")}`;
  }

  function Pill({ live, warn, children }) {
    const cls = "pill" + (live ? " live" : "") + (warn ? " warnpill" : "");
    return html`<span className=${cls}><span className="dot"></span>${children}</span>`;
  }

  function Kv({ k, v, mono, tone }) {
    const cls = "kv-val" + (mono ? " mono" : "") + (tone ? ` ${tone}` : "");
    return html`<div className="kv"><span className="kv-key">${k}</span><span className=${cls}>${v === undefined || v === null || v === "" ? "unknown" : v}</span></div>`;
  }

  function Card({ title, children }) {
    return html`<div className="card"><div className="card-title">${title}</div>${children}</div>`;
  }

  function Trace({ decision }) {
    const ev = decision.evidence;
    const ftLive = isLive(ev.fivetran.source);
    const bqLive = isLive(ev.bigquery.source);
    const tone = toneOf(decision.decision);
    const steps = [
      { n: 1, label: "Agent proposed", sub: `${ev.contract.amount ? "$" + ev.contract.amount : "action"} / ${decision.agent_id || "agent"}`, cls: "ok" },
      { n: 2, label: "Fivetran", sub: ftLive ? "fivetran_rest_live" : ev.fivetran.source, cls: ftLive ? "ok" : "warn" },
      { n: 3, label: "BigQuery", sub: bqLive ? "bigquery_rest_live" : ev.bigquery.source, cls: bqLive ? "ok" : "warn" },
      { n: 4, label: "Policy decided", sub: `${decision.decision} / ${decision.risk_score} pts`, cls: tone === "allow" ? "ok" : tone === "approval" ? "warn" : "bad" }
    ];
    return html`
      <div className="trace">
        ${steps.map((s) => html`
          <div key=${s.n} className=${"trace-step " + s.cls}>
            <div className="step-head">
              <span className="step-num">${s.n}</span>
              <span className="step-label">${s.label}</span>
            </div>
            <span className="step-sub">${s.sub}</span>
          </div>`)}
      </div>`;
  }

  function Banner({ decision }) {
    const tone = toneOf(decision.decision);
    const ev = decision.evidence;
    return html`
      <div className=${"banner " + tone}>
        <div className="banner-top">
          <div className="banner-status">
            <span className="glyph">${glyphOf(decision.decision)}</span>
            ${decision.decision}
          </div>
          <span className="banner-action">Approve refund · $${ev.contract.amount} · ${ev.bigquery.customer_id || "C-1042"}</span>
        </div>
        <p className="banner-reason">${decision.explanation}</p>
        <div className="banner-meta">
          <span><b>Receipt</b> <span className="mono">${decision.decision_id}</span></span>
          <span><b>Contract</b> ${decision.contract_version}</span>
          <span><b>Policy</b> ${decision.policy_version}</span>
          <span><b>Tier</b> ${ev.bigquery.customer_tier}</span>
        </div>
      </div>`;
  }

  function DecisionDetail({ decision, onApprove, busy, devView, setDevView }) {
    const ev = decision.evidence;
    const breakdown = decision.risk_breakdown && decision.risk_breakdown.length
      ? decision.risk_breakdown
      : [{ rule: "none", points: 0 }];
    return html`
      <div className="stack">
        <${Banner} decision=${decision} />
        <${Trace} decision=${decision} />

        <div className="cards-grid">
          <${Card} title="Fivetran REST evidence">
            <${Kv} k="connection" v=${ev.fivetran.connection_id} mono=${true} />
            <${Kv} k="source" v=${ev.fivetran.source} mono=${true} tone=${isLive(ev.fivetran.source) ? "good" : ""} />
            <${Kv} k="sync state" v=${ev.fivetran.sync_state_summary} />
            <${Kv} k="schema change" v=${String(!!ev.fivetran.schema_change_detected)} tone=${ev.fivetran.schema_change_detected ? "warnv" : ""} />
            <${Kv} k="schema hash" v=${ev.fivetran.schema_config_hash} mono=${true} />
          <//>
          <${Card} title="BigQuery row evidence">
            <${Kv} k="source" v=${ev.bigquery.source} mono=${true} tone=${isLive(ev.bigquery.source) ? "good" : ""} />
            <${Kv} k="row tier" v=${ev.bigquery.customer_tier} mono=${true} />
            <${Kv} k="row amount" v=${ev.bigquery.refund_amount ? "$" + ev.bigquery.refund_amount : "unknown"} />
            <${Kv} k="freshness" v=${freshnessLabel(ev.bigquery)} tone=${ev.bigquery.freshness_simulated ? "warnv" : ""} />
            <${Kv} k="columns" v=${summarizeColumns(ev.bigquery.available_columns)} />
          <//>
          ${ev.fivetran_mcp ? html`
          <${Card} title="Fivetran MCP (partner server)">
            <${Kv} k="source" v=${ev.fivetran_mcp.source} mono=${true} tone=${ev.fivetran_mcp.source === "fivetran_mcp_live" ? "good" : ""} />
            <${Kv} k="server" v=${ev.fivetran_mcp.server || "github.com/fivetran/fivetran-mcp"} />
            <${Kv} k="tools" v=${(ev.fivetran_mcp.tools || [ev.fivetran_mcp.tool]).filter(Boolean).join(", ") || "-"} mono=${true} />
            <${Kv} k="connection seen" v=${ev.fivetran_mcp.source === "fivetran_mcp_live" ? String(!!ev.fivetran_mcp.target_connection_present) : "-"} tone=${ev.fivetran_mcp.target_connection_present ? "good" : ""} />
            <${Kv} k="details verified" v=${ev.fivetran_mcp.details_verified === undefined ? "-" : String(!!ev.fivetran_mcp.details_verified)} tone=${ev.fivetran_mcp.details_verified ? "good" : ""} />
          <//>` : null}
          <${Card} title="Contract diff">
            <${Kv} k="allowed tiers" v=${(ev.contract.allowed_customer_tiers || []).join(", ")} />
            <${Kv} k="observed" v=${ev.contract.observed_customer_tier} mono=${true} tone=${(ev.contract.allowed_customer_tiers || []).includes(ev.contract.observed_customer_tier) ? "good" : "warnv"} />
            <${Kv} k="amount" v=${"$" + ev.contract.amount} />
            <${Kv} k="version" v=${decision.contract_version} />
          <//>
          <${Card} title=${`Risk breakdown · ${decision.risk_score} pts`}>
            ${breakdown.map((item, i) => html`
              <div key=${i} className=${"kv risk-row" + (item.points ? "" : " zero")}>
                <span className="kv-key mono">${item.rule}</span>
                <span className="kv-val">${item.points} pts</span>
              </div>`)}
          <//>
        </div>

        ${decision.decision === "APPROVAL_REQUIRED"
          ? html`<div className="receipt-actions">
              <button className="primary" disabled=${busy} onClick=${() => onApprove(decision)}>Conditional approve under $50</button>
            </div>`
          : null}

        <div className="dev-toggle">
          <button className="ghost tiny" onClick=${() => setDevView(!devView)}>
            ${devView ? "Hide developer view" : "Show developer view (raw receipt)"}
          </button>
        </div>
        ${devView ? html`<pre>${JSON.stringify(decision, null, 2)}</pre>` : null}
        ${devView && decision.human_approval ? html`<pre>${JSON.stringify(decision.human_approval, null, 2)}</pre>` : null}
      </div>`;
  }

  function AgentRunDetail({ agentRun }) {
    const r = agentRun.trustgate_receipt;
    const sent = agentRun.function_call_sent_to_trustgate;
    return html`
      <div className="stack">
        <div className="cards-grid">
          <${Card} title="Gemini function call">
            <${Kv} k="model" v=${agentRun.model} mono=${true} />
            <${Kv} k="tool" v=${agentRun.function_call_requested.name} mono=${true} />
            <${Kv} k="customer" v=${sent.customer_id} mono=${true} />
            <${Kv} k="amount" v=${"$" + sent.amount} />
            <${Kv} k="reason" v=${sent.reason} />
          <//>
          <${Card} title="TrustGate evidence passed back">
            <${Kv} k="decision" v=${r.decision} tone=${toneOf(r.decision) === "allow" ? "good" : "warnv"} />
            <${Kv} k="receipt" v=${r.decision_id} mono=${true} />
            <${Kv} k="Fivetran" v=${r.evidence.fivetran.source} mono=${true} tone=${isLive(r.evidence.fivetran.source) ? "good" : ""} />
            <${Kv} k="BigQuery" v=${r.evidence.bigquery.source} mono=${true} tone=${isLive(r.evidence.bigquery.source) ? "good" : ""} />
          <//>
        </div>
        <div>
          <div className="subtle-label">Gemini final answer</div>
          <p className="agent-answer">${cleanAgentAnswer(agentRun.final_answer) || "Gemini returned no text."}</p>
        </div>
      </div>`;
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
    const [devView, setDevView] = useState(false);
    const [scenarioCustomerTier, setScenarioCustomerTier] = useState("");

    const selected = useMemo(
      () => decisions.find((item) => item.decision_id === selectedId) || decisions[0],
      [decisions, selectedId]
    );

    const ftSource = selected && selected.evidence.fivetran.source;
    const bqSource = selected && selected.evidence.bigquery.source;
    const mcpLive = Boolean(selected && selected.evidence.fivetran_mcp && selected.evidence.fivetran_mcp.source === "fivetran_mcp_live");
    const approvalActive = Boolean(activeApproval || (state && state.activeApproval));
    const activeCustomerTier = scenarioCustomerTier ||
      (state && state.customerTier && state.customerTier !== DEFAULT_CUSTOMER_TIER ? state.customerTier : "");

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
            customer_tier: body.customer_tier || activeCustomerTier || undefined,
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
            customer_tier: body.customer_tier || activeCustomerTier || undefined,
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
        if (path.includes("/api/demo/reset")) {
          setActiveApproval(null);
          setScenarioCustomerTier("");
        }
        await refresh();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    }

    async function simulateEnumDrift() {
      setScenarioCustomerTier(ENUM_DRIFT_CUSTOMER_TIER);
      await mutate("/api/demo/inject-enum-drift");
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

    return html`
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <div className="mark">TG</div>
            <div>
              <div className="brand-name">TrustGate</div>
              <div className="brand-sub">Runtime authorization for AI-agent actions</div>
            </div>
          </div>
          <div className="status-strip">
            <${Pill}>${agentRun ? agentRun.model : "gemini-3.5-flash"}<//>
            <${Pill} live=${isLive(ftSource)}>Fivetran REST ${selected ? (isLive(ftSource) ? "live" : ftSource) : "ready"}<//>
            <${Pill} live=${mcpLive}>Fivetran MCP ${selected ? (mcpLive ? "live" : "-") : "ready"}<//>
            <${Pill} live=${isLive(bqSource)}>BigQuery ${selected ? (isLive(bqSource) ? "live" : bqSource) : "ready"}<//>
            <${Pill}>Policy deterministic<//>
            <${Pill} warn=${approvalActive}>${approvalActive ? "Scoped approval active" : "No scoped approval"}<//>
          </div>
        </header>

        <main className="layout">
          <aside className="panel">
            <div className="panel-header"><h2 className="panel-title">Action Console</h2></div>
            <div className="panel-body stack">
              <label className="field">
                <span>Refund amount (USD)</span>
                <input type="number" value=${amount} min="1" onChange=${(e) => setAmount(e.target.value)} />
              </label>
              <div className="button-grid">
                <button className="primary" disabled=${busy} onClick=${() => runAgent(Number(amount) > 100 ? "service_failure" : "late_delivery", { amount })}>Run Gemini agent</button>
                <button disabled=${busy} onClick=${() => run("late_delivery", { amount })}>Run policy only</button>
              </div>
              <div className="group-label">Simulate data-supply-chain events</div>
              <div className="button-grid">
                <button className="warn" disabled=${busy} onClick=${simulateEnumDrift}>Simulate new customer tier</button>
                <button disabled=${busy} onClick=${() => mutate("/api/demo/inject-stale-sync")}>Simulate stale sync</button>
                <button className="danger" disabled=${busy} onClick=${() => mutate("/api/demo/inject-critical-failure")}>Simulate schema failure</button>
                <button disabled=${busy} onClick=${() => mutate("/api/demo/reset")}>Reset demo</button>
              </div>
              ${activeCustomerTier ? html`<div className="scenario-tag">Next action tier: <span className="mono">${activeCustomerTier}</span></div>` : null}
              ${busy ? html`<div className="busy-tag"><span className="spinner"></span> Evaluating policy…</div>` : null}
              ${error ? html`<div className="error-banner">${error}</div>` : null}
              <div className="legend">
                <div className="legend-row"><span className="dot allow"></span> ALLOW - data is trusted, action proceeds</div>
                <div className="legend-row"><span className="dot approval"></span> APPROVAL_REQUIRED - routed to a human</div>
                <div className="legend-row"><span className="dot block"></span> BLOCK - broken supply chain, action stopped</div>
              </div>
            </div>
          </aside>

          <section className="col">
            <div className="panel">
              <div className="panel-header">
                <h2 className="panel-title">Decision</h2>
                ${busy ? html`<span className="busy-tag"><span className="spinner"></span> evaluating</span>` : null}
              </div>
              <div className="panel-body">
                ${selected
                  ? html`<${DecisionDetail} decision=${selected} onApprove=${approve} busy=${busy} devView=${devView} setDevView=${setDevView} />`
                  : html`<div className="empty"><h3>No decision yet</h3><div>Set a refund amount and run the Gemini agent. The decision, evidence trace, and receipt appear here.</div></div>`}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header"><h2 className="panel-title">Gemini Agent Run</h2></div>
              <div className="panel-body">
                ${agentRun
                  ? html`<${AgentRunDetail} agentRun=${agentRun} />`
                  : html`<div className="empty"><h3>No Gemini run yet</h3><div>Run the agent to see the tool call, the TrustGate receipt it received, and Gemini's explanation.</div></div>`}
              </div>
            </div>
          </section>

          <aside className="panel right-rail">
            <div className="panel-header"><h2 className="panel-title">Decision History</h2></div>
            <div className="panel-body">
              <div className="queue">
                ${decisions.length
                  ? decisions.map((d) => html`
                      <button key=${d.decision_id} className=${"queue-item" + (selected && d.decision_id === selected.decision_id ? " active" : "")} onClick=${() => setSelectedId(d.decision_id)}>
                        <div className="row1">
                          <span className=${"badge " + toneOf(d.decision)}>${d.decision}</span>
                          <span className="pts">${d.risk_score} pts</span>
                        </div>
                        <span className="tier">${d.evidence.contract.observed_customer_tier} · $${d.evidence.contract.amount}</span>
                        <span className="ts">${new Date(d.created_at).toLocaleTimeString()}</span>
                      </button>`)
                  : html`<div className="empty"><div>Receipts appear here after each action.</div></div>`}
              </div>
            </div>
          </aside>
        </main>
      </div>`;
  }

  ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);
})();
