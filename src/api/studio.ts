import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  apiKeys,
  apiRoutes,
  auditLogs,
  projects,
  securityPolicies,
  studioApis,
  studioRecords,
  studioResources,
} from '../db/schema.js';
import type { AuthRequest } from '../middleware/auth.js';
import { requireProjectOwnership } from './projects.js';
import { buildStudioInternalTargetUrl } from '../gateway/ssrf.js';
import {
  MAX_RECORDS_PER_RESOURCE,
  MAX_RESOURCES_PER_API,
  MAX_STUDIO_APIS_PER_PROJECT,
  type StudioFieldDefinition,
  normalizeResourceSlug,
  normalizeStudioBasePath,
  normalizeStudioVersion,
  resourceFieldsArraySchema,
} from '../studio/schema-validator.js';
import {
  FTX_STUDIO_PRODUCTS_CATEGORIES,
  FTX_STUDIO_PRODUCTS_MANIFEST,
  STUDIO_CUSTOMERS_FIELDS,
  STUDIO_ORDERS_FIELDS,
  STUDIO_PRODUCTS_FIELDS,
  generateDeterministicRecordsForSchema,
} from '../studio/products-dataset.js';
import { generateStudioOpenApiSpec } from '../studio/openapi-generator.js';

const router = express.Router();

function resolveProjectId(req: express.Request): string {
  return (
    ((req as any).project?.id as string) ||
    (req.query.projectId as string) ||
    (req.body?.projectId as string) ||
    ''
  );
}

function requireStudioWriteRole(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user.role !== 'ADMIN' && req.user.role !== 'DEVELOPER') {
    return res.status(403).json({
      error: 'Forbidden: Operator write role (ADMIN or DEVELOPER) required to modify Studio APIs',
    });
  }
  return next();
}

const createStudioApiSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).optional().default(''),
  basePath: z.string().trim().min(1).max(80).default('/api/store'),
  version: z.string().trim().min(2).max(16).optional().default('v1'),
  template: z.enum(['products_100', 'store_suite', 'empty']).optional().default('products_100'),
  initialPolicy: z
    .object({
      rateLimitRpm: z.number().int().min(1).max(100_000).nullable().optional(),
      enableWaf: z.boolean().optional(),
      enableSsrf: z.boolean().optional(),
    })
    .optional(),
  issueApiKey: z.boolean().optional().default(false),
});

const createResourceSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().min(2).max(40).optional(),
  fields: resourceFieldsArraySchema,
  seedCount: z.number().int().min(0).max(100).optional().default(0),
});

const seedResourceSchema = z.object({
  projectId: z.string().min(1),
  mode: z.enum(['reset', 'append']).optional().default('reset'),
  count: z.number().int().min(1).max(100).optional(),
});

function buildEndpointDescriptors(routeId: string | null, basePath: string, slug: string) {
  const cleanBase = basePath === '/' ? '' : basePath.replace(/\/+$/, '');
  const gatewayPrefix = routeId ? `/proxy/${routeId}` : '/proxy/{routeId}';
  const canonicalCollection = `${gatewayPrefix}${cleanBase}/${slug}`;
  const shortCollection = `${gatewayPrefix}/${slug}`;
  return [
    { method: 'GET', path: canonicalCollection, shortPath: shortCollection, summary: `List ${slug} (paginated)` },
    { method: 'GET', path: `${canonicalCollection}/:id`, shortPath: `${shortCollection}/:id`, summary: `Get single ${slug} by ID` },
    { method: 'POST', path: canonicalCollection, shortPath: shortCollection, summary: `Create ${slug} record` },
    { method: 'PATCH', path: `${canonicalCollection}/:id`, shortPath: `${shortCollection}/:id`, summary: `Partially update ${slug}` },
    { method: 'DELETE', path: `${canonicalCollection}/:id`, shortPath: `${shortCollection}/:id`, summary: `Delete ${slug} record` },
  ];
}

async function seedResourceRows(params: {
  resourceId: string;
  apiId: string;
  projectId: string;
  slug: string;
  fields: StudioFieldDefinition[];
  count: number;
  startIndex: number;
}): Promise<number> {
  const generated = generateDeterministicRecordsForSchema(
    params.slug,
    params.fields,
    params.count,
    params.startIndex
  );
  if (generated.length === 0) return 0;

  const now = new Date();
  const rowsToInsert = generated.map((item) => ({
    id: uuidv4(),
    resourceId: params.resourceId,
    apiId: params.apiId,
    projectId: params.projectId,
    recordId: item.recordId,
    data: item.data,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }));

  // Insert in bounded chunks of 50 for optimal pg-mem and PostgreSQL query parameter limits
  const chunkSize = 50;
  for (let i = 0; i < rowsToInsert.length; i += chunkSize) {
    await db.insert(studioRecords).values(rowsToInsert.slice(i, i + chunkSize));
  }
  return rowsToInsert.length;
}

async function hydrateStudioApiSummary(apiRow: typeof studioApis.$inferSelect) {
  const [routeRows, resourceRows, activeKeys] = await Promise.all([
    apiRow.routeId
      ? db
          .select()
          .from(apiRoutes)
          .where(and(eq(apiRoutes.id, apiRow.routeId), eq(apiRoutes.projectId, apiRow.projectId)))
          .limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(studioResources)
      .where(and(eq(studioResources.apiId, apiRow.id), eq(studioResources.projectId, apiRow.projectId)))
      .orderBy(asc(studioResources.createdAt)),
    db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.projectId, apiRow.projectId), isNull(apiKeys.revokedAt))),
  ]);

  const route = routeRows[0] ?? null;
  let policy: typeof securityPolicies.$inferSelect | null = null;
  if (route) {
    const [p] = await db
      .select()
      .from(securityPolicies)
      .where(eq(securityPolicies.routeId, route.id))
      .limit(1);
    policy = p ?? null;
  }

  const enrichedResources = await Promise.all(
    resourceRows.map(async (r) => {
      const countRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(studioRecords)
        .where(and(eq(studioRecords.resourceId, r.id), eq(studioRecords.projectId, apiRow.projectId)));
      const recordCount = Number(countRows[0]?.count ?? 0);
      return {
        ...r,
        fields: (Array.isArray(r.fields) ? r.fields : []) as StudioFieldDefinition[],
        recordCount,
        endpoints: buildEndpointDescriptors(route?.id ?? apiRow.routeId, apiRow.basePath, r.slug),
      };
    })
  );

  return {
    ...apiRow,
    gatewayBaseUrl: route ? `/proxy/${route.id}` : null,
    route,
    policy,
    activeKeyCount: activeKeys.length,
    totalRecords: enrichedResources.reduce((acc, r) => acc + r.recordCount, 0),
    resources: enrichedResources,
  };
}

// GET /api/control/studio/templates
router.get('/templates', (_req, res) => {
  res.json({
    manifest: FTX_STUDIO_PRODUCTS_MANIFEST,
    categories: FTX_STUDIO_PRODUCTS_CATEGORIES,
    templates: [
      {
        id: 'products_100',
        name: 'Products Catalogue API (100 Canonical Records)',
        description: 'Focused retail & hardware inventory API pre-seeded with 100 INR products across 24 categories.',
        defaultBasePath: '/api/store',
        resources: [{ name: 'Products', slug: 'products', seedCount: 100, fields: STUDIO_PRODUCTS_FIELDS }],
      },
      {
        id: 'store_suite',
        name: 'Store Suite API (Products, Customers, Orders)',
        description: 'Multi-resource commerce playground with 100 Products, 20 Customers, and 20 Orders.',
        defaultBasePath: '/api/store',
        resources: [
          { name: 'Products', slug: 'products', seedCount: 100, fields: STUDIO_PRODUCTS_FIELDS },
          { name: 'Customers', slug: 'customers', seedCount: 20, fields: STUDIO_CUSTOMERS_FIELDS },
          { name: 'Orders', slug: 'orders', seedCount: 20, fields: STUDIO_ORDERS_FIELDS },
        ],
      },
      {
        id: 'empty',
        name: 'Blank Declarative API',
        description: 'Start with a clean gateway-protected API and define custom resources and field schemas.',
        defaultBasePath: '/api/custom',
        resources: [],
      },
    ],
  });
});

// GET /api/control/studio/apis?projectId=...
router.get('/apis', requireProjectOwnership, async (req, res) => {
  const projectId = resolveProjectId(req);
  try {
    const apis = await db
      .select()
      .from(studioApis)
      .where(eq(studioApis.projectId, projectId))
      .orderBy(desc(studioApis.createdAt));

    const enriched = await Promise.all(apis.map((a) => hydrateStudioApiSummary(a)));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load Studio APIs' });
  }
});

// POST /api/control/studio/apis
router.post('/apis', requireProjectOwnership, requireStudioWriteRole as any, async (req: AuthRequest, res) => {
  try {
    const parsed = createStudioApiSchema.parse(req.body);
    const { projectId, name, description, template, initialPolicy, issueApiKey } = parsed;

    const baseCheck = normalizeStudioBasePath(parsed.basePath);
    if (!baseCheck.ok) {
      return res.status(400).json({ error: baseCheck.error });
    }
    const verCheck = normalizeStudioVersion(parsed.version);
    if (!verCheck.ok) {
      return res.status(400).json({ error: verCheck.error });
    }

    const existingApis = await db
      .select()
      .from(studioApis)
      .where(eq(studioApis.projectId, projectId));

    if (existingApis.length >= MAX_STUDIO_APIS_PER_PROJECT) {
      return res.status(409).json({
        error: `Studio API quota reached (${MAX_STUDIO_APIS_PER_PROJECT} APIs per project)`,
      });
    }

    const collision = existingApis.some(
      (a) => a.basePath === baseCheck.value && a.version === verCheck.value
    );
    if (collision) {
      return res.status(409).json({
        error: `A Studio API with basePath '${baseCheck.value}' and version '${verCheck.value}' already exists in this project`,
        code: 'STUDIO_API_PATH_COLLISION',
      });
    }

    const apiId = uuidv4();
    const routeId = uuidv4();
    const targetUrl = buildStudioInternalTargetUrl(apiId);
    const routePathPattern = baseCheck.value === '/' ? `/studio/${apiId.slice(0, 8)}` : baseCheck.value;

    // 1. Register real gateway route in api_routes
    await db.insert(apiRoutes).values({
      id: routeId,
      projectId,
      pathPattern: routePathPattern,
      targetUrl,
    });

    // 2. Attach real gateway security policy in security_policies
    await db.insert(securityPolicies).values({
      id: uuidv4(),
      routeId,
      rateLimitRpm:
        initialPolicy?.rateLimitRpm === null
          ? null
          : typeof initialPolicy?.rateLimitRpm === 'number'
            ? initialPolicy.rateLimitRpm
            : 60,
      enableWaf: initialPolicy?.enableWaf ?? true,
      enableSsrf: initialPolicy?.enableSsrf ?? true,
    });

    // 3. Create Studio API workspace record
    const now = new Date();
    const [createdApi] = await db
      .insert(studioApis)
      .values({
        id: apiId,
        projectId,
        routeId,
        name,
        description,
        basePath: baseCheck.value,
        version: verCheck.value,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // 4. Provision starter resources & deterministic seed data
    if (template === 'products_100' || template === 'store_suite') {
      const prodResId = uuidv4();
      await db.insert(studioResources).values({
        id: prodResId,
        apiId,
        projectId,
        name: 'Products',
        slug: 'products',
        fields: STUDIO_PRODUCTS_FIELDS,
        createdAt: now,
      });
      await seedResourceRows({
        resourceId: prodResId,
        apiId,
        projectId,
        slug: 'products',
        fields: STUDIO_PRODUCTS_FIELDS,
        count: 100,
        startIndex: 1,
      });
    }

    if (template === 'store_suite') {
      const custResId = uuidv4();
      await db.insert(studioResources).values({
        id: custResId,
        apiId,
        projectId,
        name: 'Customers',
        slug: 'customers',
        fields: STUDIO_CUSTOMERS_FIELDS,
        createdAt: now,
      });
      await seedResourceRows({
        resourceId: custResId,
        apiId,
        projectId,
        slug: 'customers',
        fields: STUDIO_CUSTOMERS_FIELDS,
        count: 20,
        startIndex: 1,
      });

      const ordResId = uuidv4();
      await db.insert(studioResources).values({
        id: ordResId,
        apiId,
        projectId,
        name: 'Orders',
        slug: 'orders',
        fields: STUDIO_ORDERS_FIELDS,
        createdAt: now,
      });
      await seedResourceRows({
        resourceId: ordResId,
        apiId,
        projectId,
        slug: 'orders',
        fields: STUDIO_ORDERS_FIELDS,
        count: 20,
        startIndex: 1,
      });
    }

    // 5. Optional one-click scoped gateway API key issuance
    let issuedApiKey: { id: string; name: string; keyPrefix: string; rawKey: string } | null = null;
    if (issueApiKey) {
      const activeKeys = await db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt)));

      if (activeKeys.length < 25) {
        const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
        const envPrefix = proj?.environment === 'production' ? 'live' : 'test';
        const keyId = crypto.randomBytes(8).toString('hex');
        const secret = crypto.randomBytes(32).toString('hex');
        const keyPrefix = `fx_${envPrefix}_${keyId}`;
        const rawKey = `${keyPrefix}_${secret}`;
        const secretHash = await bcrypt.hash(secret, 10);
        const keyLabel = `${name} Playground Key`;

        await db.insert(apiKeys).values({
          id: keyId,
          projectId,
          keyPrefix,
          secretHash,
          name: keyLabel,
          purpose: `FortiX API Studio (${name})`,
          scopes: ['gateway:proxy'],
          expiresAt: null,
          revokedAt: null,
        });

        issuedApiKey = {
          id: keyId,
          name: keyLabel,
          keyPrefix,
          rawKey,
        };
      }
    }

    try {
      await db.insert(auditLogs).values({
        id: uuidv4(),
        projectId,
        userId: req.user?.id || null,
        action: 'STUDIO_API_CREATED',
        domain: 'gateway',
        previousVersion: 1,
        newVersion: 1,
        diff: { apiId, routeId, name, basePath: baseCheck.value, version: verCheck.value, template },
        metadata: { apiId, routeId, template },
        timestamp: new Date(),
      });
    } catch {}

    const summary = await hydrateStudioApiSummary(createdApi);
    return res.status(201).json({
      ...summary,
      issuedApiKey,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid Studio API configuration', issues: error.issues });
    }
    return res.status(500).json({ error: 'Failed to create Studio API' });
  }
});

// GET /api/control/studio/apis/:apiId?projectId=...
router.get('/apis/:apiId', requireProjectOwnership, async (req, res) => {
  const projectId = resolveProjectId(req);
  const apiId = String(req.params.apiId);
  try {
    const [apiRow] = await db
      .select()
      .from(studioApis)
      .where(and(eq(studioApis.id, apiId), eq(studioApis.projectId, projectId)))
      .limit(1);

    if (!apiRow) {
      return res.status(404).json({ error: 'Studio API not found in this project' });
    }

    const summary = await hydrateStudioApiSummary(apiRow);
    return res.json(summary);
  } catch {
    return res.status(500).json({ error: 'Failed to load Studio API details' });
  }
});

// DELETE /api/control/studio/apis/:apiId?projectId=...
router.delete('/apis/:apiId', requireProjectOwnership, requireStudioWriteRole as any, async (req, res) => {
  const projectId = resolveProjectId(req);
  const apiId = String(req.params.apiId);
  try {
    const [existing] = await db
      .select()
      .from(studioApis)
      .where(and(eq(studioApis.id, apiId), eq(studioApis.projectId, projectId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'Studio API not found in this project' });
    }

    await db.delete(studioApis).where(and(eq(studioApis.id, apiId), eq(studioApis.projectId, projectId)));
    if (existing.routeId) {
      await db
        .delete(apiRoutes)
        .where(and(eq(apiRoutes.id, existing.routeId), eq(apiRoutes.projectId, projectId)));
    }

    return res.json({ success: true, deletedApiId: apiId, deletedRouteId: existing.routeId });
  } catch {
    return res.status(500).json({ error: 'Failed to delete Studio API' });
  }
});

// POST /api/control/studio/apis/:apiId/resources
router.post('/apis/:apiId/resources', requireProjectOwnership, requireStudioWriteRole as any, async (req, res) => {
  const projectId = resolveProjectId(req);
  const apiId = String(req.params.apiId);

  try {
    const parsed = createResourceSchema.parse(req.body);
    const [apiRow] = await db
      .select()
      .from(studioApis)
      .where(and(eq(studioApis.id, apiId), eq(studioApis.projectId, projectId)))
      .limit(1);

    if (!apiRow) {
      return res.status(404).json({ error: 'Studio API not found in this project' });
    }

    const slugCheck = normalizeResourceSlug(parsed.slug || parsed.name);
    if (!slugCheck.ok) {
      return res.status(400).json({ error: slugCheck.error });
    }

    const currentResources = await db
      .select()
      .from(studioResources)
      .where(and(eq(studioResources.apiId, apiId), eq(studioResources.projectId, projectId)));

    if (currentResources.length >= MAX_RESOURCES_PER_API) {
      return res.status(409).json({
        error: `Maximum of ${MAX_RESOURCES_PER_API} resources per Studio API reached`,
      });
    }

    if (currentResources.some((r) => r.slug === slugCheck.value)) {
      return res.status(409).json({
        error: `Resource slug '${slugCheck.value}' already exists in '${apiRow.name}'`,
        code: 'DUPLICATE_RESOURCE_SLUG',
      });
    }

    const resourceId = uuidv4();
    const fields = parsed.fields as StudioFieldDefinition[];
    const [createdResource] = await db
      .insert(studioResources)
      .values({
        id: resourceId,
        apiId,
        projectId,
        name: parsed.name,
        slug: slugCheck.value,
        fields,
        createdAt: new Date(),
      })
      .returning();

    let seededCount = 0;
    if (parsed.seedCount > 0) {
      seededCount = await seedResourceRows({
        resourceId,
        apiId,
        projectId,
        slug: slugCheck.value,
        fields,
        count: parsed.seedCount,
        startIndex: 1,
      });
    }

    return res.status(201).json({
      ...createdResource,
      fields,
      recordCount: seededCount,
      endpoints: buildEndpointDescriptors(apiRow.routeId, apiRow.basePath, slugCheck.value),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid resource schema definition', issues: error.issues });
    }
    return res.status(500).json({ error: 'Failed to create Studio resource' });
  }
});

// DELETE /api/control/studio/apis/:apiId/resources/:resourceId
router.delete(
  '/apis/:apiId/resources/:resourceId',
  requireProjectOwnership,
  requireStudioWriteRole as any,
  async (req, res) => {
    const projectId = resolveProjectId(req);
    const apiId = String(req.params.apiId);
    const resourceId = String(req.params.resourceId);

    try {
      const deleted = await db
        .delete(studioResources)
        .where(
          and(
            eq(studioResources.id, resourceId),
            eq(studioResources.apiId, apiId),
            eq(studioResources.projectId, projectId)
          )
        )
        .returning({ id: studioResources.id });

      if (deleted.length === 0) {
        return res.status(404).json({ error: 'Studio resource not found in this project' });
      }

      return res.json({ success: true, deletedResourceId: resourceId });
    } catch {
      return res.status(500).json({ error: 'Failed to delete Studio resource' });
    }
  }
);

// POST /api/control/studio/apis/:apiId/resources/:resourceId/seed
router.post(
  '/apis/:apiId/resources/:resourceId/seed',
  requireProjectOwnership,
  requireStudioWriteRole as any,
  async (req, res) => {
    const projectId = resolveProjectId(req);
    const apiId = String(req.params.apiId);
    const resourceId = String(req.params.resourceId);

    try {
      const parsed = seedResourceSchema.parse(req.body);
      const [resource] = await db
        .select()
        .from(studioResources)
        .where(
          and(
            eq(studioResources.id, resourceId),
            eq(studioResources.apiId, apiId),
            eq(studioResources.projectId, projectId)
          )
        )
        .limit(1);

      if (!resource) {
        return res.status(404).json({ error: 'Studio resource not found in this project' });
      }

      const fields = (Array.isArray(resource.fields) ? resource.fields : []) as StudioFieldDefinition[];
      const defaultSeedCount = resource.slug === 'products' ? 100 : 20;
      const requestedCount = parsed.count ?? defaultSeedCount;

      if (parsed.mode === 'reset') {
        await db
          .delete(studioRecords)
          .where(and(eq(studioRecords.resourceId, resourceId), eq(studioRecords.projectId, projectId)));

        const inserted = await seedResourceRows({
          resourceId,
          apiId,
          projectId,
          slug: resource.slug,
          fields,
          count: requestedCount,
          startIndex: 1,
        });

        return res.json({
          success: true,
          mode: 'reset',
          inserted,
          totalRecords: inserted,
        });
      }

      const existingRows = await db
        .select({ recordId: studioRecords.recordId })
        .from(studioRecords)
        .where(and(eq(studioRecords.resourceId, resourceId), eq(studioRecords.projectId, projectId)));

      if (existingRows.length >= MAX_RECORDS_PER_RESOURCE) {
        return res.status(409).json({
          error: `Resource '${resource.slug}' has already reached the ${MAX_RECORDS_PER_RESOURCE}-record cap`,
        });
      }

      const allowedToAdd = Math.min(requestedCount, MAX_RECORDS_PER_RESOURCE - existingRows.length);
      let maxExistingSeq = existingRows.length;
      for (const r of existingRows) {
        const m = r.recordId.match(/_(\d+)$/);
        if (m) {
          const n = Number.parseInt(m[1], 10);
          if (Number.isFinite(n) && n > maxExistingSeq) maxExistingSeq = n;
        }
      }

      const inserted = await seedResourceRows({
        resourceId,
        apiId,
        projectId,
        slug: resource.slug,
        fields,
        count: allowedToAdd,
        startIndex: maxExistingSeq + 1,
      });

      return res.json({
        success: true,
        mode: 'append',
        inserted,
        totalRecords: existingRows.length + inserted,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid seed parameters', issues: error.issues });
      }
      return res.status(500).json({ error: 'Failed to seed Studio resource records' });
    }
  }
);

// GET /api/control/studio/apis/:apiId/resources/:resourceId/records
router.get('/apis/:apiId/resources/:resourceId/records', requireProjectOwnership, async (req, res) => {
  const projectId = resolveProjectId(req);
  const apiId = String(req.params.apiId);
  const resourceId = String(req.params.resourceId);

  try {
    const [resource] = await db
      .select()
      .from(studioResources)
      .where(
        and(
          eq(studioResources.id, resourceId),
          eq(studioResources.apiId, apiId),
          eq(studioResources.projectId, projectId)
        )
      )
      .limit(1);

    if (!resource) {
      return res.status(404).json({ error: 'Studio resource not found in this project' });
    }

    const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 20;
    const rawOffset = typeof req.query.offset === 'string' ? Number.parseInt(req.query.offset, 10) : 0;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 100) : 20;
    const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

    const categoryFilter = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
    const searchFilter = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    const allRows = await db
      .select()
      .from(studioRecords)
      .where(and(eq(studioRecords.resourceId, resourceId), eq(studioRecords.projectId, projectId)))
      .orderBy(asc(studioRecords.recordId));

    const filtered = allRows.filter((row) => {
      const d = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>;
      if (categoryFilter && String(d.category ?? '').toLowerCase() !== categoryFilter) return false;
      if (statusFilter && String(d.status ?? '').toLowerCase() !== statusFilter) return false;
      if (searchFilter) {
        const hay = `${row.recordId} ${Object.values(d).map((v) => String(v ?? '')).join(' ')}`.toLowerCase();
        if (!hay.includes(searchFilter)) return false;
      }
      return true;
    });

    const page = filtered.slice(offset, offset + limit);
    return res.json({
      items: page.map((r) => ({
        id: r.recordId,
        ...(r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {}),
      })),
      pagination: {
        total: filtered.length,
        limit,
        offset,
        hasMore: offset + page.length < filtered.length,
      },
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load Studio resource records' });
  }
});

// GET /api/control/studio/apis/:apiId/openapi?projectId=...
router.get('/apis/:apiId/openapi', requireProjectOwnership, async (req, res) => {
  const projectId = resolveProjectId(req);
  const apiId = String(req.params.apiId);

  try {
    const [apiRow] = await db
      .select()
      .from(studioApis)
      .where(and(eq(studioApis.id, apiId), eq(studioApis.projectId, projectId)))
      .limit(1);

    if (!apiRow) {
      return res.status(404).json({ error: 'Studio API not found in this project' });
    }

    const resources = await db
      .select()
      .from(studioResources)
      .where(and(eq(studioResources.apiId, apiRow.id), eq(studioResources.projectId, projectId)))
      .orderBy(asc(studioResources.createdAt));

    const spec = generateStudioOpenApiSpec({
      api: {
        id: apiRow.id,
        name: apiRow.name,
        description: apiRow.description,
        basePath: apiRow.basePath,
        version: apiRow.version,
        routeId: apiRow.routeId,
      },
      resources: resources.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        fields: (Array.isArray(r.fields) ? r.fields : []) as StudioFieldDefinition[],
      })),
    });

    if (req.query.download === '1' || req.query.download === 'true') {
      const safeFile = apiRow.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'studio-api';
      res.setHeader('Content-Disposition', `attachment; filename="${safeFile}-${apiRow.version}-openapi.json"`);
    }
    res.setHeader('Content-Type', 'application/json');
    return res.json(spec);
  } catch {
    return res.status(500).json({ error: 'Failed to generate OpenAPI specification' });
  }
});

export const studioRouter = router;
