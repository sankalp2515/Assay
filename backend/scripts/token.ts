import { readFile } from "node:fs/promises";
import { token } from "../src/core/auth.js";
const role = process.argv[2] ?? "operator";
if (!["operator", "buyer"].includes(role))
  throw new Error("Use operator or buyer");
const demo = JSON.parse(await readFile(".local/demo.json", "utf8")) as {
  tenant_id: string;
  operator_id: string;
  buyer_id: string;
};
const publicKeys = JSON.parse(
  await readFile(".local/public-keys.json", "utf8"),
) as Record<string, string>;
console.log(
  await token(
    {
      name: "operator",
      privateKey: await readFile(".local/keys/operator.pem", "utf8"),
      publicKeys,
    },
    "commerce",
    demo.tenant_id,
    role,
    role === "buyer" ? demo.buyer_id : demo.operator_id,
  ),
);
