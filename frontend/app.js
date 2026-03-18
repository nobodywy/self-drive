const state = {
  mode: 'login',
  token: localStorage.getItem('selfDriveToken') || '',
  user: null,
  files: []
};

const authCard = document.getElementById('authCard');
const appCard = document.getElementById('appCard');
const loginTab = document.getElementById('loginTab');
const registerTab = document.getElementById('registerTab');
const authForm = document.getElementById('authForm');
const authMessage = document.getElementById('authMessage');
const submitBtn = document.getElementById('submitBtn');
const nameField = document.getElementById('nameField');
const nameInput = document.getElementById('nameInput');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const uploadForm = document.getElementById('uploadForm');
const uploadMessage = document.getElementById('uploadMessage');
const fileInput = document.getElementById('fileInput');
const fileCount = document.getElementById('fileCount');
const totalSize = document.getElementById('totalSize');
const fileTable = document.getElementById('fileTable');
const fileTableBody = document.getElementById('fileTableBody');
const emptyState = document.getElementById('emptyState');
const currentUser = document.getElementById('currentUser');
const userBox = document.getElementById('userBox');
const logoutBtn = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const previewContainer = document.getElementById('previewContainer');
const previewTitle = document.getElementById('previewTitle');

function apiBase() {
  return `${window.location.origin}/api`;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const hasBody = options.body && !(options.body instanceof FormData);
  if (hasBody) {
    headers.set('Content-Type', 'application/json');
  }

  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = payload?.message || payload || '请求失败';
    throw new Error(message);
  }

  return payload;
}

function setMode(mode) {
  state.mode = mode;
  loginTab.classList.toggle('active', mode === 'login');
  registerTab.classList.toggle('active', mode === 'register');
  nameField.classList.toggle('hidden', mode !== 'register');
  submitBtn.textContent = mode === 'login' ? '登录' : '注册并进入';
  authMessage.textContent = '';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function previewUrl(fileId) {
  const token = encodeURIComponent(state.token);
  return `${apiBase()}/files/${fileId}/preview?token=${token}`;
}

function downloadUrl(fileId) {
  const token = encodeURIComponent(state.token);
  return `${apiBase()}/files/${fileId}/download?token=${token}`;
}

function resetPreview(message = '支持图片 / PDF / 文本 / 音视频预览') {
  previewTitle.textContent = '未选择文件';
  previewContainer.className = 'preview-container muted';
  previewContainer.innerHTML = message;
}

async function showPreview(file) {
  previewTitle.textContent = file.name;
  previewContainer.className = 'preview-container';
  previewContainer.innerHTML = '';

  if (file.mimeType.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = previewUrl(file.id);
    img.alt = file.name;
    previewContainer.appendChild(img);
    return;
  }

  if (file.mimeType === 'application/pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = previewUrl(file.id);
    iframe.height = '440';
    iframe.title = file.name;
    previewContainer.appendChild(iframe);
    return;
  }

  if (file.mimeType.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = previewUrl(file.id);
    video.controls = true;
    video.style.maxHeight = '440px';
    previewContainer.appendChild(video);
    return;
  }

  if (file.mimeType.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = previewUrl(file.id);
    audio.controls = true;
    previewContainer.appendChild(audio);
    return;
  }

  if (
    file.mimeType.startsWith('text/') ||
    file.mimeType.includes('json') ||
    file.mimeType.includes('xml') ||
    file.mimeType.includes('javascript')
  ) {
    const text = await request(`/files/${file.id}/preview`);
    const pre = document.createElement('pre');
    pre.textContent = text;
    previewContainer.appendChild(pre);
    return;
  }

  previewContainer.className = 'preview-container muted';
  previewContainer.textContent = '当前格式暂不支持在线预览，可以直接下载。';
}

function renderFiles(files, stats) {
  state.files = files;
  fileTableBody.innerHTML = '';
  fileCount.textContent = String(stats.count || 0);
  totalSize.textContent = formatBytes(stats.totalSize || 0);

  if (!files.length) {
    emptyState.classList.remove('hidden');
    fileTable.classList.add('hidden');
    resetPreview();
    return;
  }

  emptyState.classList.add('hidden');
  fileTable.classList.remove('hidden');

  for (const file of files) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${file.name}</td>
      <td>${formatBytes(file.size)}</td>
      <td>${file.mimeType || '-'}</td>
      <td>${new Date(file.createdAt).toLocaleString()}</td>
      <td><div class="table-actions"></div></td>
    `;

    const actions = row.querySelector('.table-actions');
    const previewBtn = document.createElement('button');
    previewBtn.className = 'ghost';
    previewBtn.textContent = '预览';
    previewBtn.addEventListener('click', () => showPreview(file));

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'ghost';
    downloadBtn.textContent = '下载';
    downloadBtn.addEventListener('click', () => {
      window.open(downloadUrl(file.id), '_blank');
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', async () => {
      if (!window.confirm(`确认删除 ${file.name} ?`)) {
        return;
      }
      try {
        await request(`/files/${file.id}`, { method: 'DELETE' });
        await loadFiles();
      } catch (error) {
        uploadMessage.textContent = error.message;
      }
    });

    actions.append(previewBtn, downloadBtn, deleteBtn);
    fileTableBody.appendChild(row);
  }
}

async function loadFiles() {
  const payload = await request('/files');
  renderFiles(payload.files, payload.stats);
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('selfDriveToken', token);
  currentUser.textContent = `${user.name}（${user.email}）`;
  userBox.classList.remove('hidden');
  authCard.classList.add('hidden');
  appCard.classList.remove('hidden');
}

function clearSession() {
  state.token = '';
  state.user = null;
  state.files = [];
  localStorage.removeItem('selfDriveToken');
  userBox.classList.add('hidden');
  authCard.classList.remove('hidden');
  appCard.classList.add('hidden');
  fileTableBody.innerHTML = '';
  fileTable.classList.add('hidden');
  emptyState.classList.remove('hidden');
  resetPreview();
}

async function bootstrapSession() {
  if (!state.token) {
    setMode('login');
    return;
  }

  try {
    const payload = await request('/auth/me');
    saveSession(state.token, payload.user);
    await loadFiles();
  } catch {
    clearSession();
    setMode('login');
  }
}

loginTab.addEventListener('click', () => setMode('login'));
registerTab.addEventListener('click', () => setMode('register'));

logoutBtn.addEventListener('click', () => {
  clearSession();
  setMode('login');
});

refreshBtn.addEventListener('click', async () => {
  await loadFiles();
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authMessage.textContent = '处理中...';

  try {
    const path = state.mode === 'login' ? '/auth/login' : '/auth/register';
    const body = {
      email: emailInput.value.trim(),
      password: passwordInput.value
    };

    if (state.mode === 'register') {
      body.name = nameInput.value.trim();
    }

    const payload = await request(path, {
      method: 'POST',
      body: JSON.stringify(body)
    });

    saveSession(payload.token, payload.user);
    authForm.reset();
    authMessage.textContent = '';
    await loadFiles();
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!fileInput.files.length) {
    uploadMessage.textContent = '先选择文件再上传';
    return;
  }

  uploadMessage.textContent = '上传中...';
  const formData = new FormData();
  for (const file of fileInput.files) {
    formData.append('files', file);
  }

  try {
    await request('/files/upload', {
      method: 'POST',
      body: formData
    });
    uploadMessage.textContent = '上传完成';
    fileInput.value = '';
    await loadFiles();
  } catch (error) {
    uploadMessage.textContent = error.message;
  }
});

resetPreview();
bootstrapSession();
