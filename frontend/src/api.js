const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers['content-type'] && !headers['Content-Type']) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    credentials: 'include',
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const err = new Error(json?.error || res.statusText || `Request failed: ${res.status}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

// ---------- Public, unscoped ----------

export async function getCompetitions() {
  return request('/competitions');
}

// ---------- Public, scoped to competition ----------

function compBase(slug) {
  return `/competitions/${encodeURIComponent(slug)}`;
}

export async function getCompetition(slug) {
  return request(compBase(slug));
}

export async function getOverallLeaderboard(slug) {
  return request(`${compBase(slug)}/leaderboard`);
}

export async function getTaskLeaderboard(slug, taskSlug) {
  return request(`${compBase(slug)}/tasks/${encodeURIComponent(taskSlug)}`);
}

export async function getBoards(slug) {
  return request(`${compBase(slug)}/boards`);
}

export async function getParticipants(slug) {
  return request(`${compBase(slug)}/participants`);
}

export async function getCurrentCard(slug) {
  return request(`${compBase(slug)}/card`);
}

export async function setCurrentCard(slug, id) {
  return request(`${compBase(slug)}/card`, {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

export async function getCycleConfig(slug) {
  return request(`${compBase(slug)}/cycle`);
}

// ---------- Admin token (legacy fallback) ----------

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
  const headers = { ...(opts.headers || {}) };
  if (token) headers['x-admin-token'] = token;
  try {
    return await request(p, { ...opts, headers });
  } catch (e) {
    if (e.status === 401) {
      setAdminToken('');
      throw new AdminAuthError(e.message);
    }
    throw e;
  }
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

export async function setAdminCycleBoard(slug, boardSlug) {
  return adminFetch(`${adminCompBase(slug)}/cycle`, {
    method: 'PUT',
    body: JSON.stringify({ cycleBoardSlug: boardSlug }),
  });
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

// ---------- Auth ----------

export const auth = {
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
};

// ---------- Competitions (search) ----------

export const competitions = {
  list: (q) => request(`/competitions${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  get: (slug) => request(`/competitions/${slug}`),
  getLeaderboard: (slug) => request(`/competitions/${slug}/leaderboard`),
};

// ---------- Native tasks (public) ----------

export const nativeTasks = {
  listPublic: (compSlug) => request(`/competitions/${compSlug}/native-tasks`),
  getPublic: (compSlug, taskSlug) => request(`/competitions/${compSlug}/native-tasks/${taskSlug}`),
  fileUrl: (compSlug, taskSlug, fileId) =>
    `${API_BASE}/competitions/${compSlug}/native-tasks/${taskSlug}/files/${fileId}`,
  zipUrl: (compSlug, taskSlug, kind) =>
    `${API_BASE}/competitions/${compSlug}/native-tasks/${taskSlug}/files.zip?kind=${kind}`,
};

// ---------- Native tasks (admin) ----------

async function uploadFormData(url, formData) {
  const r = await fetch(url, { method: 'POST', credentials: 'include', body: formData });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error || r.statusText), { status: r.status });
  return j;
}

async function putFormData(url, formData) {
  const r = await fetch(url, { method: 'PUT', credentials: 'include', body: formData });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error || r.statusText), { status: r.status });
  return j;
}

export const adminNativeTasks = {
  list: (compSlug) => request(`/admin/competitions/${compSlug}/native-tasks`),
  create: (compSlug, body) =>
    request(`/admin/competitions/${compSlug}/native-tasks`, { method: 'POST', body: JSON.stringify(body) }),
  update: (compSlug, taskSlug, body) =>
    request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (compSlug, taskSlug) =>
    request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}`, { method: 'DELETE' }),
  uploadFile: (compSlug, taskSlug, kind, formData) =>
    uploadFormData(`${API_BASE}/admin/competitions/${compSlug}/native-tasks/${taskSlug}/files?kind=${kind}`, formData),
  updateFile: (compSlug, taskSlug, fileId, body) =>
    request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/files/${fileId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteFile: (compSlug, taskSlug, fileId) =>
    request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/files/${fileId}`, { method: 'DELETE' }),
  uploadGrader: (compSlug, taskSlug, formData) =>
    putFormData(`${API_BASE}/admin/competitions/${compSlug}/native-tasks/${taskSlug}/grader`, formData),
  uploadGroundTruth: (compSlug, taskSlug, formData) =>
    putFormData(`${API_BASE}/admin/competitions/${compSlug}/native-tasks/${taskSlug}/ground-truth`, formData),
  deleteGrader: (compSlug, taskSlug) =>
    request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/grader`, { method: 'DELETE' }),
  deleteGroundTruth: (compSlug, taskSlug) =>
    request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/ground-truth`, { method: 'DELETE' }),
  uploadGroundTruthPrivate: (compSlug, taskSlug, formData) =>
    putFormData(`${API_BASE}/admin/competitions/${compSlug}/native-tasks/${taskSlug}/ground-truth-private`, formData),
  deleteGroundTruthPrivate: (compSlug, taskSlug) =>
    request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/ground-truth-private`, { method: 'DELETE' }),
};

// ---------- Submissions (public) ----------

export const submissions = {
  create: async (compSlug, taskSlug, formData) => {
    const r = await fetch(`${API_BASE}/competitions/${compSlug}/native-tasks/${taskSlug}/submissions`, {
      method: 'POST', credentials: 'include', body: formData,
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) {
      const err = new Error(json?.error || r.statusText);
      err.status = r.status;
      err.payload = json;
      throw err;
    }
    return json;
  },
  listMine: (compSlug, taskSlug) => request(`/competitions/${compSlug}/native-tasks/${taskSlug}/submissions/me`),
  get: (compSlug, taskSlug, id) => request(`/competitions/${compSlug}/native-tasks/${taskSlug}/submissions/${id}`),
};

// ---------- Submissions (admin) ----------

export const adminSubmissions = {
  list: (compSlug, taskSlug, status) => request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/submissions${status ? `?status=${status}` : ''}`),
  delete: (compSlug, taskSlug, id) => request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/submissions/${id}`, { method: 'DELETE' }),
  rescore: (compSlug, taskSlug, id) => request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/submissions/${id}/rescore`, { method: 'POST' }),
  rescoreAll: (compSlug, taskSlug) => request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/submissions/rescore-all`, { method: 'POST' }),
};
