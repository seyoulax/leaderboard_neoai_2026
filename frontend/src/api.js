const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';

// ---------- Public, unscoped ----------

export async function getCompetitions() {
  const res = await fetch(`${API_BASE}/competitions`);
  if (!res.ok) throw new Error(`Failed to fetch competitions: ${res.status}`);
  return res.json();
}

// ---------- Public, scoped to competition ----------

function compBase(slug) {
  return `${API_BASE}/competitions/${encodeURIComponent(slug)}`;
}

export async function getCompetition(slug) {
  const res = await fetch(compBase(slug));
  if (!res.ok) throw new Error(`Failed to fetch competition '${slug}': ${res.status}`);
  return res.json();
}

export async function getOverallLeaderboard(slug) {
  const res = await fetch(`${compBase(slug)}/leaderboard`);
  if (!res.ok) throw new Error(`Failed to fetch leaderboard '${slug}': ${res.status}`);
  return res.json();
}

export async function getTaskLeaderboard(slug, taskSlug) {
  const res = await fetch(`${compBase(slug)}/tasks/${encodeURIComponent(taskSlug)}`);
  if (!res.ok) throw new Error(`Failed to fetch task '${slug}/${taskSlug}': ${res.status}`);
  return res.json();
}

export async function getBoards(slug) {
  const res = await fetch(`${compBase(slug)}/boards`);
  if (!res.ok) throw new Error(`Failed to fetch boards '${slug}': ${res.status}`);
  return res.json();
}

export async function getParticipants(slug) {
  const res = await fetch(`${compBase(slug)}/participants`);
  if (!res.ok) throw new Error(`Failed to fetch participants '${slug}': ${res.status}`);
  return res.json();
}

export async function getCurrentCard(slug) {
  const res = await fetch(`${compBase(slug)}/card`);
  if (!res.ok) throw new Error(`Failed to fetch card '${slug}': ${res.status}`);
  return res.json();
}

export async function setCurrentCard(slug, id) {
  const res = await fetch(`${compBase(slug)}/card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(`Failed to set current card '${slug}': ${res.status}`);
  return res.json();
}

// ---------- Admin token ----------

const ADMIN_TOKEN_KEY = 'neoai_admin_token';

export function getAdminToken() {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; }
}
export function setAdminToken(token) {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {}
}
export class AdminAuthError extends Error {
  constructor(message = 'unauthorized') {
    super(message); this.name = 'AdminAuthError';
  }
}

async function adminFetch(p, opts = {}) {
  const token = getAdminToken();
  const headers = { ...(opts.headers || {}), 'x-admin-token': token };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${p}`, { ...opts, headers });
  if (res.status === 401) {
    setAdminToken(''); throw new AdminAuthError();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data;
}

export async function adminPing() { return adminFetch('/admin/competitions'); }

// ---------- Admin: competitions ----------

export async function getAdminCompetitions() { return adminFetch('/admin/competitions'); }

export async function saveAdminCompetitions(competitions) {
  return adminFetch('/admin/competitions', {
    method: 'PUT',
    body: JSON.stringify({ competitions }),
  });
}

export async function createAdminCompetition(competition) {
  return adminFetch('/admin/competitions', {
    method: 'POST',
    body: JSON.stringify({ competition }),
  });
}

export async function deleteAdminCompetition(slug) {
  return adminFetch(`/admin/competitions/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

// ---------- Admin: scoped tasks/boards/participants/private ----------

function adminCompBase(slug) {
  return `/admin/competitions/${encodeURIComponent(slug)}`;
}

export async function getAdminTasks(slug) { return adminFetch(`${adminCompBase(slug)}/tasks`); }
export async function saveAdminTasks(slug, tasks) {
  return adminFetch(`${adminCompBase(slug)}/tasks`, { method: 'PUT', body: JSON.stringify({ tasks }) });
}

export async function getAdminBoards(slug) { return adminFetch(`${adminCompBase(slug)}/boards`); }
export async function saveAdminBoards(slug, boards) {
  return adminFetch(`${adminCompBase(slug)}/boards`, { method: 'PUT', body: JSON.stringify({ boards }) });
}

export async function getAdminParticipants(slug) {
  return adminFetch(`${adminCompBase(slug)}/participants`);
}
export async function saveAdminParticipants(slug, participants) {
  return adminFetch(`${adminCompBase(slug)}/participants`, {
    method: 'PUT',
    body: JSON.stringify({ participants }),
  });
}

export async function getAdminPrivate(slug, taskSlug) {
  return adminFetch(`${adminCompBase(slug)}/tasks/${encodeURIComponent(taskSlug)}/private`);
}
export async function uploadAdminPrivate(slug, taskSlug, csv) {
  return adminFetch(`${adminCompBase(slug)}/tasks/${encodeURIComponent(taskSlug)}/private`, {
    method: 'PUT', body: JSON.stringify({ csv }),
  });
}
export async function deleteAdminPrivate(slug, taskSlug) {
  return adminFetch(`${adminCompBase(slug)}/tasks/${encodeURIComponent(taskSlug)}/private`, {
    method: 'DELETE',
  });
}
