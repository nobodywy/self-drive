const shareMeta = document.getElementById('shareMeta');
const publicPreview = document.getElementById('publicPreview');
const downloadLink = document.getElementById('downloadLink');

function tokenFromQuery() {
  const url = new URL(window.location.href);
  return url.searchParams.get('token') || '';
}

async function requestShare(token) {
  const response = await fetch(`${window.location.origin}/api/public/shares/${encodeURIComponent(token)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || '分享读取失败');
  }
  return payload.share;
}

async function renderPreview(share) {
  publicPreview.className = 'preview-container';
  publicPreview.innerHTML = '';

  if ((share.mimeType || '').startsWith('image/')) {
    const img = document.createElement('img');
    img.src = share.previewUrl;
    img.alt = share.fileName;
    publicPreview.appendChild(img);
    return;
  }

  if (share.mimeType === 'application/pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = share.previewUrl;
    iframe.height = '520';
    iframe.title = share.fileName;
    publicPreview.appendChild(iframe);
    return;
  }

  if ((share.mimeType || '').startsWith('video/')) {
    const video = document.createElement('video');
    video.src = share.previewUrl;
    video.controls = true;
    video.style.maxHeight = '520px';
    publicPreview.appendChild(video);
    return;
  }

  if ((share.mimeType || '').startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = share.previewUrl;
    audio.controls = true;
    publicPreview.appendChild(audio);
    return;
  }

  if (
    (share.mimeType || '').startsWith('text/') ||
    (share.mimeType || '').includes('json') ||
    (share.mimeType || '').includes('xml') ||
    (share.mimeType || '').includes('javascript')
  ) {
    const response = await fetch(share.previewUrl);
    const text = await response.text();
    const pre = document.createElement('pre');
    pre.textContent = text;
    publicPreview.appendChild(pre);
    return;
  }

  publicPreview.className = 'preview-container muted';
  publicPreview.textContent = '当前格式暂不支持在线预览，请直接下载。';
}

async function main() {
  const token = tokenFromQuery();
  if (!token) {
    shareMeta.textContent = '缺少分享 token';
    publicPreview.textContent = '链接不完整，请检查分享地址。';
    return;
  }

  try {
    const share = await requestShare(token);
    shareMeta.textContent = `${share.fileName} · ${share.mimeType || '文件'} · ${new Date(share.expiresAt).toLocaleString('zh-CN')}`;
    downloadLink.href = share.downloadUrl;
    downloadLink.classList.remove('hidden');
    await renderPreview(share);
  } catch (error) {
    shareMeta.textContent = error.message;
    publicPreview.className = 'preview-container muted';
    publicPreview.textContent = '这个分享可能已经失效，或者文件已被移除。';
  }
}

main();
