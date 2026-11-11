import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, copyFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { embedded } from "../src/core/database.js";
import { token, type Identity } from "../src/core/auth.js";
import type { Context, PayPal, Model, Call } from "../src/core/context.js";
import { createApp } from "../src/app.js";
import { Problem } from "../src/core/errors.js";
import {
  services,
  id,
  type Service,
  type Json,
  type Batch,
  type Evidence,
} from "../src/domain/contracts.js";
import { usd } from "../src/adapters/paypal.js";
import { dispatchOutbox } from "../src/core/transport.js";
export class FixturePayPal implements PayPal {
  available = true;
  captures = 0;
  refunds = 0;
  voids = 0;
  loseCapture = false;
  pending = false;
  merchant = "MERCHANT_FIXTURE";
  authId = "AUTH_FIXTURE";
  captureAmount = 0;
  refundAmount = 0;
  batchId = "";
  ceiling = 0;
  async createOrder(batchId: string, amount: number) {
    this.batchId = batchId;
    this.ceiling = amount;
    return {
      id: "ORDER_FIXTURE",
      status: "CREATED",
      links: [
        { rel: "payer-action", href: "https://sandbox.paypal.com/fixture" },
      ],
    };
  }
  async getOrder() {
    return {
      id: "ORDER_FIXTURE",
      status: "APPROVED",
      purchase_units: [
        {
          reference_id: this.batchId,
          payee: { merchant_id: this.merchant },
          amount: { currency_code: "USD", value: usd(this.ceiling) },
        },
      ],
    };
  }
  async authorizeOrder() {
    return {
      purchase_units: [
        {
          payments: {
            authorizations: [
              {
                id: this.authId,
                status: "CREATED",
                amount: { currency_code: "USD", value: usd(this.ceiling) },
              },
            ],
          },
        },
      ],
    };
  }
  async getAuthorization() {
    return {
      id: this.authId,
      status: this.voids ? "VOIDED" : "CREATED",
      amount: { currency_code: "USD", value: usd(this.ceiling) },
    };
  }
  captureDetails: { invoice_id: string; note_to_payer: string } | undefined;
  async capture(
    _id: string,
    amount: number,
    _key?: string,
    details?: { invoice_id: string; note_to_payer: string },
  ) {
    this.captures++;
    this.captureDetails = details;
    this.captureAmount = amount;
    if (this.loseCapture) throw new Error("Injected lost response");
    return {
      id: "CAPTURE_FIXTURE",
      status: this.pending ? "PENDING" : "COMPLETED",
    };
  }
  async getCapture() {
    return {
      id: "CAPTURE_FIXTURE",
      status: this.pending ? "PENDING" : "COMPLETED",
      amount: { currency_code: "USD", value: usd(this.captureAmount) },
      payee: { merchant_id: this.merchant },
      supplementary_data: { related_ids: { authorization_id: this.authId } },
    };
  }
  async void() {
    this.voids++;
    return { status: "VOIDED" };
  }
  async refund(_id: string, amount: number) {
    this.refunds++;
    this.refundAmount = amount;
    return { id: "REFUND_FIXTURE", status: "COMPLETED" };
  }
  async getRefund() {
    return {
      id: "REFUND_FIXTURE",
      status: "COMPLETED",
      amount: { currency_code: "USD", value: usd(this.refundAmount) },
      links: [
        {
          rel: "up",
          method: "GET",
          href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE_FIXTURE",
        },
      ],
    };
  }
  async verifyWebhook() {
    return false;
  }
}
export const fixtureModel: Model = {
  available: true,
  // Explicit test fixture: digits only, no language understanding. Not a model evaluation.
  async interpret(message: string, clipCount: number) {
    const numbers = [...message.matchAll(/\b(\d{1,2})\b/g)]
      .map((m) => Number(m[1]))
      .filter((n, i, all) => n >= 1 && n <= clipCount && all.indexOf(n) === i);
    const issue = /never|missing|didn't get/i.test(message)
      ? ("NOT_RECEIVED" as const)
      : /play|open|corrupt/i.test(message)
        ? ("WONT_PLAY" as const)
        : /refund|charge/i.test(message)
          ? ("BILLING_QUESTION" as const)
          : ("NOT_RECEIVED" as const);
    return {
      provenance: "fixture" as const,
      model: "explicit-test-fixture",
      interpretation: {
        claims: [{ clip_numbers: numbers, issue, quote: message.slice(0, 20) }],
        contains_instructions: /refund me|ignore/i.test(message),
        summary: "Fixture reading of the buyer message.",
      },
    };
  },
  async assess(evidence: Evidence[]) {
    const delivery = evidence.filter((e) => e.source === "delivery");
    const unpublished = delivery.filter((e) =>
      e.text.includes("published to purchaser: false"),
    );
    return {
      provenance: "fixture",
      model: "explicit-test-fixture",
      tool_calls: 0,
      assessment: {
        disposition: unpublished.length ? "RECOVER_EXISTING" : "READY_TO_CLOSE",
        explanation:
          "Fixture evidence supports the declared technical state; this is not a real model evaluation.",
        citations: [
          {
            observation_id: evidence[0]!.id,
            quote: evidence[0]!.text.slice(0, 50),
          },
        ],
        hypotheses: [
          {
            description: "Known fixture diagnosis",
            observation_ids: [evidence[0]!.id],
          },
        ],
        actions: unpublished.length
          ? unpublished.map((e) => ({
              kind: "RESTORE_ACCESS" as const,
              unit_id: e.unit_id,
              reason:
                "Validated original artifact is stored without buyer access",
            }))
          : [
              {
                kind: "NO_ACTION",
                unit_id: null,
                reason: "Known fixture records are consistent",
              },
            ],
      },
    };
  },
};
export async function harness(
  options: {
    dataRoot?: string;
    artifactDir?: string;
    tenant?: string;
    buyer?: string;
  } = {},
) {
  const dir =
    options.artifactDir ??
    (await mkdtemp(join(tmpdir(), "paypal-backend-test-")));
  const publicKeys: Record<string, string> = {};
  const identities = {} as Record<Service | "operator", Identity>;
  for (const name of [...services, "operator"] as const) {
    const pair = generateKeyPairSync("ed25519");
    publicKeys[name] = pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    identities[name] = {
      name,
      privateKey: pair.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      publicKeys,
    };
  }
  const contexts = {} as Record<Service, Context>;
  const apps = {} as Record<Service, FastifyInstance>;
  const tenant = options.tenant ?? id(),
    buyer = options.buyer ?? id(),
    operator = id();
  const paypal = new FixturePayPal();
  const call: Call = async (target, path, tenant, body, key) => {
    const caller = contexts[target];
    void caller;
    throw new Error("Caller-specific transport must be installed");
  };
  for (const name of services) {
    const db = await embedded(
      options.dataRoot ? join(options.dataRoot, name) : undefined,
    );
    await db.migrate(name);
    contexts[name] = {
      name,
      db,
      identity: identities[name],
      call,
      artifactDir: dir,
      allowPaid: false,
      maxAttempts: 1,
      merchantId: paypal.merchant,
      publicOrigin: "http://localhost:4100",
      fixture: true,
      now: Date.now,
    };
  }
  for (const name of services)
    contexts[name].call = async (target, path, t, body, key) => {
      const response = await apps[target].inject({
        url: path,
        method: body ? "POST" : "GET",
        headers: {
          authorization: "Bearer " + (await token(identities[name], target, t)),
          "idempotency-key": key ?? "fixture-" + id(),
        },
        ...(body ? { payload: body } : {}),
      });
      const data = response.json<Json>();
      if (response.statusCode >= 400)
        throw new Problem(
          response.statusCode,
          String(data.code),
          String(data.message),
        );
      return data;
    };
  contexts.payments.paypal = paypal;
  contexts.investigation.model = { ...fixtureModel };
  contexts.provider.provider = {
    available: true,
    lookup: async (task) => ({ id: task, status: "SUCCEEDED", output: [] }),
    submit: async () => {
      throw new Error("Fixture must not generate paid work");
    },
  };
  for (const name of services) apps[name] = await createApp(contexts[name]);
  async function request(
    path: string,
    body?: Json,
    role = "operator",
    key = "test-" + id(),
    t = tenant,
  ) {
    const invoke = async () =>
      apps.commerce.inject({
        url: path,
        method: body ? "POST" : "GET",
        headers: {
          authorization:
            "Bearer " +
            (await token(
              identities.operator,
              "commerce",
              t,
              role,
              role === "buyer" ? buyer : operator,
            )),
          "idempotency-key": key,
        },
        ...(body ? { payload: body } : {}),
      });
    let response = await invoke();
    // Test client follows the same durable submit/poll/adopt protocol as API clients.
    if (
      body &&
      path.endsWith("/investigate") &&
      response.statusCode === 200 &&
      ["RESERVED", "RUNNING"].includes(String(response.json<Json>().state))
    ) {
      await dispatchOutbox(contexts.investigation, t);
      response = await invoke();
    }
    return response;
  }
  async function setup(unitCount = 10) {
    const created = await request("/v1/batches", {
      buyer_id: buyer,
      unit_count: unitCount,
      unit_price_minor: 500,
      currency: "USD",
      prompt: "A small blue bird flying over a quiet green forest",
    });
    if (created.statusCode !== 200) throw new Error(created.body);
    const batch = created.json<Batch>();
    for (const [path, body] of [
      ["consent", { contract_hash: batch.contract_hash }],
      ["paypal/order", {}],
      ["paypal/authorize", {}],
    ] as const) {
      const r = await request(
        "/v1/batches/" + batch.id + "/" + path,
        body,
        "buyer",
      );
      if (r.statusCode !== 200) throw new Error(r.body);
    }
    return batch;
  }
  async function seed(
    batch: Batch,
    count: number,
    published = true,
    offset = 0,
  ) {
    const fixture = join(dir, "source.mp4");
    try {
      await readFile(fixture);
    } catch {
      execFileSync(
        process.env.FFMPEG_PATH ?? "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=blue:s=1280x720:r=24",
          "-t",
          "4",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          fixture,
        ],
        { windowsHide: true, timeout: 20000 },
      );
    }
    const { verifyVideo } = await import("../src/adapters/media.js");
    const checked = await verifyVideo(fixture);
    const artifacts: Json[] = [];
    for (const unit of batch.units.slice(offset, offset + count)) {
      const attempt = {
        id: id(),
        batch_id: batch.id,
        unit_id: unit.id,
        state: "SUCCEEDED",
        provider_task_id: "TASK_" + unit.id,
      };
      await contexts.provider.db.create(
        tenant,
        "attempt",
        String(attempt.id),
        attempt,
        attempt,
      );
      const artifact = {
        id: id(),
        batch_id: batch.id,
        unit_id: unit.id,
        buyer_id: buyer,
        contract_hash: batch.contract_hash,
        state: "STORED",
        published,
        retention_until: batch.retention_until,
        ...checked,
      };
      await copyFile(fixture, join(dir, artifact.id + ".mp4"));
      await contexts.delivery.db.create(
        tenant,
        "artifact",
        artifact.id,
        artifact,
        artifact,
      );
      artifacts.push(artifact);
    }
    return artifacts;
  }
  async function settle(batch: Batch) {
    const assessment = await request(
      "/v1/batches/" + batch.id + "/investigate",
      {},
    );
    if (assessment.statusCode !== 200) throw new Error(assessment.body);
    const preview = await request(
      "/v1/batches/" + batch.id + "/closure-preview",
      {},
    );
    if (preview.statusCode !== 200) throw new Error(preview.body);
    const permit = preview.json<Json>();
    const approval = await request("/v1/batches/" + batch.id + "/approve", {
      proposal_id: permit.id,
      approval_digest: permit.approval_digest,
    });
    if (approval.statusCode !== 200) throw new Error(approval.body);
    await contexts.commerce.call(
      "payments",
      "/internal/settlements",
      tenant,
      { batch_id: batch.id, permit_id: permit.id },
      "settle-" + id(),
    );
    return {
      permit,
      execute: () =>
        contexts.payments.call(
          "payments",
          "/internal/operations/" + permit.id + "/execute",
          tenant,
          {},
          "execute-" + id(),
        ),
    };
  }
  return {
    dir,
    contexts,
    apps,
    identities,
    tenant,
    buyer,
    operator,
    paypal,
    request,
    setup,
    seed,
    settle,
    close: async () => {
      for (const name of services) {
        await apps[name].close();
        await contexts[name].db.close();
      }
    },
  };
}
