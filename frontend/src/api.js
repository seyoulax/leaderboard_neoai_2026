const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';

export async function getOverallLeaderboard() {
  const response = await fetch(`${API_BASE}/leaderboard`);
  if (!response.ok) {
    throw new Error(`Failed to fetch overall leaderboard: ${response.status}`);
  }
  return response.json();
}

export async function getTaskLeaderboard(slug) {
  const response = await fetch(`${API_BASE}/tasks/${slug}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch task leaderboard '${slug}': ${response.status}`);
  }
  return response.json();
}

export async function getTasks() {
  const response = await fetch(`${API_BASE}/tasks`);
  if (!response.ok) {
    throw new Error(`Failed to fetch tasks: ${response.status}`);
  }
  return response.json();
}

export async function getParticipants() {
  const response = await fetch(`${API_BASE}/participants`);
  if (!response.ok) {
    throw new Error(`Failed to fetch participants: ${response.status}`);
  }
  return response.json();
}

export async function getCurrentCard() {
  const response = await fetch(`${API_BASE}/card`);
  if (!response.ok) {
    throw new Error(`Failed to fetch current card: ${response.status}`);
  }
  return response.json();
}

export async function setCurrentCard(id) {
  const response = await fetch(`${API_BASE}/card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    throw new Error(`Failed to set current card: ${response.status}`);
  }
  return response.json();
}

const ADMIN_TOKEN_KEY = 'neoai_admin_token';

export function getAdminToken() {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAdminToken(token) {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {}
}

export class AdminAuthError extends Error {
  constructor(message = 'unauthorized') {
    super(message);
    this.name = 'AdminAuthError';
  }
}

async function adminFetch(path, opts = {}) {
  const token = getAdminToken();
  const headers = { ...(opts.headers || {}), 'x-admin-token': token };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (response.status === 401) {
    setAdminToken('');
    throw new AdminAuthError();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }
  return data;
}

export async function adminPing() {
  return adminFetch('/admin/tasks');
}

export async function getAdminTasks() {
  return adminFetch('/admin/tasks');
}

export async function saveAdminTasks(tasks) {
  return adminFetch('/admin/tasks', {
    method: 'PUT',
    body: JSON.stringify({ tasks }),
  });
}
