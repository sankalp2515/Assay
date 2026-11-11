import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database.js";
import { services, type Service } from "../domain/contracts.js";

const coreTables = ["entities", "commands", "outbox", "audit"] as const;
function tables(service: Service) {
  return [
    ...coreTables,
    ...(service === "payments"
      ? ["money_accounts", "unit_settlements", "financial_journal"]
      : []),
  ];
}
function validKey(key: Buffer) {
  if (key.length !== 32)
    throw new Error("Backup key must be exactly 32 random bytes");
}
/** Encrypted logical service snapshot, not PITR and not a media-file backup. */
export async function backup(db: Database, service: Service, key: Buffer) {
  validKey(key);
  const payload = await db.maintenanceTx(async (q) => {
    await q.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const records: Record<string, unknown[]> = {};
    for (const table of tables(service)) {
      records[table] = (
        await q.query(`SELECT row_to_json(t) AS row FROM ${table} t`)
      ).rows.map((r) => r.row);
    }
    const versions = (
      await q.query("SELECT version FROM schema_migrations ORDER BY version")
    ).rows.map((r) => r.version);
    return {
      format: 1,
      service,
      created_at: new Date().toISOString(),
      versions,
      records,
    };
  });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from("PVD1"),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}
export async function restore(
  db: Database,
  service: Service,
  key: Buffer,
  encrypted: Buffer,
) {
  validKey(key);
  if (encrypted.length < 33 || encrypted.subarray(0, 4).toString() !== "PVD1")
    throw new Error("Invalid backup envelope");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    encrypted.subarray(4, 16),
  );
  decipher.setAuthTag(encrypted.subarray(16, 32));
  const clear = Buffer.concat([
    decipher.update(encrypted.subarray(32)),
    decipher.final(),
  ]);
  const data = z
    .strictObject({
      format: z.literal(1),
      service: z.enum(services),
      created_at: z.iso.datetime(),
      versions: z.array(z.number().int()),
      records: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
    })
    .parse(JSON.parse(clear.toString()));
  if (
    data.service !== service ||
    Object.keys(data.records).sort().join() !== tables(service).sort().join()
  )
    throw new Error("Wrong service or table manifest");
  await db.maintenanceTx(async (q) => {
    // Offline target only: this locks admission while checking and loading the empty DB.
    for (const table of tables(service))
      await q.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
    const versions = (
      await q.query("SELECT version FROM schema_migrations ORDER BY version")
    ).rows.map((r) => r.version);
    if (JSON.stringify(versions) !== JSON.stringify(data.versions))
      throw new Error("Migrate target to the same schema version first");
    for (const table of tables(service)) {
      if (
        Number(
          (await q.query(`SELECT count(*) AS count FROM ${table}`)).rows[0]!
            .count,
        ) !== 0
      )
        throw new Error("Restore refuses a nonempty target");
      for (const row of data.records[table]!) {
        await q.query(
          `INSERT INTO ${table} OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_record(NULL::${table},$1::jsonb)`,
          [JSON.stringify(row)],
        );
      }
    }
    await q.query(
      "SELECT setval(pg_get_serial_sequence('audit','sequence'),GREATEST(COALESCE((SELECT max(sequence) FROM audit),0),1),EXISTS(SELECT 1 FROM audit))",
    );
  });
  return {
    service,
    restored_records: Object.values(data.records).reduce(
      (n, r) => n + r.length,
      0,
    ),
    snapshot_at: data.created_at,
  };
}
