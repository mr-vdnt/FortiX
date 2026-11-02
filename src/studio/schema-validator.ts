import { z } from 'zod';

export const MAX_STUDIO_PAYLOAD_BYTES = 65_536; // 64 KB hard payload cap
export const MAX_RECORDS_PER_RESOURCE = 500;
export const MAX_RESOURCES_PER_API = 10;
export const MAX_STUDIO_APIS_PER_PROJECT = 20;
export const MAX_FIELDS_PER_RESOURCE = 20;

export type StudioFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'enum';

export interface StudioFieldDefinition {
  name: string;
  type: StudioFieldType;
  required: boolean;
  unique?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  enumValues?: string[];
  description?: string;
}

const RESERVED_SLUGS = new Set([
  'health',
  'live',
  'ready',
  'metrics',
  'openapi',
  'openapi.json',
  'swagger',
  'docs',
  'api',
  'proxy',
  'admin',
  '__admin',
  '__internal',
  'internal',
  'control',
  'auth',
  'v1',
  'v2',
  'v3',
  'v4',
]);

const RESERVED_FIELD_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const fieldDefinitionSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Field name is required')
      .max(48, 'Field name must not exceed 48 characters')
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Field name must start with a letter and contain only letters, digits, or underscores'),
    type: z.enum(['string', 'number', 'integer', 'boolean', 'enum']),
    required: z.boolean().default(true),
    unique: z.boolean().optional().default(false),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    maxLength: z.number().int().min(1).max(4096).optional(),
    enumValues: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
    description: z.string().trim().max(240).optional(),
  })
  .superRefine((field, ctx) => {
    if (RESERVED_FIELD_NAMES.has(field.name) || field.name === 'id') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Field name '${field.name}' is reserved ('id' is automatically managed by FortiX API Studio)`,
      });
    }
    if (field.type === 'enum') {
      if (!field.enumValues || field.enumValues.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Enum field '${field.name}' must define at least one allowed enumValues entry`,
        });
      }
    }
    if (typeof field.min === 'number' && typeof field.max === 'number' && field.min > field.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Field '${field.name}' min (${field.min}) cannot exceed max (${field.max})`,
      });
    }
  });

export const resourceFieldsArraySchema = z
  .array(fieldDefinitionSchema)
  .min(1, 'At least one field definition is required')
  .max(MAX_FIELDS_PER_RESOURCE, `Maximum ${MAX_FIELDS_PER_RESOURCE} fields per resource`)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const f of fields) {
      const lower = f.name.toLowerCase();
      if (seen.has(lower)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate field name '${f.name}' in resource schema`,
        });
      }
      seen.add(lower);
    }
  });

export interface NormalizedStringResult {
  ok: boolean;
  value?: string;
  error?: string;
}

export function normalizeStudioBasePath(raw: string): NormalizedStringResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'basePath must be a string' };
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) {
    return { ok: false, error: 'basePath must start with "/" (e.g., /api/store)' };
  }
  if (trimmed.length > 80) {
    return { ok: false, error: 'basePath must not exceed 80 characters' };
  }
  if (trimmed.includes('..') || trimmed.includes('//') || /[?#\s\\]/.test(trimmed)) {
    return { ok: false, error: 'basePath contains invalid path traversal or query characters' };
  }

  const normalized = trimmed === '/' ? '/' : trimmed.replace(/\/+$/, '').toLowerCase();
  if (normalized !== '/') {
    const segments = normalized.slice(1).split('/');
    if (segments.length > 4) {
      return { ok: false, error: 'basePath may contain at most 4 path segments' };
    }
    for (const seg of segments) {
      if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(seg)) {
        return {
          ok: false,
          error: `Invalid basePath segment '${seg}': use lowercase letters, numbers, hyphens, or underscores`,
        };
      }
      if (seg === 'proxy' || seg === 'control' || seg === '__admin') {
        return { ok: false, error: `basePath segment '${seg}' is reserved by FortiX Gateway` };
      }
    }
  }
  return { ok: true, value: normalized };
}

export function normalizeStudioVersion(raw: string | undefined): NormalizedStringResult {
  const candidate = (raw ?? 'v1').trim().toLowerCase();
  if (!/^v[0-9]{1,2}(\.[0-9]{1,2})?$/.test(candidate)) {
    return { ok: false, error: 'version must match format v1, v2, or v1.0' };
  }
  return { ok: true, value: candidate };
}

export function normalizeResourceSlug(rawSlugOrName: string): NormalizedStringResult {
  if (typeof rawSlugOrName !== 'string') {
    return { ok: false, error: 'Resource slug must be a string' };
  }
  const slug = rawSlugOrName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug || slug.length < 2 || slug.length > 40) {
    return { ok: false, error: 'Resource slug must be between 2 and 40 characters' };
  }
  if (!/^[a-z][a-z0-9_-]*$/.test(slug)) {
    return { ok: false, error: 'Resource slug must start with a lowercase letter and contain only a-z, 0-9, -, or _' };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, error: `Resource slug '${slug}' is reserved and cannot be used` };
  }
  return { ok: true, value: slug };
}

export function validateRecordIdFormat(rawId: string): NormalizedStringResult {
  const trimmed = rawId.trim();
  if (!trimmed || trimmed.length > 64) {
    return { ok: false, error: 'Record id must be between 1 and 64 characters' };
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed)) {
    return {
      ok: false,
      error: 'Record id must start with an alphanumeric character and contain only letters, digits, hyphens, or underscores',
    };
  }
  return { ok: true, value: trimmed };
}

export interface RecordValidationIssue {
  field: string;
  message: string;
}

export interface RecordValidationResult {
  ok: boolean;
  recordId?: string;
  data?: Record<string, unknown>;
  status?: 400 | 413 | 422;
  error?: string;
  issues?: RecordValidationIssue[];
}

export function validateStudioRecordPayload(
  fields: StudioFieldDefinition[],
  rawPayload: unknown,
  options: { partial: boolean; existingRecordId?: string; maxBytes?: number }
): RecordValidationResult {
  const maxBytes = options.maxBytes ?? MAX_STUDIO_PAYLOAD_BYTES;

  if (rawPayload === null || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return {
      ok: false,
      status: 400,
      error: 'Request body must be a JSON object',
    };
  }

  let serializedLength = 0;
  try {
    serializedLength = Buffer.byteLength(JSON.stringify(rawPayload), 'utf8');
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'Request body could not be serialized as valid JSON',
    };
  }

  if (serializedLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `Payload exceeds maximum allowed size of ${maxBytes} bytes`,
    };
  }

  const input = rawPayload as Record<string, unknown>;
  const fieldMap = new Map<string, StudioFieldDefinition>();
  for (const f of fields) {
    fieldMap.set(f.name, f);
  }

  const issues: RecordValidationIssue[] = [];
  let explicitRecordId: string | undefined;

  for (const key of Object.keys(input)) {
    if (RESERVED_FIELD_NAMES.has(key)) {
      issues.push({ field: key, message: `Forbidden property '${key}'` });
      continue;
    }
    if (key === 'id') {
      const rawIdVal = input.id;
      if (rawIdVal !== undefined) {
        if (typeof rawIdVal !== 'string') {
          issues.push({ field: 'id', message: 'Field "id" must be a string' });
        } else {
          const check = validateRecordIdFormat(rawIdVal);
          if (!check.ok) {
            issues.push({ field: 'id', message: check.error });
          } else if (options.partial && options.existingRecordId && check.value !== options.existingRecordId) {
            issues.push({ field: 'id', message: 'Record "id" is immutable and cannot be changed on PATCH' });
          } else {
            explicitRecordId = check.value;
          }
        }
      }
      continue;
    }
    if (!fieldMap.has(key)) {
      issues.push({
        field: key,
        message: `Unknown field '${key}' is not declared in resource schema`,
      });
    }
  }

  const validatedData: Record<string, unknown> = {};
  let providedFieldCount = 0;

  for (const field of fields) {
    const hasKey = Object.prototype.hasOwnProperty.call(input, field.name);
    const val = input[field.name];

    if (!hasKey || val === undefined) {
      if (!options.partial && field.required) {
        issues.push({ field: field.name, message: `Field '${field.name}' is required` });
      }
      continue;
    }

    if (val === null) {
      if (field.required) {
        issues.push({ field: field.name, message: `Field '${field.name}' cannot be null` });
      } else {
        providedFieldCount++;
        validatedData[field.name] = null;
      }
      continue;
    }

    providedFieldCount++;

    switch (field.type) {
      case 'string': {
        if (typeof val !== 'string') {
          issues.push({ field: field.name, message: `Field '${field.name}' must be a string` });
          break;
        }
        const maxLen = field.maxLength ?? 1024;
        if (val.length > maxLen) {
          issues.push({
            field: field.name,
            message: `Field '${field.name}' exceeds maximum length of ${maxLen} characters`,
          });
          break;
        }
        if (field.required && val.trim().length === 0) {
          issues.push({ field: field.name, message: `Field '${field.name}' cannot be empty` });
          break;
        }
        validatedData[field.name] = val;
        break;
      }
      case 'enum': {
        if (typeof val !== 'string') {
          issues.push({ field: field.name, message: `Field '${field.name}' must be a string enum value` });
          break;
        }
        const allowed = field.enumValues ?? [];
        if (!allowed.includes(val)) {
          issues.push({
            field: field.name,
            message: `Field '${field.name}' must be one of: ${allowed.join(', ')}`,
          });
          break;
        }
        validatedData[field.name] = val;
        break;
      }
      case 'number': {
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          issues.push({ field: field.name, message: `Field '${field.name}' must be a finite number` });
          break;
        }
        if (typeof field.min === 'number' && val < field.min) {
          issues.push({ field: field.name, message: `Field '${field.name}' must be >= ${field.min}` });
          break;
        }
        if (typeof field.max === 'number' && val > field.max) {
          issues.push({ field: field.name, message: `Field '${field.name}' must be <= ${field.max}` });
          break;
        }
        validatedData[field.name] = Number(val);
        break;
      }
      case 'integer': {
        if (typeof val !== 'number' || !Number.isInteger(val)) {
          issues.push({ field: field.name, message: `Field '${field.name}' must be an integer` });
          break;
        }
        if (typeof field.min === 'number' && val < field.min) {
          issues.push({ field: field.name, message: `Field '${field.name}' must be >= ${field.min}` });
          break;
        }
        if (typeof field.max === 'number' && val > field.max) {
          issues.push({ field: field.name, message: `Field '${field.name}' must be <= ${field.max}` });
          break;
        }
        validatedData[field.name] = val;
        break;
      }
      case 'boolean': {
        if (typeof val !== 'boolean') {
          issues.push({ field: field.name, message: `Field '${field.name}' must be a boolean` });
          break;
        }
        validatedData[field.name] = val;
        break;
      }
    }
  }

  if (options.partial && providedFieldCount === 0 && issues.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'PATCH payload must include at least one updatable schema field',
    };
  }

  if (issues.length > 0) {
    return {
      ok: false,
      status: 422,
      error: 'Schema validation failed',
      issues,
    };
  }

  return {
    ok: true,
    recordId: explicitRecordId,
    data: validatedData,
  };
}
