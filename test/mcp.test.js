process.env.TRUSTGATE_SKIP_DOTENV = "1";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resetDemoState,
  mcpToolDefinitions,
  handleMcpMessage
} = require("../server.js");

test("mcpToolDefinitions exposes proposeTrustGateAction with an input schema", () => {
  const tools = mcpToolDefinitions();

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "proposeTrustGateAction");
  assert.equal(tools[0].inputSchema.type, "object");
  assert.deepEqual(
    tools[0].inputSchema.required,
    ["agent_id", "action_type", "customer_id", "amount", "reason"]
  );
});

test("initialize returns a protocol version and tool capability", async () => {
  const response = await handleMcpMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" }
  });

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, 1);
  assert.equal(response.result.protocolVersion, "2025-06-18");
  assert.ok(response.result.capabilities.tools);
  assert.equal(response.result.serverInfo.name, "trustgate-mcp");
});

test("tools/list returns the TrustGate tool", async () => {
  const response = await handleMcpMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list"
  });

  assert.equal(response.result.tools[0].name, "proposeTrustGateAction");
});

test("tools/call evaluates a refund and returns a receipt as structured content", async () => {
  resetDemoState();

  const response = await handleMcpMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "proposeTrustGateAction",
      arguments: {
        agent_id: "customer_recovery_agent",
        action_type: "approve_refund",
        customer_id: "C-1042",
        amount: 75,
        reason: "late_delivery"
      }
    }
  });

  assert.equal(response.result.isError, false);
  assert.ok(["ALLOW", "APPROVAL_REQUIRED", "BLOCK"].includes(response.result.structuredContent.decision));
  assert.ok(response.result.content[0].text.includes("decision"));
});

test("tools/call rejects an unknown tool without throwing", async () => {
  const response = await handleMcpMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "deleteEverything", arguments: {} }
  });

  assert.equal(response.result.isError, true);
});

test("notifications produce no response body", async () => {
  const response = await handleMcpMessage({
    jsonrpc: "2.0",
    method: "notifications/initialized"
  });

  assert.equal(response, null);
});

test("unknown method returns a JSON-RPC method-not-found error", async () => {
  const response = await handleMcpMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "resources/list"
  });

  assert.equal(response.error.code, -32601);
});
