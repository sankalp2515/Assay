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
  SETTLEMENT_REQUESTED: 5, CLAIMED: 5, CANCEL_REQUESTED: 2, CLOSED: 6,
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
