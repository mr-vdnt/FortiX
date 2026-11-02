import type { Request, Response } from 'express';
import { and, asc, eq, ne } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { apiRoutes, studioApis, studioRecords, studioResources } from '../db/schema.js';
import {
  MAX_RECORDS_PER_RESOURCE,
  MAX_STUDIO_PAYLOAD_BYTES,
  type StudioFieldDefinition,
  validateRecordIdFormat,
  validateStudioRecordPayload,
} from './schema-validator.js';
import { generateStudioOpenApiSpec } from './openapi-generator.js';

export interface StudioGatewayDispatchContext {
  route: typeof apiRoutes.$inferSelect;
  routeId: string;
  requestId: string;
  studioApiId: string;
}

async function readJsonBodySafe(
  req: Request
): Promise<{
  ok: boolean;
  body?: unknown;
  status?: 400 | 413;
  error?: string;
}> {
  const contentLengthHeader = req.headers['content-length'];
  if (typeof contentLengthHeader === 'string') {
    const parsedLen = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(parsedLen) && parsedLen > MAX_STUDIO_PAYLOAD_BYTES) {
      return {
        ok: false,
        status: 413,
        error: `Payload exceeds maximum allowed size of ${MAX_STUDIO_PAYLOAD_BYTES} bytes`,
      };
    }
  }

  if (req.body !== undefined) {
    return { ok: true, body: req.body };
  }

  if (req.readableEnded) {
    return { ok: true, body: {} };
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer | string) => {
      if (aborted) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > MAX_STUDIO_PAYLOAD_BYTES) {
        aborted = true;
        resolve({
          ok: false,
          status: 413,
          error: `Payload exceeds maximum allowed size of ${MAX_STUDIO_PAYLOAD_BYTES} bytes`,
        });
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (aborted) return;
      if (chunks.length === 0) {
        resolve({ ok: true, body: {} });
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({ ok: true, body: {} });
        return;
      }
      try {
        resolve({ ok: true, body: JSON.parse(raw) });
      } catch {
        resolve({
          ok: false,
          status: 400,
          error: 'Malformed JSON in request body',
        });
      }
    });

    req.on('error', () => {
      if (aborted) return;
      aborted = true;
      resolve({
        ok: false,
        status: 400,
        error: 'Failed to read request body stream',
      });
    });
  });
}

function extractRelativePath(req: Request, routeId: string): string {
  const fullUrl = req.originalUrl || req.url || '/';
  const qIdx = fullUrl.indexOf('?');
  const pathname = qIdx >= 0 ? fullUrl.slice(0, qIdx) : fullUrl;
  const escapedRouteId = routeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripped = pathname.replace(new RegExp(`^/proxy/${escapedRouteId}`), '');
  if (!stripped || stripped === '/') return '/';
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

function resolveResourceAndRecordSegments(
  relPath: string,
  basePath: string,
  version: string,
  knownSlugs: Set<string>
): { resourceSlug: string; recordId?: string } | null {
  const candidates: string[] = [relPath];
  const cleanBase = basePath === '/' ? '' : basePath.replace(/\/+$/, '');
  const cleanVer = `/${version.toLowerCase()}`;

  if (cleanBase && relPath.toLowerCase().startsWith(`${cleanBase.toLowerCase()}${cleanVer}/`)) {
    candidates.push(relPath.slice(cleanBase.length + cleanVer.length));
  }
  if (cleanBase && relPath.toLowerCase().startsWith(`${cleanBase.toLowerCase()}/`)) {
    candidates.push(relPath.slice(cleanBase.length));
  }
  if (relPath.toLowerCase().startsWith(`${cleanVer}/`)) {
    candidates.push(relPath.slice(cleanVer.length));
  }

  for (const candidate of candidates) {
    const parts = candidate.split('/').filter(Boolean);
    if (parts.length === 1 || parts.length === 2) {
      const slugCandidate = decodeURIComponent(parts[0]).toLowerCase();
      if (knownSlugs.has(slugCandidate)) {
        const recordId = parts.length === 2 ? decodeURIComponent(parts[1]) : undefined;
        return { resourceSlug: slugCandidate, recordId };
      }
    }
  }

  return null;
}

function formatStudioRecord(recordId: string, data: unknown): Record<string, unknown> {
  const obj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return {
    id: recordId,
    ...obj,
  };
}

function allocateNextRecordId(slug: string, existingIds: string[]): string {
  const prefix = slug === 'products' ? 'prod' : slug === 'customers' ? 'cust' : slug === 'orders' ? 'ord' : slug.replace(/[^a-z0-9]/g, '').slice(0, 4) || 'rec';
  const existingSet = new Set(existingIds);
  let maxNum = existingIds.length;
  const re = new RegExp(`^${prefix}_(\\d+)$`);
  for (const id of existingIds) {
    const m = id.match(re);
    if (m) {
      const num = Number.parseInt(m[1], 10);
      if (Number.isFinite(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  for (let candidateNum = maxNum + 1; candidateNum <= maxNum + 10_000; candidateNum++) {
    const candidate = `${prefix}_${String(candidateNum).padStart(4, '0')}`;
    if (!existingSet.has(candidate)) {
      return candidate;
    }
  }
  return `${prefix}_${uuidv4().slice(0, 8)}`;
}

export async function handleStudioUpstreamRequest(
  req: Request,
  res: Response,
  ctx: StudioGatewayDispatchContext
): Promise<number> {
  const sendJson = (status: number, payload: unknown): number => {
    res.setHeader('X-FortiX-Studio-Api', ctx.studioApiId);
    res.status(status).json(payload);
    return status;
  };

  // Strict tenant boundary check: Studio API MUST exist and belong to the exact same projectId as the gateway route
  const [studioApi] = await db
    .select()
    .from(studioApis)
    .where(and(eq(studioApis.id, ctx.studioApiId), eq(studioApis.projectId, ctx.route.projectId)))
    .limit(1);

  if (!studioApi) {
    return sendJson(502, {
      error: 'Bad Gateway: Studio API upstream target is unavailable or unlinked',
      code: 'STUDIO_TARGET_NOT_FOUND',
    });
  }

  const resources = await db
    .select()
    .from(studioResources)
    .where(and(eq(studioResources.apiId, studioApi.id), eq(studioResources.projectId, ctx.route.projectId)))
    .orderBy(asc(studioResources.createdAt));

  const relPath = extractRelativePath(req, ctx.routeId);
  const cleanBase = studioApi.basePath === '/' ? '' : studioApi.basePath.replace(/\/+$/, '');
  const method = req.method.toUpperCase();

  // 1. Root index & health probes (used by FortiX Experiment Worker & Autonomous Verification Engine)
  if (
    relPath === '/' ||
    (cleanBase && relPath.toLowerCase() === cleanBase.toLowerCase()) ||
    (cleanBase && relPath.toLowerCase() === `${cleanBase.toLowerCase()}/${studioApi.version.toLowerCase()}`)
  ) {
    if (method !== 'GET' && method !== 'HEAD') {
      return sendJson(405, { error: `Method ${method} not allowed on API root`, code: 'METHOD_NOT_ALLOWED' });
    }
    return sendJson(200, {
      status: 'operational',
      service: studioApi.name,
      apiId: studioApi.id,
      basePath: studioApi.basePath,
      version: studioApi.version,
      resources: resources.map((r) => ({
        name: r.name,
        slug: r.slug,
        endpoint: `/proxy/${ctx.routeId}${cleanBase}/${r.slug}`,
        shortEndpoint: `/proxy/${ctx.routeId}/${r.slug}`,
      })),
    });
  }

  if (relPath === '/health' || (cleanBase && relPath.toLowerCase() === `${cleanBase.toLowerCase()}/health`)) {
    if (method !== 'GET' && method !== 'HEAD') {
      return sendJson(405, { error: `Method ${method} not allowed on /health`, code: 'METHOD_NOT_ALLOWED' });
    }
    return sendJson(200, {
      status: 'healthy',
      apiId: studioApi.id,
      name: studioApi.name,
      version: studioApi.version,
    });
  }

  if (
    relPath === '/openapi.json' ||
    (cleanBase && relPath.toLowerCase() === `${cleanBase.toLowerCase()}/openapi.json`)
  ) {
    if (method !== 'GET') {
      return sendJson(405, { error: `Method ${method} not allowed on /openapi.json`, code: 'METHOD_NOT_ALLOWED' });
    }
    const spec = generateStudioOpenApiSpec({
      api: {
        id: studioApi.id,
        name: studioApi.name,
        description: studioApi.description,
        basePath: studioApi.basePath,
        version: studioApi.version,
        routeId: ctx.routeId,
      },
      resources: resources.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        fields: (Array.isArray(r.fields) ? r.fields : []) as StudioFieldDefinition[],
      })),
    });
    return sendJson(200, spec);
  }

  // 2. Resolve target resource & optional record ID
  const slugMap = new Map<string, typeof studioResources.$inferSelect>();
  for (const r of resources) {
    slugMap.set(r.slug.toLowerCase(), r);
  }

  const resolved = resolveResourceAndRecordSegments(
    relPath,
    studioApi.basePath,
    studioApi.version,
    new Set(slugMap.keys())
  );

  if (!resolved) {
    return sendJson(404, {
      error: `Endpoint '${relPath}' does not match any resource in ${studioApi.name}`,
      code: 'STUDIO_ENDPOINT_NOT_FOUND',
      availableResources: resources.map((r) => `${cleanBase}/${r.slug}`),
    });
  }

  const targetResource = slugMap.get(resolved.resourceSlug)!;
  const fields = (Array.isArray(targetResource.fields) ? targetResource.fields : []) as StudioFieldDefinition[];

  // Collection endpoints: GET /:slug, POST /:slug
  if (!resolved.recordId) {
    if (method === 'GET') {
      const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 20;
      const rawOffset = typeof req.query.offset === 'string' ? Number.parseInt(req.query.offset, 10) : 0;

      if (req.query.limit !== undefined && (!Number.isFinite(rawLimit) || rawLimit < 1 || rawLimit > 100)) {
        return sendJson(400, {
          error: 'Query parameter "limit" must be an integer between 1 and 100',
          code: 'INVALID_PAGINATION',
        });
      }
      if (req.query.offset !== undefined && (!Number.isFinite(rawOffset) || rawOffset < 0 || rawOffset > 10_000)) {
        return sendJson(400, {
          error: 'Query parameter "offset" must be a non-negative integer <= 10000',
          code: 'INVALID_PAGINATION',
        });
      }

      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 100) : 20;
      const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

      const allRows = await db
        .select()
        .from(studioRecords)
        .where(
          and(
            eq(studioRecords.resourceId, targetResource.id),
            eq(studioRecords.projectId, ctx.route.projectId)
          )
        )
        .orderBy(asc(studioRecords.recordId));

      const categoryFilter = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : '';
      const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
      const searchFilter =
        typeof req.query.q === 'string'
          ? req.query.q.trim().toLowerCase()
          : typeof req.query.search === 'string'
            ? req.query.search.trim().toLowerCase()
            : '';

      const filtered = allRows.filter((row) => {
        const d = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>;
        if (categoryFilter && String(d.category ?? '').toLowerCase() !== categoryFilter) {
          return false;
        }
        if (statusFilter && String(d.status ?? '').toLowerCase() !== statusFilter) {
          return false;
        }
        if (searchFilter) {
          const hay = `${row.recordId} ${Object.values(d).map((v) => String(v ?? '')).join(' ')}`.toLowerCase();
          if (!hay.includes(searchFilter)) {
            return false;
          }
        }
        return true;
      });

      const total = filtered.length;
      const pageRows = filtered.slice(offset, offset + limit);

      return sendJson(200, {
        items: pageRows.map((r) => formatStudioRecord(r.recordId, r.data)),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + pageRows.length < total,
        },
      });
    }

    if (method === 'POST') {
      const parsedBody = await readJsonBodySafe(req);
      if (!parsedBody.ok) {
        return sendJson(parsedBody.status, {
          error: parsedBody.error,
          code: parsedBody.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
        });
      }

      const validation = validateStudioRecordPayload(fields, parsedBody.body, { partial: false });
      if (!validation.ok) {
        return sendJson(validation.status, {
          error: validation.error,
          code: 'SCHEMA_VALIDATION_ERROR',
          ...(validation.issues ? { issues: validation.issues } : {}),
        });
      }

      const existingRows = await db
        .select({
          recordId: studioRecords.recordId,
          data: studioRecords.data,
        })
        .from(studioRecords)
        .where(
          and(
            eq(studioRecords.resourceId, targetResource.id),
            eq(studioRecords.projectId, ctx.route.projectId)
          )
        );

      if (existingRows.length >= MAX_RECORDS_PER_RESOURCE) {
        return sendJson(409, {
          error: `Resource '${targetResource.slug}' has reached maximum capacity (${MAX_RECORDS_PER_RESOURCE} records)`,
          code: 'RESOURCE_RECORD_QUOTA_EXCEEDED',
        });
      }

      const targetRecordId =
        validation.recordId ??
        allocateNextRecordId(
          targetResource.slug,
          existingRows.map((r) => r.recordId)
        );

      if (existingRows.some((r) => r.recordId === targetRecordId)) {
        return sendJson(409, {
          error: `Record with id '${targetRecordId}' already exists in '${targetResource.slug}'`,
          code: 'DUPLICATE_RECORD_ID',
        });
      }

      const uniqueFields = fields.filter((f) => f.unique);
      for (const uf of uniqueFields) {
        const candidateVal = validation.data[uf.name];
        if (candidateVal !== undefined && candidateVal !== null) {
          const duplicate = existingRows.some((r) => {
            const d = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>;
            return d[uf.name] === candidateVal;
          });
          if (duplicate) {
            return sendJson(409, {
              error: `Duplicate value for unique field '${uf.name}': '${String(candidateVal)}'`,
              code: 'UNIQUE_CONSTRAINT_VIOLATION',
            });
          }
        }
      }

      const now = new Date();
      try {
        await db.insert(studioRecords).values({
          id: uuidv4(),
          resourceId: targetResource.id,
          apiId: studioApi.id,
          projectId: ctx.route.projectId,
          recordId: targetRecordId,
          data: validation.data,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err: any) {
        if (String(err?.message || '').toLowerCase().includes('unique') || err?.code === '23505') {
          return sendJson(409, {
            error: `Record '${targetRecordId}' already exists`,
            code: 'DUPLICATE_RECORD_ID',
          });
        }
        throw err;
      }

      return sendJson(201, formatStudioRecord(targetRecordId, validation.data));
    }

    return sendJson(405, {
      error: `Method ${method} is not allowed on collection '${targetResource.slug}'`,
      code: 'METHOD_NOT_ALLOWED',
    });
  }

  // Item endpoints: GET /:slug/:id, PATCH /:slug/:id, DELETE /:slug/:id
  const idCheck = validateRecordIdFormat(resolved.recordId);
  if (!idCheck.ok) {
    return sendJson(400, { error: idCheck.error, code: 'INVALID_RECORD_ID' });
  }
  const recordId = idCheck.value;

  if (method === 'GET') {
    const [row] = await db
      .select()
      .from(studioRecords)
      .where(
        and(
          eq(studioRecords.resourceId, targetResource.id),
          eq(studioRecords.projectId, ctx.route.projectId),
          eq(studioRecords.recordId, recordId)
        )
      )
      .limit(1);

    if (!row) {
      return sendJson(404, {
        error: `Record '${recordId}' not found in '${targetResource.slug}'`,
        code: 'RECORD_NOT_FOUND',
      });
    }

    return sendJson(200, formatStudioRecord(row.recordId, row.data));
  }

  if (method === 'PATCH') {
    const parsedBody = await readJsonBodySafe(req);
    if (!parsedBody.ok) {
      return sendJson(parsedBody.status, {
        error: parsedBody.error,
        code: parsedBody.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
      });
    }

    const validation = validateStudioRecordPayload(fields, parsedBody.body, {
      partial: true,
      existingRecordId: recordId,
    });
    if (!validation.ok) {
      return sendJson(validation.status, {
        error: validation.error,
        code: 'SCHEMA_VALIDATION_ERROR',
        ...(validation.issues ? { issues: validation.issues } : {}),
      });
    }

    // Retry optimistic concurrency loop up to 3 times so concurrent PATCH requests merge cleanly without lost updates
    for (let attempt = 0; attempt < 3; attempt++) {
      const [existing] = await db
        .select()
        .from(studioRecords)
        .where(
          and(
            eq(studioRecords.resourceId, targetResource.id),
            eq(studioRecords.projectId, ctx.route.projectId),
            eq(studioRecords.recordId, recordId)
          )
        )
        .limit(1);

      if (!existing) {
        return sendJson(404, {
          error: `Record '${recordId}' not found in '${targetResource.slug}'`,
          code: 'RECORD_NOT_FOUND',
        });
      }

      const uniqueFields = fields.filter((f) => f.unique && Object.prototype.hasOwnProperty.call(validation.data, f.name));
      if (uniqueFields.length > 0) {
        const peerRows = await db
          .select({ data: studioRecords.data })
          .from(studioRecords)
          .where(
            and(
              eq(studioRecords.resourceId, targetResource.id),
              eq(studioRecords.projectId, ctx.route.projectId),
              ne(studioRecords.id, existing.id)
            )
          );
        for (const uf of uniqueFields) {
          const nextVal = validation.data[uf.name];
          if (nextVal !== undefined && nextVal !== null) {
            const conflict = peerRows.some((peer) => {
              const pd = (peer.data && typeof peer.data === 'object' ? peer.data : {}) as Record<string, unknown>;
              return pd[uf.name] === nextVal;
            });
            if (conflict) {
              return sendJson(409, {
                error: `Duplicate value for unique field '${uf.name}': '${String(nextVal)}'`,
                code: 'UNIQUE_CONSTRAINT_VIOLATION',
              });
            }
          }
        }
      }

      const baseObj =
        existing.data && typeof existing.data === 'object' && !Array.isArray(existing.data)
          ? (existing.data as Record<string, unknown>)
          : {};
      const mergedData: Record<string, unknown> = {
        ...baseObj,
        ...validation.data,
      };

      const updatedRows = await db
        .update(studioRecords)
        .set({
          data: mergedData,
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(studioRecords.id, existing.id),
            eq(studioRecords.version, existing.version)
          )
        )
        .returning();

      if (updatedRows.length > 0) {
        return sendJson(200, formatStudioRecord(updatedRows[0].recordId, updatedRows[0].data));
      }
    }

    return sendJson(409, {
      error: 'Concurrent update conflict on record; retry request',
      code: 'CONCURRENT_MODIFICATION_CONFLICT',
    });
  }

  if (method === 'DELETE') {
    const deleted = await db
      .delete(studioRecords)
      .where(
        and(
          eq(studioRecords.resourceId, targetResource.id),
          eq(studioRecords.projectId, ctx.route.projectId),
          eq(studioRecords.recordId, recordId)
        )
      )
      .returning({ recordId: studioRecords.recordId });

    if (deleted.length === 0) {
      return sendJson(404, {
        error: `Record '${recordId}' not found in '${targetResource.slug}'`,
        code: 'RECORD_NOT_FOUND',
      });
    }

    return sendJson(200, { deleted: true, id: recordId });
  }

  return sendJson(405, {
    error: `Method ${method} is not allowed on item '${targetResource.slug}/${recordId}'`,
    code: 'METHOD_NOT_ALLOWED',
  });
}
