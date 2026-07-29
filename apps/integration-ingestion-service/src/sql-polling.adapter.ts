import { BadRequestException, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { z } from "zod";
import { env } from "./environment.js";

export type ResolvedCredential = { username: string; password: string };
export type SqlPollCheckpoint = { watermark: string; tieBreaker: string };
export type SourceTriggerCandidate = {
  sourceRecordId?: string;
  occurredAt?: string;
  payload: unknown;
  metadata: Record<string, string | number | boolean | null>;
};
export interface SqlPollingAdapter<TConfig> {
  readonly engine: "POSTGRESQL";
  validateConfiguration(config: unknown): TConfig;
  testConnection(
    config: TConfig,
    credential: ResolvedCredential,
  ): Promise<void>;
  poll(
    config: TConfig,
    credential: ResolvedCredential,
    checkpoint: SqlPollCheckpoint | null,
  ): Promise<{
    rows: SourceTriggerCandidate[];
    nextCheckpoint: SqlPollCheckpoint | null;
  }>;
}

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/);
const configSchema = z
  .object({
    engine: z.literal("POSTGRESQL").default("POSTGRESQL"),
    host: z.string().min(1).max(253),
    port: z.coerce.number().int().min(1).max(65535).default(5432),
    database: z.string().min(1).max(63),
    sslMode: z.enum(["DISABLE", "REQUIRE"]).default("DISABLE"),
    schema: identifier,
    tableOrView: identifier,
    selectedColumns: z.array(identifier).min(1),
    watermarkColumn: identifier,
    watermarkType: z.enum(["TIMESTAMP", "BIGINT"]),
    tieBreakerColumn: identifier,
    tieBreakerType: z.enum(["UUID", "STRING", "BIGINT"]),
    sourceRecordIdColumn: identifier,
    occurredAtColumn: identifier.nullable().optional(),
    pollIntervalSeconds: z.coerce.number().int().min(5).max(86_400).default(60),
    batchSize: z.coerce.number().int().positive(),
    statementTimeoutMs: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .default(5000),
    initialLookbackMinutes: z.coerce.number().int().min(1),
  })
  .strict();
export type PostgresPollingConfig = z.infer<typeof configSchema>;

@Injectable()
export class PostgresSqlPollingAdapter implements SqlPollingAdapter<PostgresPollingConfig> {
  readonly engine = "POSTGRESQL" as const;

  validateConfiguration(input: unknown): PostgresPollingConfig {
    const parsed = configSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("Invalid SQL polling configuration.");
    const environment = env();
    if (parsed.data.batchSize > environment.SQL_POLL_MAX_BATCH_SIZE)
      throw new BadRequestException(
        "SQL batch size exceeds the configured maximum.",
      );
    if (
      parsed.data.initialLookbackMinutes >
      environment.SQL_POLL_MAX_INITIAL_LOOKBACK_MINUTES
    )
      throw new BadRequestException(
        "Initial lookback exceeds the configured maximum.",
      );
    return parsed.data;
  }

  private quote(value: string) {
    if (!identifier.safeParse(value).success)
      throw new BadRequestException("INVALID_SQL_IDENTIFIER");
    return `"${value.replaceAll('"', '""')}"`;
  }

  private pool(config: PostgresPollingConfig, credential: ResolvedCredential) {
    return new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: credential.username,
      password: credential.password,
      max: 2,
      connectionTimeoutMillis: 3000,
      statement_timeout: config.statementTimeoutMs,
      ssl: config.sslMode === "REQUIRE" ? { rejectUnauthorized: false } : false,
    });
  }

  async testConnection(
    config: PostgresPollingConfig,
    credential: ResolvedCredential,
  ) {
    const pool = this.pool(config, credential);
    try {
      const result = await pool.query("SHOW transaction_read_only");
      if (result.rows[0]?.transaction_read_only !== "on")
        throw new BadRequestException("The source account must be read-only.");
    } finally {
      await pool.end();
    }
  }

  async poll(
    config: PostgresPollingConfig,
    credential: ResolvedCredential,
    checkpoint: SqlPollCheckpoint | null,
  ) {
    const required = [
      config.watermarkColumn,
      config.tieBreakerColumn,
      config.sourceRecordIdColumn,
      ...(config.occurredAtColumn ? [config.occurredAtColumn] : []),
    ];
    const columns = [...new Set([...config.selectedColumns, ...required])];
    const quotedColumns = columns
      .map((column) => this.quote(column))
      .join(", ");
    const watermark = this.quote(config.watermarkColumn),
      tieBreaker = this.quote(config.tieBreakerColumn);
    const table = `${this.quote(config.schema)}.${this.quote(config.tableOrView)}`;
    let effective = checkpoint;
    const pool = this.pool(config, credential);
    try {
      if (!effective) {
        if (config.watermarkType === "TIMESTAMP") {
          effective = {
            watermark: new Date(
              Date.now() - config.initialLookbackMinutes * 60_000,
            ).toISOString(),
            tieBreaker: this.minimumTieBreaker(config.tieBreakerType),
          };
        } else {
          const latest = await pool.query(
            `SELECT MAX(${watermark}) AS maximum FROM ${table}`,
          );
          const maximum =
            latest.rows[0]?.maximum == null
              ? 0n
              : BigInt(latest.rows[0].maximum);
          effective = {
            watermark: (maximum - BigInt(config.batchSize) - 1n).toString(),
            tieBreaker: this.minimumTieBreaker(config.tieBreakerType),
          };
        }
      }
      const query = `SELECT ${quotedColumns} FROM ${table} WHERE (${watermark} > $1 OR (${watermark} = $1 AND ${tieBreaker} > $2)) ORDER BY ${watermark} ASC, ${tieBreaker} ASC LIMIT $3`;
      const result = await pool.query(query, [
        this.watermarkValue(effective.watermark, config.watermarkType),
        this.tieBreakerValue(effective.tieBreaker, config.tieBreakerType),
        config.batchSize,
      ]);
      const rows = result.rows.map((row) => ({
        sourceRecordId: String(row[config.sourceRecordIdColumn]),
        ...(config.occurredAtColumn && row[config.occurredAtColumn] != null
          ? { occurredAt: new Date(row[config.occurredAtColumn]).toISOString() }
          : {}),
        payload: Object.fromEntries(
          columns.map((column) => [column, row[column]]),
        ),
        metadata: {
          engine: "POSTGRESQL",
          watermark: this.serializeWatermark(
            row[config.watermarkColumn],
            config.watermarkType,
          ),
          tieBreaker: String(row[config.tieBreakerColumn]),
        },
      }));
      const last = result.rows.at(-1);
      return {
        rows,
        nextCheckpoint: last
          ? {
              watermark: this.serializeWatermark(
                last[config.watermarkColumn],
                config.watermarkType,
              ),
              tieBreaker: String(last[config.tieBreakerColumn]),
            }
          : checkpoint,
      };
    } finally {
      await pool.end();
    }
  }

  private minimumTieBreaker(type: PostgresPollingConfig["tieBreakerType"]) {
    if (type === "BIGINT") return "-9223372036854775808";
    if (type === "UUID") return "00000000-0000-0000-0000-000000000000";
    return "";
  }
  private watermarkValue(
    value: string,
    type: PostgresPollingConfig["watermarkType"],
  ) {
    return type === "BIGINT" ? BigInt(value).toString() : new Date(value);
  }
  private serializeWatermark(
    value: unknown,
    type: PostgresPollingConfig["watermarkType"],
  ) {
    return type === "BIGINT"
      ? String(value)
      : new Date(value as string | Date).toISOString();
  }
  private tieBreakerValue(
    value: string,
    type: PostgresPollingConfig["tieBreakerType"],
  ) {
    return type === "BIGINT" ? BigInt(value).toString() : value;
  }
}
