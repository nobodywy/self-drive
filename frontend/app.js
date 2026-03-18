const state = {
  mode: 'login',
  token: localStorage.getItem('selfDriveToken') || '',
  user: null,
  currentFolderId: null,
  breadcrumb: [{ id: null, name: '根目录' }],
  folders: [],
  files: [],
  shares: [],
  adminUsers: []
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
const folderForm = document.getElementById('folderForm');
const folderNameInput = document.getElementById('folderNameInput');
const folderMessage = document.getElementById('folderMessage');
const uploadForm = document.getElementById('uploadForm');
const uploadMessage = document.getElementById('uploadMessage');
const fileInput = document.getElementById('fileInput');
const fileCount = document.getElementById('fileCount');
const totalSize = document.getElementById('totalSize');
const quotaSize = document.getElementById('quotaSize');
const currentLocation = document.getElementById('currentLocation');
const breadcrumbBar = document.getElementById('breadcrumbBar');
const rootBtn = document.getElementById('rootBtn');
const upBtn = document.getElementById('upBtn');
const refreshBtn = document.getElementById('refreshBtn');
const explorerTable = document.getElementById('explorerTable');
const explorerTableBody = document.getElementById('explorerTableBody');
const emptyState = document.getElementById('emptyState');
const currentUser = document.getElementById('currentUser');
const userBox = document.getElementById('userBox');
const logoutBtn = document.getElementById('logoutBtn');
const previewContainer = document.getElementById('previewContainer');
const previewTitle = document.getElementById('previewTitle');
const sharesEmpty = document.getElementById('sharesEmpty');
const sharesList = document.getElementById('sharesList');
const shareMessage = document.getElementById('shareMessage');
const refreshSharesBtn = document.getElementById('refreshSharesBtn');
const accountRoleBadge = document.getElementById('accountRoleBadge');
const accountEmailText = document.getElementById('accountEmailText');
const accountStatusText = document.getElementById('accountStatusText');
const profileForm = document.getElementById('profileForm');
const accountNameInput = document.getElementById('accountNameInput');
const profileMessage = document.getElementById('profileMessage');
const passwordForm = document.getElementById('passwordForm');
const currentPasswordInput = document.getElementById('currentPasswordInput');
const newPasswordInput = document.getElementById('newPasswordInput');
const passwordMessage = document.getElementById('passwordMessage');
const adminCard = document.getElementById('adminCard');
const adminEmpty = document.getElementById('adminEmpty');
const adminList = document.getElementById('adminList');
const refreshAdminBtn = document.getElementById('refreshAdminBtn');

function apiBase() {
  return `${window.location.origin}/api`;
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

function formatDate(value) {
  return new Date(value).toLocaleString('zh-CN');
}

function previewUrl(fileId) {
  return `${apiBase()}/files/${fileId}/preview?token=${encodeURIComponent(state.token)}`;
}

function downloadUrl(fileId) {
  return `${apiBase()}/files/${fileId}/download?token=${encodeURIComponent(state.token)}`;
}

function sharePageUrl(token) {
  return `${window.location.origin}/share.html?token=${encodeURIComponent(token)}`;
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
    if (response.status === 401) {
      clearSession();
      setMode('login');
    }
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

function renderCurrentUser() {
  if (!state.user) {
    return;
  }

  currentUser.textContent = `${state.user.name}（${state.user.email} / ${state.user.role}）`;
  quotaSize.textContent = `${state.user.storageQuotaMb} MB`;
  accountRoleBadge.textContent = state.user.role;
  accountRoleBadge.className = `badge ${state.user.role === 'admin' ? 'admin' : ''}`;
  accountEmailText.textContent = `邮箱：${state.user.email}`;
  accountStatusText.textContent = `状态：${state.user.isEnabled ? '启用中' : '已禁用'} · 配额：${state.user.storageQuotaMb} MB`;
  accountNameInput.value = state.user.name;
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

  if ((file.mimeType || '').startsWith('image/')) {
    const img = document.createElement('img');
    img.src = previewUrl(file.id);
    img.alt = file.name;
    previewContainer.appendChild(img);
    return;
  }

  if (file.mimeType === 'application/pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = previewUrl(file.id);
    iframe.height = '420';
    iframe.title = file.name;
    previewContainer.appendChild(iframe);
    return;
  }

  if ((file.mimeType || '').startsWith('video/')) {
    const video = document.createElement('video');
    video.src = previewUrl(file.id);
    video.controls = true;
    video.style.maxHeight = '420px';
    previewContainer.appendChild(video);
    return;
  }

  if ((file.mimeType || '').startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = previewUrl(file.id);
    audio.controls = true;
    previewContainer.appendChild(audio);
    return;
  }

  if (
    (file.mimeType || '').startsWith('text/') ||
    (file.mimeType || '').includes('json') ||
    (file.mimeType || '').includes('xml') ||
    (file.mimeType || '').includes('javascript')
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

function renderBreadcrumb() {
  breadcrumbBar.innerHTML = '';
  currentLocation.textContent = `当前：${state.breadcrumb.map((item) => item.name).join(' / ')}`;
  state.breadcrumb.forEach((item, index) => {
    const button = document.createElement('button');
    button.className = 'crumb';
    button.textContent = item.name;
    button.disabled = index === state.breadcrumb.length - 1;
    button.addEventListener('click', async () => {
      await loadExplorer(item.id);
    });
    breadcrumbBar.appendChild(button);

    if (index !== state.breadcrumb.length - 1) {
      const divider = document.createElement('span');
      divider.className = 'crumb-divider';
      divider.textContent = '/';
      breadcrumbBar.appendChild(divider);
    }
  });
}

function renderExplorer(data) {
  state.currentFolderId = data.currentFolder?.id ?? null;
  state.breadcrumb = data.breadcrumb || [{ id: null, name: '根目录' }];
  state.folders = data.folders || [];
  state.files = data.files || [];

  renderBreadcrumb();
  fileCount.textContent = String(data.stats?.count || 0);
  totalSize.textContent = formatBytes(data.stats?.totalSize || 0);
  explorerTableBody.innerHTML = '';

  const items = [
    ...state.folders.map((folder) => ({ kind: 'folder', item: folder })),
    ...state.files.map((file) => ({ kind: 'file', item: file }))
  ];

  if (!items.length) {
    emptyState.classList.remove('hidden');
    explorerTable.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  explorerTable.classList.remove('hidden');

  for (const entry of items) {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    const typeCell = document.createElement('td');
    const sizeCell = document.createElement('td');
    const timeCell = document.createElement('td');
    const actionCell = document.createElement('td');
    const actionWrap = document.createElement('div');
    actionWrap.className = 'table-actions';

    if (entry.kind === 'folder') {
      const folder = entry.item;
      const folderLabel = document.createElement('strong');
      folderLabel.textContent = `📁 ${folder.name}`;
      nameCell.appendChild(folderLabel);
      typeCell.textContent = '文件夹';
      sizeCell.textContent = '—';
      timeCell.textContent = formatDate(folder.createdAt);

      const openButton = document.createElement('button');
      openButton.className = 'ghost';
      openButton.textContent = '打开';
      openButton.addEventListener('click', async () => {
        await loadExplorer(folder.id);
      });

      const renameButton = document.createElement('button');
      renameButton.className = 'ghost';
      renameButton.textContent = '重命名';
      renameButton.addEventListener('click', async () => {
        const name = window.prompt('输入新的文件夹名称', folder.name)?.trim();
        if (!name) {
          return;
        }
        try {
          await request(`/folders/${folder.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name })
          });
          await loadExplorer();
        } catch (error) {
          folderMessage.textContent = error.message;
        }
      });

      const deleteButton = document.createElement('button');
      deleteButton.textContent = '删除';
      deleteButton.addEventListener('click', async () => {
        if (!window.confirm(`确认删除文件夹 ${folder.name} ?`)) {
          return;
        }
        try {
          await request(`/folders/${folder.id}`, { method: 'DELETE' });
          await loadExplorer();
        } catch (error) {
          folderMessage.textContent = error.message;
        }
      });

      actionWrap.append(openButton, renameButton, deleteButton);
    } else {
      const file = entry.item;
      nameCell.textContent = file.name;
      typeCell.textContent = file.mimeType || '文件';
      sizeCell.textContent = formatBytes(file.size);
      timeCell.textContent = formatDate(file.createdAt);

      const previewButton = document.createElement('button');
      previewButton.className = 'ghost';
      previewButton.textContent = '预览';
      previewButton.addEventListener('click', () => showPreview(file));

      const downloadButton = document.createElement('button');
      downloadButton.className = 'ghost';
      downloadButton.textContent = '下载';
      downloadButton.addEventListener('click', () => {
        window.open(downloadUrl(file.id), '_blank');
      });

      const shareButton = document.createElement('button');
      shareButton.className = 'ghost';
      shareButton.textContent = '分享';
      shareButton.addEventListener('click', async () => {
        const input = window.prompt('分享有效期（天），默认 7 天', '7');
        const expiresInDays = Number(input || 7);
        try {
          const payload = await request(`/files/${file.id}/share`, {
            method: 'POST',
            body: JSON.stringify({ expiresInDays })
          });
          shareMessage.textContent = '分享链接已生成';
          await loadShares();
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(payload.share.url);
            shareMessage.textContent = '分享链接已生成，并已复制到剪贴板';
          }
        } catch (error) {
          shareMessage.textContent = error.message;
        }
      });

      const renameButton = document.createElement('button');
      renameButton.className = 'ghost';
      renameButton.textContent = '重命名';
      renameButton.addEventListener('click', async () => {
        const name = window.prompt('输入新的文件名', file.name)?.trim();
        if (!name) {
          return;
        }
        try {
          await request(`/files/${file.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name })
          });
          await loadExplorer();
        } catch (error) {
          uploadMessage.textContent = error.message;
        }
      });

      const deleteButton = document.createElement('button');
      deleteButton.textContent = '删除';
      deleteButton.addEventListener('click', async () => {
        if (!window.confirm(`确认删除 ${file.name} ?`)) {
          return;
        }
        try {
          await request(`/files/${file.id}`, { method: 'DELETE' });
          await loadExplorer();
          resetPreview();
        } catch (error) {
          uploadMessage.textContent = error.message;
        }
      });

      actionWrap.append(previewButton, downloadButton, shareButton, renameButton, deleteButton);
    }

    actionCell.appendChild(actionWrap);
    row.append(nameCell, typeCell, sizeCell, timeCell, actionCell);
    explorerTableBody.appendChild(row);
  }
}

function renderShares(shares) {
  state.shares = shares;
  sharesList.innerHTML = '';

  if (!shares.length) {
    sharesEmpty.classList.remove('hidden');
    sharesList.classList.add('hidden');
    return;
  }

  sharesEmpty.classList.add('hidden');
  sharesList.classList.remove('hidden');

  for (const share of shares) {
    const card = document.createElement('div');
    card.className = 'share-item';

    const title = document.createElement('strong');
    title.textContent = share.fileName;

    const meta = document.createElement('div');
    meta.className = 'share-meta';
    meta.textContent = `有效期至：${formatDate(share.expiresAt)}`;

    const link = document.createElement('a');
    link.href = sharePageUrl(share.token);
    link.textContent = sharePageUrl(share.token);
    link.target = '_blank';
    link.rel = 'noreferrer';

    const actions = document.createElement('div');
    actions.className = 'table-actions';

    const copyButton = document.createElement('button');
    copyButton.className = 'ghost';
    copyButton.textContent = '复制';
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(sharePageUrl(share.token));
        shareMessage.textContent = '分享链接已复制';
      } catch {
        shareMessage.textContent = '复制失败，请手动复制链接';
      }
    });

    const openButton = document.createElement('button');
    openButton.className = 'ghost';
    openButton.textContent = '打开';
    openButton.addEventListener('click', () => {
      window.open(sharePageUrl(share.token), '_blank');
    });

    const revokeButton = document.createElement('button');
    revokeButton.textContent = '撤销';
    revokeButton.addEventListener('click', async () => {
      if (!window.confirm(`确认撤销 ${share.fileName} 的分享链接？`)) {
        return;
      }
      try {
        await request(`/shares/${share.id}`, { method: 'DELETE' });
        await loadShares();
      } catch (error) {
        shareMessage.textContent = error.message;
      }
    });

    actions.append(copyButton, openButton, revokeButton);
    card.append(title, meta, link, actions);
    sharesList.appendChild(card);
  }
}

function createAdminActionButton(label, handler, ghost = false) {
  const button = document.createElement('button');
  button.textContent = label;
  if (ghost) {
    button.className = 'ghost';
  }
  button.addEventListener('click', handler);
  return button;
}

function renderAdminUsers(users) {
  state.adminUsers = users;
  adminList.innerHTML = '';

  if (!users.length) {
    adminEmpty.classList.remove('hidden');
    adminList.classList.add('hidden');
    return;
  }

  adminEmpty.classList.add('hidden');
  adminList.classList.remove('hidden');

  for (const user of users) {
    const card = document.createElement('div');
    card.className = 'admin-item';

    const title = document.createElement('strong');
    title.textContent = `${user.name}${user.id === state.user.id ? '（我）' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'admin-meta';
    meta.textContent = `${user.email} · ${user.role} · ${user.isEnabled ? '启用中' : '已禁用'}`;

    const stats = document.createElement('div');
    stats.className = 'admin-meta';
    stats.textContent = `文件数：${user.fileCount} · 占用：${formatBytes(user.totalSize)} · 配额：${user.storageQuotaMb} MB`;

    const actions = document.createElement('div');
    actions.className = 'table-actions';

    const renameButton = createAdminActionButton('改昵称', async () => {
      const name = window.prompt('输入新的昵称', user.name)?.trim();
      if (!name) {
        return;
      }
      try {
        await request(`/admin/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name })
        });
        await loadAdminUsers();
      } catch (error) {
        profileMessage.textContent = error.message;
      }
    }, true);

    const roleButton = createAdminActionButton(user.role === 'admin' ? '改为普通用户' : '设为管理员', async () => {
      try {
        await request(`/admin/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ role: user.role === 'admin' ? 'user' : 'admin' })
        });
        await loadAdminUsers();
      } catch (error) {
        profileMessage.textContent = error.message;
      }
    }, true);

    const statusButton = createAdminActionButton(user.isEnabled ? '禁用' : '启用', async () => {
      try {
        await request(`/admin/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isEnabled: !user.isEnabled })
        });
        await loadAdminUsers();
      } catch (error) {
        profileMessage.textContent = error.message;
      }
    }, true);

    const quotaButton = createAdminActionButton('改配额', async () => {
      const input = window.prompt('输入新的配额（MB，至少 100）', String(user.storageQuotaMb));
      if (!input) {
        return;
      }
      try {
        await request(`/admin/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ storageQuotaMb: Number(input) })
        });
        await loadAdminUsers();
      } catch (error) {
        profileMessage.textContent = error.message;
      }
    }, true);

    const passwordButton = createAdminActionButton('重置密码', async () => {
      const input = window.prompt('输入新密码（至少 6 位）');
      if (!input) {
        return;
      }
      try {
        await request(`/admin/users/${user.id}/reset-password`, {
          method: 'POST',
          body: JSON.stringify({ newPassword: input })
        });
        profileMessage.textContent = `已重置 ${user.email} 的密码`;
      } catch (error) {
        profileMessage.textContent = error.message;
      }
    }, true);

    const deleteButton = createAdminActionButton('删除用户', async () => {
      if (!window.confirm(`确认删除用户 ${user.email} ? 这会同时删除其文件和分享。`)) {
        return;
      }
      try {
        await request(`/admin/users/${user.id}`, { method: 'DELETE' });
        await loadAdminUsers();
      } catch (error) {
        profileMessage.textContent = error.message;
      }
    });

    if (user.id === state.user.id) {
      roleButton.disabled = true;
      statusButton.disabled = true;
      deleteButton.disabled = true;
    }

    actions.append(renameButton, roleButton, statusButton, quotaButton, passwordButton, deleteButton);
    card.append(title, meta, stats, actions);
    adminList.appendChild(card);
  }
}

async function loadExplorer(folderId = state.currentFolderId) {
  const query = folderId ? `?folderId=${folderId}` : '';
  const payload = await request(`/explorer${query}`);
  renderExplorer(payload);
}

async function loadShares() {
  const payload = await request('/shares');
  renderShares(payload.shares || []);
}

async function loadAdminUsers() {
  if (state.user?.role !== 'admin') {
    adminCard.classList.add('hidden');
    return;
  }

  adminCard.classList.remove('hidden');
  const payload = await request('/admin/users');
  renderAdminUsers(payload.users || []);
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('selfDriveToken', token);
  userBox.classList.remove('hidden');
  authCard.classList.add('hidden');
  appCard.classList.remove('hidden');
  renderCurrentUser();

  if (user.role === 'admin') {
    adminCard.classList.remove('hidden');
  } else {
    adminCard.classList.add('hidden');
  }
}

function clearSession() {
  state.token = '';
  state.user = null;
  state.currentFolderId = null;
  state.breadcrumb = [{ id: null, name: '根目录' }];
  localStorage.removeItem('selfDriveToken');
  userBox.classList.add('hidden');
  authCard.classList.remove('hidden');
  appCard.classList.add('hidden');
  explorerTableBody.innerHTML = '';
  sharesList.innerHTML = '';
  adminList.innerHTML = '';
  profileForm.reset();
  passwordForm.reset();
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
    await Promise.all([loadExplorer(null), loadShares(), loadAdminUsers()]);
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

rootBtn.addEventListener('click', async () => {
  await loadExplorer(null);
});

upBtn.addEventListener('click', async () => {
  if (state.breadcrumb.length <= 1) {
    return;
  }
  const parent = state.breadcrumb[state.breadcrumb.length - 2];
  await loadExplorer(parent.id);
});

refreshBtn.addEventListener('click', async () => {
  await loadExplorer();
});

refreshSharesBtn.addEventListener('click', async () => {
  await loadShares();
});

refreshAdminBtn.addEventListener('click', async () => {
  await loadAdminUsers();
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
    await Promise.all([loadExplorer(null), loadShares(), loadAdminUsers()]);
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  profileMessage.textContent = '保存中...';

  try {
    const payload = await request('/account/profile', {
      method: 'PATCH',
      body: JSON.stringify({ name: accountNameInput.value.trim() })
    });
    state.user = payload.user;
    renderCurrentUser();
    profileMessage.textContent = '资料已保存';
    await loadAdminUsers();
  } catch (error) {
    profileMessage.textContent = error.message;
  }
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  passwordMessage.textContent = '更新中...';

  try {
    const payload = await request('/account/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: currentPasswordInput.value,
        newPassword: newPasswordInput.value
      })
    });
    passwordForm.reset();
    passwordMessage.textContent = payload.message || '密码已更新';
  } catch (error) {
    passwordMessage.textContent = error.message;
  }
});

folderForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  folderMessage.textContent = '创建中...';

  try {
    await request('/folders', {
      method: 'POST',
      body: JSON.stringify({
        name: folderNameInput.value.trim(),
        parentId: state.currentFolderId
      })
    });

    folderNameInput.value = '';
    folderMessage.textContent = '文件夹已创建';
    await loadExplorer();
  } catch (error) {
    folderMessage.textContent = error.message;
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
  if (state.currentFolderId) {
    formData.append('folderId', String(state.currentFolderId));
  }

  try {
    await request('/files/upload', {
      method: 'POST',
      body: formData
    });
    uploadMessage.textContent = '上传完成';
    fileInput.value = '';
    await loadExplorer();
    await loadAdminUsers();
  } catch (error) {
    uploadMessage.textContent = error.message;
  }
});

resetPreview();
bootstrapSession();
