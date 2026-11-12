// Assay as an MCP server: an AI coding agent or support agent (Claude Code, Cursor, any
// MCP client) can open batches, register provider tasks and read delivery evidence.
//
// Deliberately absent: approving a capture, refunding, cancelling, and key management.
// Money moves only after a person approves an exact amount in Assay. The same rule
// holds inside Assay: AI reads and proposes, rules and people decide.
//
//   ASSAY_API_KEY=assay_sk_… ASSAY_BASE_URL=https://… npx tsx src/mcp/server.ts
// Use an `integration`-scope key: it cannot approve money even if a tool were added.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Assay, AssayError } from "../../sdk/src/index.js";

export function createAssayMcp(assay: Assay) {
  const server = new McpServer({ name: "assay", version: "0.1.0" });
  const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
  const run = async (f: () => Promise<unknown>) => {
    try {
      return text(await f());
    } catch (e) {
      if (e instanceof AssayError)
        return { ...text({ error: e.code, message: e.message, status: e.status, retryable: e.retryable }), isError: true };
      throw e;
    }
  };
  const read = { readOnlyHint: true, openWorldHint: false };
  const batchId = z.uuid().describe("Batch id");

  server.registerTool(
    "assay_account",
    { title: "Account", description: "The merchant account and role behind this key.", annotations: read },
    () => run(() => assay.account.get()),
  );
  server.registerTool(
    "assay_list_batches",
    { title: "List batches", description: "Recent batches (deliveries) for this merchant.", annotations: read },
    () => run(() => assay.batches.list()),
  );
  server.registerTool(
    "assay_get_batch",
    {
      title: "Get batch",
      description: "One batch: state, clips, currency, ceiling, and which clips were recovered.",
      inputSchema: { batch_id: batchId },
      annotations: read,
    },
    ({ batch_id }) => run(() => assay.batches.get(batch_id)),
  );
  server.registerTool(
    "assay_timeline",
    {
      title: "Recovery window",
      description:
        "Per-clip timeline: provider retention (estimate), archive, buyer access, PayPal hold and dispute deadlines. at_risk_unit_ids are clips whose provider copy is alive but not yet archived.",
      inputSchema: { batch_id: batchId },
      annotations: read,
    },
    ({ batch_id }) => run(() => assay.batches.timeline(batch_id)),
  );
  server.registerTool(
    "assay_statement",
    {
      title: "Delivery statement",
      description: "The signed per-clip statement, available only after PayPal confirms the capture or void.",
      inputSchema: { batch_id: batchId },
      annotations: read,
    },
    ({ batch_id }) => run(() => assay.batches.statement(batch_id)),
  );
  server.registerTool(
    "assay_dashboard",
    {
      title: "Operations dashboard",
      description: "One row per batch or per clip. Money is in minor units of each row's currency; never add rows of different currencies.",
      inputSchema: { level: z.enum(["batch", "clip"]).default("batch") },
      annotations: read,
    },
    ({ level }) => run(() => assay.operations.dashboard(level)),
  );
  server.registerTool(
    "assay_open_batch",
    {
      title: "Open a batch",
      description:
        "Open a batch when a buyer checks out: an immutable contract of unit_count clips at unit_price_minor, PayPal later authorizes the ceiling. Nothing is charged. Reuse the same idempotency_key to retry.",
      inputSchema: {
        buyer_id: z.uuid(),
        unit_count: z.number().int().min(1).max(10),
        unit_price_minor: z.number().int().min(1).max(100000),
        currency: z.enum(["USD", "EUR", "GBP", "CAD", "AUD", "JPY"]),
        prompt: z.string().min(5).max(2000),
        idempotency_key: z.string().regex(/^[\w.:-]{8,128}$/),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ idempotency_key, ...input }) => run(() => assay.batches.create(input, idempotency_key)),
  );
  server.registerTool(
    "assay_register_task",
    {
      title: "Register a provider task",
      description:
        "Register a video provider task against a clip right after the provider accepts it. Assay archives the output when it finishes, before the provider deletes it. source: runway or replicate (looked up with the merchant's key) or reported (output_url on an approved host).",
      inputSchema: {
        batch_id: batchId,
        unit_id: z.uuid(),
        source: z.enum(["runway", "replicate", "reported"]),
        provider_task_id: z.string().min(1).max(100),
        output_url: z.string().regex(/^https:\/\/\S+$/).optional(),
        deliver_on_archive: z.boolean().optional(),
        idempotency_key: z.string().regex(/^[\w.:-]{8,128}$/),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ batch_id, idempotency_key, ...input }) => run(() => assay.batches.registerTask(batch_id, input, idempotency_key)),
  );
  return server;
}

const isMain = process.argv[1] && /mcp[\\/]server\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  const key = process.env.ASSAY_API_KEY ?? "";
  const base = process.env.ASSAY_BASE_URL ?? "";
  if (!key || !base) {
    console.error("Set ASSAY_API_KEY and ASSAY_BASE_URL");
    process.exit(2);
  }
  await createAssayMcp(new Assay({ apiKey: key, baseUrl: base })).connect(new StdioServerTransport());
}
