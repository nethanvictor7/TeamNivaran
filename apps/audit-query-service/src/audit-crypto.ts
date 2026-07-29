import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const blockedKey =
  /(password|secret|token|authorization|cookie|credential|private.?key|raw.?body|binary|content)$/i;

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return String(value);
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function auditRecordHash(value: Record<string, unknown>) {
  return sha256(canonicalJson(value));
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : "[NON_FINITE]";
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !blockedKey.test(key))
        .slice(0, 40)
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)]),
    );
  }
  return String(value).slice(0, 500);
}

export function sanitizeAuditMetadata(value: unknown) {
  return sanitizeValue(value, 0) as Record<string, unknown>;
}

type CursorPayload = {
  v: 1;
  organizationId: string;
  filtersHash: string;
  occurredAt: string;
  id: string;
  expiresAt: number;
};

export function encodeCursor(
  input: Omit<CursorPayload, "v" | "expiresAt">,
  secret: string,
  ttlSeconds = 900,
) {
  const payload: CursorPayload = {
    v: 1,
    ...input,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(canonicalJson(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function decodeCursor(
  value: string,
  expected: { organizationId: string; filtersHash: string },
  secret: string,
) {
  const [body, signature] = value.split(".");
  if (!body || !signature) throw new Error("CURSOR_INVALID");
  const expectedSignature = createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right))
    throw new Error("CURSOR_INVALID");
  const parsed = JSON.parse(
    Buffer.from(body, "base64url").toString("utf8"),
  ) as CursorPayload;
  if (
    parsed.v !== 1 ||
    parsed.organizationId !== expected.organizationId ||
    parsed.filtersHash !== expected.filtersHash ||
    parsed.expiresAt < Math.floor(Date.now() / 1000)
  )
    throw new Error("CURSOR_INVALID");
  return parsed;
}

export function protectCsvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function csvRow(values: unknown[]) {
  return values
    .map((value) => {
      const protectedValue = protectCsvCell(value);
      return `"${protectedValue.replaceAll('"', '""')}"`;
    })
    .join(",");
}
