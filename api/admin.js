// Wishlist Admin Dashboard — no login screen
// GET /api/admin                           → HTML dashboard (direct, no login)
// GET /api/admin?data=customers&secret=…   → JSON: customers grouped by phone

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_SECRET    = process.env.WISHLIST_API_SECRET || '';

async function gql(query, variables = {}) {
  const res = await fetch(
    `https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  if (!res.ok) throw new Error(`Shopify API error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

module.exports = async function handler(req, res) {
  try {
    if (req.query.data === 'customers') {
      if (!API_SECRET || req.query.secret !== API_SECRET) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const customers = await getGroupedCustomers();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ customers });
    }

    // HTML dashboard — inject secret server-side so no login needed
    const secret = API_SECRET;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com");
    return res.status(200).send(renderDashboardHTML(secret));
  } catch (err) {
    console.error('[Admin Error]', err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function getGroupedCustomers() {
  let allNodes = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await gql(
      `query FetchAll($after: String) {
         metaobjects(type: "wishlist_entry", first: 250, after: $after) {
           nodes { id fields { key value } }
           pageInfo { hasNextPage endCursor }
         }
       }`,
      { after: cursor }
    );
    const { nodes, pageInfo } = data.metaobjects;
    allNodes = allNodes.concat(nodes);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  const entries = allNodes.map(node => {
    const obj = { id: node.id };
    node.fields.forEach(f => { obj[f.key] = f.value; });
    return obj;
  });

  const map = new Map();
  for (const e of entries) {
    const phone = e.phone || 'unknown';
    if (!map.has(phone)) {
      map.set(phone, { phone, name: '', items: [], total_value: 0, last_added: null });
    }
    const c = map.get(phone);
    if (e.customer_name && e.customer_name.trim()) c.name = e.customer_name.trim();
    const price = parseFloat(String(e.product_price || '').replace(/[^\d.]/g, '')) || 0;
    c.total_value += price;
    const addedAt = e.added_at || null;
    if (addedAt && (!c.last_added || addedAt > c.last_added)) c.last_added = addedAt;
    c.items.push({
      id: e.id,
      product_id: e.product_id,
      product_title: e.product_title || '',
      product_handle: e.product_handle || '',
      product_image: e.product_image || '',
      product_price: price,
      variant_id: e.variant_id || '',
      added_at: addedAt,
    });
  }

  const customers = Array.from(map.values()).map(c => {
    c.items.sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''));
    return c;
  });

  customers.sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    return (b.last_added || '').localeCompare(a.last_added || '');
  });

  return customers;
}

function renderDashboardHTML(secret) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Wishlist Customers</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #f6f6f4; color: #1d1d1b; -webkit-font-smoothing: antialiased; line-height: 1.45;
  }
  .wrap { max-width: 980px; margin: 0 auto; padding: 28px 20px 80px; }

  /* Loading */
  .boot-screen {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; background: #f6f6f4; gap: 14px;
  }
  .boot-msg { font-size: 14px; color: #6b6b66; }
  .boot-err { font-size: 14px; color: #c0392b; text-align: center; max-width: 400px; line-height: 1.6; }

  /* Header */
  .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 22px; flex-wrap: wrap; }
  .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
  .header-actions { display: flex; gap: 10px; }
  .btn {
    padding: 9px 16px; border-radius: 8px; border: 1px solid #d9d9d4; background: #fff;
    font-size: 14px; font-weight: 500; cursor: pointer; transition: background .15s;
    color: #1d1d1b; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
  }
  .btn:hover { background: #f0f0ec; }

  /* Stats */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat { background: #fff; border: 1px solid #ebebe7; border-radius: 12px; padding: 16px 18px; }
  .stat-label { font-size: 13px; color: #6b6b66; margin-bottom: 6px; }
  .stat-value { font-size: 26px; font-weight: 600; line-height: 1; }
  @media (max-width: 700px) { .stats { grid-template-columns: repeat(2, 1fr); } }

  /* Search */
  .search-bar {
    width: 100%; padding: 12px 16px; border: 1px solid #ebebe7; border-radius: 12px;
    background: #fff; font-size: 15px; outline: none; margin-bottom: 14px; transition: border-color .15s;
  }
  .search-bar:focus { border-color: #1d1d1b; }

  /* Customer list */
  .customers { background: #fff; border: 1px solid #ebebe7; border-radius: 12px; overflow: hidden; }
  .customer { border-bottom: 1px solid #ebebe7; }
  .customer:last-child { border-bottom: none; }
  .customer-head {
    display: flex; align-items: center; gap: 14px; padding: 16px 18px; cursor: pointer; transition: background .12s;
  }
  .customer-head:hover { background: #fafaf7; }
  .avatar {
    width: 40px; height: 40px; border-radius: 50%; background: #eef0ff; color: #4a55c1;
    display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; flex-shrink: 0;
  }
  .customer-info { flex: 1; min-width: 0; }
  .customer-name { font-weight: 600; font-size: 15px; margin-bottom: 2px; word-break: break-word; }
  .customer-meta { font-size: 13px; color: #6b6b66; }
  .badge {
    background: #eef0ff; color: #4a55c1; padding: 4px 10px; border-radius: 999px;
    font-size: 13px; font-weight: 600; flex-shrink: 0;
  }
  .chevron { width: 20px; height: 20px; color: #6b6b66; flex-shrink: 0; transition: transform .2s; }
  .customer.is-open .chevron { transform: rotate(90deg); }

  .items { display: none; padding: 4px 18px 20px; background: #fafaf7; border-top: 1px solid #ebebe7; }
  .customer.is-open .items { display: block; }
  .item { display: flex; gap: 14px; align-items: center; padding: 12px 0; border-bottom: 1px solid #ebebe7; }
  .item:last-child { border-bottom: none; }
  .item-img { width: 56px; height: 56px; border-radius: 8px; object-fit: cover; background: #eee; flex-shrink: 0; }
  .item-img-ph { width: 56px; height: 56px; border-radius: 8px; background: #eee; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 20px; }
  .item-info { flex: 1; min-width: 0; }
  .item-title { font-size: 14px; font-weight: 500; margin-bottom: 3px; word-break: break-word; }
  .item-meta { font-size: 12px; color: #6b6b66; }
  .item-price { font-weight: 600; font-size: 14px; flex-shrink: 0; }

  .empty { text-align: center; padding: 60px 20px; color: #6b6b66; }
  .spinner {
    display: inline-block; width: 28px; height: 28px; border: 3px solid #ebebe7;
    border-top-color: #1d1d1b; border-radius: 50%; animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .toast {
    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%) translateY(20px);
    background: #1d1d1b; color: #fff; padding: 12px 20px; border-radius: 8px;
    font-size: 14px; opacity: 0; pointer-events: none; transition: all .25s; box-shadow: 0 4px 16px rgba(0,0,0,.2);
  }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
</style>
</head>
<body>

<!-- Boot loading screen -->
<div id="boot" class="boot-screen">
  <div class="spinner"></div>
  <div class="boot-msg">Loading dashboard…</div>
  <div id="boot-err" class="boot-err"></div>
</div>

<!-- Dashboard (hidden until loaded) -->
<div id="app" class="wrap" style="display:none">
  <div class="header">
    <h1>Wishlist customers</h1>
    <div class="header-actions">
      <button class="btn" id="export-btn">⬇ Export CSV</button>
    </div>
  </div>
  <div class="stats" id="stats"></div>
  <input id="search" class="search-bar" type="text" placeholder="Search by name or phone…" />
  <div id="list"></div>
</div>

<div id="toast" class="toast"></div>

<script>
(function() {
  // Secret is injected server-side — no login needed
  const SECRET = ${JSON.stringify(secret)};

  let CUSTOMERS = [];

  function $(id) { return document.getElementById(id); }

  function showToast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(showToast._t); showToast._t = setTimeout(() => t.classList.remove('show'), 2500);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString(undefined, {day:'numeric',month:'short',year:'numeric'}); }
    catch { return '—'; }
  }

  function fmtMoney(n) {
    if (!n || isNaN(n)) return '₹0';
    return '₹' + Number(n).toLocaleString(undefined, {maximumFractionDigits:2});
  }

  function initials(name, phone) {
    if (name && name.trim()) {
      const p = name.trim().split(/\s+/);
      return ((p[0]||'')[0]||'').toUpperCase() + ((p[1]||'')[0]||'').toUpperCase() || '?';
    }
    if (phone) return phone.replace(/\D/g,'').slice(-2);
    return '?';
  }

  function ensureHttps(u) {
    if (!u) return '';
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('http')) return u;
    return 'https://' + u;
  }

  // ── Load data ──
  async function load() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      let res;
      try {
        res = await fetch('/api/admin?data=customers&secret=' + encodeURIComponent(SECRET), {signal: controller.signal});
      } finally { clearTimeout(timer); }

      if (res.status === 401) {
        $('boot-err').textContent = '❌ Unauthorized — check WISHLIST_API_SECRET in Vercel environment variables.';
        $('boot').querySelector('.spinner').style.display = 'none';
        $('boot').querySelector('.boot-msg').style.display = 'none';
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data = await res.json();
      CUSTOMERS = data.customers || [];
      $('boot').style.display = 'none';
      $('app').style.display = 'block';
      renderStats();
      renderList(CUSTOMERS);
    } catch(e) {
      $('boot').querySelector('.spinner').style.display = 'none';
      $('boot').querySelector('.boot-msg').style.display = 'none';
      if (e.name === 'AbortError') {
        $('boot-err').innerHTML = '⏱ Timed out (25s)<br>Check SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN in Vercel.';
      } else {
        $('boot-err').textContent = '❌ ' + e.message;
      }
      console.error('[WL Admin]', e);
    }
  }

  // ── Render stats ──
  function renderStats() {
    const tc = CUSTOMERS.length;
    const ti = CUSTOMERS.reduce((s,c) => s + c.items.length, 0);
    const avg = tc ? (ti/tc).toFixed(1) : '0';
    const top = CUSTOMERS.reduce((m,c) => Math.max(m,c.items.length), 0);
    $('stats').innerHTML =
      '<div class="stat"><div class="stat-label">Customers</div><div class="stat-value">' + tc + '</div></div>' +
      '<div class="stat"><div class="stat-label">Total items</div><div class="stat-value">' + ti + '</div></div>' +
      '<div class="stat"><div class="stat-label">Avg items/customer</div><div class="stat-value">' + avg + '</div></div>' +
      '<div class="stat"><div class="stat-label">Most wishlisted</div><div class="stat-value">' + top + '</div></div>';
  }

  // ── Render list ──
  function renderList(list) {
    if (!list.length) {
      $('list').innerHTML = '<div class="customers"><div class="empty">No customers yet.</div></div>';
      return;
    }
    const html = list.map((c, idx) => {
      const itemsHTML = c.items.map(it =>
        '<div class="item">' +
          (it.product_image
            ? '<img class="item-img" src="' + esc(ensureHttps(it.product_image)) + '" loading="lazy" alt="" onerror="this.style.display=\'none\'" />'
            : '<div class="item-img-ph">🛍️</div>') +
          '<div class="item-info">' +
            '<div class="item-title">' + esc(it.product_title || 'Untitled product') + '</div>' +
            '<div class="item-meta">Added ' + fmtDate(it.added_at) + '</div>' +
          '</div>' +
          '<div class="item-price">' + fmtMoney(it.product_price) + '</div>' +
        '</div>'
      ).join('');

      const displayName = c.name ? esc(c.name) : esc(c.phone);
      const subtitle = c.name
        ? esc(c.phone) + ' · ' + c.items.length + ' item' + (c.items.length===1?'':'s') + ' · Last added ' + fmtDate(c.last_added) + ' · ' + fmtMoney(c.total_value)
        : c.items.length + ' item' + (c.items.length===1?'':'s') + ' · Last added ' + fmtDate(c.last_added) + ' · ' + fmtMoney(c.total_value);

      return '<div class="customer" data-idx="' + idx + '">' +
        '<div class="customer-head">' +
          '<div class="avatar">' + esc(initials(c.name, c.phone)) + '</div>' +
          '<div class="customer-info">' +
            '<div class="customer-name">' + displayName + '</div>' +
            '<div class="customer-meta">' + subtitle + '</div>' +
          '</div>' +
          '<div class="badge">' + c.items.length + '</div>' +
          '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>' +
        '</div>' +
        '<div class="items">' + itemsHTML + '</div>' +
      '</div>';
    }).join('');

    $('list').innerHTML = '<div class="customers">' + html + '</div>';
    $('list').querySelectorAll('.customer-head').forEach(h => {
      h.addEventListener('click', () => h.parentElement.classList.toggle('is-open'));
    });
  }

  // ── Search ──
  $('search').addEventListener('input', function() {
    const q = this.value.trim().toLowerCase();
    renderList(q ? CUSTOMERS.filter(c =>
      (c.phone||'').toLowerCase().includes(q) || (c.name||'').toLowerCase().includes(q)
    ) : CUSTOMERS);
  });

  // ── Export CSV ──
  $('export-btn').addEventListener('click', function() {
    if (!CUSTOMERS.length) { showToast('Nothing to export'); return; }
    const rows = [['Name','Phone','Product Title','Product Handle','Variant ID','Price','Added At']];
    CUSTOMERS.forEach(c => c.items.forEach(it =>
      rows.push([c.name||'', c.phone||'', it.product_title||'', it.product_handle||'', it.variant_id||'', it.product_price||'', it.added_at||''])
    ));
    const csv = rows.map(r => r.map(cell => {
      const s = String(cell == null ? '' : cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
    }).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'}));
    a.download = 'wishlist-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast('CSV downloaded ✓');
  });

  // ── Boot ──
  load();
})();
</script>
</body>
</html>`;
}
