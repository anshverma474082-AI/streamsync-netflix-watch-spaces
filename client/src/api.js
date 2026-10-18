const BASE = '/api/v1';

let accessToken = localStorage.getItem('ss_access') ?? null;
let refreshToken = localStorage.getItem('ss_refresh') ?? null;

export function setTokens(access, refresh) {
  accessToken = access;
  if (refresh) refreshToken = refresh;
  localStorage.setItem('ss_access', access ?? '');
  if (refresh) localStorage.setItem('ss_refresh', refresh);
}

export function clearTokens() {
  setTokens(null, null);
}

export function getAccessToken() {
  return accessToken;
}

async function request(path, { method = 'GET', body, retry = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && retry && refreshToken) {
    const rr = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ refreshToken }),
    });
    if (rr.ok) {
      const json = await rr.json();
      setTokens(json.accessToken, json.refreshToken);
      return request(path, { method, body, retry: false });
    }
    clearTokens();
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error ?? `Request failed (${res.status})`);
    err.status = res.status;
    err.details = json.details;
    throw err;
  }
  return json;
}

export const api = {
  register: (b) => request('/auth/register', { method: 'POST', body: b }),
  login: (b) => request('/auth/login', { method: 'POST', body: b }),
  me: () => request('/auth/me'),
  savePreferences: (b) => request('/auth/me/preferences', { method: 'PATCH', body: b }),
  titles: () => request('/titles'),
  title: (id) => request(`/titles/${id}`),
  timeline: (id, from, to) => request(`/titles/${id}/timeline?from=${from}&to=${to}`),
  createWatchSpace: (b) => request('/watch-spaces', { method: 'POST', body: b }),
  watchSpace: (id) => request(`/watch-spaces/${id}`),
  byInvite: (code) => request(`/watch-spaces/invite/${code}`),
  endWatchSpace: (id) => request(`/watch-spaces/${id}/end`, { method: 'POST' }),
  liveRooms: () => request('/watch-spaces'),
  recommendations: (limit = 8) => request(`/recommendations/me?limit=${limit}`),
  rateTitle: (titleId, rating) => request('/recommendations/me/ratings', { method: 'POST', body: { titleId, rating } }),
  myInteractions: () => request('/recommendations/me/interactions'),
  retrainModel: () => request('/recommendations/retrain', { method: 'POST' }),
  analyticsSessions: () => request('/recommendations/analytics/sessions'),
  timelineSchema: (titleId) => request(`/titles/${titleId}/timeline/schema`),
  uploadTimeline: (titleId, timeline, mode = 'merge') =>
    request(`/titles/${titleId}/timeline?mode=${mode}`, { method: 'POST', body: { timeline } }),
};

export { request };
