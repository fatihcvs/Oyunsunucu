import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ASSISTANT_MODEL, createOpenAiAssistantModel } from "../lib/assistant-service.ts";

function fakeClient(response) {
  const calls = [];
  return {
    calls,
    client: {
      responses: {
        async create(request) {
          calls.push(request);
          return response;
        },
      },
    },
  };
}

const TOOLS = [
  {
    name: "change_plan",
    description: "Paketi büyütmeyi önerir.",
    parameters: { type: "object", properties: { multiplier: { type: "number" } } },
  },
];

test("the system prompt travels as instructions and tools keep their JSON Schema", async () => {
  const { client, calls } = fakeClient({ output: [], output_text: "Tamam." });
  const model = createOpenAiAssistantModel({ apiKey: "test", client });

  await model.propose({ system: "SISTEM", userMessage: "merhaba", tools: TOOLS });

  const request = calls[0];
  assert.equal(request.model, DEFAULT_ASSISTANT_MODEL);
  assert.equal(request.instructions, "SISTEM");
  assert.deepEqual(request.input, [{ role: "user", content: "merhaba" }]);
  assert.equal(request.tools[0].type, "function");
  assert.equal(request.tools[0].name, "change_plan");
  assert.deepEqual(request.tools[0].parameters, TOOLS[0].parameters);
});

test("a function call is read from the output array and its arguments parsed", async () => {
  const { client } = fakeClient({
    output: [
      { type: "reasoning", summary: [] },
      { type: "function_call", name: "change_plan", arguments: '{"multiplier":2}', call_id: "c1" },
    ],
    output_text: "Önerim var.",
  });
  const model = createOpenAiAssistantModel({ apiKey: "test", client });

  const result = await model.propose({ system: "S", userMessage: "2 katına çıkar", tools: TOOLS });
  assert.equal(result.toolName, "change_plan");
  assert.deepEqual(result.toolInput, { multiplier: 2 });
  assert.equal(result.text, "Önerim var.");
});

test("malformed or non-object arguments produce no tool input rather than a crash", async () => {
  for (const args of ["{bozuk", "[1,2]", '"metin'.concat('"'), "null"]) {
    const { client } = fakeClient({
      output: [{ type: "function_call", name: "change_plan", arguments: args, call_id: "c1" }],
      output_text: "",
    });
    const model = createOpenAiAssistantModel({ apiKey: "test", client });

    const result = await model.propose({ system: "S", userMessage: "x", tools: TOOLS });
    assert.equal(result.toolName, "change_plan");
    assert.deepEqual(result.toolInput, {});
  }
});

test("a plain answer with no tool call comes back as text only", async () => {
  const { client } = fakeClient({ output: [{ type: "message", content: [] }], output_text: "Sunucun çevrimiçi." });
  const model = createOpenAiAssistantModel({ apiKey: "test", client });

  const result = await model.propose({ system: "S", userMessage: "durum?", tools: TOOLS });
  assert.equal(result.toolName, null);
  assert.deepEqual(result.toolInput, {});
  assert.equal(result.text, "Sunucun çevrimiçi.");
});

test("the model id is configurable without touching the adapter", async () => {
  const { client, calls } = fakeClient({ output: [], output_text: "" });
  const model = createOpenAiAssistantModel({ apiKey: "test", client, model: "gpt-5.6-luna" });

  await model.propose({ system: "S", userMessage: "x", tools: TOOLS });
  assert.equal(calls[0].model, "gpt-5.6-luna");
});
