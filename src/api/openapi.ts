import { Router, Request, Response } from 'express';

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'FortiX API Gateway & Resilience Engine',
    version: '1.0.0',
    description: 'Production-grade API security, automated resilience experimentation, real-time threat telemetry, and authoritative verification gateway.',
    contact: {
      name: 'FortiX Security Engineering',
      url: 'https://fortix.dev'
    },
    license: {
      name: 'Proprietary'
    }
  },
  servers: [
    {
      url: '/',
      description: 'Current Environment'
    }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Control-plane authentication using JWT bearer token in Authorization header (`Bearer <token>`).'
      },
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'Gateway proxy authentication using hashed API Key (`fx_<env>_<keyId>_<secret>`).'
      }
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          details: { type: 'array', items: { type: 'object' } }
        },
        required: ['error']
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['ADMIN', 'DEVELOPER', 'VIEWER'] }
        },
        required: ['id', 'email', 'role']
      },
      Project: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          orgId: { type: 'string', format: 'uuid' },
          environment: { type: 'string', enum: ['development', 'staging', 'production'] },
          createdAt: { type: 'string', format: 'date-time' }
        },
        required: ['id', 'name', 'orgId', 'environment']
      },
      ApiRoute: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          pathPattern: { type: 'string', example: '/api/v1/payments' },
          targetUrl: { type: 'string', format: 'uri', example: 'https://payment-service.internal' },
          rateLimit: { type: 'integer', default: 100 },
          authRequired: { type: 'boolean', default: true },
          circuitBreakerEnabled: { type: 'boolean', default: false },
          createdAt: { type: 'string', format: 'date-time' }
        },
        required: ['id', 'projectId', 'pathPattern', 'targetUrl']
      },
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          keyPrefix: { type: 'string' },
          projectId: { type: 'string', format: 'uuid' },
          revokedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' }
        },
        required: ['id', 'name', 'keyPrefix', 'projectId', 'createdAt']
      },
      ApiKeyCreated: {
        allOf: [
          { $ref: '#/components/schemas/ApiKey' },
          {
            type: 'object',
            properties: {
              rawKey: { type: 'string', description: 'Raw secret returned exactly once upon key generation.' }
            },
            required: ['rawKey']
          }
        ]
      },
      SecurityPolicy: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['RATE_LIMIT', 'WAF_SQLI', 'WAF_XSS', 'IP_ALLOWLIST', 'JWT_VALIDATION'] },
          rules: { type: 'object' },
          enabled: { type: 'boolean', default: true },
          createdAt: { type: 'string', format: 'date-time' }
        },
        required: ['id', 'projectId', 'name', 'type', 'rules']
      },
      ChaosExperiment: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          routeId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['latency', 'error', 'drop', 'bandwidth'] },
          status: { type: 'string', enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] },
          config: { type: 'object' },
          createdAt: { type: 'string', format: 'date-time' },
          startedAt: { type: 'string', format: 'date-time', nullable: true },
          completedAt: { type: 'string', format: 'date-time', nullable: true }
        },
        required: ['id', 'projectId', 'routeId', 'name', 'type', 'status', 'config']
      },
      SecurityEvent: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          routeId: { type: 'string', format: 'uuid', nullable: true },
          eventType: { type: 'string' },
          severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
          ipAddress: { type: 'string' },
          metadata: { type: 'object' },
          timestamp: { type: 'string', format: 'date-time' }
        },
        required: ['id', 'projectId', 'eventType', 'severity', 'timestamp']
      },
      Webhook: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' } },
          enabled: { type: 'boolean', default: true },
          createdAt: { type: 'string', format: 'date-time' }
        },
        required: ['id', 'projectId', 'url', 'events', 'enabled']
      },
      DlqJob: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          queueName: { type: 'string' },
          jobName: { type: 'string' },
          experimentId: { type: 'string', nullable: true },
          failedReason: { type: 'string' },
          stacktrace: { type: 'array', items: { type: 'string' } },
          attemptsMade: { type: 'integer' },
          maxAttempts: { type: 'integer' },
          failedAt: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['DEAD_LETTER', 'FAILED', 'RETRYING', 'RESOLVED'] },
          data: { type: 'object' }
        },
        required: ['id', 'queueName', 'jobName', 'failedReason', 'attemptsMade', 'maxAttempts', 'failedAt', 'status']
      },
      QueueStats: {
        type: 'object',
        properties: {
          dlqTotal: { type: 'integer' },
          dlqByQueue: { type: 'object', additionalProperties: { type: 'integer' } },
          queues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                queueName: { type: 'string' },
                waiting: { type: 'integer' },
                active: { type: 'integer' },
                completed: { type: 'integer' },
                failed: { type: 'integer' },
                delayed: { type: 'integer' },
                paused: { type: 'boolean' }
              }
            }
          }
        }
      }
    }
  },
  paths: {
    '/api/health': {
      get: {
        summary: 'Full System Health Check',
        tags: ['System'],
        responses: {
          '200': {
            description: 'System components healthy',
            content: { 'application/json': { schema: { type: 'object' } } }
          },
          '503': {
            description: 'One or more subsystem dependencies degraded',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          }
        }
      }
    },
    '/api/health/live': {
      get: {
        summary: 'Liveness Probe',
        tags: ['System'],
        responses: {
          '200': { description: 'Process alive' }
        }
      }
    },
    '/api/health/ready': {
      get: {
        summary: 'Readiness Probe',
        tags: ['System'],
        responses: {
          '200': { description: 'Ready to receive traffic' },
          '503': { description: 'Not ready' }
        }
      }
    },
    '/metrics': {
      get: {
        summary: 'Prometheus Metrics Exposition',
        tags: ['Observability'],
        responses: {
          '200': {
            description: 'Prometheus metrics in standard exposition format',
            content: { 'text/plain': { schema: { type: 'string' } } }
          }
        }
      }
    },
    '/api/auth/register': {
      post: {
        summary: 'Register New Tenant Account',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  name: { type: 'string' }
                },
                required: ['email', 'password']
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'User registered successfully',
            content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } }
          },
          '400': { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '409': { description: 'User already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/api/auth/login': {
      post: {
        summary: 'Tenant Login',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' }
                },
                required: ['email', 'password']
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Authenticated successfully with JWT token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/User' }
                  },
                  required: ['token', 'user']
                }
              }
            }
          },
          '401': { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/api/auth/logout': {
      post: {
        summary: 'Logout Session',
        tags: ['Authentication'],
        responses: {
          '200': { description: 'Logged out successfully' }
        }
      }
    },
    '/api/auth/me': {
      get: {
        summary: 'Get Current Authenticated User',
        tags: ['Authentication'],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Current user profile',
            content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } }
          },
          '401': { description: 'Unauthorized' }
        }
      }
    },
    '/api/control/account/me': {
      get: {
        summary: 'Get Detailed Account and Organization Profile',
        tags: ['Account'],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Account profile' },
          '401': { description: 'Unauthorized' }
        }
      }
    },
    '/api/control/account/password': {
      post: {
        summary: 'Update Account Password',
        tags: ['Account'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  currentPassword: { type: 'string' },
                  newPassword: { type: 'string', minLength: 8 }
                },
                required: ['currentPassword', 'newPassword']
              }
            }
          }
        },
        responses: {
          '200': { description: 'Password updated successfully' },
          '400': { description: 'Invalid password input' },
          '401': { description: 'Unauthorized' }
        }
      }
    },
    '/api/control/projects': {
      get: {
        summary: 'List Projects for Authenticated Organization',
        tags: ['Projects'],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'List of projects',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Project' } } } }
          }
        }
      },
      post: {
        summary: 'Create New Project',
        tags: ['Projects'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  environment: { type: 'string', enum: ['development', 'staging', 'production'], default: 'development' }
                },
                required: ['name']
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Project created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Project' } } }
          }
        }
      }
    },
    '/api/control/projects/{projectId}': {
      patch: {
        summary: 'Update Project Configuration',
        tags: ['Projects'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  environment: { type: 'string', enum: ['development', 'staging', 'production'] }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Project updated' },
          '403': { description: 'Forbidden' },
          '404': { description: 'Project not found' }
        }
      }
    },
    '/api/control/routes': {
      get: {
        summary: 'List Upstream API Routes',
        tags: ['API Routes'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': {
            description: 'List of configured routes',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ApiRoute' } } } }
          },
          '403': { description: 'Forbidden' }
        }
      },
      post: {
        summary: 'Register Upstream API Route',
        tags: ['API Routes'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string', format: 'uuid' },
                  pathPattern: { type: 'string', example: '/api/v1/checkout' },
                  targetUrl: { type: 'string', format: 'uri', example: 'https://api.internal.service' },
                  rateLimit: { type: 'integer', default: 100 },
                  authRequired: { type: 'boolean', default: true }
                },
                required: ['projectId', 'pathPattern', 'targetUrl']
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Route created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiRoute' } } }
          },
          '400': { description: 'Invalid SSRF target or invalid path pattern' },
          '403': { description: 'Forbidden' }
        }
      }
    },
    '/api/control/routes/{id}': {
      delete: {
        summary: 'Delete API Route',
        tags: ['API Routes'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': { description: 'Route deleted' },
          '403': { description: 'Forbidden' },
          '404': { description: 'Route not found' }
        }
      }
    },
    '/api/control/keys': {
      get: {
        summary: 'List API Keys (Masked)',
        tags: ['API Keys'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': {
            description: 'List of API keys (secrets masked)',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } } } }
          }
        }
      },
      post: {
        summary: 'Create New API Key',
        tags: ['API Keys'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string', format: 'uuid' },
                  name: { type: 'string' }
                },
                required: ['projectId', 'name']
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'API key generated. Raw key is returned once only.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiKeyCreated' } } }
          }
        }
      }
    },
    '/api/control/keys/{id}/revoke': {
      post: {
        summary: 'Revoke API Key',
        tags: ['API Keys'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string', format: 'uuid' }
                },
                required: ['projectId']
              }
            }
          }
        },
        responses: {
          '200': { description: 'Key revoked and invalidated across distributed nodes via Redis Pub/Sub' },
          '404': { description: 'Key not found' }
        }
      }
    },
    '/api/control/keys/revoke-all': {
      post: {
        summary: 'Revoke All Keys for Project',
        tags: ['API Keys'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string', format: 'uuid' }
                },
                required: ['projectId']
              }
            }
          }
        },
        responses: {
          '200': { description: 'All active project keys revoked' }
        }
      }
    },
    '/api/control/policies': {
      get: {
        summary: 'List Security Policies',
        tags: ['Security Policies'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': {
            description: 'List of policies',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/SecurityPolicy' } } } }
          }
        }
      },
      post: {
        summary: 'Create Security Policy',
        tags: ['Security Policies'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  type: { type: 'string', enum: ['RATE_LIMIT', 'WAF_SQLI', 'WAF_XSS', 'IP_ALLOWLIST', 'JWT_VALIDATION'] },
                  rules: { type: 'object' }
                },
                required: ['projectId', 'name', 'type', 'rules']
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Policy created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SecurityPolicy' } } }
          }
        }
      }
    },
    '/api/control/policies/{id}': {
      delete: {
        summary: 'Delete Security Policy',
        tags: ['Security Policies'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': { description: 'Policy deleted' }
        }
      }
    },
    '/api/control/experiments': {
      get: {
        summary: 'List Chaos Experiments',
        tags: ['Chaos & Resilience'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': {
            description: 'List of experiments',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ChaosExperiment' } } } }
          },
          '403': { description: 'Entitlement ADVANCED_EXPERIMENTS required' }
        }
      },
      post: {
        summary: 'Launch Chaos Experiment',
        tags: ['Chaos & Resilience'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string', format: 'uuid' },
                  routeId: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  type: { type: 'string', enum: ['latency', 'error', 'drop', 'bandwidth'] },
                  config: { type: 'object' }
                },
                required: ['projectId', 'routeId', 'name', 'type', 'config']
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Experiment queued and worker job dispatched',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChaosExperiment' } } }
          },
          '403': { description: 'Entitlement ADVANCED_EXPERIMENTS required' }
        }
      }
    },
    '/api/control/metrics': {
      get: {
        summary: 'Get Gateway Telemetry Metrics',
        tags: ['Observability'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'range', in: 'query', schema: { type: 'string', enum: ['1h', '6h', '24h', '7d'], default: '1h' } }
        ],
        responses: {
          '200': { description: 'Aggregated metric series' },
          '403': { description: 'Entitlement ADVANCED_ANALYTICS required' }
        }
      }
    },
    '/api/control/metrics/scores': {
      get: {
        summary: 'Get Security and Resilience Scores',
        tags: ['Observability'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': {
            description: 'Composite score evaluations',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    securityScore: { type: 'number', minimum: 0, maximum: 100 },
                    resilienceScore: { type: 'number', minimum: 0, maximum: 100 }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/control/metrics/resilience-summary': {
      get: {
        summary: 'Get Resilience Summary & Latency Percentiles',
        tags: ['Observability'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': { description: 'Resilience summary including availability, p95, and p99 metrics' }
        }
      }
    },
    '/api/control/verifications': {
      get: {
        summary: 'List Verification Assertions',
        tags: ['Verifications'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': { description: 'Verification records' },
          '403': { description: 'Entitlement POLICY_VERIFICATION required' }
        }
      }
    },
    '/api/control/events': {
      get: {
        summary: 'List Real-time Security Events',
        tags: ['Security Events'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'severity', in: 'query', schema: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] } }
        ],
        responses: {
          '200': {
            description: 'List of security events',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/SecurityEvent' } } } }
          }
        }
      }
    },
    '/api/control/webhooks': {
      get: {
        summary: 'List Configured Alert Webhooks',
        tags: ['Webhooks'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': {
            description: 'List of webhooks',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Webhook' } } } }
          },
          '403': { description: 'Entitlement ADVANCED_SECURITY required' }
        }
      },
      post: {
        summary: 'Create Webhook',
        tags: ['Webhooks'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string', format: 'uuid' },
                  url: { type: 'string', format: 'uri' },
                  events: { type: 'array', items: { type: 'string' } }
                },
                required: ['projectId', 'url', 'events']
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Webhook created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Webhook' } } }
          },
          '403': { description: 'Entitlement ADVANCED_SECURITY required' }
        }
      }
    },
    '/api/control/webhooks/{id}': {
      delete: {
        summary: 'Delete Webhook',
        tags: ['Webhooks'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': { description: 'Webhook deleted' },
          '403': { description: 'Forbidden' }
        }
      }
    },
    '/api/control/webhooks/{id}/toggle': {
      patch: {
        summary: 'Toggle Webhook Active State',
        tags: ['Webhooks'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string', format: 'uuid' },
                  enabled: { type: 'boolean' }
                },
                required: ['projectId', 'enabled']
              }
            }
          }
        },
        responses: {
          '200': { description: 'Webhook updated' }
        }
      }
    },
    '/api/control/resources': {
      get: {
        summary: 'Get Tenant-Scoped Dynamic Telemetry Topology',
        tags: ['Observability'],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'projectId',
            in: 'query',
            required: true,
            schema: { type: 'string', minLength: 1 }
          }
        ],
        responses: {
          '200': {
            description: 'Current topology graph and live resource telemetry for the authorized project',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['schemaVersion', 'generatedAt', 'projectId', 'nodes', 'edges', 'activeExperiments', 'telemetryHistory'],
                  properties: {
                    schemaVersion: { type: 'integer', example: 1 },
                    generatedAt: { type: 'string', format: 'date-time' },
                    projectId: { type: 'string' },
                    nodes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['id', 'type', 'label', 'status'],
                        properties: {
                          id: { type: 'string' },
                          type: { type: 'string', enum: ['client', 'gateway', 'route', 'worker', 'redis', 'postgres'] },
                          label: { type: 'string' },
                          status: { type: 'string', enum: ['healthy', 'degraded', 'error'] },
                          metadata: { type: 'object', additionalProperties: true }
                        }
                      }
                    },
                    edges: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['id', 'source', 'target', 'relation', 'status'],
                        properties: {
                          id: { type: 'string' },
                          source: { type: 'string' },
                          target: { type: 'string' },
                          relation: { type: 'string', enum: ['request', 'telemetry', 'persistence'] },
                          status: { type: 'string', enum: ['healthy', 'degraded', 'error'] }
                        }
                      }
                    },
                    activeExperiments: { type: 'array', items: { type: 'object' } },
                    telemetry: { type: 'object', nullable: true },
                    telemetryHistory: { type: 'array', items: { type: 'object' } }
                  }
                }
              }
            }
          },
          '401': { description: 'Unauthorized' },
          '403': { description: 'TOPOLOGY entitlement or project ownership required' },
          '500': { description: 'Failed to collect topology telemetry' }
        }
      }
    },
,
    '/api/control/settings': {
      get: {
        summary: 'Get Project Settings',
        tags: ['Settings'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': { description: 'Settings object' }
        }
      }
    },
    '/api/control/settings/audit-logs': {
      get: {
        summary: 'Get Immutable Audit Logs',
        tags: ['Settings'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'projectId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': { description: 'Audit log trail' }
        }
      }
    },
    '/api/control/settings/{domain}': {
      patch: {
        summary: 'Update Settings for Specific Domain',
        tags: ['Settings'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'domain', in: 'path', required: true, schema: { type: 'string', enum: ['security', 'resilience', 'notifications'] } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string', format: 'uuid' },
                  settings: { type: 'object' }
                },
                required: ['projectId', 'settings']
              }
            }
          }
        },
        responses: {
          '200': { description: 'Settings updated' }
        }
      }
    },
    '/api/control/reports/{verificationId}': {
      post: {
        summary: 'Generate Authoritative Server-Side PDF Evidence Report',
        tags: ['Reports'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'verificationId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string', format: 'uuid' },
                  details: { type: 'string' }
                },
                required: ['projectId']
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'PDF report binary stream',
            content: {
              'application/pdf': {
                schema: { type: 'string', format: 'binary' }
              }
            }
          },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden' }
        }
      }
    },
    '/api/control/dlq': {
      get: {
        summary: 'List Dead-Letter Queue Jobs',
        tags: ['Queue & DLQ'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'queueName', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }
        ],
        responses: {
          '200': {
            description: 'List of dead-letter jobs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer' },
                    jobs: { type: 'array', items: { $ref: '#/components/schemas/DlqJob' } }
                  }
                }
              }
            }
          },
          '401': { description: 'Unauthorized' }
        }
      }
    },
    '/api/control/dlq/stats': {
      get: {
        summary: 'Get BullMQ & DLQ Health Stats',
        tags: ['Queue & DLQ'],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Queue and DLQ statistics',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/QueueStats' } } }
          },
          '401': { description: 'Unauthorized' }
        }
      }
    },
    '/api/control/dlq/{jobId}': {
      get: {
        summary: 'Get Dead-Letter Job Details',
        tags: ['Queue & DLQ'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': {
            description: 'Job details',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DlqJob' } } }
          },
          '404': { description: 'Job not found' },
          '401': { description: 'Unauthorized' }
        }
      },
      delete: {
        summary: 'Discard Dead-Letter Job',
        tags: ['Queue & DLQ'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Job discarded successfully' },
          '404': { description: 'Job not found' },
          '401': { description: 'Unauthorized' }
        }
      }
    },
    '/api/control/dlq/{jobId}/retry': {
      post: {
        summary: 'Retry Dead-Letter Job',
        tags: ['Queue & DLQ'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Job re-enqueued for retry' },
          '404': { description: 'Job not found' },
          '401': { description: 'Unauthorized' }
        }
      }
    },
    '/api/control/dlq/retry-all': {
      post: {
        summary: 'Retry All Dead-Letter Jobs',
        tags: ['Queue & DLQ'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'queueName', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Retry initiated for all dead-letter jobs' },
          '401': { description: 'Unauthorized' }
        }
      }
    },
    '/api/control/dlq/purge-all': {
      delete: {
        summary: 'Purge All Dead-Letter Jobs',
        tags: ['Queue & DLQ'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'queueName', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Purged all dead-letter jobs' },
          '401': { description: 'Unauthorized' }
        }
      }
    },
    '/proxy/{routeId}': {
      get: {
        summary: 'Gateway Reverse Proxy Request (GET)',
        tags: ['Gateway Proxy'],
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: 'routeId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': { description: 'Proxied upstream response' },
          '401': { description: 'Missing or invalid API key' },
          '429': { description: 'Rate limit exceeded' },
          '500': { description: 'Upstream gateway error / injected chaos' }
        }
      },
      post: {
        summary: 'Gateway Reverse Proxy Request (POST)',
        tags: ['Gateway Proxy'],
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: 'routeId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': { schema: { type: 'object' } }
          }
        },
        responses: {
          '200': { description: 'Proxied upstream response' },
          '401': { description: 'Missing or invalid API key' },
          '429': { description: 'Rate limit exceeded' },
          '500': { description: 'Upstream gateway error / injected chaos' }
        }
      }
    }
  }
};

export const openApiRouter = Router();

// 1. JSON Schema endpoint
openApiRouter.get('/openapi.json', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(openApiSpec);
});

// 2. Interactive documentation page (Swagger UI standalone)
export function getSwaggerHtml(specUrl = '/api/openapi.json'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FortiX API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .swagger-ui { color: #f3f4f6; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info { margin: 30px 0; }
    .swagger-ui .info .title { color: #f8fafc; }
    .swagger-ui .scheme-container { background: #111827; box-shadow: none; border-bottom: 1px solid #1f2937; }
    .swagger-ui .opblock { background: #111827; border: 1px solid #1f2937; border-radius: 8px; }
    .swagger-ui .opblock .opblock-summary { border-color: #1f2937; }
    .swagger-ui .opblock .opblock-summary-method { border-radius: 4px; font-weight: bold; }
    .swagger-ui .opblock-body { background: #0f172a; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
}
