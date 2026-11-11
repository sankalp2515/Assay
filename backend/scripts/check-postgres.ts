import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { postgres } from "../src/core/database.js";
import { id } from "../src/domain/contracts.js";
import { dispatchOutbox } from "../src/core/transport.js";
import type { Context } from "../src/core/context.js";
import { backup, restore } from "../src/core/backup.js";

// Native PostgreSQL integration, isolated from the developer's five data stores.
// Persistent=true intentionally retains private evidence instead of deleting paths.
await mkdir(".local", { recursive: true });
const directory = await mkdtemp(resolve(".local/native-pg-check-"));
const password = randomBytes(24).toString("hex");
const port = Number(process.env.PG_CHECK_PORT ?? 55439);
const cluster = new EmbeddedPostgres({
  databaseDir: resolve(directory, "cluster"),
  user: "postgres",
  password,
  port,
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
let db: ReturnType<typeof postgres> | undefined;
const checks: string[] = [];
try {
  await cluster.initialise();
  await cluster.start();
  db = postgres(url);
  await db.migrate("payments");
  const version = (await db.admin.query("SELECT version() AS version")).rows[0]!
    .version;
  const tenant = id(),
    other = id(),
    record = id();
  const results = await Promise.all(
    Array.from({ length: 16 }, () =>
      db!.create(
        tenant,
        "probe",
        "same-command",
        { value: 1 },
        { id: id(), value: 1 },
      ),
    ),
  );
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
  assert.equal((await db.list(tenant, "probe")).length, 1);
  checks.push("16 concurrent command submissions produce one aggregate");
  await db.tx(tenant, (q) =>
    db!.put(q, tenant, "counter", record, { id: record, value: 0 }),
  );
  await Promise.all(
    Array.from({ length: 24 }, () =>
      db!.mutate(tenant, "counter", record, async (body) => ({
        ...body,
        value: Number(body.value) + 1,
      })),
    ),
  );
  assert.equal((await db.get(tenant, "counter", record))!.value, 24);
  checks.push("24 pooled row-lock mutations preserve every update");
  assert.equal(await db.get(other, "counter", record), undefined);
  await assert.rejects(
    db.tx(other, (q) => db!.put(q, tenant, "counter", id(), { value: 0 })),
  );
  await assert.rejects(
    db.tx(tenant, (q) => q.query("UPDATE audit SET action='tamper'")),
  );
  await assert.rejects(
    db.tx(tenant, (q) => q.query("DELETE FROM financial_journal")),
  );
  checks.push(
    "tenant RLS rejects cross-tenant writes; audit/journal deny mutation",
  );
  await assert.rejects(
    db.tx(tenant, async (q) => {
      await db!.put(q, tenant, "rollback", record, { id: record });
      throw new Error("simulated interruption");
    }),
  );
  assert.equal(await db.get(tenant, "rollback", record), undefined);
  checks.push("failed transaction leaves neither aggregate nor audit record");
  await db.tx(tenant, (q) =>
    db!.enqueue(q, tenant, "commerce", "/internal/probe", {}),
  );
  let firstStarted!: () => void, releaseFirst!: () => void;
  const started = new Promise<void>((r) => {
    firstStarted = r;
  });
  const release = new Promise<void>((r) => {
    releaseFirst = r;
  });
  let calls = 0;
  const context = {
    db,
    call: async () => {
      calls++;
      if (calls === 1) {
        firstStarted();
        await release;
        throw new Error("late failure");
      }
      return {};
    },
  } as unknown as Context;
  const stale = dispatchOutbox(context, tenant);
  await started;
  await db.tx(tenant, (q) =>
    q.query(
      "UPDATE outbox SET lease_until=now()-interval '1 second' WHERE state='SENDING'",
    ),
  );
  await dispatchOutbox(context, tenant);
  releaseFirst();
  await stale;
  const job = await db.tx(tenant, (q) =>
    q.query("SELECT state,attempts FROM outbox"),
  );
  assert.equal(job.rows[0]!.state, "DONE");
  assert.equal(job.rows[0]!.attempts, 2);
  checks.push("expired worker cannot overwrite successful newer lease claim");

  // A restricted login exercises actual DB grants rather than a superuser pool.
  await db.admin.query(
    `CREATE ROLE runtime_probe LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
  );
  await db.admin.query("GRANT app_runtime TO runtime_probe");
  const runtime = new pg.Client({
    connectionString: url.replace("postgres:", "runtime_probe:"),
  });
  await runtime.connect();
  try {
    await assert.rejects(runtime.query("SELECT * FROM entities"));
    await runtime.query("BEGIN");
    await runtime.query("SET LOCAL ROLE app_runtime");
    await runtime.query("SELECT set_config('app.tenant_id',$1,true)", [other]);
    assert.equal(
      (await runtime.query("SELECT * FROM entities")).rows.length,
      0,
    );
    await runtime.query("ROLLBACK");
  } finally {
    await runtime.end();
  }
  checks.push(
    "restricted login cannot read without tenant role and cannot bypass RLS",
  );
  const batch = id(),
    operation = id(),
    unit = id();
  await db.tx(tenant, async (q) => {
    await db!.put(q, tenant, "operation", operation, {
      id: operation,
      kind: "CAPTURE",
      state: "CONFIRMED",
      fixture: true,
    });
    await q.query(
      "INSERT INTO money_accounts(tenant_id,batch_id,captured) VALUES($1,$2,4000)",
      [tenant, batch],
    );
    await q.query(
      "INSERT INTO unit_settlements(tenant_id,unit_id,batch_id,operation_id,amount_minor) VALUES($1,$2,$3,$4,500)",
      [tenant, unit, batch, operation],
    );
    await q.query(
      "INSERT INTO financial_journal(tenant_id,operation_id,event_kind,amount_minor,currency,provider_reference,resource_digest) VALUES($1,$2,'CAPTURE',4000,'USD','NATIVE_TEST_FIXTURE','fixture')",
      [tenant, operation],
    );
  });
  const reservations = await Promise.allSettled(
    Array.from({ length: 2 }, () =>
      db!.tx(tenant, (q) =>
        q.query(
          "UPDATE money_accounts SET reserved_refund=reserved_refund+3000 WHERE tenant_id=$1 AND batch_id=$2",
          [tenant, batch],
        ),
      ),
    ),
  );
  assert.equal(reservations.filter((r) => r.status === "fulfilled").length, 1);
  checks.push(
    "competing refund reservations cannot exceed captured balance on native PostgreSQL",
  );
  const encryptionKey = randomBytes(32);
  const snapshot = await backup(db, "payments", encryptionKey);
  await writeFile(resolve(directory, "snapshot.pvd"), snapshot, {
    mode: 0o600,
  });
  await cluster.createDatabase("restore_probe");
  const restored = postgres(url.replace(/\/postgres$/, "/restore_probe"));
  try {
    await restored.migrate("payments");
    const tampered = Buffer.from(snapshot);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    await assert.rejects(
      restore(restored, "payments", encryptionKey, tampered),
    );
    await restore(restored, "payments", encryptionKey, snapshot);
    assert.equal((await restored.get(tenant, "counter", record))!.value, 24);
    assert.equal(
      (await restored.tx(tenant, (q) => q.query("SELECT state FROM outbox")))
        .rows[0]!.state,
      "DONE",
    );
    assert.equal(
      Number(
        (
          await restored.tx(tenant, (q) =>
            q.query("SELECT reserved_refund FROM money_accounts"),
          )
        ).rows[0]!.reserved_refund,
      ),
      3000,
    );
    assert.equal(
      (
        await restored.tx(tenant, (q) =>
          q.query("SELECT provider_reference FROM financial_journal"),
        )
      ).rows[0]!.provider_reference,
      "NATIVE_TEST_FIXTURE",
    );
    await assert.rejects(
      restore(restored, "payments", encryptionKey, snapshot),
    );
    await restored.tx(tenant, (q) =>
      restored.put(q, tenant, "after_restore", id(), { value: 1 }),
    );
  } finally {
    await restored.close();
  }
  checks.push(
    "encrypted logical snapshot restores to separate DB; tampering/nonempty targets rejected; audit sequence resumes",
  );
  await db.close();
  db = undefined;
  await cluster.stop();
  await cluster.start();
  db = postgres(url);
  assert.equal((await db.get(tenant, "counter", record))!.value, 24);
  checks.push("committed state survives native PostgreSQL stop/start");
  await mkdir("evidence", { recursive: true });
  const report = {
    at: new Date().toISOString(),
    engine: version,
    provenance: "actual local native PostgreSQL",
    checks,
    passed: checks.length,
    limitations: [
      "not managed cloud PostgreSQL",
      "logical service database restore only; media files and cross-service consistency not tested",
      "no external provider or payment lifecycle asserted",
    ],
  };
  await writeFile(
    "evidence/native-postgres.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await db?.close();
  await cluster.stop();
}
