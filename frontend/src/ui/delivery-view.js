const stages = {
  ACCEPTED: ["Agreement created", "active", "Review agreement"],
  AWAITING_BUYER_APPROVAL: ["Awaiting buyer", "active", "Review agreement"],
  AUTHORIZING: ["Authorization pending", "active", "Check payment status"],
  AUTHORIZED: ["Authorized", "active", "Review original files"],
  RUNNING: ["In progress", "active", "Review delivery"],
  WAITING_FOR_AI: ["AI review needed", "attention", "Review evidence"],
  WAITING_FOR_PAYPAL: [
    "Payment setup needed",
    "attention",
    "Review payment setup",
  ],
  INVESTIGATED: ["Evidence reviewed", "attention", "Review next steps"],
  READY_FOR_REVIEW: ["Review needed", "attention", "Review next steps"],
  SETTLEMENT_REQUESTED: [
    "Settlement pending",
    "active",
    "Check payment status",
  ],
  CLAIMED: ["Settlement in progress", "active", "Check payment status"],
  CANCEL_REQUESTED: ["Cancellation pending", "active", "Check payment status"],
  CLOSED: ["Closed", "closed", "View record"],
};

export function deliveryStage(state) {
  const [label, group, action] = stages[state] || [
    "Review status",
    "attention",
    "Open delivery",
  ];
  return {
    label,
    group,
    action,
    tone: group === "attention" ? "warning" : "neutral",
  };
}

export function filterDeliveries(items, query, group) {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter(
    (batch) =>
      (group === "all" || deliveryStage(batch.state).group === group) &&
      (!needle ||
        `${batch.title || ""} ${batch.id}`
          .toLocaleLowerCase()
          .includes(needle)),
  );
}

const KEYS = ["agreement", "payment", "execution", "artifact", "delivery", "settlement"];
const TITLES = { agreement: "Agreement", payment: "Payment", execution: "Execution", artifact: "Artifact", delivery: "Delivery", settlement: "Settlement" };
// How far along the proof line a delivery is, judged from its state alone.
// The list has no per-clip records, so nothing here is ever shown as broken.
const REACHED = {
  ACCEPTED: 1, AWAITING_BUYER_APPROVAL: 1, AUTHORIZING: 1,
  AUTHORIZED: 2, RUNNING: 2, WAITING_FOR_PAYPAL: 1,
  WAITING_FOR_AI: 4, INVESTIGATED: 4, READY_FOR_REVIEW: 5,
  SETTLEMENT_REQUESTED: 5, CLAIMED: 5, CANCEL_REQUESTED: 1, CLOSED: 6,
};
export function coarseStations(state) {
  const reached = REACHED[state] ?? 1;
  return KEYS.map((key, i) => ({
    key,
    title: TITLES[key],
    state: i < reached ? "verified" : REACHED[state] === undefined && i === reached ? "unknown" : "pending",
    value: "",
  }));
}

/**
 * The job in order, for the Start here page. States come from the delivery record only:
 * a step is "done" when the record shows it, the first step that is not is "next".
 */
export function journeySteps(batch, { demoProvider = false, hasTasks = false } = {}) {
  const reached = REACHED[batch.state] ?? 1;
  const id = batch.id;
  const recovered = (batch.recovered_unit_ids || []).length;
  const closed = batch.state === "CLOSED";
  const steps = [
    {
      key: "agree", who: "buyer", to: `/buyer/${id}/agreement`, action: "Open the agreement",
      title: "Review the agreement",
      detail: "The buyer sees the clips, the price for each and the most that can be held.",
      done: !!batch.consented_at || reached >= 2,
    },
    {
      key: "authorize", who: "buyer", to: `/buyer/${id}/agreement`, action: "Authorize with PayPal",
      title: "Authorize with PayPal",
      detail: "PayPal places a hold up to the ceiling. A hold is not a charge.",
      done: reached >= 2,
    },
    // Hosted Sandbox demo only: a stand-in for the merchant's video provider.
    ...(demoProvider
      ? [{
          key: "provider", who: "merchant", to: `/batches/${id}`, action: "Run the demo provider",
          title: "Run the demo provider",
          detail: "A stand-in for your video provider that reuses two pre-generated LTX-Video clips, or up to three links of your own. Seven are delivered, one is archived but lost, two never render.",
          done: hasTasks || reached >= 4,
        }]
      : []),
    {
      key: "investigate", who: "merchant", to: `/batches/${id}`, action: "Open the investigation",
      title: "Investigate what was delivered",
      detail: "Assay compares provider, archive and buyer-route records. AI reads them and cites what it used.",
      done: reached >= 4,
    },
    {
      key: "restore", who: "merchant", to: `/batches/${id}`, action: "Restore the lost clip",
      title: recovered ? `Restored ${recovered === 1 ? "one lost clip" : recovered + " lost clips"}` : reached >= 5 ? "Nothing needed restoring" : "Restore any clip that was rendered but never delivered",
      detail: "The archived original is re-linked and checked on the buyer's own route. No new render.",
      done: recovered > 0 || reached >= 5,
    },
    {
      key: "settle", who: "merchant", to: `/batches/${id}/settlement`, action: "Review the settlement",
      title: "Approve one exact capture",
      detail: "Only clips the buyer can open are charged. The rest of the hold is released, not refunded.",
      done: closed,
    },
    {
      key: "receipt", who: "buyer", to: `/buyer/${id}`, action: "See the buyer's receipt",
      title: "Open the clips and the signed statement",
      detail: "The buyer sees every clip, what was charged and what was never taken.",
      done: false,
    },
  ];
  let found = false;
  return steps.map(({ done, ...step }) => {
    const state = done && !found ? "done" : found ? "later" : "next";
    if (state === "next") found = true;
    return { ...step, state };
  });
}

/**
 * A visitor's own clip links for the demo provider: one to three https addresses, one per
 * line (or separated by spaces or commas). Empty input means "use the pre-generated clips".
 * The server does the real checks; this only catches what it would refuse outright.
 */
export function clipLinks(text) {
  const parts = String(text || "").split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return { urls: [], error: "" };
  if (parts.length > 3) return { urls: [], error: "Use at most three links." };
  const urls = [];
  for (const part of parts) {
    let u;
    try {
      u = new URL(part);
    } catch {
      return { urls: [], error: `"${part.slice(0, 60)}" is not a link.` };
    }
    if (u.protocol !== "https:" || u.username || u.password)
      return { urls: [], error: "Each link must start with https:// and carry no sign-in details." };
    urls.push(u.href);
  }
  return { urls, error: "" };
}
