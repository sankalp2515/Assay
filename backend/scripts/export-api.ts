import { harness } from "../test/harness.js";
import { mkdir, writeFile } from "node:fs/promises";
import { services } from "../src/domain/contracts.js";
import { merchantCollection, environment } from "./postman.js";
const h = await harness();
try {
  await mkdir("docs/openapi", { recursive: true });
  for (const service of services) {
    const spec = h.apps[service].swagger();
    await writeFile(
      "docs/openapi/" + service + ".json",
      JSON.stringify(spec, null, 2),
    );
  }
  const collection = {
    info: {
      name: "Assay — backend API smoke",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "commerce_url", value: "http://127.0.0.1:4100" },
      { key: "operator_token", value: "" },
    ],
    item: [
      {
        name: "Commerce health",
        request: { method: "GET", url: "{{commerce_url}}/health" },
        event: [
          {
            listen: "test",
            script: {
              type: "text/javascript",
              exec: [
                "pm.test('Commerce alive', () => pm.response.to.have.status(200));",
                "pm.test('Explicit sandbox environment', () => pm.expect(pm.response.json().environment).to.eql('sandbox'));    ",
              ],
            },
          },
        ],
      },
      {
        name: "Authenticated batch list",
        request: {
          method: "GET",
          url: "{{commerce_url}}/v1/batches?limit=10",
          header: [
            { key: "Authorization", value: "Bearer {{operator_token}}" },
          ],
        },
        event: [
          {
            listen: "test",
            script: {
              type: "text/javascript",
              exec: [
                "pm.test('Authorized list', () => pm.response.to.have.status(200));",
                "pm.test('Bounded page', () => pm.expect(pm.response.json().items.length).to.be.at.most(10));",
              ],
            },
          },
        ],
      },
    ],
  };
  await writeFile(
    "docs/postman.collection.json",
    JSON.stringify(collection, null, 2),
  );
  await mkdir("docs/postman", { recursive: true });
  await writeFile("docs/postman/assay-merchant.postman_collection.json", JSON.stringify(merchantCollection(), null, 2));
  await writeFile("docs/postman/local.postman_environment.json", JSON.stringify(environment("Assay local", "http://127.0.0.1:4100"), null, 2));
  await writeFile("docs/postman/hosted-sandbox.postman_environment.json", JSON.stringify(environment("Assay hosted Sandbox", "https://<your-domain>"), null, 2));
  console.log(
    "Exported five OpenAPI documents, a Postman smoke collection and the merchant collection.",
  );
} finally {
  await h.close();
}
