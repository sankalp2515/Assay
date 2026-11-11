import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HostedInvestigator,
  InvestigatorChain,
  configuredInvestigator,
} from "../src/adapters/models.js";
import type { Model } from "../src/core/context.js";
import { id, type Evidence, type Assessment } from "../src/domain/contracts.js";
test("zero-cost policy excludes keys until their free-tier access is confirmed", () => {
  assert.equal(
    configuredInvestigator({ GEMINI_API_KEY: "test-only" }).available,
    false,
  );
  assert.equal(
    configuredInvestigator({
      GEMINI_API_KEY: "test-only",
      GEMINI_FREE_TIER_CONFIRMED: "true",
    }).available,
    true,
  );
  assert.equal(
    configuredInvestigator({
      GROQ_API_KEY: "test-only",
      GROQ_FREE_TIER_CONFIRMED: "true",
    }).available,
    true,
  );
  assert.throws(() =>
    configuredInvestigator({ AI_FALLBACK_PROVIDERS: "arbitrary-host" }),
  );
});
const unit = id();
const evidence: Evidence[] = [
  {
    id: id(),
    source: "delivery",
    unit_id: unit,
    text: "Archive valid but access not published.",
  },
];
function assessment(quote = evidence[0]!.text): Assessment {
  return {
    disposition: "RECOVER_EXISTING",
    explanation:
      "The valid archive is present and needs purchaser access restored.",
    citations: [{ observation_id: evidence[0]!.id, quote }],
    hypotheses: [
      {
        description: "Publication missing",
        observation_ids: [evidence[0]!.id],
      },
    ],
    actions: [
      {
        kind: "RESTORE_ACCESS",
        unit_id: unit,
        reason: "Restore original access",
      },
    ],
  };
}
test("hosted fallback adapters use fixed provider hosts and validate citations", async () => {
  for (const provider of ["groq", "nvidia"] as const) {
    const model = new HostedInvestigator(
      provider,
      "test-only-key",
      "test-model",
      async (url, init) => {
        assert.equal(
          new URL(String(url)).hostname,
          provider === "groq" ? "api.groq.com" : "integrate.api.nvidia.com",
        );
        const body = JSON.parse(String(init?.body));
        assert.equal(body.max_tokens, 2500);
        assert.equal(body.stream, false);
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(assessment()) },
            },
          ],
        });
      },
    );
    const result = await model.assess(evidence);
    assert.equal(result.model, provider + "/test-model");
  }
  const bad = new HostedInvestigator("groq", "test", "test", async () =>
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify(assessment("Invented payment success")),
          },
        },
      ],
    }),
  );
  await assert.rejects(bad.assess(evidence), /unsupported evidence/);
});
test("fallback uses next provider after outage but never shops away inconclusive result", async () => {
  let secondCalls = 0;
  const fail: Model = {
    available: true,
    assess: async () => {
      throw new Error("outage");
    },
  };
  const success: Model = {
    available: true,
    assess: async () => {
      secondCalls++;
      return {
        assessment: assessment(),
        model: "test-only",
        provenance: "fixture",
        tool_calls: 0,
      };
    },
  };
  const chain = new InvestigatorChain([
    { name: "primary", model: fail },
    { name: "secondary", model: success },
  ]);
  const result = await chain.assess(evidence);
  assert.equal(secondCalls, 1);
  assert.deepEqual(
    result.attempted_models.map((a) => a.outcome),
    ["unavailable_or_invalid", "accepted"],
  );
  const inconclusive: Model = {
    available: true,
    assess: async () => ({
      assessment: { ...assessment(), disposition: "INCONCLUSIVE" },
      model: "uncertain-test",
      provenance: "fixture",
      tool_calls: 0,
    }),
  };
  const cautious = new InvestigatorChain([
    { name: "primary", model: inconclusive },
    { name: "secondary", model: success },
  ]);
  assert.equal(
    (await cautious.assess(evidence)).assessment.disposition,
    "INCONCLUSIVE",
  );
  assert.equal(secondCalls, 1);
});
test("all AI providers failing cannot yield a normal completion", async () => {
  const chain = new InvestigatorChain([
    {
      name: "missing",
      model: {
        available: false,
        assess: async () => {
          throw new Error();
        },
      },
    },
  ]);
  assert.equal(chain.available, false);
  await assert.rejects(chain.assess(evidence));
});
test("fallback shares bounded tool reads across attempts", async () => {
  let calls = 0;
  const fail: Model = {
    available: true,
    assess: async (_e, read) => {
      await read!(unit);
      throw new Error("response invalid");
    },
  };
  const next: Model = {
    available: true,
    assess: async (_e, read) => {
      await read!(unit);
      return {
        assessment: assessment(),
        model: "test",
        provenance: "fixture",
        tool_calls: 1,
      };
    },
  };
  await new InvestigatorChain([
    { name: "primary", model: fail },
    { name: "secondary", model: next },
  ]).assess(evidence, async () => {
    calls++;
    return evidence;
  });
  assert.equal(calls, 1);
});
