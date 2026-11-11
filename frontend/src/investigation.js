import { request } from "./api.js";
export async function investigateBatch(id) {
  const root = `/v1/batches/${id}`;
  let result = await request(root + "/investigate", {
    body: {},
    intent: `investigation:${id}:${crypto.randomUUID()}`,
  });
  for (
    let n = 0;
    n < 80 && ["RESERVED", "RUNNING"].includes(result.state);
    n++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    result = await request(root + "/investigation");
  }
  if (result.state !== "VALID")
    throw Error(
      result.state === "WAITING_FOR_AI"
        ? "AI is unavailable. Payment history and reconciliation remain accessible."
        : "The investigation is not conclusive. Review its findings in the batch before preparing a refund.",
    );
  await request(root + "/investigate", {
    body: {},
    intent: `adopt:${id}:${result.id}`,
  });
  return result;
}
