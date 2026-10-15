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
  <title>File Storage</title>
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
    <header><div><div class="kicker">Documents</div><h1>File Storage</h1></div><a href="/">Back to home</a></header>
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

function renderOrdersPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Orders</title>
<style>
:root{--ink:#17221d;--paper:#f4efe2;--card:#fffaf0;--line:#c8bda8;--accent:#bf4d28;--good:#207a57;--bad:#a12c35}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:radial-gradient(circle at top right,#e8c777 0,transparent 30%),var(--paper);font:16px Georgia,"Times New Roman",serif}main{width:min(1100px,calc(100% - 2rem));margin:2rem auto}header{border-bottom:4px double var(--ink);padding-bottom:1rem;display:flex;justify-content:space-between;gap:1rem;align-items:end}h1{margin:0;font-size:clamp(2rem,7vw,4rem);line-height:.9}.kicker,button,input{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.kicker{text-transform:uppercase;letter-spacing:.12em}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin:1.5rem 0}.card{background:var(--card);border:1px solid var(--line);box-shadow:5px 5px 0 var(--ink);padding:1rem}.value{display:block;font-size:1.35rem;font-weight:bold;margin-top:.4rem}.good{color:var(--good)}.bad{color:var(--bad)}form{display:flex;gap:.75rem;flex-wrap:wrap}input{padding:.7rem;border:1px solid var(--line);background:white;min-width:150px;flex:1}button{border:1px solid var(--ink);background:var(--ink);color:white;padding:.7rem .9rem;cursor:pointer}button:hover{background:var(--accent)}table{width:100%;border-collapse:collapse;margin-top:1.5rem;background:var(--card)}th,td{padding:.75rem;text-align:left;border-bottom:1px solid var(--line)}th{background:var(--ink);color:white}#message{min-height:1.5rem;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:720px){header{display:block}.grid{grid-template-columns:1fr}table,thead,tbody,tr,th,td{display:block}thead{display:none}td{border:0;padding:.35rem .75rem}tr{border-bottom:2px solid var(--ink);padding:.6rem 0}}
</style></head><body><main>
<header><div><div class="kicker">Order management</div><h1>Orders</h1></div><a href="/">Back to home</a></header>
<section class="grid"><div class="card"><span class="kicker">Service</span><span id="api" class="value">Checking...</span></div><div class="card"><span class="kicker">Availability</span><span id="db" class="value">Checking...</span></div><div class="card"><span class="kicker">Orders</span><span class="value">/api/v1/orders</span></div></section>
<section class="card"><h2>Create Order</h2><form id="order-form"><input id="item" aria-label="Item ID" placeholder="Item ID" required><input id="qty" aria-label="Quantity" type="number" min="1" value="1" required><button>Create Order</button></form><p id="message" role="status" aria-live="polite"></p></section>
<section class="card"><div style="display:flex;justify-content:space-between;gap:1rem;align-items:center"><h2>Recent orders</h2><button id="refresh">Refresh</button></div><table><thead><tr><th>ID</th><th>Item ID</th><th>Quantity</th><th>Created At</th></tr></thead><tbody id="orders"><tr><td colspan="4">Loading...</td></tr></tbody></table></section>
<script>
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function json(path,options){const r=await fetch(path,options);const b=await r.json().catch(()=>({}));if(!r.ok)throw Error(b.message||b.error||('HTTP '+r.status));return b}
async function status(){try{const b=await json('/api/v1/orders/health');$('#api').textContent='Available';$('#api').className='value good';$('#db').textContent=b.database==='connected'?'Connected':'Disconnected';$('#db').className='value '+(b.database==='connected'?'good':'bad')}catch(e){$('#api').textContent='Unavailable';$('#api').className='value bad';$('#db').textContent='Disconnected';$('#db').className='value bad';$('#message').textContent=e.message}}
async function refresh(){try{const rows=await json('/api/v1/orders');$('#orders').innerHTML=rows.length?rows.map(o=>'<tr><td>'+esc(o.id)+'</td><td>'+esc(o.item_id)+'</td><td>'+esc(o.quantity)+'</td><td>'+esc(o.created_at)+'</td></tr>').join(''):'<tr><td colspan="4">No orders yet.</td></tr>'}catch(e){$('#orders').innerHTML='<tr><td colspan="4" class="bad">'+esc(e.message)+'</td></tr>'}}
async function create(item,quantity){$('#message').textContent='Saving...';try{const order=await json('/api/v1/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_id:item,quantity:Number(quantity)})});$('#message').textContent='Created order #'+order.id;await refresh()}catch(e){$('#message').textContent=e.message}}
$('#order-form').addEventListener('submit',e=>{e.preventDefault();create($('#item').value,$('#qty').value)});$('#refresh').addEventListener('click',refresh);Promise.all([status(),refresh()]);
</script></main></body></html>`;
}

function renderDataPage(title, endpoint, heading) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;padding:2rem;background:#0f172a;color:#f8fafc;font:16px system-ui,sans-serif}main{max-width:900px;margin:auto}.card{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:1.5rem}a{color:#7dd3fc}pre{white-space:pre-wrap;overflow:auto;background:#020617;padding:1rem;border-radius:6px}</style></head><body><main><p><a href="/">Home</a> · <a href="/orders">Orders</a> · <a href="/api/v1/catalog">Catalog API</a> · <a href="/api/v1/info">System Info API</a></p><section class="card"><h1>${heading}</h1><pre id="data">Loading...</pre></section><script>fetch('${endpoint}').then(r=>r.json()).then(v=>document.querySelector('#data').textContent=JSON.stringify(v,null,2)).catch(e=>document.querySelector('#data').textContent=e.message)</script></main></body></html>`;
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
    <h1>Order Management</h1>
    <p>Welcome back. Service region: <span class="badge">${region}</span></p>
    <p><a href="/info" style="color:#7dd3fc">System Info</a> · <a href="/catalog" style="color:#7dd3fc">Catalog</a> · <a href="/orders" style="color:#7dd3fc">Orders</a> · <a href="/files" style="color:#7dd3fc">File Storage</a></p>
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

  if (url.pathname === '/orders') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderOrdersPage());
    return;
  }

  if (url.pathname === '/info') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDataPage('System Info', '/api/v1/info', 'System Info'));
    return;
  }

  if (url.pathname === '/catalog') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDataPage('Catalog', '/api/v1/catalog', 'Catalog'));
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
  renderDataPage,
  handleRequest
};
