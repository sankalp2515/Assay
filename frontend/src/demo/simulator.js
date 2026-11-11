// Illustrative walkthrough backend. Mirrors the Commerce response shapes the UI consumes
// so the same screens run without services. Everything here is fabricated example data:
// no provider, model, PayPal or money is involved, and every record is labeled as such.
import { ApiError } from "../api.js";

export const DEMO_BATCH_ID = "demo-coastal-024";
const MEDIA = "/assets/coast-demo.mp4";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
let seq = 0;
const ref = (prefix) =>
  `${prefix}-${String(++seq).padStart(3, "0")}-${Math.random().toString(16).slice(2, 8)}`;

let mediaDigest = null;
async function digestOfMedia() {
  if (mediaDigest) return mediaDigest;
  try {
    const bytes = await (await fetch(MEDIA)).arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    mediaDigest = [...new Uint8Array(hash)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    mediaDigest = null;
  }
  return mediaDigest;
}

function fresh() {
  const created = Date.now() - 26 * 60 * 1000;
  const at = (min) => new Date(created + min * 60000).toISOString();
  const units = Array.from({ length: 10 }, (_, i) => ({
    id: `demo-unit-${String(i + 1).padStart(2, "0")}`,
    price_minor: 500,
  }));
  return {
    batch: {
      id: DEMO_BATCH_ID,
      title: "Coastal collection",
      state: "AUTHORIZED",
      currency: "USD",
      ceiling_minor: 5000,
      units,
      version: 4,
      buyer_id: "demo-buyer",
      contract_hash: "illustrative-contract-024",
      created_at: at(0),
      deadline: at(30),
      retention_until: new Date(created + 7 * 864e5).toISOString(),
      consented_at: at(1),
      terms: {
        billable: "ready-and-purchaser-retrievable",
        technical: {
          codec: "h264",
          min_height: 720,
          min_seconds: 4,
          max_seconds: 10,
          max_bytes: 26214400,
        },
        retention_days: 7,
        creative_quality_guaranteed: false,
      },
    },
    attempts: units.map((u, i) => ({
      id: `demo-attempt-${i + 1}`,
      unit_id: u.id,
      state: i < 8 ? "SUCCEEDED" : "FAILED",
      provider_task_id: `task_demo_${String(i + 1).padStart(2, "0")}`,
      created_at: at(3 + i),
    })),
    artifacts: units.slice(0, 8).map((u, i) => ({
      id: `demo-artifact-${i + 1}`,
      batch_id: DEMO_BATCH_ID,
      unit_id: u.id,
      state: "STORED",
      published: i < 7,
      width: 1920,
      height: 1080,
      duration: 6,
      bytes: 166495,
      retention_until: new Date(created + 7 * 864e5).toISOString(),
    })),
    authorization: {
      id: DEMO_BATCH_ID,
      provider_id: "DEMO-AUTH-024",
      state: "AUTHORIZED",
      amount_minor: 5000,
      confirmed_at: at(2),
    },
    events: [
      ["AWAITING_BUYER_APPROVAL", 0],
      ["ACCEPTED", 1],
      ["AUTHORIZING", 2],
      ["AUTHORIZED", 2],
      ["RUNNING", 3],
    ].map(([action, min]) => ({
      sequence: ref("evt"),
      action,
      recorded_at: at(min),
    })),
    assessment: null,
    permit: null,
    operations: [],
    statement: null,
    recoveries: [],
    cases: [],
  };
}
let state = fresh();
export function resetDemo() {
  state = fresh();
}

function record(action) {
  state.events.unshift({
    sequence: ref("evt"),
    action,
    recorded_at: iso(),
  });
  state.batch.state = action;
  state.batch.version += 1;
}
const clipOf = (unitId) =>
  state.batch.units.findIndex((u) => u.id === unitId) + 1;

async function evidence() {
  const digest = (await digestOfMedia()) || "unavailable";
  return [
    {
      id: "obs-contract",
      source: "commerce",
      unit_id: null,
      text: `Accepted contract ${state.batch.contract_hash}: technical validity and purchaser retrievability determine billability; subjective creative satisfaction is not required.`,
    },
    ...state.attempts.map((a) => ({
      id: `obs-attempt-${clipOf(a.unit_id)}`,
      source: "provider",
      unit_id: a.unit_id,
      text: `Attempt ${a.id} for clip ${clipOf(a.unit_id)} has provider task ${a.provider_task_id} and state ${a.state}.`,
    })),
    ...state.artifacts.map((a) => ({
      id: `obs-artifact-${clipOf(a.unit_id)}`,
      source: "delivery",
      unit_id: a.unit_id,
      text: `Artifact ${a.id} for clip ${clipOf(a.unit_id)} is ${a.state}; published to purchaser: ${a.published}; digest ${digest}.`,
    })),
  ];
}

async function investigate() {
  await wait(900);
  const ev = await evidence();
  const hidden = state.artifacts.filter((a) => !a.published);
  const failed = state.attempts.filter((a) => a.state === "FAILED");
  const first = hidden[0];
  state.assessment = {
    id: ref("assessment"),
    batch_id: DEMO_BATCH_ID,
    state: "VALID",
    model: "illustrative-walkthrough",
    provenance: "illustrative",
    tool_calls: 0,
    created_at: iso(),
    completed_at: iso(),
    current: true,
    evidence: ev,
    assessment: {
      disposition: hidden.length ? "RECOVER_EXISTING" : "READY_TO_CLOSE",
      explanation: hidden.length
        ? `The provider finished clip ${clipOf(first.unit_id)} and its original file is archived, but it was never published to the buyer. Restoring access is enough; another render is not needed. Clips ${failed.map((a) => clipOf(a.unit_id)).join(" and ")} failed at the provider and have no file.`
        : `Every archived original is published and retrievable by the buyer. Clips ${failed.map((a) => clipOf(a.unit_id)).join(" and ")} have no file and are not billable.`,
      citations: [
        ...(first
          ? [
              {
                observation_id: `obs-attempt-${clipOf(first.unit_id)}`,
                quote: `state SUCCEEDED`,
              },
              {
                observation_id: `obs-artifact-${clipOf(first.unit_id)}`,
                quote: "published to purchaser: false",
              },
            ]
          : [
              {
                observation_id: "obs-contract",
                quote: "purchaser retrievability determine billability",
              },
            ]),
        ...failed.map((a) => ({
          observation_id: `obs-attempt-${clipOf(a.unit_id)}`,
          quote: "state FAILED",
        })),
      ],
      hypotheses: hidden.length
        ? [
            {
              description:
                "The completion callback was lost after the provider finished, so the archived file was never released to the buyer.",
              observation_ids: [
                `obs-attempt-${clipOf(first.unit_id)}`,
                `obs-artifact-${clipOf(first.unit_id)}`,
              ],
            },
          ]
        : [],
      actions: hidden.length
        ? hidden.map((a) => ({
            kind: "RESTORE_ACCESS",
            unit_id: a.unit_id,
            reason:
              "A validated original is archived without buyer access. Publish the existing file instead of rendering again.",
          }))
        : [
            {
              kind: "NO_ACTION",
              unit_id: null,
              reason: "Delivery records are consistent with the contract.",
            },
          ],
    },
  };
  record("INVESTIGATED");
  return state.assessment;
}

async function statement() {
  const digest = await digestOfMedia();
  const permit = state.permit;
  return {
    type: "delivery-statement",
    version: 1,
    batch_id: DEMO_BATCH_ID,
    currency: "USD",
    permit_id: permit.id,
    authorized_minor: state.batch.ceiling_minor,
    charged_minor: permit.action === "CAPTURE" ? permit.amount_minor : 0,
    not_taken_minor:
      state.batch.ceiling_minor -
      (permit.action === "CAPTURE" ? permit.amount_minor : 0),
    clips: state.batch.units.map((u, i) => {
      const charged = permit.unit_ids.includes(u.id);
      return {
        clip: i + 1,
        unit_id: u.id,
        price_minor: u.price_minor,
        charged,
        sha256: charged ? digest : null,
        retrieval_receipt_id: charged ? `demo-receipt-${i + 1}` : null,
      };
    }),
  };
}

const notFound = (message = "Not available in the walkthrough") =>
  new ApiError(message, 404, "not_found");

export async function simulate(path, { body } = {}) {
  const [pathname] = path.split("?");
  const parts = pathname.split("/").filter(Boolean); // v1, batches, id, ...
  const write = body !== undefined;
  await wait(write ? 320 : 140);
  if (pathname === "/v1/batches" && !write)
    return { items: [structuredClone(state.batch)], next: null };
  if (pathname === "/v1/readiness")
    return { environment: "demo", currency: "USD", services: [], observed_at: iso() };
  if (pathname === "/v1/operations/impact") {
    const op = state.operations.find((o) => o.kind === "CAPTURE");
    return {
      clips_recovered_without_rerender: state.recoveries.length,
      recovered_clip_list_value_minor: state.recoveries.length * 500,
      estimated_rerender_cost_avoided_minor: 0,
      rerender_cost_basis: "not configured in the walkthrough",
      settled_batches: op ? 1 : 0,
      authorized_minor: op ? state.batch.ceiling_minor : 0,
      charged_minor: op ? op.amount_minor : 0,
      never_taken_minor: op ? state.batch.ceiling_minor - op.amount_minor : 0,
      buyer_messages: 0,
      buyer_messages_read_by_ai: 0,
      buyer_message_outcomes: {},
      currency: "USD",
    };
  }
  if (parts[1] === "operations" && parts[3] === "reconcile") {
    const op = state.operations.find((o) => o.id === parts[2]);
    if (!op) throw notFound();
    return structuredClone(op);
  }
  if (pathname === "/v1/support") return { items: [], limit: 100 };
  if (parts[1] !== "batches" || parts[2] !== DEMO_BATCH_ID) throw notFound();
  const action = parts.slice(3).join("/");
  const digest = await digestOfMedia();
  switch (action) {
    case "":
      return structuredClone(state.batch);
    case "outcomes":
      return {
        batch_id: DEMO_BATCH_ID,
        state: state.batch.state,
        artifacts: state.artifacts
          .filter((a) => a.published)
          .map((a) => ({
            ...a,
            sha256: digest,
            content_path: `/v1/artifacts/${a.id}/content`,
          })),
        delivery_token: "walkthrough",
        operations: structuredClone(state.operations),
      };
    case "review":
      return {
        batch_id: DEMO_BATCH_ID,
        state: state.batch.state,
        attempts: structuredClone(state.attempts),
        artifacts: state.artifacts.map(
          ({ id, unit_id, state: s, published, retention_until }) => ({
            id,
            unit_id,
            state: s,
            published,
            retention_until,
          }),
        ),
      };
    case "financials":
      return {
        environment: "demo",
        observed_at: iso(),
        order: { provider_id: "DEMO-ORDER-024", state: "APPROVED" },
        authorization: structuredClone(state.authorization),
        refundable_units: [],
        operations: structuredClone(state.operations),
      };
    case "activity":
      return {
        batch_id: DEMO_BATCH_ID,
        events: structuredClone(state.events),
        observed_at: iso(),
      };
    case "settlement-status":
      return {
        batch_id: DEMO_BATCH_ID,
        batch_state: state.batch.state,
        proposal: null,
      };
    case "statement":
      if (!state.statement) throw notFound("No settlement statement yet");
      return {
        state: "CONFIRMED",
        signed: false,
        illustrative: true,
        statement: structuredClone(state.statement),
      };
    case "support":
      if (write)
        throw new ApiError(
          "The walkthrough has no support inbox. Run the local services to record a buyer message.",
          409,
          "demo_only",
        );
      return { items: [] };
    case "investigation":
      if (!state.assessment) throw notFound("No assessment requested");
      return structuredClone(state.assessment);
    case "investigate":
      if (state.batch.state === "CLOSED" && state.assessment)
        return structuredClone(state.assessment);
      if (state.assessment?.current && !body?.refresh_reason)
        return structuredClone(state.assessment);
      return structuredClone(await investigate());
    case "recover": {
      const artifact = state.artifacts.find((a) => a.id === body?.artifact_id);
      if (!artifact || artifact.published)
        throw new ApiError("No archived original needs restoring.", 409);
      if (!state.assessment?.current || state.assessment.id !== body.assessment_id)
        throw new ApiError(
          "Evidence changed. Investigate again before restoring.",
          409,
          "stale_assessment",
        );
      await wait(700);
      artifact.published = true;
      state.assessment.current = false;
      const receipt = {
        id: ref("receipt"),
        batch_id: DEMO_BATCH_ID,
        unit_id: artifact.unit_id,
        artifact_id: artifact.id,
        sha256: digest,
        checker_version: "illustrative",
        observed_at: iso(),
        valid_until: iso(5 * 60000),
        outcome: "VERIFIED",
        receipt_hash: ref("demo-receipt"),
      };
      state.recoveries.push(receipt);
      state.batch.version += 1;
      return receipt;
    }
    case "closure-preview": {
      if (state.batch.state === "CLOSED")
        throw new ApiError("This delivery is already settled.", 409);
      if (!state.assessment?.current)
        throw new ApiError(
          "A current investigation is required before settlement.",
          409,
          "stale_assessment",
        );
      const eligible = state.batch.units.filter((u) =>
        state.artifacts.some((a) => a.unit_id === u.id && a.published),
      );
      state.permit = {
        id: ref("permit"),
        batch_id: DEMO_BATCH_ID,
        unit_ids: eligible.map((u) => u.id),
        amount_minor: eligible.reduce((n, u) => n + u.price_minor, 0),
        currency: "USD",
        action: eligible.length ? "CAPTURE" : "VOID",
        assessment_id: state.assessment.id,
        expires_at: iso(45000),
        state: "PROPOSED",
        approval_digest: ref("digest"),
      };
      record("READY_FOR_REVIEW");
      return structuredClone(state.permit);
    }
    case "approve": {
      const permit = state.permit;
      if (state.operations.length)
        return {
          batch_id: DEMO_BATCH_ID,
          operation_id: state.operations[0].id,
          state: "SETTLEMENT_REQUESTED",
        };
      if (
        !permit ||
        permit.id !== body?.proposal_id ||
        permit.approval_digest !== body?.approval_digest
      )
        throw new ApiError("This review no longer matches the delivery.", 409);
      if (Date.parse(permit.expires_at) <= Date.now())
        throw new ApiError("This review expired. Request a fresh review.", 409);
      record("SETTLEMENT_REQUESTED");
      await wait(600);
      state.statement = await statement();
      state.operations = [
        {
          id: permit.id,
          kind: permit.action,
          state: "CONFIRMED",
          batch_id: DEMO_BATCH_ID,
          currency: "USD",
          amount_minor: permit.action === "CAPTURE" ? permit.amount_minor : 0,
          provider_id:
            permit.action === "CAPTURE" ? "DEMO-CAPTURE-024" : "DEMO-VOID-024",
          authorization_id: state.authorization.provider_id,
          created_at: iso(),
          updated_at: iso(),
          confirmed_at: iso(),
        },
      ];
      record("CLOSED");
      return {
        batch_id: DEMO_BATCH_ID,
        operation_id: permit.id,
        state: "SETTLEMENT_REQUESTED",
      };
    }
    default:
      throw notFound();
  }
}

export async function demoContent(artifact, signal) {
  const known = state.artifacts.find(
    (a) => `/v1/artifacts/${a.id}/content` === artifact.content_path,
  );
  if (!known?.published)
    throw new ApiError("This file is not currently retrievable.", 409);
  const res = await fetch(MEDIA, { signal });
  if (!res.ok) throw new ApiError("The example clip could not be loaded.", 503);
  return res.blob();
}
