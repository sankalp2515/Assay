import "./config.js";
import { postgres } from "../src/core/database.js";
import { services, type Service } from "../src/domain/contracts.js";
const service = process.env.SERVICE_NAME as Service;
if (!services.includes(service) || !process.env.MIGRATION_DATABASE_URL)
  throw new Error(
    "Set SERVICE_NAME and an admin MIGRATION_DATABASE_URL only for this migration job",
  );
const db = postgres(process.env.MIGRATION_DATABASE_URL);
try {
  await db.migrate(service);
  console.log("Applied versioned migrations for " + service);
} finally {
  await db.close();
}
