import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  Copy,
  Database,
  Download,
  FileJson,
  KeyRound,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Send,
  Shield,
  Trash2,
  Zap,
} from 'lucide-react';
import { Card } from '../components/ui/card.js';
import { useProject } from '../context/ProjectContext.js';
import { fetchWithAuth, parseApiErrorResponse, trackProductEvent } from '../lib/api.js';

interface StudioFieldDef {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'enum';
  required: boolean;
  unique?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  enumValues?: string[];
  description?: string;
}

interface StudioEndpointDesc {
  method: string;
  path: string;
  shortPath: string;
  summary: string;
}

interface StudioResourceSummary {
  id: string;
  apiId: string;
  projectId: string;
  name: string;
  slug: string;
  fields: StudioFieldDef[];
  recordCount: number;
  endpoints: StudioEndpointDesc[];
}

interface StudioApiSummary {
  id: string;
  projectId: string;
  routeId: string | null;
  gatewayBaseUrl: string | null;
  name: string;
  description: string;
  basePath: string;
  version: string;
  activeKeyCount: number;
  totalRecords: number;
  route: {
    id: string;
    pathPattern: string;
    targetUrl: string;
  } | null;
  policy: {
    id: string;
    routeId: string;
    rateLimitRpm: number | null;
    enableWaf: boolean;
    enableSsrf: boolean;
  } | null;
  resources: StudioResourceSummary[];
}

interface PlaygroundResponseState {
  mode: 'single' | 'burst';
  status: number;
  statusText: string;
  latencyMs: number;
  requestId: string | null;
  rateLimitLimit: string | null;
  rateLimitRemaining: string | null;
  bodyText: string;
  burstSummary?: {
    totalSent: number;
    ok2xx: number;
    rateLimited429: number;
    otherErrors: number;
    avgLatencyMs: number;
  };
}

const CANONICAL_CATEGORIES = [
  'Accessories',
  'Audio & Video',
  'Automotive',
  'Cloud & Storage',
  'Computer Peripherals',
  'Cybersecurity',
  'Developer Tools',
  'Electronics',
  'Fitness',
  'Home',
  'Industrial IoT',
  'Kitchen',
  'Lab Equipment',
  'Learning & STEM',
  'Monitoring & Sensors',
  'Networking',
  'Office',
  'Outdoor & Travel',
  'Packaging & Logistics',
  'Personal Care',
  'Power & Backup',
  'Safety & Security',
  'Smart Devices',
  'Software & Licenses',
];

function buildSamplePayload(fields: StudioFieldDef[], partial = false): string {
  const obj: Record<string, unknown> = {};
  const targetFields = partial ? fields.slice(0, Math.min(2, fields.length)) : fields;
  for (const f of targetFields) {
    if (f.name === 'sku') obj[f.name] = `FTX-NEW-${Math.floor(1000 + Math.random() * 8999)}`;
    else if (f.name === 'name') obj[f.name] = partial ? 'Updated Studio Item' : 'Industrial Edge Sensor Pro';
    else if (f.name === 'description') obj[f.name] = 'Telemetry-ready hardware unit provisioned in FortiX API Studio.';
    else if (f.name === 'category') obj[f.name] = 'Industrial IoT';
    else if (f.name === 'price') obj[f.name] = partial ? 2499.5 : 3299.0;
    else if (f.name === 'stock') obj[f.name] = partial ? 48 : 25;
    else if (f.type === 'enum') obj[f.name] = f.enumValues?.[0] ?? 'active';
    else if (f.type === 'boolean') obj[f.name] = true;
    else if (f.type === 'integer') obj[f.name] = typeof f.min === 'number' ? Math.max(1, f.min) : 10;
    else if (f.type === 'number') obj[f.name] = typeof f.min === 'number' ? Math.max(1, f.min) : 199.99;
    else obj[f.name] = `sample_${f.name}`;
  }
  return JSON.stringify(obj, null, 2);
}

export default function ApiStudio() {
  const { currentProject } = useProject();
  const projectId = currentProject?.id || localStorage.getItem('fortix_project_id') || '';

  const [studioApis, setStudioApis] = useState<StudioApiSummary[]>([]);
  const [selectedApiId, setSelectedApiId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'playground' | 'data' | 'security' | 'openapi'>('playground');

  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [statusNotice, setStatusNotice] = useState('');

  // Create API form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newApiForm, setNewApiForm] = useState({
    name: 'Store Products API',
    description: 'Self-contained INR hardware and retail catalogue protected behind FortiX Gateway.',
    basePath: '/api/store',
    version: 'v1',
    template: 'products_100' as 'products_100' | 'store_suite' | 'empty',
    rateLimitRpm: 60,
    enableWaf: true,
    enableSsrf: true,
    issueApiKey: true,
  });

  // Delete confirmation
  const [confirmDeleteApiId, setConfirmDeleteApiId] = useState<string | null>(null);

  // Active API key in session for playground convenience
  const [sessionApiKey, setSessionApiKey] = useState<string>('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Playground state
  const [playMethod, setPlayMethod] = useState<'GET' | 'POST' | 'PATCH' | 'DELETE'>('GET');
  const [playPath, setPlayPath] = useState<string>('');
  const [playBody, setPlayBody] = useState<string>('{\n  \n}');
  const [playBusy, setPlayBusy] = useState(false);
  const [playResponse, setPlayResponse] = useState<PlaygroundResponseState | null>(null);

  // Data Browser & Resource Builder state
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsOffset, setRecordsOffset] = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  const [showAddResource, setShowAddResource] = useState(false);
  const [newResName, setNewResName] = useState('');
  const [newResSlug, setNewResSlug] = useState('');
  const [newResSeedCount, setNewResSeedCount] = useState(20);
  const [newResFields, setNewResFields] = useState<StudioFieldDef[]>([
    { name: 'title', type: 'string', required: true },
    { name: 'amount', type: 'number', required: true, min: 0 },
    { name: 'status', type: 'enum', required: true, enumValues: ['active', 'archived'] },
  ]);

  // Security & Verification state
  const [policyForm, setPolicyForm] = useState({
    rateLimitRpm: '60',
    enableWaf: true,
    enableSsrf: true,
  });
  const [routeExperiments, setRouteExperiments] = useState<any[]>([]);
  const [routeVerifications, setRouteVerifications] = useState<any[]>([]);

  // OpenAPI Spec state
  const [openApiJson, setOpenApiJson] = useState<string>('');
  const [openApiLoading, setOpenApiLoading] = useState(false);

  const selectedApi = useMemo(
    () => studioApis.find((a) => a.id === selectedApiId) || studioApis[0] || null,
    [studioApis, selectedApiId]
  );

  const selectedResource = useMemo(() => {
    if (!selectedApi) return null;
    return (
      selectedApi.resources.find((r) => r.id === selectedResourceId) ||
      selectedApi.resources[0] ||
      null
    );
  }, [selectedApi, selectedResourceId]);

  const loadStudioApis = useCallback(
    async (preferApiId?: string) => {
      if (!projectId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetchWithAuth(`/api/control/studio/apis?projectId=${encodeURIComponent(projectId)}`);
        if (!res.ok) {
          const parsed = await parseApiErrorResponse(res, 'Unable to load FortiX API Studio workspaces.');
          setErrorMsg(parsed.message);
          return;
        }
        setErrorMsg('');
        const list: StudioApiSummary[] = await res.json();
        const safeList = Array.isArray(list) ? list : [];
        setStudioApis(safeList);

        const nextApi =
          (preferApiId && safeList.find((a) => a.id === preferApiId)) ||
          safeList.find((a) => a.id === selectedApiId) ||
          safeList[0] ||
          null;

        if (nextApi) {
          setSelectedApiId(nextApi.id);
        } else {
          setSelectedApiId('');
        }
      } catch {
        setErrorMsg('Network error loading Studio APIs.');
      } finally {
        setLoading(false);
      }
    },
    [projectId, selectedApiId]
  );

  useEffect(() => {
    void loadStudioApis();
  }, [projectId]);

  // Sync playground path, selected resource, and policy form when selectedApi changes
  useEffect(() => {
    if (!selectedApi) return;
    const firstRes = selectedApi.resources[0];
    if (firstRes && !selectedApi.resources.some((r) => r.id === selectedResourceId)) {
      setSelectedResourceId(firstRes.id);
    }
    if (selectedApi.gatewayBaseUrl) {
      const cleanBase = selectedApi.basePath === '/' ? '' : selectedApi.basePath.replace(/\/+$/, '');
      const defaultPath = firstRes
        ? `${selectedApi.gatewayBaseUrl}${cleanBase}/${firstRes.slug}?limit=10`
        : `${selectedApi.gatewayBaseUrl}/health`;
      setPlayPath((prev) =>
        prev && prev.startsWith(selectedApi.gatewayBaseUrl!) ? prev : defaultPath
      );
      if (firstRes) {
        setPlayBody(buildSamplePayload(firstRes.fields, false));
      }
    }
    if (selectedApi.policy) {
      setPolicyForm({
        rateLimitRpm:
          selectedApi.policy.rateLimitRpm !== null && selectedApi.policy.rateLimitRpm !== undefined
            ? String(selectedApi.policy.rateLimitRpm)
            : '',
        enableWaf: Boolean(selectedApi.policy.enableWaf),
        enableSsrf: Boolean(selectedApi.policy.enableSsrf),
      });
    }
  }, [selectedApi, selectedResourceId]);

  // Load records when Data tab or filters change
  const loadResourceRecords = useCallback(async () => {
    if (!selectedApi || !selectedResource || !projectId) return;
    setRecordsLoading(true);
    try {
      const qs = new URLSearchParams({
        projectId,
        limit: '15',
        offset: String(recordsOffset),
      });
      if (filterCategory) qs.set('category', filterCategory);
      if (filterStatus) qs.set('status', filterStatus);
      if (filterSearch.trim()) qs.set('q', filterSearch.trim());

      const res = await fetchWithAuth(
        `/api/control/studio/apis/${selectedApi.id}/resources/${selectedResource.id}/records?${qs.toString()}`
      );
      if (res.ok) {
        const data = await res.json();
        setRecords(Array.isArray(data.items) ? data.items : []);
        setRecordsTotal(Number(data.pagination?.total ?? 0));
      }
    } catch {
      // Keep current table state on transient error
    } finally {
      setRecordsLoading(false);
    }
  }, [selectedApi, selectedResource, projectId, recordsOffset, filterCategory, filterStatus, filterSearch]);

  useEffect(() => {
    if (activeTab === 'data' && selectedApi && selectedResource) {
      void loadResourceRecords();
    }
  }, [activeTab, selectedApi, selectedResource, loadResourceRecords]);

  // Load Experiments & Verifications when Security tab is active
  const loadExperimentsAndVerifications = useCallback(async () => {
    if (!selectedApi?.routeId || !projectId) return;
    try {
      const [expRes, verRes] = await Promise.all([
        fetchWithAuth(`/api/control/experiments?projectId=${encodeURIComponent(projectId)}`),
        fetchWithAuth(`/api/control/verifications?projectId=${encodeURIComponent(projectId)}`),
      ]);
      if (expRes.ok) {
        const expData = await expRes.json();
        const filtered = (Array.isArray(expData) ? expData : []).filter(
          (e) => e.routeId === selectedApi.routeId
        );
        setRouteExperiments(filtered.slice(0, 8));
      }
      if (verRes.ok) {
        const verData = await verRes.json();
        const filteredVer = (Array.isArray(verData) ? verData : []).filter(
          (v) => v.routeId === selectedApi.routeId
        );
        setRouteVerifications(filteredVer.slice(0, 8));
      }
    } catch {}
  }, [selectedApi?.routeId, projectId]);

  useEffect(() => {
    if (activeTab !== 'security' || !selectedApi?.routeId) return;
    void loadExperimentsAndVerifications();
    const hasRunning = routeExperiments.some(
      (e) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(e.status)
    );
    if (!hasRunning) return;
    const timer = setInterval(() => {
      void loadExperimentsAndVerifications();
    }, 1500);
    return () => clearInterval(timer);
  }, [activeTab, selectedApi?.routeId, routeExperiments, loadExperimentsAndVerifications]);

  // Load OpenAPI spec when OpenAPI tab is active
  const loadOpenApiSpec = useCallback(async () => {
    if (!selectedApi || !projectId) return;
    setOpenApiLoading(true);
    try {
      const res = await fetchWithAuth(
        `/api/control/studio/apis/${selectedApi.id}/openapi?projectId=${encodeURIComponent(projectId)}`
      );
      if (res.ok) {
        const spec = await res.json();
        setOpenApiJson(JSON.stringify(spec, null, 2));
      }
    } catch {
      setErrorMsg('Unable to generate OpenAPI specification.');
    } finally {
      setOpenApiLoading(false);
    }
  }, [selectedApi, projectId]);

  useEffect(() => {
    if (activeTab === 'openapi' && selectedApi) {
      void loadOpenApiSpec();
    }
  }, [activeTab, selectedApi, loadOpenApiSpec]);

  const copyText = async (text: string, tokenLabel: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedToken(tokenLabel);
      setTimeout(() => setCopiedToken(null), 1800);
    } catch {}
  };

  const handleQuickCreateProductsApi = async () => {
    setErrorMsg('');
    setStatusNotice('');
    setBusyAction(true);
    try {
      const suffix = studioApis.length > 0 ? ` ${studioApis.length + 1}` : '';
      const basePath = studioApis.length > 0 ? `/api/store-${studioApis.length + 1}` : '/api/store';
      const res = await fetchWithAuth('/api/control/studio/apis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: `Store Products API${suffix}`,
          description: 'Canonical 100-product INR catalogue across 24 categories behind FortiX Gateway.',
          basePath,
          version: 'v1',
          template: 'products_100',
          initialPolicy: {
            rateLimitRpm: 60,
            enableWaf: true,
            enableSsrf: true,
          },
          issueApiKey: !sessionApiKey,
        }),
      });
      if (!res.ok) {
        const parsed = await parseApiErrorResponse(res, 'Failed to provision Products API.');
        setErrorMsg(parsed.message);
        return;
      }
      const created = await res.json();
      if (created.issuedApiKey?.rawKey) {
        setSessionApiKey(created.issuedApiKey.rawKey);
      }
      trackProductEvent('studio_api_created');
      setStatusNotice(`Created ${created.name} with 100 seeded products and active gateway route.`);
      setShowCreateForm(false);
      await loadStudioApis(created.id);
    } catch {
      setErrorMsg('Network error provisioning Studio API.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCustomCreateApi = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusNotice('');
    setBusyAction(true);
    try {
      const res = await fetchWithAuth('/api/control/studio/apis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: newApiForm.name.trim(),
          description: newApiForm.description.trim(),
          basePath: newApiForm.basePath.trim(),
          version: newApiForm.version.trim(),
          template: newApiForm.template,
          initialPolicy: {
            rateLimitRpm: newApiForm.rateLimitRpm > 0 ? Number(newApiForm.rateLimitRpm) : null,
            enableWaf: newApiForm.enableWaf,
            enableSsrf: newApiForm.enableSsrf,
          },
          issueApiKey: newApiForm.issueApiKey,
        }),
      });
      if (!res.ok) {
        const parsed = await parseApiErrorResponse(res, 'Failed to create Studio API.');
        setErrorMsg(parsed.message);
        return;
      }
      const created = await res.json();
      if (created.issuedApiKey?.rawKey) {
        setSessionApiKey(created.issuedApiKey.rawKey);
      }
      setShowCreateForm(false);
      setStatusNotice(`Created ${created.name} (${created.basePath} · ${created.version}).`);
      await loadStudioApis(created.id);
    } catch {
      setErrorMsg('Network error creating Studio API.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleDeleteApi = async (apiId: string) => {
    setConfirmDeleteApiId(null);
    setBusyAction(true);
    setErrorMsg('');
    try {
      const res = await fetchWithAuth(
        `/api/control/studio/apis/${apiId}?projectId=${encodeURIComponent(projectId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const parsed = await parseApiErrorResponse(res, 'Failed to delete Studio API.');
        setErrorMsg(parsed.message);
        return;
      }
      setStatusNotice('Deleted Studio API workspace and unlinked gateway route.');
      await loadStudioApis();
    } catch {
      setErrorMsg('Network error deleting Studio API.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleIssuePlaygroundKey = async () => {
    setErrorMsg('');
    setBusyAction(true);
    try {
      const res = await fetchWithAuth('/api/control/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: `${selectedApi?.name || 'Studio'} Key`,
          purpose: 'FortiX API Studio Playground',
        }),
      });
      if (!res.ok) {
        const parsed = await parseApiErrorResponse(res, 'Failed to issue gateway API key.');
        setErrorMsg(parsed.message);
        return;
      }
      const created = await res.json();
      if (created.rawKey) {
        setSessionApiKey(created.rawKey);
        setStatusNotice('Issued new gateway API key and attached it to the playground.');
      }
      await loadStudioApis(selectedApi?.id);
    } catch {
      setErrorMsg('Network error issuing API key.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSendSingleRequest = async (override?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path?: string;
    omitKey?: boolean;
  }) => {
    const targetMethod = override?.method ?? playMethod;
    const targetPath = (override?.path ?? playPath).trim();
    if (!targetPath.startsWith('/proxy/')) {
      setErrorMsg('Playground requests must target a protected /proxy/:routeId gateway URL.');
      return;
    }

    setErrorMsg('');
    setPlayBusy(true);
    const t0 = performance.now();
    try {
      const headers: Record<string, string> = {};
      if (!override?.omitKey && sessionApiKey.trim()) {
        headers['x-api-key'] = sessionApiKey.trim();
      }
      if (targetMethod === 'POST' || targetMethod === 'PATCH') {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(targetPath, {
        method: targetMethod,
        headers,
        body: targetMethod === 'POST' || targetMethod === 'PATCH' ? playBody : undefined,
      });
      const elapsed = Math.max(1, Math.round(performance.now() - t0));
      const rawText = await res.text();
      let formatted = rawText;
      try {
        formatted = JSON.stringify(JSON.parse(rawText), null, 2);
      } catch {}

      setPlayResponse({
        mode: 'single',
        status: res.status,
        statusText: res.statusText || (res.ok ? 'OK' : 'Error'),
        latencyMs: elapsed,
        requestId: res.headers.get('x-fortix-request-id'),
        rateLimitLimit: res.headers.get('x-ratelimit-limit'),
        rateLimitRemaining: res.headers.get('x-ratelimit-remaining'),
        bodyText: formatted,
      });

      if (targetMethod === 'POST' || targetMethod === 'PATCH' || targetMethod === 'DELETE') {
        void loadStudioApis(selectedApi?.id);
      }
    } catch {
      setErrorMsg('Gateway request failed due to network error.');
    } finally {
      setPlayBusy(false);
    }
  };

  const handleSendBurst = async (burstCount = 25) => {
    const targetPath = playPath.trim();
    if (!targetPath.startsWith('/proxy/')) {
      setErrorMsg('Playground burst must target a /proxy/:routeId gateway URL.');
      return;
    }
    setErrorMsg('');
    setPlayBusy(true);
    const t0 = performance.now();
    try {
      const headers: Record<string, string> = {};
      if (sessionApiKey.trim()) {
        headers['x-api-key'] = sessionApiKey.trim();
      }

      const calls = Array.from({ length: burstCount }, async () => {
        const reqStart = performance.now();
        const r = await fetch(targetPath, { method: 'GET', headers });
        const lat = Math.max(1, Math.round(performance.now() - reqStart));
        return {
          status: r.status,
          lat,
          limit: r.headers.get('x-ratelimit-limit'),
          remaining: r.headers.get('x-ratelimit-remaining'),
          reqId: r.headers.get('x-fortix-request-id'),
        };
      });

      const results = await Promise.all(calls);
      const totalElapsed = Math.max(1, Math.round(performance.now() - t0));
      const ok2xx = results.filter((r) => r.status >= 200 && r.status < 300).length;
      const rateLimited429 = results.filter((r) => r.status === 429).length;
      const otherErrors = results.length - ok2xx - rateLimited429;
      const avgLatencyMs = Math.round(results.reduce((s, r) => s + r.lat, 0) / results.length);
      const last = results[results.length - 1];

      setPlayResponse({
        mode: 'burst',
        status: rateLimited429 > 0 ? 429 : last.status,
        statusText: rateLimited429 > 0 ? 'Rate Limit Enforced' : 'Burst Completed',
        latencyMs: totalElapsed,
        requestId: last.reqId,
        rateLimitLimit: last.limit,
        rateLimitRemaining: last.remaining,
        bodyText: JSON.stringify(
          {
            burstRequestsSent: burstCount,
            accepted2xx: ok2xx,
            rejected429RateLimited: rateLimited429,
            otherResponses: otherErrors,
            averageRequestLatencyMs: avgLatencyMs,
            totalBurstWallTimeMs: totalElapsed,
          },
          null,
          2
        ),
        burstSummary: {
          totalSent: burstCount,
          ok2xx,
          rateLimited429,
          otherErrors,
          avgLatencyMs,
        },
      });
    } catch {
      setErrorMsg('Burst execution failed.');
    } finally {
      setPlayBusy(false);
    }
  };

  const handleSeedResource = async (mode: 'reset' | 'append', count?: number) => {
    if (!selectedApi || !selectedResource) return;
    setBusyAction(true);
    setErrorMsg('');
    try {
      const res = await fetchWithAuth(
        `/api/control/studio/apis/${selectedApi.id}/resources/${selectedResource.id}/seed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            mode,
            ...(count ? { count } : {}),
          }),
        }
      );
      if (!res.ok) {
        const parsed = await parseApiErrorResponse(res, 'Failed to seed sample data.');
        setErrorMsg(parsed.message);
        return;
      }
      const data = await res.json();
      setRecordsOffset(0);
      setStatusNotice(
        mode === 'reset'
          ? `Reset '${selectedResource.name}' to ${data.totalRecords} deterministic records.`
          : `Appended ${data.inserted} records (${data.totalRecords} total).`
      );
      await loadStudioApis(selectedApi.id);
      await loadResourceRecords();
    } catch {
      setErrorMsg('Network error seeding sample records.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleAddResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApi) return;
    setBusyAction(true);
    setErrorMsg('');
    try {
      const res = await fetchWithAuth(`/api/control/studio/apis/${selectedApi.id}/resources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: newResName.trim(),
          slug: newResSlug.trim() || undefined,
          fields: newResFields,
          seedCount: newResSeedCount,
        }),
      });
      if (!res.ok) {
        const parsed = await parseApiErrorResponse(res, 'Failed to add resource.');
        setErrorMsg(parsed.message);
        return;
      }
      const created = await res.json();
      setShowAddResource(false);
      setNewResName('');
      setNewResSlug('');
      setSelectedResourceId(created.id);
      setStatusNotice(`Added resource '${created.name}' (/${created.slug}) with ${created.recordCount} records.`);
      await loadStudioApis(selectedApi.id);
    } catch {
      setErrorMsg('Network error adding resource.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveSecurityPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApi?.routeId) return;
    setBusyAction(true);
    setErrorMsg('');
    try {
      const rpmNum = policyForm.rateLimitRpm.trim()
        ? Number.parseInt(policyForm.rateLimitRpm.trim(), 10)
        : null;
      const res = await fetchWithAuth(`/api/control/policies?projectId=${encodeURIComponent(projectId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          routeId: selectedApi.routeId,
          rateLimitRpm: Number.isFinite(rpmNum as number) ? rpmNum : null,
          enableWaf: policyForm.enableWaf,
          enableSsrf: policyForm.enableSsrf,
        }),
      });
      if (!res.ok) {
        const parsed = await parseApiErrorResponse(res, 'Failed to save gateway security policy.');
        setErrorMsg(parsed.message);
        return;
      }
      setStatusNotice('Updated gateway security policy on this Studio API route.');
      await loadStudioApis(selectedApi.id);
    } catch {
      setErrorMsg('Network error saving security policy.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleRunStudioExperiment = async (
    type: 'traffic_burst' | 'latency' | 'error_5xx'
  ) => {
    if (!selectedApi?.routeId) return;
    setBusyAction(true);
    setErrorMsg('');
    try {
      const config =
        type === 'latency'
          ? { latencyMs: 450, durationMs: 3500 }
          : { durationMs: 3500 };

      const res = await fetchWithAuth('/api/control/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          routeId: selectedApi.routeId,
          type,
          config,
        }),
      });
      if (!res.ok) {
        const parsed = await parseApiErrorResponse(res, 'Failed to queue controlled experiment.');
        setErrorMsg(parsed.message);
        return;
      }
      setStatusNotice(
        `Queued '${type}' experiment against ${selectedApi.name} (/proxy/${selectedApi.routeId.slice(0, 8)}…). Observing BASELINE → INJECTION → RECOVERY.`
      );
      await loadExperimentsAndVerifications();
    } catch {
      setErrorMsg('Network error starting experiment.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleDownloadOpenApi = () => {
    if (!openApiJson || !selectedApi) return;
    const blob = new Blob([openApiJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeSlug = selectedApi.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = url;
    a.download = `${safeSlug}-${selectedApi.version}-openapi.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-strong">FortiX API Studio</h2>
          <p className="text-xs text-muted mt-1 max-w-2xl">
            Create a declarative REST API, seed deterministic sample data, and exercise real FortiX Gateway authentication, WAF, rate limiting, chaos experiments, and verification evidence.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={busyAction}
            onClick={handleQuickCreateProductsApi}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-inverted rounded-lg text-xs font-semibold hover:opacity-90 transition disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Zap size={14} />
            <span>Create Products API (100 Records)</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-hover border border-subtle text-strong rounded-lg text-xs font-semibold hover:bg-hover-strong transition whitespace-nowrap shrink-0"
          >
            <Plus size={14} />
            <span>{showCreateForm ? 'Close Builder' : 'Custom API'}</span>
          </button>
        </div>
      </div>

      {/* Error & Notice Banners */}
      {errorMsg && (
        <div
          role="alert"
          className="bg-red-500/15 text-red-300 px-4 py-3 rounded-xl border border-red-500/30 flex items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0 text-red-400" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg('')}
            className="text-xs text-red-200 hover:text-white font-semibold whitespace-nowrap"
          >
            Dismiss
          </button>
        </div>
      )}

      {statusNotice && (
        <div className="bg-emerald-500/10 text-emerald-300 px-4 py-2.5 rounded-xl border border-emerald-500/25 flex items-center justify-between gap-3 text-xs">
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice('')}
            className="text-xs text-muted hover:text-strong whitespace-nowrap"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Custom API Creation Form */}
      {showCreateForm && (
        <Card className="p-6 bg-card border-subtle">
          <form onSubmit={handleCustomCreateApi} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-strong">Define New Gateway-Protected API</h3>
              <span className="text-xs text-muted font-mono">No arbitrary code · Declarative JSON schema</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2 flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted">API Name</label>
                <input
                  type="text"
                  required
                  value={newApiForm.name}
                  onChange={(e) => setNewApiForm({ ...newApiForm, name: e.target.value })}
                  className="bg-base border border-subtle text-strong text-sm rounded-xl px-3.5 py-2 outline-none focus:border-primary"
                  placeholder="Store API"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted">Base Path</label>
                <input
                  type="text"
                  required
                  value={newApiForm.basePath}
                  onChange={(e) => setNewApiForm({ ...newApiForm, basePath: e.target.value })}
                  className="bg-base border border-subtle text-strong text-sm rounded-xl px-3.5 py-2 outline-none focus:border-primary font-mono"
                  placeholder="/api/store"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted">API Version</label>
                <input
                  type="text"
                  required
                  value={newApiForm.version}
                  onChange={(e) => setNewApiForm({ ...newApiForm, version: e.target.value })}
                  className="bg-base border border-subtle text-strong text-sm rounded-xl px-3.5 py-2 outline-none focus:border-primary font-mono"
                  placeholder="v1"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted">Starter Dataset Template</label>
                <select
                  value={newApiForm.template}
                  onChange={(e) =>
                    setNewApiForm({
                      ...newApiForm,
                      template: e.target.value as 'products_100' | 'store_suite' | 'empty',
                    })
                  }
                  className="bg-base border border-subtle text-strong text-sm rounded-xl px-3 py-2 outline-none focus:border-primary"
                >
                  <option value="products_100">Products Catalogue (100 INR Records · 24 Categories)</option>
                  <option value="store_suite">Store Suite (100 Products · 20 Customers · 20 Orders)</option>
                  <option value="empty">Empty API (Define Custom Resources)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted">Initial Rate Limit (RPM)</label>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={newApiForm.rateLimitRpm}
                  onChange={(e) =>
                    setNewApiForm({ ...newApiForm, rateLimitRpm: Number(e.target.value) || 60 })
                  }
                  className="bg-base border border-subtle text-strong text-sm rounded-xl px-3.5 py-2 outline-none focus:border-primary font-mono tabular-nums"
                />
              </div>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <label className="inline-flex items-center gap-2 text-xs text-strong cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newApiForm.issueApiKey}
                    onChange={(e) => setNewApiForm({ ...newApiForm, issueApiKey: e.target.checked })}
                  />
                  <span>Issue gateway API key automatically</span>
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-strong cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newApiForm.enableWaf}
                    onChange={(e) => setNewApiForm({ ...newApiForm, enableWaf: e.target.checked })}
                  />
                  <span>Enforce WAF (SQLi / XSS) &amp; SSRF guards</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 text-xs font-semibold text-muted hover:text-strong whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-5 py-2 bg-primary text-inverted rounded-lg text-xs font-semibold hover:opacity-90 transition disabled:opacity-50 whitespace-nowrap"
              >
                {busyAction ? 'Provisioning...' : 'Create & Register Behind Gateway'}
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Loading / Empty State */}
      {loading ? (
        <div className="space-y-3">
          <div className="h-24 bg-card border border-subtle rounded-2xl animate-pulse" />
          <div className="h-64 bg-card border border-subtle rounded-2xl animate-pulse" />
        </div>
      ) : !selectedApi ? (
        <Card className="p-10 bg-card border-subtle text-center space-y-4">
          <div className="mx-auto w-11 h-11 rounded-xl bg-hover border border-subtle flex items-center justify-center text-primary">
            <Layers size={20} />
          </div>
          <div className="space-y-1.5 max-w-lg mx-auto">
            <h3 className="text-base font-bold text-strong">No Studio APIs created in this project yet</h3>
            <p className="text-xs text-muted leading-relaxed">
              Launch a self-contained API pre-seeded with 100 canonical product records across 24 categories. Every endpoint is automatically routed through FortiX Gateway (`/proxy/:routeId`) for live security testing and verification.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-1">
            <button
              type="button"
              disabled={busyAction}
              onClick={handleQuickCreateProductsApi}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-inverted rounded-lg text-xs font-semibold hover:opacity-90 transition disabled:opacity-50 whitespace-nowrap"
            >
              <Zap size={14} />
              <span>Create Products API (100 Records)</span>
            </button>
          </div>
        </Card>
      ) : (
        <>
          {/* Active Studio API Summary Strip */}
          <Card className="p-5 bg-card border-subtle space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 min-w-0">
                {studioApis.length > 1 ? (
                  <select
                    aria-label="Select Studio API"
                    value={selectedApi.id}
                    onChange={(e) => setSelectedApiId(e.target.value)}
                    className="bg-base border border-subtle text-strong text-sm font-bold rounded-xl px-3 py-1.5 outline-none focus:border-primary"
                  >
                    {studioApis.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.basePath} · {a.version})
                      </option>
                    ))}
                  </select>
                ) : (
                  <h3 className="text-lg font-bold text-strong truncate">{selectedApi.name}</h3>
                )}
                <span className="text-xs text-muted font-mono">
                  {selectedApi.basePath} · {selectedApi.version}
                </span>
                <span className="text-xs text-muted">·</span>
                <span className="text-xs font-mono tabular-nums text-strong">
                  {selectedApi.resources.length} {selectedApi.resources.length === 1 ? 'resource' : 'resources'} · {selectedApi.totalRecords} records
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <span className="text-xs font-mono tabular-nums text-muted">
                  Rate Limit: {selectedApi.policy?.rateLimitRpm ? `${selectedApi.policy.rateLimitRpm} RPM` : 'Unlimited'} · WAF: {selectedApi.policy?.enableWaf ? 'On' : 'Monitor'}
                </span>
                {confirmDeleteApiId === selectedApi.id ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDeleteApi(selectedApi.id)}
                      className="px-2.5 py-1 rounded bg-red-500 text-white text-xs font-semibold whitespace-nowrap"
                    >
                      Confirm Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteApiId(null)}
                      className="px-2 py-1 text-xs text-muted hover:text-strong whitespace-nowrap"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteApiId(selectedApi.id)}
                    className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 font-semibold whitespace-nowrap"
                  >
                    <Trash2 size={13} />
                    <span>Delete API</span>
                  </button>
                )}
              </div>
            </div>

            {/* Gateway Proxy Base URL Bar */}
            {selectedApi.gatewayBaseUrl && (
              <div className="flex flex-wrap items-center justify-between gap-2 bg-base border border-subtle rounded-xl px-3.5 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-semibold text-muted shrink-0">Protected Gateway Base</span>
                  <code className="text-xs font-mono text-strong truncate">
                    {selectedApi.gatewayBaseUrl}
                    {selectedApi.basePath === '/' ? '' : selectedApi.basePath}
                  </code>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        `${window.location.origin}${selectedApi.gatewayBaseUrl}${selectedApi.basePath === '/' ? '' : selectedApi.basePath}`,
                        'gateway-url'
                      )
                    }
                    className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-strong whitespace-nowrap"
                  >
                    {copiedToken === 'gateway-url' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    <span>{copiedToken === 'gateway-url' ? 'Copied URL' : 'Copy Full URL'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Sub-Navigation Tabs */}
            <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
              <button
                type="button"
                onClick={() => setActiveTab('playground')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                  activeTab === 'playground'
                    ? 'bg-primary text-inverted'
                    : 'text-muted hover:bg-hover hover:text-strong'
                }`}
              >
                <Send size={13} />
                <span>Request Playground</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('data')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                  activeTab === 'data'
                    ? 'bg-primary text-inverted'
                    : 'text-muted hover:bg-hover hover:text-strong'
                }`}
              >
                <Database size={13} />
                <span>Resources &amp; Data ({selectedApi.totalRecords})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('security')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                  activeTab === 'security'
                    ? 'bg-primary text-inverted'
                    : 'text-muted hover:bg-hover hover:text-strong'
                }`}
              >
                <Shield size={13} />
                <span>Security &amp; Verification</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('openapi')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                  activeTab === 'openapi'
                    ? 'bg-primary text-inverted'
                    : 'text-muted hover:bg-hover hover:text-strong'
                }`}
              >
                <FileJson size={13} />
                <span>OpenAPI 3.0 Spec</span>
              </button>
            </div>
          </Card>

          {/* TAB 1: REQUEST PLAYGROUND & GENERATED ENDPOINTS */}
          {activeTab === 'playground' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Generated Endpoints Column */}
              <Card className="lg:col-span-5 p-5 bg-card border-subtle space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-strong">Generated Gateway Endpoints</h4>
                  <span className="text-[11px] text-muted font-mono">Click to load</span>
                </div>

                {selectedApi.resources.length === 0 ? (
                  <div className="p-4 rounded-xl bg-base border border-subtle text-xs text-muted space-y-2">
                    <p>No resources defined yet in this API.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('data');
                        setShowAddResource(true);
                      }}
                      className="px-3 py-1.5 bg-primary text-inverted rounded-lg font-semibold whitespace-nowrap"
                    >
                      Define First Resource
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
                    {selectedApi.resources.map((resItem) => {
                      const sampleId =
                        resItem.slug === 'products'
                          ? 'prod_0001'
                          : resItem.slug === 'customers'
                            ? 'cust_0001'
                            : resItem.slug === 'orders'
                              ? 'ord_0001'
                              : `${resItem.slug.slice(0, 4)}_0001`;
                      return (
                        <div key={resItem.id} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-strong">{resItem.name}</span>
                            <span className="font-mono tabular-nums text-muted">
                              {resItem.recordCount} records
                            </span>
                          </div>
                          <div className="divide-y divide-white/5 border border-subtle rounded-xl overflow-hidden bg-base">
                            {resItem.endpoints.map((ep, idx) => {
                              const resolvedPath = ep.path.replace(':id', sampleId);
                              const methodColor =
                                ep.method === 'GET'
                                  ? 'text-sky-400'
                                  : ep.method === 'POST'
                                    ? 'text-emerald-400'
                                    : ep.method === 'PATCH'
                                      ? 'text-amber-400'
                                      : 'text-red-400';
                              return (
                                <button
                                  key={`${ep.method}-${idx}`}
                                  type="button"
                                  onClick={() => {
                                    const m = ep.method as 'GET' | 'POST' | 'PATCH' | 'DELETE';
                                    setPlayMethod(m);
                                    setPlayPath(
                                      m === 'GET' && !ep.path.endsWith(':id')
                                        ? `${resolvedPath}?limit=10`
                                        : resolvedPath
                                    );
                                    if (m === 'POST') {
                                      setPlayBody(buildSamplePayload(resItem.fields, false));
                                    } else if (m === 'PATCH') {
                                      setPlayBody(buildSamplePayload(resItem.fields, true));
                                    }
                                  }}
                                  className="w-full px-3 py-2 text-left hover:bg-hover transition flex items-center gap-2.5 text-xs"
                                >
                                  <span className={`w-12 font-mono font-bold shrink-0 ${methodColor}`}>
                                    {ep.method}
                                  </span>
                                  <span className="font-mono text-strong truncate">{resolvedPath}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Interactive Request Sender & Response Viewer */}
              <Card className="lg:col-span-7 p-5 bg-card border-subtle space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-strong">Live Gateway Request Playground</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={playBusy}
                      onClick={() => handleSendSingleRequest({ omitKey: true })}
                      className="px-2.5 py-1 rounded-lg bg-hover border border-subtle text-[11px] font-semibold text-muted hover:text-strong transition whitespace-nowrap"
                    >
                      Probe 401 (No Key)
                    </button>
                    {selectedApi.gatewayBaseUrl && (
                      <button
                        type="button"
                        disabled={playBusy}
                        onClick={() => {
                          const firstSlug = selectedApi.resources[0]?.slug || 'products';
                          void handleSendSingleRequest({
                            method: 'GET',
                            path: `${selectedApi.gatewayBaseUrl}/${firstSlug}?q=${encodeURIComponent("' OR 1=1 --")}`,
                          });
                        }}
                        className="px-2.5 py-1 rounded-lg bg-hover border border-subtle text-[11px] font-semibold text-muted hover:text-strong transition whitespace-nowrap"
                      >
                        Probe 403 (SQLi WAF)
                      </button>
                    )}
                  </div>
                </div>

                {/* API Key Header Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-semibold text-muted flex items-center gap-1.5">
                      <KeyRound size={13} />
                      <span>Gateway Header: X-API-Key</span>
                    </label>
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={handleIssuePlaygroundKey}
                      className="text-xs font-semibold text-primary hover:underline whitespace-nowrap"
                    >
                      Issue Fresh Gateway Key
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={sessionApiKey}
                      onChange={(e) => setSessionApiKey(e.target.value)}
                      placeholder="Paste fx_... gateway key or click 'Issue Fresh Gateway Key'"
                      className="flex-1 bg-base border border-subtle text-strong text-xs font-mono rounded-xl px-3 py-2 outline-none focus:border-primary"
                    />
                    {sessionApiKey && (
                      <button
                        type="button"
                        onClick={() => copyText(sessionApiKey, 'api-key')}
                        className="px-3 py-2 rounded-xl bg-hover border border-subtle text-xs font-semibold text-strong whitespace-nowrap"
                      >
                        {copiedToken === 'api-key' ? 'Copied' : 'Copy'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Method + Path + Send */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    aria-label="HTTP Method"
                    value={playMethod}
                    onChange={(e) =>
                      setPlayMethod(e.target.value as 'GET' | 'POST' | 'PATCH' | 'DELETE')
                    }
                    className="sm:w-28 bg-base border border-subtle text-strong text-xs font-mono font-bold rounded-xl px-3 py-2 outline-none focus:border-primary"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PATCH">PATCH</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                  <input
                    type="text"
                    value={playPath}
                    onChange={(e) => setPlayPath(e.target.value)}
                    className="flex-1 bg-base border border-subtle text-strong text-xs font-mono rounded-xl px-3 py-2 outline-none focus:border-primary"
                    placeholder="/proxy/:routeId/api/store/products"
                  />
                  <button
                    type="button"
                    disabled={playBusy}
                    onClick={() => handleSendSingleRequest()}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-primary text-inverted rounded-xl text-xs font-semibold hover:opacity-90 transition disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Send size={13} />
                    <span>{playBusy ? 'Sending...' : 'Send'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={playBusy}
                    onClick={() => handleSendBurst(25)}
                    title="Send 25 concurrent GET requests through the gateway to test rate limiting"
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-hover border border-subtle text-strong rounded-xl text-xs font-semibold hover:bg-hover-strong transition disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Zap size={13} />
                    <span>25x Burst</span>
                  </button>
                </div>

                {/* Request JSON Body Editor */}
                {(playMethod === 'POST' || playMethod === 'PATCH') && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted">JSON Request Payload</label>
                    <textarea
                      rows={6}
                      value={playBody}
                      onChange={(e) => setPlayBody(e.target.value)}
                      className="w-full bg-base border border-subtle text-strong text-xs font-mono rounded-xl p-3 outline-none focus:border-primary"
                    />
                  </div>
                )}

                {/* Response Inspector */}
                {playResponse && (
                  <div className="space-y-2 pt-2 border-t border-subtle">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-bold ${
                            playResponse.status >= 200 && playResponse.status < 300
                              ? 'text-emerald-400'
                              : playResponse.status === 429
                                ? 'text-amber-400'
                                : 'text-red-400'
                          }`}
                        >
                          HTTP {playResponse.status} {playResponse.statusText}
                        </span>
                        <span className="text-muted">·</span>
                        <span className="text-strong">{playResponse.latencyMs} ms</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
                        {playResponse.rateLimitRemaining !== null && (
                          <span>
                            Quota Remaining: {playResponse.rateLimitRemaining}/{playResponse.rateLimitLimit}
                          </span>
                        )}
                        {playResponse.requestId && (
                          <span>Req ID: {playResponse.requestId.slice(0, 12)}</span>
                        )}
                      </div>
                    </div>

                    {playResponse.burstSummary && (
                      <div className="grid grid-cols-4 gap-2 p-3 rounded-xl bg-base border border-subtle text-center font-mono tabular-nums">
                        <div>
                          <div className="text-[11px] text-muted">Sent</div>
                          <div className="text-sm font-bold text-strong">{playResponse.burstSummary.totalSent}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-muted">2xx Allowed</div>
                          <div className="text-sm font-bold text-emerald-400">{playResponse.burstSummary.ok2xx}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-muted">429 Blocked</div>
                          <div className="text-sm font-bold text-amber-400">{playResponse.burstSummary.rateLimited429}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-muted">Avg Latency</div>
                          <div className="text-sm font-bold text-strong">{playResponse.burstSummary.avgLatencyMs} ms</div>
                        </div>
                      </div>
                    )}

                    <pre className="max-h-80 overflow-auto rounded-xl bg-base border border-subtle p-3.5 text-xs font-mono text-strong leading-relaxed">
                      {playResponse.bodyText}
                    </pre>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* TAB 2: DATA BROWSER & DECLARATIVE RESOURCES */}
          {activeTab === 'data' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {selectedApi.resources.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setSelectedResourceId(r.id);
                        setRecordsOffset(0);
                      }}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold font-mono tabular-nums transition whitespace-nowrap ${
                        selectedResource?.id === r.id
                          ? 'bg-primary text-inverted'
                          : 'bg-card border border-subtle text-strong hover:bg-hover'
                      }`}
                    >
                      {r.name} ({r.recordCount})
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedResource && (
                    <>
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() =>
                          handleSeedResource(
                            'reset',
                            selectedResource.slug === 'products' ? 100 : 20
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-hover border border-subtle text-xs font-semibold text-strong hover:bg-hover-strong whitespace-nowrap"
                      >
                        <RefreshCw size={12} />
                        <span>
                          Reset Seed ({selectedResource.slug === 'products' ? '100 Canonical' : '20 Sample'})
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => handleSeedResource('append', 10)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-hover border border-subtle text-xs font-semibold text-strong hover:bg-hover-strong whitespace-nowrap"
                      >
                        <Plus size={12} />
                        <span>Append +10</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowAddResource(!showAddResource)}
                    className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-primary text-inverted text-xs font-semibold whitespace-nowrap"
                  >
                    <Plus size={13} />
                    <span>{showAddResource ? 'Cancel Resource' : 'Add Resource'}</span>
                  </button>
                </div>
              </div>

              {showAddResource && (
                <Card className="p-5 bg-card border-subtle">
                  <form onSubmit={handleAddResource} className="space-y-4">
                    <h4 className="text-sm font-bold text-strong">Add Declarative Resource Schema</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-muted">Resource Name</label>
                        <input
                          type="text"
                          required
                          value={newResName}
                          onChange={(e) => setNewResName(e.target.value)}
                          placeholder="Inventory"
                          className="bg-base border border-subtle text-strong text-sm rounded-xl px-3 py-2 outline-none focus:border-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-muted">URL Slug (optional)</label>
                        <input
                          type="text"
                          value={newResSlug}
                          onChange={(e) => setNewResSlug(e.target.value)}
                          placeholder="inventory"
                          className="bg-base border border-subtle text-strong text-sm font-mono rounded-xl px-3 py-2 outline-none focus:border-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-muted">Initial Sample Rows</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={newResSeedCount}
                          onChange={(e) => setNewResSeedCount(Number(e.target.value) || 0)}
                          className="bg-base border border-subtle text-strong text-sm font-mono tabular-nums rounded-xl px-3 py-2 outline-none focus:border-primary"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted">Fields (`id` is automatic)</span>
                        <button
                          type="button"
                          onClick={() =>
                            setNewResFields([
                              ...newResFields,
                              { name: `field_${newResFields.length + 1}`, type: 'string', required: false },
                            ])
                          }
                          className="text-xs font-semibold text-primary hover:underline whitespace-nowrap"
                        >
                          + Add Field
                        </button>
                      </div>
                      {newResFields.map((fld, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                          <input
                            type="text"
                            required
                            value={fld.name}
                            onChange={(e) => {
                              const copy = [...newResFields];
                              copy[idx] = { ...copy[idx], name: e.target.value };
                              setNewResFields(copy);
                            }}
                            placeholder="fieldName"
                            className="col-span-4 bg-base border border-subtle text-strong text-xs font-mono rounded-lg px-2.5 py-1.5"
                          />
                          <select
                            value={fld.type}
                            onChange={(e) => {
                              const nextType = e.target.value as StudioFieldDef['type'];
                              const copy = [...newResFields];
                              copy[idx] = {
                                ...copy[idx],
                                type: nextType,
                                enumValues: nextType === 'enum' ? ['active', 'inactive'] : undefined,
                              };
                              setNewResFields(copy);
                            }}
                            className="col-span-3 bg-base border border-subtle text-strong text-xs rounded-lg px-2 py-1.5"
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="integer">integer</option>
                            <option value="boolean">boolean</option>
                            <option value="enum">enum</option>
                          </select>
                          <label className="col-span-3 inline-flex items-center gap-1.5 text-xs text-muted">
                            <input
                              type="checkbox"
                              checked={fld.required}
                              onChange={(e) => {
                                const copy = [...newResFields];
                                copy[idx] = { ...copy[idx], required: e.target.checked };
                                setNewResFields(copy);
                              }}
                            />
                            <span>Required</span>
                          </label>
                          <button
                            type="button"
                            disabled={newResFields.length <= 1}
                            onClick={() => setNewResFields(newResFields.filter((_, i) => i !== idx))}
                            className="col-span-2 text-xs text-red-400 hover:text-red-300 disabled:opacity-30 text-right"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={busyAction}
                        className="px-4 py-2 bg-primary text-inverted rounded-lg text-xs font-semibold whitespace-nowrap"
                      >
                        Create Resource &amp; Endpoints
                      </button>
                    </div>
                  </form>
                </Card>
              )}

              {selectedResource && (
                <Card className="p-5 bg-card border-subtle space-y-4">
                  {/* Filters */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
                      <input
                        type="text"
                        value={filterSearch}
                        onChange={(e) => {
                          setFilterSearch(e.target.value);
                          setRecordsOffset(0);
                        }}
                        placeholder={`Search ${selectedResource.name.toLowerCase()} by ID, SKU, or name...`}
                        className="w-full sm:w-64 bg-base border border-subtle text-strong text-xs rounded-xl px-3 py-1.5 outline-none focus:border-primary"
                      />
                      {selectedResource.slug === 'products' && (
                        <select
                          aria-label="Filter by category"
                          value={filterCategory}
                          onChange={(e) => {
                            setFilterCategory(e.target.value);
                            setRecordsOffset(0);
                          }}
                          className="bg-base border border-subtle text-strong text-xs rounded-xl px-3 py-1.5 outline-none focus:border-primary"
                        >
                          <option value="">All 24 Categories</option>
                          {CANONICAL_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      )}
                      {selectedResource.fields.some((f) => f.name === 'status') && (
                        <select
                          aria-label="Filter by status"
                          value={filterStatus}
                          onChange={(e) => {
                            setFilterStatus(e.target.value);
                            setRecordsOffset(0);
                          }}
                          className="bg-base border border-subtle text-strong text-xs rounded-xl px-3 py-1.5 outline-none focus:border-primary"
                        >
                          <option value="">All Statuses</option>
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                        </select>
                      )}
                    </div>
                    <div className="text-xs font-mono tabular-nums text-muted">
                      Showing {records.length > 0 ? recordsOffset + 1 : 0}–{recordsOffset + records.length} of {recordsTotal}
                    </div>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto border border-subtle rounded-xl bg-base">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-subtle text-muted font-semibold">
                          <th className="py-2.5 px-3 font-mono">id</th>
                          {selectedResource.fields.slice(0, 6).map((f) => (
                            <th key={f.name} className="py-2.5 px-3 font-mono">
                              {f.name}
                              {f.name === 'price' ? ' (INR)' : ''}
                            </th>
                          ))}
                          <th className="py-2.5 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {recordsLoading ? (
                          <tr>
                            <td colSpan={8} className="py-8 text-center text-muted">
                              Loading records...
                            </td>
                          </tr>
                        ) : records.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-8 text-center text-muted">
                              No records match the current filter.
                            </td>
                          </tr>
                        ) : (
                          records.map((row) => {
                            const recId = String(row.id ?? '');
                            return (
                              <tr key={recId} className="hover:bg-hover transition-colors">
                                <td className="py-2 px-3 font-mono text-strong whitespace-nowrap">{recId}</td>
                                {selectedResource.fields.slice(0, 6).map((f) => {
                                  const val = row[f.name];
                                  const isNumeric = f.type === 'number' || f.type === 'integer';
                                  return (
                                    <td
                                      key={f.name}
                                      className={`py-2 px-3 max-w-[220px] truncate ${
                                        isNumeric ? 'font-mono tabular-nums text-strong' : 'text-base-text'
                                      }`}
                                    >
                                      {f.name === 'price' && typeof val === 'number'
                                        ? `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                        : String(val ?? '—')}
                                    </td>
                                  );
                                })}
                                <td className="py-2 px-3 text-right whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!selectedApi.gatewayBaseUrl) return;
                                      const cleanBase =
                                        selectedApi.basePath === '/'
                                          ? ''
                                          : selectedApi.basePath.replace(/\/+$/, '');
                                      setPlayMethod('GET');
                                      setPlayPath(
                                        `${selectedApi.gatewayBaseUrl}${cleanBase}/${selectedResource.slug}/${recId}`
                                      );
                                      setActiveTab('playground');
                                    }}
                                    className="text-primary hover:underline font-semibold whitespace-nowrap"
                                  >
                                    Inspect via Gateway
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Footer */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">
                      Declarative schema: {selectedResource.fields.map((f) => `${f.name}:${f.type}`).join(' · ')}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={recordsOffset === 0}
                        onClick={() => setRecordsOffset(Math.max(0, recordsOffset - 15))}
                        className="px-3 py-1 rounded-lg bg-hover border border-subtle text-strong disabled:opacity-40 whitespace-nowrap"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={recordsOffset + records.length >= recordsTotal}
                        onClick={() => setRecordsOffset(recordsOffset + 15)}
                        className="px-3 py-1 rounded-lg bg-hover border border-subtle text-strong disabled:opacity-40 whitespace-nowrap"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* TAB 3: SECURITY POLICIES & REAL GATEWAY VERIFICATION */}
          {activeTab === 'security' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Security Controls */}
              <Card className="lg:col-span-5 p-5 bg-card border-subtle space-y-4">
                <div>
                  <h4 className="text-sm font-bold text-strong">Gateway Security Policy</h4>
                  <p className="text-xs text-muted mt-0.5">
                    Backed directly by FortiX `/api/control/policies` and enforced live on `/proxy/{selectedApi.routeId?.slice(0, 8)}…`.
                  </p>
                </div>

                <form onSubmit={handleSaveSecurityPolicy} className="space-y-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted">
                      Token-Bucket Rate Limit (Requests / Minute)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={policyForm.rateLimitRpm}
                      onChange={(e) => setPolicyForm({ ...policyForm, rateLimitRpm: e.target.value })}
                      placeholder="Leave blank for unlimited"
                      className="bg-base border border-subtle text-strong text-sm font-mono tabular-nums rounded-xl px-3.5 py-2 outline-none focus:border-primary"
                    />
                    <span className="text-[11px] text-muted">
                      Tip: Set to 15 RPM to observe immediate 429 enforcement in a 25-request burst or traffic_burst verification.
                    </span>
                  </div>

                  <div className="space-y-2.5 pt-1">
                    <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-base border border-subtle cursor-pointer">
                      <div>
                        <div className="text-xs font-semibold text-strong">WAF Threat Blocking</div>
                        <div className="text-[11px] text-muted">Block SQL injection, XSS, and path traversal payloads (HTTP 403)</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={policyForm.enableWaf}
                        onChange={(e) => setPolicyForm({ ...policyForm, enableWaf: e.target.checked })}
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-base border border-subtle cursor-pointer">
                      <div>
                        <div className="text-xs font-semibold text-strong">Deep Parameter SSRF Guard</div>
                        <div className="text-[11px] text-muted">Block loopback, RFC1918, and metadata URLs in query/body fields</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={policyForm.enableSsrf}
                        onChange={(e) => setPolicyForm({ ...policyForm, enableSsrf: e.target.checked })}
                      />
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={busyAction}
                    className="w-full py-2 bg-primary text-inverted rounded-lg text-xs font-semibold hover:opacity-90 transition disabled:opacity-50 whitespace-nowrap"
                  >
                    Save Gateway Security Policy
                  </button>
                </form>
              </Card>

              {/* Controlled Experiments & Verification Evidence */}
              <Card className="lg:col-span-7 p-5 bg-card border-subtle space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-strong">Controlled Experiments &amp; Verification</h4>
                    <p className="text-xs text-muted mt-0.5">
                      Execute real BASELINE → INJECTION → RECOVERY gateway probes against this Studio API.
                    </p>
                  </div>
                  <Link
                    to="/verifications"
                    className="text-xs font-semibold text-primary hover:underline whitespace-nowrap"
                  >
                    Open Full Evidence Ledger
                  </Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => handleRunStudioExperiment('traffic_burst')}
                    className="p-3 rounded-xl bg-base border border-subtle hover:border-primary text-left transition space-y-1"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-strong">
                      <Play size={12} className="text-primary shrink-0" />
                      <span>Verify Rate Limit</span>
                    </div>
                    <p className="text-[11px] text-muted">Burst traffic above RPM cap and prove 429 enforcement + recovery.</p>
                  </button>

                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => handleRunStudioExperiment('latency')}
                    className="p-3 rounded-xl bg-base border border-subtle hover:border-primary text-left transition space-y-1"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-strong">
                      <Play size={12} className="text-primary shrink-0" />
                      <span>Verify Latency Fault</span>
                    </div>
                    <p className="text-[11px] text-muted">Inject +450 ms delay and verify clean post-fault recovery.</p>
                  </button>

                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => handleRunStudioExperiment('error_5xx')}
                    className="p-3 rounded-xl bg-base border border-subtle hover:border-primary text-left transition space-y-1"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-strong">
                      <Play size={12} className="text-primary shrink-0" />
                      <span>Verify 5xx Failure</span>
                    </div>
                    <p className="text-[11px] text-muted">Inject HTTP 503 upstream failure and prove clean restoration.</p>
                  </button>
                </div>

                {/* Verifications List */}
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-muted">Recent Verification Evidence on This API</span>
                    <button
                      type="button"
                      onClick={loadExperimentsAndVerifications}
                      className="inline-flex items-center gap-1 text-muted hover:text-strong"
                    >
                      <RefreshCw size={12} />
                      <span>Refresh</span>
                    </button>
                  </div>

                  {routeExperiments.some((e) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(e.status)) && (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200 font-mono">
                      Active experiment in progress: {
                        routeExperiments.find((e) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(e.status))?.status
                      }…
                    </div>
                  )}

                  {routeVerifications.length === 0 ? (
                    <div className="p-6 rounded-xl bg-base border border-subtle text-center text-xs text-muted">
                      No verification runs recorded for this Studio API yet. Trigger one of the three experiments above to produce measured evidence.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/5 border border-subtle rounded-xl bg-base overflow-hidden">
                      {routeVerifications.map((v) => {
                        const verdictColor =
                          v.verdict === 'PASS'
                            ? 'text-emerald-400'
                            : v.verdict === 'FAIL'
                              ? 'text-red-400'
                              : 'text-amber-400';
                        const summaryReason =
                          v.observed?.summaryReason ||
                          v.observed?.verdictReason ||
                          'Deterministic gateway telemetry evaluation completed.';
                        return (
                          <div key={v.id} className="p-3.5 space-y-1 text-xs">
                            <div className="flex items-center justify-between gap-2 font-mono tabular-nums">
                              <span className="font-semibold text-strong">
                                {v.experimentType || 'experiment'} · {new Date(v.createdAt).toLocaleTimeString()}
                              </span>
                              <span className={`font-bold ${verdictColor}`}>{v.verdict}</span>
                            </div>
                            <p className="text-muted text-[11px] leading-relaxed">{summaryReason}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          )}

          {/* TAB 4: OPENAPI 3.0 SPECIFICATION EXPORT */}
          {activeTab === 'openapi' && (
            <Card className="p-5 bg-card border-subtle space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-strong">Generated OpenAPI 3.0.3 Contract</h4>
                  <p className="text-xs text-muted mt-0.5">
                    Automatically synthesized from {selectedApi.name}&apos;s declarative resource schemas and FortiX Gateway security requirements.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!openApiJson}
                    onClick={() => copyText(openApiJson, 'openapi')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-hover border border-subtle text-xs font-semibold text-strong whitespace-nowrap"
                  >
                    {copiedToken === 'openapi' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    <span>{copiedToken === 'openapi' ? 'Copied Spec' : 'Copy JSON'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={!openApiJson}
                    onClick={handleDownloadOpenApi}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-inverted text-xs font-semibold hover:opacity-90 transition whitespace-nowrap"
                  >
                    <Download size={13} />
                    <span>Download openapi.json</span>
                  </button>
                </div>
              </div>

              {openApiLoading ? (
                <div className="h-64 rounded-xl bg-base border border-subtle animate-pulse" />
              ) : (
                <pre className="max-h-[540px] overflow-auto rounded-xl bg-base border border-subtle p-4 text-xs font-mono text-strong leading-relaxed">
                  {openApiJson}
                </pre>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
