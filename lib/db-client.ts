import { sql } from "@/lib/db";

type QueryError = Error & { code?: string };
type QueryResult<T = Record<string, any>[]> = { data: T | null; error: QueryError | null; count?: number | null };
type Filter = { column: string; operator: "eq" | "neq" | "gt" | "lt" | "ilike" | "is" | "in"; value: unknown };
type Order = { column: string; ascending: boolean };

type SelectOptions = { count?: "exact"; head?: boolean };
type UpsertOptions = { onConflict?: string };

const TABLES = new Set([
  "profiles",
  "subscriptions",
  "provider_cache",
  "search_queries",
  "establishments",
  "search_results",
  "saved_establishments",
  "saved_lead_lists",
  "stripe_webhook_events",
  "search_access_orders",
  "search_access_bulk_orders",
  "search_ai_format_orders"
]);

function assertIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Identificador SQL inválido: ${value}`);
  }
  return value;
}

function assertTable(table: string) {
  if (!TABLES.has(table)) {
    throw new Error(`Tabela não permitida: ${table}`);
  }
  return table;
}

function toColumns(record: Record<string, unknown>) {
  return Object.keys(record).filter((key) => typeof record[key] !== "undefined");
}

function normalizeRows<T>(value: T | T[]) {
  return Array.isArray(value) ? value : [value];
}

function parseColumns(columns: string) {
  const trimmed = columns.trim();
  if (!trimmed || trimmed === "*") return { base: ["*"], relations: [] as string[] };

  const relations: string[] = [];
  const base = trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const relation = item.match(/^([a-z_][a-z0-9_]*)\([^)]*\)$/i)?.[1];
      if (relation) {
        relations.push(relation);
        return false;
      }
      return true;
    })
    .map(assertIdentifier);

  return { base: base.length ? base : ["*"], relations };
}

function buildSelectList(table: string, columns: string) {
  const parsed = parseColumns(columns);
  const base = parsed.base.includes("*") ? "t.*" : parsed.base.map((column) => `t.${column}`).join(", ");
  const relationSelects: string[] = [];
  let joins = "";

  if (table === "search_results" && parsed.relations.includes("establishments")) {
    relationSelects.push("to_jsonb(establishments.*) AS establishments");
    joins += " LEFT JOIN establishments ON establishments.id = t.establishment_id";
  }

  if (table === "saved_establishments") {
    if (parsed.relations.includes("establishments")) {
      relationSelects.push("to_jsonb(establishments.*) AS establishments");
      joins += " LEFT JOIN establishments ON establishments.id = t.establishment_id";
    }
    if (parsed.relations.includes("saved_lead_lists")) {
      relationSelects.push("to_jsonb(saved_lead_lists.*) AS saved_lead_lists");
      joins += " LEFT JOIN saved_lead_lists ON saved_lead_lists.id = t.list_id";
    }
  }

  return {
    selectList: [base, ...relationSelects].filter(Boolean).join(", "),
    joins
  };
}

function buildWhere(filters: Filter[], startIndex: number) {
  const params: unknown[] = [];
  const clauses: string[] = [];

  for (const filter of filters) {
    const column = assertIdentifier(filter.column);
    if (filter.operator === "is") {
      clauses.push(filter.value === null ? `t.${column} IS NULL` : `t.${column} IS NOT NULL`);
      continue;
    }

    params.push(filter.value);
    const placeholder = `$${startIndex + params.length - 1}`;

    if (filter.operator === "in") {
      clauses.push(`t.${column} = ANY(${placeholder})`);
    } else if (filter.operator === "eq") {
      clauses.push(`t.${column} = ${placeholder}`);
    } else if (filter.operator === "neq") {
      clauses.push(`t.${column} <> ${placeholder}`);
    } else if (filter.operator === "gt") {
      clauses.push(`t.${column} > ${placeholder}`);
    } else if (filter.operator === "lt") {
      clauses.push(`t.${column} < ${placeholder}`);
    } else if (filter.operator === "ilike") {
      clauses.push(`t.${column} ILIKE ${placeholder}`);
    }
  }

  return {
    whereSql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function buildOrder(orders: Order[]) {
  if (!orders.length) return "";
  return ` ORDER BY ${orders.map((order) => `t.${assertIdentifier(order.column)} ${order.ascending ? "ASC" : "DESC"}`).join(", ")}`;
}

function asQueryError(error: unknown): QueryError {
  if (error instanceof Error) return error as QueryError;
  return new Error(String(error)) as QueryError;
}

class DbQuery<T = Record<string, any>[]> implements PromiseLike<QueryResult<T>> {
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private selected = "*";
  private selectOptions: SelectOptions = {};
  private payload: unknown;
  private upsertOptions: UpsertOptions = {};
  private limitCount: number | null = null;
  private resultMode: "many" | "single" | "maybeSingle" = "many";
  private orExpression = "";

  constructor(private readonly table: string) {
    assertTable(table);
  }

  select(columns = "*", options: SelectOptions = {}): DbQuery<Record<string, any>[]> {
    this.selected = columns;
    this.selectOptions = options;
    return this as unknown as DbQuery<Record<string, any>[]>;
  }

  insert(payload: unknown) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  upsert(payload: unknown, options: UpsertOptions = {}) {
    this.action = "upsert";
    this.payload = payload;
    this.upsertOptions = options;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, operator: "eq", value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ column, operator: "neq", value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ column, operator: "gt", value });
    return this;
  }

  ilike(column: string, value: unknown) {
    this.filters.push({ column, operator: "ilike", value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ column, operator: "is", value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ column, operator: "in", value });
    return this;
  }

  or(expression: string) {
    this.orExpression = expression;
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending: options.ascending ?? true });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single(): DbQuery<Record<string, any>> {
    this.resultMode = "single";
    return this as unknown as DbQuery<Record<string, any>>;
  }

  maybeSingle(): DbQuery<Record<string, any>> {
    this.resultMode = "maybeSingle";
    return this as unknown as DbQuery<Record<string, any>>;
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult<T>> {
    try {
      if (this.action === "select") return await this.executeSelect();
      if (this.action === "insert") return await this.executeInsert();
      if (this.action === "update") return await this.executeUpdate();
      if (this.action === "delete") return await this.executeDelete();
      return await this.executeUpsert();
    } catch (error) {
      return { data: null, error: asQueryError(error), count: null };
    }
  }

  private applyResultMode(rows: unknown[]): QueryResult<T> {
    if (this.resultMode === "single") {
      if (rows.length !== 1) {
        return { data: null, error: new Error("Registro não encontrado.") as QueryError };
      }
      return { data: rows[0] as T, error: null };
    }

    if (this.resultMode === "maybeSingle") {
      return { data: (rows[0] ?? null) as T | null, error: null };
    }

    return { data: rows as T, error: null };
  }

  private buildOrClause(params: unknown[], startIndex: number) {
    if (!this.orExpression) return "";
    const clauses: string[] = [];

    for (const part of this.orExpression.split(",")) {
      const [column, operator, ...rest] = part.split(".");
      const value = rest.join(".");
      const safeColumn = assertIdentifier(column ?? "");

      if (operator === "is" && value === "null") {
        clauses.push(`t.${safeColumn} IS NULL`);
      } else if (operator === "lt") {
        params.push(value);
        clauses.push(`t.${safeColumn} < $${startIndex + params.length - 1}`);
      } else if (operator === "eq") {
        params.push(value);
        clauses.push(`t.${safeColumn} = $${startIndex + params.length - 1}`);
      }
    }

    return clauses.length ? ` AND (${clauses.join(" OR ")})` : "";
  }

  private async executeSelect(): Promise<QueryResult<T>> {
    const { whereSql, params } = buildWhere(this.filters, 1);
    const allParams = [...params];
    const orSql = this.buildOrClause(allParams, allParams.length + 1);
    const whereWithOr = whereSql ? `${whereSql}${orSql}` : orSql ? ` WHERE ${orSql.replace(/^ AND /, "")}` : "";

    if (this.selectOptions.count === "exact" && this.selectOptions.head) {
      const rows = await sql.query(`SELECT count(*)::int AS count FROM ${assertTable(this.table)} t${whereWithOr}`, allParams);
      return { data: null, error: null, count: Number(rows[0]?.count ?? 0) };
    }

    const { selectList, joins } = buildSelectList(this.table, this.selected);
    const limitSql = this.limitCount === null ? "" : ` LIMIT ${Math.max(0, this.limitCount)}`;
    const rows = await sql.query(
      `SELECT ${selectList} FROM ${assertTable(this.table)} t${joins}${whereWithOr}${buildOrder(this.orders)}${limitSql}`,
      allParams
    );

    return this.applyResultMode(rows);
  }

  private async executeInsert(): Promise<QueryResult<T>> {
    const rows = normalizeRows(this.payload as Record<string, unknown> | Record<string, unknown>[]);
    if (!rows.length) return { data: [] as T, error: null };

    const columns = toColumns(rows[0] as Record<string, unknown>).map(assertIdentifier);
    const params: unknown[] = [];
    const valuesSql = rows
      .map((row) => {
        const record = row as Record<string, unknown>;
        const placeholders = columns.map((column) => {
          params.push(record[column]);
          return `$${params.length}`;
        });
        return `(${placeholders.join(", ")})`;
      })
      .join(", ");

    const returning = this.selected ? ` RETURNING ${parseColumns(this.selected).base.includes("*") ? "*" : parseColumns(this.selected).base.join(", ")}` : "";
    const result = await sql.query(`INSERT INTO ${assertTable(this.table)} (${columns.join(", ")}) VALUES ${valuesSql}${returning}`, params);
    return this.applyResultMode(result);
  }

  private async executeUpdate(): Promise<QueryResult<T>> {
    const record = this.payload as Record<string, unknown>;
    const columns = toColumns(record).map(assertIdentifier);
    const params = columns.map((column) => record[column]);
    const setSql = columns.map((column, index) => `${column} = $${index + 1}`).join(", ");
    const { whereSql, params: whereParams } = buildWhere(this.filters, params.length + 1);
    const allParams = [...params, ...whereParams];
    const orSql = this.buildOrClause(allParams, allParams.length + 1);
    const whereWithOr = whereSql ? `${whereSql}${orSql}` : orSql ? ` WHERE ${orSql.replace(/^ AND /, "")}` : "";
    const returning = this.selected ? ` RETURNING ${parseColumns(this.selected).base.includes("*") ? "*" : parseColumns(this.selected).base.join(", ")}` : "";
    const result = await sql.query(`UPDATE ${assertTable(this.table)} t SET ${setSql}${whereWithOr}${returning}`, allParams);
    return this.applyResultMode(result);
  }

  private async executeDelete(): Promise<QueryResult<T>> {
    const { whereSql, params } = buildWhere(this.filters, 1);
    const result = await sql.query(`DELETE FROM ${assertTable(this.table)} t${whereSql}`, params);
    return { data: result as T, error: null };
  }

  private async executeUpsert(): Promise<QueryResult<T>> {
    const rows = normalizeRows(this.payload as Record<string, unknown> | Record<string, unknown>[]);
    if (!rows.length) return { data: [] as T, error: null };

    const columns = toColumns(rows[0] as Record<string, unknown>).map(assertIdentifier);
    const params: unknown[] = [];
    const valuesSql = rows
      .map((row) => {
        const record = row as Record<string, unknown>;
        const placeholders = columns.map((column) => {
          params.push(record[column]);
          return `$${params.length}`;
        });
        return `(${placeholders.join(", ")})`;
      })
      .join(", ");
    const conflicts = (this.upsertOptions.onConflict ?? columns[0] ?? "id")
      .split(",")
      .map((column) => assertIdentifier(column.trim()))
      .filter(Boolean);
    const updateColumns = columns.filter((column) => !conflicts.includes(column));
    const updateSql = updateColumns.length
      ? `DO UPDATE SET ${updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}`
      : "DO NOTHING";
    const returning = this.selected ? ` RETURNING ${parseColumns(this.selected).base.includes("*") ? "*" : parseColumns(this.selected).base.join(", ")}` : "";
    const result = await sql.query(
      `INSERT INTO ${assertTable(this.table)} (${columns.join(", ")}) VALUES ${valuesSql} ON CONFLICT (${conflicts.join(", ")}) ${updateSql}${returning}`,
      params
    );
    return this.applyResultMode(result);
  }
}

export function createDbClient() {
  return {
    from<T = Record<string, any>[]>(table: string) {
      return new DbQuery<T>(table);
    }
  };
}
