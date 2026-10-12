const http = require('node:http');
const { createHealthResponse } = require('../../shared/src/health');

const SERVICE_NAME = 'frontend';

function getHealthStatus() {
  return createHealthResponse(SERVICE_NAME);
}

function fileServiceBaseUrl() {
  return (process.env.FILE_SERVICE_BASE_URL || '').replace(/\/$/, '');
}

function renderFilesPage() {
  const configuredBaseUrl = JSON.stringify(fileServiceBaseUrl()).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App2 File Storage DR</title>
  <style>
    :root { --ink: #15251f; --paper: #f4efe2; --card: #fffaf0; --line: #c8bda8; --accent: #bf4d28; --good: #207a57; --bad: #a12c35; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: radial-gradient(circle at top right, #e8c777 0, transparent 30%), var(--paper); font-family: Georgia, "Times New Roman", serif; }
    main { width: min(1100px, calc(100% - 2rem)); margin: 2rem auto; }
    header { border-bottom: 4px double var(--ink); padding-bottom: 1rem; display: flex; justify-content: space-between; gap: 1rem; align-items: end; }
    h1 { margin: 0; font-size: clamp(2rem, 7vw, 4.5rem); line-height: .9; letter-spacing: -.04em; }
    .kicker, button, input { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    .kicker { text-transform: uppercase; letter-spacing: .12em; }
    .status { display: grid; grid-template-columns: repeat(2, minmax(150px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
    .card { background: color-mix(in srgb, var(--card) 92%, transparent); border: 1px solid var(--line); box-shadow: 5px 5px 0 var(--ink); padding: 1rem; }
    .value { display: block; font-size: 1.4rem; font-weight: bold; margin-top: .4rem; }
    form { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
    input[type=file] { flex: 1 1 280px; padding: .7rem; border: 1px dashed var(--ink); background: white; }
    button, .button { border: 1px solid var(--ink); background: var(--ink); color: white; padding: .65rem .8rem; cursor: pointer; text-decoration: none; display: inline-block; }
    button:hover, .button:hover { background: var(--accent); }
    table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; background: var(--card); }
    th, td { padding: .8rem; text-align: left; border-bottom: 1px solid var(--line); }
    th { background: var(--ink); color: white; }
    .actions { display: flex; flex-wrap: wrap; gap: .4rem; }
    .actions button, .actions .button { font-size: .78rem; }
    .good { color: var(--good); } .bad { color: var(--bad); }
    #message { min-height: 1.5rem; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    @media (max-width: 720px) { header { display: block; } .status { grid-template-columns: 1fr; } table, thead, tbody, tr, th, td { display: block; } thead { display: none; } td { border: 0; padding: .4rem .8rem; } tr { border-bottom: 2px solid var(--ink); padding: .6rem 0; } }
  </style>
</head>
<body>
  <main>
    <header><div><div class="kicker">Filesystem disaster recovery</div><h1>File Storage</h1></div><a href="/">Back to dashboard</a></header>
    <section class="status">
      <div class="card"><span class="kicker">Active region</span><span id="region" class="value">Checking...</span></div>
      <div class="card"><span class="kicker">Storage</span><span id="storage" class="value">Checking...</span></div>
    </section>
    <section class="card">
      <form id="upload-form"><input id="file" name="file" type="file" required><button type="submit">Upload</button></form>
      <p id="message" role="status" aria-live="polite"></p>
    </section>
    <table>
      <thead><tr><th>Name</th><th>Size</th><th>Region</th><th>Integrity</th><th>Actions</th></tr></thead>
      <tbody id="files"><tr><td colspan="5">Loading...</td></tr></tbody>
    </table>
  </main>
  <script>
    const baseUrl = ${configuredBaseUrl};
    const api = (path) => baseUrl + path;
    const filesEl = document.querySelector('#files');
    const messageEl = document.querySelector('#message');
    const formatSize = (bytes) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024) + ' KB';
    const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

    async function request(path, options) {
      const response = await fetch(api(path), options);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Request failed: ' + response.status);
      }
      return response;
    }

    async function refreshStatus() {
      const response = await fetch(api('/ready'));
      const status = await response.json();
      document.querySelector('#region').textContent = status.region || 'unknown';
      const storage = status.storage || {};
      const label = storage.writable ? 'READ / WRITE' : storage.readable ? 'READ ONLY' : 'UNAVAILABLE';
      const storageEl = document.querySelector('#storage');
      storageEl.textContent = label;
      storageEl.className = 'value ' + (storage.writable ? 'good' : 'bad');
    }

    async function refreshFiles() {
      const payload = await (await request('/api/v1/files')).json();
      if (!payload.files.length) {
        filesEl.innerHTML = '<tr><td colspan="5">No files stored.</td></tr>';
        return;
      }
      filesEl.innerHTML = payload.files.map((file) => {
        const id = encodeURIComponent(file.id);
        return '<tr>' +
        '<td>' + escapeHtml(file.originalName) + '</td>' +
        '<td>' + formatSize(file.size) + '</td>' +
        '<td>' + escapeHtml(file.region) + '</td>' +
        '<td id="integrity-' + id + '">Not checked</td>' +
        '<td class="actions"><a class="button" href="' + api('/api/v1/files/' + id + '/download') + '">Download</a>' +
        '<button data-verify="' + id + '">Verify</button><button data-delete="' + id + '">Delete</button></td></tr>';
      }).join('');
    }

    document.querySelector('#upload-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      messageEl.textContent = 'Uploading...';
      try {
        const body = new FormData();
        body.set('file', document.querySelector('#file').files[0]);
        await request('/api/v1/files', { method: 'POST', body });
        event.target.reset();
        messageEl.textContent = 'Upload complete.';
        await refreshFiles();
      } catch (error) { messageEl.textContent = error.message; }
    });

    filesEl.addEventListener('click', async (event) => {
      const verifyId = event.target.dataset.verify;
      const deleteId = event.target.dataset.delete;
      try {
        if (verifyId) {
          const result = await (await request('/api/v1/files/' + verifyId + '/verify')).json();
          const cell = document.getElementById('integrity-' + verifyId);
          cell.textContent = result.integrity;
          cell.className = result.integrity === 'PASS' ? 'good' : 'bad';
        }
        if (deleteId && confirm('Delete this file?')) {
          await request('/api/v1/files/' + deleteId, { method: 'DELETE' });
          messageEl.textContent = 'File deleted.';
          await refreshFiles();
        }
      } catch (error) { messageEl.textContent = error.message; }
    });

    Promise.all([refreshStatus(), refreshFiles()]).catch((error) => { messageEl.textContent = error.message; });
  </script>
</body>
</html>`;
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  
  if (url.pathname === '/health') {
    const health = getHealthStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const health = getHealthStatus();
    const region = health.region;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App2 Multi-Region Platform</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 2rem; background: #0f172a; color: #f8fafc; }
    .card { background: #1e293b; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; border: 1px solid #334155; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; font-weight: 600; background: #0284c7; color: white; }
    h1 { color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>App2 Multi-Region DR Dashboard</h1>
    <p>Service: <strong>frontend</strong> | Active Region: <span class="badge">${region}</span></p>
    <p>Backend Topology: backend-1 (8081), backend-2 (8082 - Catalog), backend-3 (8083 - Orders / PostgreSQL)</p>
    <p><a href="/files" style="color:#7dd3fc">Open File Storage DR</a></p>
  </div>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (url.pathname === '/files') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderFilesPage());
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found', service: SERVICE_NAME }));
}

module.exports = {
  SERVICE_NAME,
  getHealthStatus,
  fileServiceBaseUrl,
  renderFilesPage,
  handleRequest
};
