# Assay MCP server

Register video tasks, open batches, and read delivery evidence from an MCP client. The server exposes no tools for approving a charge, refunding, cancelling, or managing keys.

Requires Node 22.20+ and access to an Assay deployment. Create an `integration`-scope key and provide `ASSAY_API_KEY` and `ASSAY_BASE_URL` through your MCP client's environment configuration.

Install the tarball from [Assay Releases](https://github.com/sankalp2515/Assay/releases):

```sh
npm install -g https://github.com/sankalp2515/Assay/releases/download/v0.1.0/sankalp2515-assay-mcp-0.1.0.tgz
```

Configure the client to start `assay-mcp` over stdio. Keep the integration key in the client’s private settings or a secret manager. See the [merchant integration guide](https://github.com/sankalp2515/Assay/blob/main/backend/docs/INTEGRATE.md) for the API workflow.

From a source checkout, run `npm ci` and `npm run mcp` in `backend/`.
