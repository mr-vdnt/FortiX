import type { StudioFieldDefinition } from './schema-validator.js';

export interface StudioOpenApiInput {
  api: {
    id: string;
    name: string;
    description: string;
    basePath: string;
    version: string;
    routeId: string | null;
  };
  resources: Array<{
    id: string;
    name: string;
    slug: string;
    fields: StudioFieldDefinition[];
  }>;
}

function toPascalCase(input: string): string {
  const cleaned = input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
  return cleaned || 'ResourceItem';
}

function fieldToJsonSchema(field: StudioFieldDefinition): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (field.description) {
    base.description = field.description;
  }

  switch (field.type) {
    case 'string':
      base.type = 'string';
      if (typeof field.maxLength === 'number') base.maxLength = field.maxLength;
      else base.maxLength = 1024;
      break;
    case 'enum':
      base.type = 'string';
      base.enum = field.enumValues ?? [];
      break;
    case 'number':
      base.type = 'number';
      if (typeof field.min === 'number') base.minimum = field.min;
      if (typeof field.max === 'number') base.maximum = field.max;
      break;
    case 'integer':
      base.type = 'integer';
      if (typeof field.min === 'number') base.minimum = field.min;
      if (typeof field.max === 'number') base.maximum = field.max;
      break;
    case 'boolean':
      base.type = 'boolean';
      break;
  }

  return base;
}

export function generateStudioOpenApiSpec(input: StudioOpenApiInput): Record<string, unknown> {
  const { api, resources } = input;
  const serverUrl = api.routeId ? `/proxy/${api.routeId}` : `/proxy/{routeId}`;
  const normalizedBase = api.basePath === '/' ? '' : api.basePath.replace(/\/+$/, '');

  const schemas: Record<string, unknown> = {
    StudioErrorResponse: {
      type: 'object',
      required: ['error'],
      properties: {
        error: { type: 'string' },
        code: { type: 'string' },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    DeleteConfirmation: {
      type: 'object',
      required: ['deleted', 'id'],
      properties: {
        deleted: { type: 'boolean', example: true },
        id: { type: 'string' },
      },
    },
  };

  const paths: Record<string, unknown> = {
    '/health': {
      get: {
        summary: `Health probe for ${api.name}`,
        tags: ['System'],
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': {
            description: 'Protected Studio API upstream is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status', 'version'],
                  properties: {
                    status: { type: 'string', example: 'healthy' },
                    version: { type: 'string', example: api.version },
                  },
                },
              },
            },
          },
          '401': { description: 'Missing or invalid FortiX Gateway API key' },
          '429': { description: 'FortiX Gateway rate limit exceeded' },
        },
      },
    },
  };

  for (const res of resources) {
    const modelName = toPascalCase(res.slug);
    const createSchemaName = `${modelName}CreateInput`;
    const patchSchemaName = `${modelName}PatchInput`;
    const pageSchemaName = `${modelName}PaginatedList`;

    const itemProps: Record<string, unknown> = {
      id: { type: 'string', description: 'Stable resource record identifier' },
    };
    const createProps: Record<string, unknown> = {
      id: { type: 'string', description: 'Optional caller-supplied record identifier' },
    };
    const patchProps: Record<string, unknown> = {};
    const requiredCreate: string[] = [];

    for (const f of res.fields) {
      const fSchema = fieldToJsonSchema(f);
      itemProps[f.name] = fSchema;
      createProps[f.name] = fSchema;
      patchProps[f.name] = fSchema;
      if (f.required) {
        requiredCreate.push(f.name);
      }
    }

    schemas[modelName] = {
      type: 'object',
      required: ['id', ...requiredCreate],
      properties: itemProps,
    };

    schemas[createSchemaName] = {
      type: 'object',
      ...(requiredCreate.length > 0 ? { required: requiredCreate } : {}),
      properties: createProps,
      additionalProperties: false,
    };

    schemas[patchSchemaName] = {
      type: 'object',
      properties: patchProps,
      additionalProperties: false,
    };

    schemas[pageSchemaName] = {
      type: 'object',
      required: ['items', 'pagination'],
      properties: {
        items: {
          type: 'array',
          items: { $ref: `#/components/schemas/${modelName}` },
        },
        pagination: {
          type: 'object',
          required: ['total', 'limit', 'offset', 'hasMore'],
          properties: {
            total: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
            hasMore: { type: 'boolean' },
          },
        },
      },
    };

    const collectionPath = `${normalizedBase}/${res.slug}`;
    const itemPath = `${normalizedBase}/${res.slug}/{id}`;

    paths[collectionPath] = {
      get: {
        summary: `List ${res.name} (paginated)`,
        tags: [res.name],
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
          { name: 'category', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'q', in: 'query', required: false, schema: { type: 'string', description: 'Case-insensitive text filter' } },
        ],
        responses: {
          '200': {
            description: `Paginated ${res.name} collection`,
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${pageSchemaName}` },
              },
            },
          },
          '401': { description: 'Missing or invalid FortiX Gateway API key' },
          '403': { description: 'Blocked by FortiX WAF or SSRF policy' },
          '429': { description: 'FortiX Gateway rate limit exceeded' },
        },
      },
      post: {
        summary: `Create ${res.name} record`,
        tags: [res.name],
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${createSchemaName}` },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created record',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${modelName}` },
              },
            },
          },
          '400': {
            description: 'Malformed JSON body',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/StudioErrorResponse' } } },
          },
          '401': { description: 'Missing or invalid FortiX Gateway API key' },
          '403': { description: 'Blocked by FortiX WAF or SSRF policy' },
          '409': {
            description: 'Duplicate record ID or unique field conflict',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/StudioErrorResponse' } } },
          },
          '413': { description: 'Payload exceeds 64 KB limit' },
          '422': {
            description: 'Declarative schema validation failed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/StudioErrorResponse' } } },
          },
          '429': { description: 'FortiX Gateway rate limit exceeded' },
        },
      },
    };

    paths[itemPath] = {
      get: {
        summary: `Get ${res.name} record by ID`,
        tags: [res.name],
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Record found',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${modelName}` },
              },
            },
          },
          '401': { description: 'Missing or invalid FortiX Gateway API key' },
          '404': {
            description: 'Record not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/StudioErrorResponse' } } },
          },
          '429': { description: 'FortiX Gateway rate limit exceeded' },
        },
      },
      patch: {
        summary: `Partially update ${res.name} record`,
        tags: [res.name],
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${patchSchemaName}` },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated record',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${modelName}` },
              },
            },
          },
          '401': { description: 'Missing or invalid FortiX Gateway API key' },
          '404': { description: 'Record not found' },
          '409': { description: 'Unique field conflict' },
          '422': { description: 'Schema validation failed' },
          '429': { description: 'FortiX Gateway rate limit exceeded' },
        },
      },
      delete: {
        summary: `Delete ${res.name} record`,
        tags: [res.name],
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Record deleted',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DeleteConfirmation' },
              },
            },
          },
          '401': { description: 'Missing or invalid FortiX Gateway API key' },
          '404': { description: 'Record not found' },
          '429': { description: 'FortiX Gateway rate limit exceeded' },
        },
      },
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: api.name,
      version: api.version,
      description:
        api.description ||
        `Declarative REST API managed by FortiX API Studio and protected behind FortiX Gateway (${serverUrl}).`,
    },
    servers: [
      {
        url: serverUrl,
        description: 'FortiX Protected Gateway Proxy Endpoint',
      },
    ],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Scoped FortiX Gateway API key (fx_<env>_<keyId>_<secret>)',
        },
      },
      schemas,
    },
    paths,
  };
}
