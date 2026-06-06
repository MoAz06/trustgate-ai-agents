import json
import urllib.request

import vertexai
from vertexai.generative_models import FunctionDeclaration, GenerativeModel, Part, Tool


PROJECT_ID = "trustgate-hackathon"
LOCATION = "us-central1"
MODEL_NAME = "gemini-3.5-flash"
TRUSTGATE_URL = "https://trustgate-24801890031.us-central1.run.app/api/actions/propose"


SYSTEM_INSTRUCTION = """
You are a customer recovery agent. You may review customer refund requests, but you must never approve a refund directly.

Before any refund decision, call the TrustGate tool proposeTrustGateAction with:
- agent_id
- action_type = approve_refund
- customer_id
- amount
- reason

After TrustGate responds:
- If decision is ALLOW, say the refund can proceed and cite the TrustGate receipt id.
- If decision is APPROVAL_REQUIRED, explain that human approval is required and cite the risk breakdown.
- If decision is BLOCK, explain that the action is blocked because the data supply-chain evidence is not trusted.

Always mention the Fivetran evidence source and connection id from the receipt.
Do not invent policy decisions. TrustGate decides; you explain.
""".strip()


def post_trustgate(payload):
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        TRUSTGATE_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def first_function_call(response):
    for candidate in response.candidates:
        for part in candidate.content.parts:
            if part.function_call:
                return part.function_call
    return None


def main():
    vertexai.init(project=PROJECT_ID, location=LOCATION)

    trustgate_function = FunctionDeclaration(
        name="proposeTrustGateAction",
        description="Ask TrustGate whether a proposed customer refund action is allowed, requires human approval, or must be blocked.",
        parameters={
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "Identifier of the Gemini agent proposing the action.",
                },
                "action_type": {
                    "type": "string",
                    "enum": ["approve_refund"],
                    "description": "The business action being proposed.",
                },
                "customer_id": {
                    "type": "string",
                    "description": "Customer id for the refund request.",
                },
                "amount": {
                    "type": "number",
                    "description": "Refund amount in USD.",
                },
                "reason": {
                    "type": "string",
                    "description": "Reason for the proposed refund.",
                },
            },
            "required": ["agent_id", "action_type", "customer_id", "amount", "reason"],
        },
    )

    model = GenerativeModel(
        MODEL_NAME,
        system_instruction=SYSTEM_INSTRUCTION,
        tools=[Tool(function_declarations=[trustgate_function])],
    )

    prompt = (
        "Review customer C-1042. The customer is angry because of a late delivery. "
        "Consider a $75 refund and ask TrustGate whether the action is allowed."
    )

    first_response = model.generate_content(prompt)
    function_call = first_function_call(first_response)

    if not function_call:
        print("No function call was requested.")
        print(first_response.text)
        return

    print(f"Function call requested: {function_call.name}")
    tool_args = dict(function_call.args)
    tool_args.setdefault("agent_id", "customer_recovery_agent")
    tool_args.setdefault("action_type", "approve_refund")

    trustgate_response = post_trustgate(tool_args)
    fivetran = trustgate_response["evidence"]["fivetran"]

    print(f"TrustGate decision: {trustgate_response['decision']}")
    print(f"Fivetran source: {fivetran['source']}")
    print(f"Fivetran connection: {fivetran['connection_id']}")

    final_response = model.generate_content(
        [
            prompt,
            first_response.candidates[0].content,
            Part.from_function_response(
                name=function_call.name,
                response={"content": trustgate_response},
            ),
        ]
    )

    print("\nAgent final answer:")
    print(final_response.text)


if __name__ == "__main__":
    main()
