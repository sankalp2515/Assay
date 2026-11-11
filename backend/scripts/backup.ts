import "./config.js";
import { readFile, writeFile } from "node:fs/promises";
import { postgres } from "../src/core/database.js";
import { backup, restore } from "../src/core/backup.js";
import { services, type Service } from "../src/domain/contracts.js";
const [mode, service, file] = process.argv.slice(2);
if (
  !["save", "restore"].includes(mode ?? "") ||
  !services.includes(service as Service) ||
  !file
)
  throw new Error(
    "Usage: npm run backup -- save|restore service private-file.pvd",
  );
if (!process.env.MAINTENANCE_DATABASE_URL || !process.env.BACKUP_ENCRYPTION_KEY)
  throw new Error(
    "Set private MAINTENANCE_DATABASE_URL and base64 BACKUP_ENCRYPTION_KEY (32 random bytes)",
  );
const db = postgres(process.env.MAINTENANCE_DATABASE_URL);
try {
  const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY, "base64");
  if (mode === "save") {
    const data = await backup(db, service as Service, key);
    await writeFile(file!, data, { mode: 0o600, flag: "wx" });
    console.log(
      JSON.stringify({ status: "encrypted_snapshot_written", service }),
    );
  } else {
    const result = await restore(
      db,
      service as Service,
      key,
      await readFile(file!),
    );
    console.log(
      JSON.stringify({ status: "restored_to_empty_database", ...result }),
    );
  }
} catch {
  console.error(
    "Backup/restore failed. Check private configuration, key, schema versions and empty target. No credentials printed.",
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
