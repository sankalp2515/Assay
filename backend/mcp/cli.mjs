#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Assay } from "./sdk/src/index.js";
import { createAssayMcp } from "./src/mcp/server.js";

const { ASSAY_API_KEY, ASSAY_BASE_URL } = process.env;
if (!ASSAY_API_KEY || !ASSAY_BASE_URL) {
  console.error("Set ASSAY_API_KEY and ASSAY_BASE_URL");
  process.exit(2);
}

await createAssayMcp(new Assay({ apiKey: ASSAY_API_KEY, baseUrl: ASSAY_BASE_URL }))
  .connect(new StdioServerTransport());
