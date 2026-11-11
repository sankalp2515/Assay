import { readFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { Json, Service } from "../domain/contracts.js";
import { digest, id } from "../domain/contracts.js";
import { requireThat } from "./errors.js";
export type Row = Record<string, unknown>;
export interface Sql {
  query<T extends Row = Row>(
    sql: string,
    args?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export class Database {
  constructor(
    private transaction: <T>(f: (q: Sql) => Promise<T>) => Promise<T>,
    public admin: Sql,
    public close: () => Promise<void>,
  ) {}
  // Maintenance tooling only. Runtime requests must use tenant-scoped tx().
  async maintenanceTx<T>(fn: (q: Sql) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }
  async migrate(service: Service) {
    await this.admin.query(
      await readFile(resolve("migrations/001_core.sql"), "utf8"),
    );
    if (service === "payments") {
      await this.admin.query(
        await readFile(resolve("migrations/002_payments.sql"), "utf8"),
      );
      await this.admin.query(
        await readFile(resolve("migrations/004_currencies.sql"), "utf8"),
      );
    }
    if (service === "provider" || service === "delivery")
      await this.admin.query(
        "CREATE UNIQUE INDEX IF NOT EXISTS entities_unit_once_idx ON entities(tenant_id,kind,(body->>'unit_id')) WHERE kind IN ('attempt','artifact')",
      );
    await this.admin.query(
      await readFile(resolve("migrations/003_operations.sql"), "utf8"),
    );
  }
  async tx<T>(tenant: string, fn: (q: Sql) => Promise<T>): Promise<T> {
    return this.transaction(async (q) => {
      await q.query("SET LOCAL ROLE app_runtime");
      await q.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      return fn(q);
    });
  }
  async get<T extends Json>(
    tenant: string,
    kind: string,
    key: string,
  ): Promise<T | undefined> {
    return this.tx(tenant, (q) => this.getIn<T>(q, tenant, kind, key));
  }
  async commandResult<T extends Json>(
    tenant: string,
    kind: string,
    key: string,
    input: unknown,
  ): Promise<T | undefined> {
    return this.tx(tenant, async (q) => {
      const r = await q.query<{ body_hash: string; entity_id: string }>(
        "SELECT body_hash,entity_id FROM commands WHERE tenant_id=$1 AND scope=$2 AND request_key=$3",
        [tenant, kind, key],
      );
      if (!r.rows[0]) return;
      requireThat(
        r.rows[0].body_hash === digest(input),
        "idempotency_conflict",
        "Idempotency key has a different payload",
      );
      return this.getIn<T>(q, tenant, kind, r.rows[0].entity_id);
    });
  }
  async getIn<T extends Json>(
    q: Sql,
    tenant: string,
    kind: string,
    key: string,
    lock = false,
  ): Promise<T | undefined> {
    const r = await q.query<{ body: T }>(
      "SELECT body FROM entities WHERE tenant_id=$1 AND kind=$2 AND id=$3" +
        (lock ? " FOR UPDATE" : ""),
      [tenant, kind, key],
    );
    return r.rows[0]?.body;
  }
  async put(q: Sql, tenant: string, kind: string, key: string, body: Json) {
    await q.query(
      "INSERT INTO entities(tenant_id,kind,id,body) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,kind,id) DO UPDATE SET body=excluded.body,version=entities.version+1,updated_at=now()",
      [tenant, kind, key, JSON.stringify(body)],
    );
    await q.query(
      "INSERT INTO audit(tenant_id,entity_id,action,digest) VALUES($1,$2,$3,$4)",
      [tenant, key, kind, digest(body)],
    );
    if (kind === "batch") {
      const event = {
        id: id(),
        batch_id: key,
        state: body.state,
        version: body.version,
        recorded_at: new Date().toISOString(),
      };
      await q.query(
        "INSERT INTO entities(tenant_id,kind,id,body) VALUES($1,'batch_event',$2,$3)",
        [tenant, event.id, JSON.stringify(event)],
      );
    }
  }
  async list<T extends Json>(
    tenant: string,
    kind: string,
    batch?: string,
    limit = 100,
  ): Promise<T[]> {
    return this.tx(tenant, async (q) => {
      const r = await q.query<{ body: T }>(
        "SELECT body FROM entities WHERE tenant_id=$1 AND kind=$2 AND ($3::text IS NULL OR body->>'batch_id'=$3) ORDER BY created_at,id LIMIT $4",
        [tenant, kind, batch ?? null, limit],
      );
      return r.rows.map((r) => r.body);
    });
  }
  async mutate<T extends Json>(
    tenant: string,
    kind: string,
    key: string,
    fn: (body: T, q: Sql) => Promise<T>,
  ): Promise<T> {
    return this.tx(tenant, async (q) => {
      const body = await this.getIn<T>(q, tenant, kind, key, true);
      requireThat(body, "not_found", "Record not found", 404);
      const next = await fn(body, q);
      await this.put(q, tenant, kind, key, next);
      return next;
    });
  }
  async create<T extends Json>(
    tenant: string,
    kind: string,
    requestKey: string,
    input: unknown,
    body: T,
    enqueue?: { target: Service; path: string; body: Json },
    admit?: (q: Sql) => Promise<void>,
  ): Promise<T> {
    return this.tx(tenant, async (q) => {
      // Serialize the logical command before reserving its external-effect intent.
      await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        tenant + kind + requestKey,
      ]);
      const old = await q.query<{ body_hash: string; entity_id: string }>(
        "SELECT body_hash,entity_id FROM commands WHERE tenant_id=$1 AND scope=$2 AND request_key=$3",
        [tenant, kind, requestKey],
      );
      if (old.rows[0]) {
        requireThat(
          old.rows[0].body_hash === digest(input),
          "idempotency_conflict",
          "Idempotency key has a different payload",
        );
        return (await this.getIn<T>(q, tenant, kind, old.rows[0].entity_id))!;
      }
      if (admit) await admit(q);
      const key = body.id as string;
      await this.put(q, tenant, kind, key, body);
      await q.query(
        "INSERT INTO commands(tenant_id,scope,request_key,body_hash,entity_id) VALUES($1,$2,$3,$4,$5)",
        [tenant, kind, requestKey, digest(input), key],
      );
      if (enqueue)
        await this.enqueue(
          q,
          tenant,
          enqueue.target,
          enqueue.path,
          enqueue.body,
        );
      return body;
    });
  }
  async enqueue(
    q: Sql,
    tenant: string,
    target: Service,
    path: string,
    body: Json,
  ) {
    await q.query(
      "INSERT INTO outbox(id,tenant_id,target,path,body) VALUES($1,$2,$3,$4,$5)",
      [id(), tenant, target, path, JSON.stringify(body)],
    );
  }
}
export async function embedded(path?: string) {
  if (path) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const engine = new PGlite(path);
  await engine.waitReady;
  return new Database(
    (fn) =>
      engine.transaction((t) =>
        fn({
          query: async <T extends Row>(s: string, a?: unknown[]) => {
            const r = await t.query<T>(s, a);
            return { rows: r.rows };
          },
        }),
      ),
    {
      query: async <T extends Row>(s: string, a?: unknown[]) => {
        if (!a) {
          await engine.exec(s);
          return { rows: [] as T[] };
        }
        const r = await engine.query<T>(s, a);
        return { rows: r.rows };
      },
    },
    () => engine.close(),
  );
}
export function postgres(url: string) {
  const pool = new pg.Pool({
    connectionString: url,
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  return new Database(
    async (fn) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await fn({
          query: async <T extends Row>(s: string, a?: unknown[]) => ({
            rows: (await c.query(s, a)).rows as T[],
          }),
        });
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    {
      query: async <T extends Row>(s: string, a?: unknown[]) => ({
        rows: (await pool.query(s, a)).rows as T[],
      }),
    },
    () => pool.end(),
  );
}
