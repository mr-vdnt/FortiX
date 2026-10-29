import { fetchWithAuth, parseApiErrorResponse, trackProductEvent } from '../lib/api.js';
import React, { useEffect, useState, useCallback } from 'react';
import { Card } from '../components/ui/card.js';
import { Link, useOutletContext } from 'react-router-dom';
import { Globe, RefreshCw, AlertCircle, KeyRound, Copy, Check } from 'lucide-react';
import { useProject } from '../context/ProjectContext.js';

export default function APIs() {
  const { currentProject } = useProject();
  const [routes, setRoutes] = useState<any[]>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const outletContext = useOutletContext<{ searchQuery?: string }>() || {};
  const searchQuery = outletContext.searchQuery || '';

  const [isAddingRoute, setIsAddingRoute] = useState(false);
  const [newRoute, setNewRoute] = useState({ path: '/api/v1/', targetUrl: 'https://', authRequired: true });

  const [isAddingKey, setIsAddingKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [isFetching, setIsFetching] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmDeleteRouteId, setConfirmDeleteRouteId] = useState<string | null>(null);
  const [confirmRevokeKeyId, setConfirmRevokeKeyId] = useState<string | null>(null);

  const projectId = currentProject?.id || localStorage.getItem('fortix_project_id') || '';

  const fetchData = useCallback(async () => {
    setIsFetching(true);
    try {
      const [routesRes, keysRes] = await Promise.all([
        fetchWithAuth(`/api/control/routes?projectId=${projectId}`),
        fetchWithAuth(`/api/control/keys?projectId=${projectId}`),
      ]);

      if (!routesRes.ok) {
        const parsed = await parseApiErrorResponse(routesRes, 'Unable to load protected API routes.');
        setErrorMsg(parsed.requestId ? `${parsed.message} (Ref: ${parsed.requestId})` : parsed.message);
      } else {
        setErrorMsg('');
        const data = await routesRes.json();
        setRoutes(Array.isArray(data) ? data : []);
      }

      if (keysRes.ok) {
        const kData = await keysRes.json();
        setKeys(Array.isArray(kData) ? kData : []);
      }
    } catch {
      setErrorMsg('Network error loading routes and gateway keys. Check connection and retry.');
    } finally {
      setIsFetching(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const createRoute = async () => {
    setErrorMsg('');
    if (!newRoute.path.trim().startsWith('/')) {
      setErrorMsg('Route path pattern must start with "/" (for example, /api/v1/orders).');
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/control/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          pathPattern: newRoute.path.trim(),
          targetUrl: newRoute.targetUrl.trim(),
        }),
      });
      if (res.ok) {
        setIsAddingRoute(false);
        setNewRoute({ path: '/api/v1/', targetUrl: 'https://', authRequired: true });
        trackProductEvent('route_registered');
        await fetchData();
      } else {
        const err = await parseApiErrorResponse(res, 'Failed to register upstream route.');
        setErrorMsg(err.requestId ? `${err.message} (Ref: ${err.requestId})` : err.message);
      }
    } catch {
      setErrorMsg('Network error while creating route.');
    } finally {
      setLoading(false);
    }
  };

  const deleteRoute = async (id: string) => {
    setConfirmDeleteRouteId(null);
    const res = await fetchWithAuth(`/api/control/routes/${id}?projectId=${projectId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await parseApiErrorResponse(res, 'Failed to delete route.');
      setErrorMsg(err.message);
    }
    fetchData();
  };

  const createKey = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/control/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, name: newKeyName.trim() || 'FortiX Gateway Key' }),
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedKey(data.rawKey);
        setIsAddingKey(false);
        setNewKeyName('');
        trackProductEvent('api_key_issued');
        await fetchData();
      } else {
        const err = await parseApiErrorResponse(res, 'Failed to issue gateway API key.');
        setErrorMsg(err.message);
      }
    } catch {
      setErrorMsg('Network error while generating API key.');
    } finally {
      setLoading(false);
    }
  };

  const revokeKey = async (id: string) => {
    setConfirmRevokeKeyId(null);
    const res = await fetchWithAuth(`/api/control/keys/${id}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    if (!res.ok) {
      const err = await parseApiErrorResponse(res, 'Failed to revoke API key.');
      setErrorMsg(err.message);
    }
    fetchData();
  };

  const copyRawKey = async (raw: string) => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {}
  };

  const filteredRoutes = (Array.isArray(routes) ? routes : []).filter((r) => {
    if (!r) return false;
    const q = (searchQuery || '').toLowerCase();
    const routePath = (r.pathPattern || r.path || '').toLowerCase();
    const routeTarget = (r.targetUrl || '').toLowerCase();
    return routePath.includes(q) || routeTarget.includes(q);
  });

  return (
    <div className="space-y-8">
      {errorMsg && (
        <div
          role="alert"
          className="bg-red-500/15 text-red-300 p-4 rounded-xl border border-red-500/30 flex items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0 text-red-400" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={fetchData}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-100 font-semibold whitespace-nowrap"
          >
            <RefreshCw size={12} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Routes Section */}
      <div>
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-strong">Protected APIs</h2>
            <p className="text-xs text-muted mt-1">
              Register authorized upstream endpoints to enforce API-key authentication, WAF rules, and SSRF protection.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <Link
              to="/directory"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-inverted rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            >
              <Globe size={15} />
              <span>Browse 800+ Public APIs</span>
            </Link>
            <button
              type="button"
              onClick={() => setIsAddingRoute(!isAddingRoute)}
              className="px-4 py-2 bg-hover border border-subtle text-strong rounded-lg text-xs font-semibold hover:bg-hover-strong transition whitespace-nowrap shrink-0"
            >
              {isAddingRoute ? 'Cancel' : 'Add API Route'}
            </button>
          </div>
        </div>

        {isAddingRoute && (
          <Card className="p-6 mb-6 bg-card border-subtle">
            <h3 className="text-base font-bold text-strong mb-4">Register New Upstream Route</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted">Path Segment</label>
                <input
                  type="text"
                  value={newRoute.path}
                  onChange={(e) => setNewRoute({ ...newRoute, path: e.target.value })}
                  className="bg-base border border-subtle text-strong text-sm rounded-xl px-3.5 py-2 outline-none focus:border-primary font-mono"
                  placeholder="/api/v1/resource"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted">Authorized Target URL</label>
                <input
                  type="url"
                  value={newRoute.targetUrl}
                  onChange={(e) => setNewRoute({ ...newRoute, targetUrl: e.target.value })}
                  className="bg-base border border-subtle text-strong text-sm rounded-xl px-3.5 py-2 outline-none focus:border-primary font-mono"
                  placeholder="https://api.yourdomain.com/v1/resource"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted">
                Loopback, RFC1918 private networks, and cloud metadata IPs are blocked automatically by SSRF guardrails.
              </span>
              <button
                type="button"
                onClick={createRoute}
                disabled={loading}
                className="px-5 py-2 bg-primary text-inverted rounded-lg text-xs font-semibold hover:opacity-90 transition disabled:opacity-50 whitespace-nowrap"
              >
                {loading ? 'Saving...' : 'Save Route'}
              </button>
            </div>
          </Card>
        )}

        {isFetching ? (
          <div className="space-y-3">
            {[1, 2].map((n) => (
              <div key={n} className="h-20 bg-card border border-subtle rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filteredRoutes.length === 0 ? (
          <Card className="p-8 bg-card border-subtle text-center space-y-2">
            <p className="text-sm font-semibold text-strong">
              {routes.length === 0 ? 'No protected routes registered in this project' : 'No routes match your current search'}
            </p>
            <p className="text-xs text-muted max-w-md mx-auto">
              {routes.length === 0
                ? 'Add an authorized upstream endpoint above to generate a gateway proxy URL (/proxy/:routeId) protected by FortiX.'
                : 'Clear the search filter in the header to view all registered routes.'}
            </p>
            {routes.length === 0 && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddingRoute(true)}
                  className="px-4 py-2 bg-primary text-inverted rounded-lg text-xs font-semibold"
                >
                  Add First Route
                </button>
              </div>
            )}
          </Card>
        ) : (
          <div className="grid gap-3">
            {filteredRoutes.map((r) => (
              <Card
                key={r.id}
                className="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card border-subtle"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold text-sm sm:text-base text-strong">
                      {r.pathPattern || r.path || '—'}
                    </span>
                    <span className="text-xs text-muted">·</span>
                    <span className="text-xs font-mono text-muted">Proxy ID: {r.id.slice(0, 8)}…</span>
                  </div>
                  <p className="text-xs text-muted font-mono break-all">Upstream: {r.targetUrl || '—'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <span className="text-xs text-emerald-400 font-medium">Active</span>
                  <span className="text-xs text-muted">·</span>
                  <span className="text-xs text-muted">Key Auth Enforced</span>
                  {confirmDeleteRouteId === r.id ? (
                    <div className="flex items-center gap-2 ml-2">
                      <button
                        type="button"
                        onClick={() => deleteRoute(r.id)}
                        className="px-2.5 py-1 rounded bg-red-500 text-white text-xs font-semibold whitespace-nowrap"
                      >
                        Confirm Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteRouteId(null)}
                        className="px-2 py-1 text-xs text-muted hover:text-strong"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteRouteId(r.id)}
                      className="text-xs text-red-400 hover:text-red-300 font-semibold ml-2"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Keys Section */}
      <div>
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-strong">Gateway API Keys</h2>
            <p className="text-xs text-muted mt-1">
              Secrets are displayed once at creation and stored strictly as salted bcrypt hashes on the server.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsAddingKey(!isAddingKey)}
            className="px-4 py-2 bg-primary text-inverted rounded-lg text-xs font-semibold hover:opacity-90 transition whitespace-nowrap shrink-0"
          >
            {isAddingKey ? 'Cancel' : 'Generate Key'}
          </button>
        </div>

        {isAddingKey && (
          <Card className="p-6 mb-6 bg-card border-subtle">
            <h3 className="text-base font-bold text-strong mb-4">Issue Scoped Gateway API Key</h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                className="flex-1 bg-base border border-subtle text-strong text-sm rounded-xl px-3.5 py-2 outline-none focus:border-primary"
                placeholder="Key label (e.g., Production Checkout Service)"
              />
              <button
                type="button"
                onClick={createKey}
                disabled={loading}
                className="px-5 py-2 bg-primary text-inverted rounded-lg text-xs font-semibold hover:opacity-90 transition disabled:opacity-50 whitespace-nowrap"
              >
                {loading ? 'Issuing...' : 'Issue Secret Key'}
              </button>
            </div>
          </Card>
        )}

        {generatedKey && (
          <Card className="p-5 mb-6 bg-emerald-500/10 border border-emerald-500/30 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                <KeyRound size={14} />
                <span>Copy your gateway API key now — it will never be shown again</span>
              </div>
              <button
                type="button"
                onClick={() => setGeneratedKey(null)}
                className="text-xs text-muted hover:text-strong"
              >
                Dismiss
              </button>
            </div>
            <div className="flex items-center gap-2 bg-base border border-subtle rounded-xl px-3.5 py-2.5">
              <code className="flex-1 text-xs font-mono text-strong break-all">{generatedKey}</code>
              <button
                type="button"
                onClick={() => copyRawKey(generatedKey)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-hover text-xs font-semibold text-strong shrink-0"
              >
                {copiedKey ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                <span>{copiedKey ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </Card>
        )}

        {keys.length === 0 ? (
          <Card className="p-8 bg-card border-subtle text-center space-y-2">
            <p className="text-sm font-semibold text-strong">No gateway API keys issued yet</p>
            <p className="text-xs text-muted max-w-md mx-auto">
              Generate a scoped gateway key to authenticate client requests sent to your FortiX `/proxy/:routeId` endpoints.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3">
            {keys.map((k) => (
              <Card
                key={k.id}
                className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-card border-subtle"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-strong">{k.name}</span>
                    <span className="text-xs text-muted">·</span>
                    <span className="font-mono text-xs text-muted">{k.keyPrefix}••••••••</span>
                  </div>
                  <div className="text-[11px] text-muted font-mono tabular-nums">
                    Created {k.createdAt ? new Date(k.createdAt).toLocaleString() : 'recently'}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {k.revoked ? (
                    <span className="text-xs text-red-400 font-semibold">Revoked</span>
                  ) : confirmRevokeKeyId === k.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => revokeKey(k.id)}
                        className="px-2.5 py-1 rounded bg-red-500 text-white text-xs font-semibold whitespace-nowrap"
                      >
                        Confirm Revoke
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeKeyId(null)}
                        className="px-2 py-1 text-xs text-muted hover:text-strong"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-xs text-emerald-400 font-medium">Active</span>
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeKeyId(k.id)}
                        className="text-xs text-red-400 hover:text-red-300 font-semibold"
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
