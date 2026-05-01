// Wishlist Admin Dashboard
// ─────────────────────────────────────────────────────────────────────────────
// Two endpoints in one file:
//   GET /api/admin                           → HTML dashboard (login + UI)
//   GET /api/admin?data=customers&password=… → JSON: customers grouped by phone
//
// Visit: https://your-vercel-app.vercel.app/api/admin
//
// Protected by ADMIN_PASSWORD env var (set in Vercel dashboard).

const SHOPIFY_STORE   = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN   = process.env.SHOPIFY_ACCESS_TOKEN;
const API_SECRET      = process.env.WISHLIST_API_SECRET || '';

// ─── Shopify GraphQL helper ───────────────────────────────────────────────────
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

// ─── Main handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  try {
    // JSON data endpoint
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

    // HTML dashboard
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    return res.status(200).send(renderDashboardHTML());
  } catch (err) {
    console.error('[Admin Error]', err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── Fetch ALL entries and group by phone ─────────────────────────────────────
async function getGroupedCustomers() {
  let allNodes = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await gql(
      `query FetchAll($after: String) {
         metaobjects(type: "wishlist_entry", first: 250, after: $after) {
           nodes {
             id
             fields { key value }
           }
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

  // Convert nodes to flat entries
  const entries = allNodes.map(node => {
    const obj = { id: node.id };
    node.fields.forEach(f => { obj[f.key] = f.value; });
    return obj;
  });

  // Group by phone
  const map = new Map();
  for (const e of entries) {
    const phone = e.phone || 'unknown';
    if (!map.has(phone)) {
      map.set(phone, {
        phone,
        name: '',
        items: [],
        total_value: 0,
        last_added: null,
      });
    }
    const c = map.get(phone);

    // Use the most recent non-empty name we see for this phone
    if (e.customer_name && e.customer_name.trim()) c.name = e.customer_name.trim();

    const price = parseFloat(String(e.product_price || '').replace(/[^\d.]/g, '')) || 0;
    c.total_value += price;

    const addedAt = e.added_at || null;
    if (addedAt && (!c.last_added || addedAt > c.last_added)) {
      c.last_added = addedAt;
    }

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

  // Sort items per customer by date desc
  const customers = Array.from(map.values()).map(c => {
    c.items.sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''));
    return c;
  });

  // Sort customers by item count desc, then by last_added desc
  customers.sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    return (b.last_added || '').localeCompare(a.last_added || '');
  });

  return customers;
}

// ─── Render HTML dashboard ────────────────────────────────────────────────────
function renderDashboardHTML() {
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
    background: #f6f6f4;
    color: #1d1d1b;
    -webkit-font-smoothing: antialiased;
    line-height: 1.45;
  }
  .wrap { max-width: 980px; margin: 0 auto; padding: 28px 20px 80px; }

  /* Login */
  .login-card {
    max-width: 380px; margin: 80px auto; background: #fff; border-radius: 14px;
    padding: 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); border: 1px solid #ebebe7;
  }
  .login-card h1 { margin: 0 0 6px; font-size: 22px; }
  .login-card p { margin: 0 0 22px; color: #6b6b66; font-size: 14px; }
  .login-card input {
    width: 100%; padding: 12px 14px; border: 1px solid #d9d9d4; border-radius: 8px;
    font-size: 15px; outline: none; transition: border-color .15s;
  }
  .login-card input:focus { border-color: #1d1d1b; }
  .login-card button {
    width: 100%; margin-top: 12px; padding: 12px; background: #1d1d1b; color: #fff;
    border: none; border-radius: 8px; font-size: 15px; font-weight: 500; cursor: pointer;
    transition: opacity .15s;
  }
  .login-card button:hover { opacity: .9; }
  .login-card button:disabled { opacity: .5; cursor: not-allowed; }
  .login-error { color: #c0392b; font-size: 13px; margin-top: 10px; min-height: 18px; }

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
  .btn-primary { background: #1d1d1b; color: #fff; border-color: #1d1d1b; }
  .btn-primary:hover { background: #333; }

  /* Stats cards */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat {
    background: #fff; border: 1px solid #ebebe7; border-radius: 12px; padding: 16px 18px;
  }
  .stat-label { font-size: 13px; color: #6b6b66; margin-bottom: 6px; }
  .stat-value { font-size: 26px; font-weight: 600; line-height: 1; }
  @media (max-width: 700px) { .stats { grid-template-columns: repeat(2, 1fr); } }

  /* Search */
  .search-bar {
    width: 100%; padding: 12px 16px; border: 1px solid #ebebe7; border-radius: 12px;
    background: #fff; font-size: 15px; outline: none; margin-bottom: 14px;
    transition: border-color .15s;
  }
  .search-bar:focus { border-color: #1d1d1b; }

  /* Customer list */
  .customers { background: #fff; border: 1px solid #ebebe7; border-radius: 12px; overflow: hidden; }
  .customer { border-bottom: 1px solid #ebebe7; }
  .customer:last-child { border-bottom: none; }
  .customer-head {
    display: flex; align-items: center; gap: 14px; padding: 16px 18px; cursor: pointer;
    transition: background .12s;
  }
  .customer-head:hover { background: #fafaf7; }
  .avatar {
    width: 40px; height: 40px; border-radius: 50%; background: #eef0ff; color: #4a55c1;
    display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px;
    flex-shrink: 0;
  }
  .customer-info { flex: 1; min-width: 0; }
  .customer-name { font-weight: 600; font-size: 15px; margin-bottom: 2px; word-break: break-word; }
  .customer-meta { font-size: 13px; color: #6b6b66; }
  .badge {
    background: #eef0ff; color: #4a55c1; padding: 4px 10px; border-radius: 999px;
    font-size: 13px; font-weight: 600; flex-shrink: 0;
  }
  .chevron {
    width: 20px; height: 20px; color: #6b6b66; flex-shrink: 0;
    transition: transform .2s;
  }
  .customer.is-open .chevron { transform: rotate(90deg); }

  /* Items detail */
  .items {
    display: none; padding: 4px 18px 20px; background: #fafaf7; border-top: 1px solid #ebebe7;
  }
  .customer.is-open .items { display: block; }
  .item {
    display: flex; gap: 14px; align-items: center; padding: 12px 0;
    border-bottom: 1px solid #ebebe7;
  }
  .item:last-child { border-bottom: none; }
  .item-img {
    width: 56px; height: 56px; border-radius: 8px; object-fit: cover; background: #eee; flex-shrink: 0;
  }
  .item-img-placeholder {
    width: 56px; height: 56px; border-radius: 8px; background: #eee; display: flex;
    align-items: center; justify-content: center; flex-shrink: 0; font-size: 20px;
  }
  .item-info { flex: 1; min-width: 0; }
  .item-title { font-size: 14px; font-weight: 500; margin-bottom: 3px; word-break: break-word; }
  .item-meta { font-size: 12px; color: #6b6b66; }
  .item-price { font-weight: 600; font-size: 14px; flex-shrink: 0; }

  .empty { text-align: center; padding: 60px 20px; color: #6b6b66; }
  .loading { text-align: center; padding: 60px 20px; color: #6b6b66; }
  .spinner {
    display: inline-block; width: 28px; height: 28px; border: 3px solid #ebebe7;
    border-top-color: #1d1d1b; border-radius: 50%; animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .toast {
    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%) translateY(20px);
    background: #1d1d1b; color: #fff; padding: 12px 20px; border-radius: 8px;
    font-size: 14px; opacity: 0; pointer-events: none; transition: all .25s;
    box-shadow: 0 4px 16px rgba(0,0,0,.2);
  }
  .toast.is-visible { opacity: 1; transform: translateX(-50%) translateY(0); }
</style>
</head>
<body>
  <!-- Login screen -->
  <div id="login-screen" class="wrap">
    <div class="login-card">
      <h1>Wishlist Admin</h1>
      <p>Enter your wishlist API secret to continue.</p>
      <input id="login-input" type="password" placeholder="API secret" autocomplete="current-password" />
      <button id="login-btn">Sign in</button>
      <div id="login-error" class="login-error"></div>
      <p style="margin-top:18px;font-size:12px;color:#9a9a93;">
        Tip: bookmark <code>/api/admin?secret=YOUR_SECRET</code> to skip this screen.
      </p>
    </div>
  </div>

  <!-- Dashboard -->
  <div id="dashboard" class="wrap" style="display:none;">
    <div class="header">
      <h1>Wishlist customers</h1>
      <div class="header-actions">
        <button class="btn" id="export-btn">Export CSV</button>
        <button class="btn" id="logout-btn">Logout</button>
      </div>
    </div>

    <div class="stats" id="stats"></div>

    <input id="search" class="search-bar" type="text" placeholder="Search by name or phone…" />

    <div id="list-container">
      <div class="loading"><div class="spinner"></div></div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

<script>
(function () {
  const LS_KEY = 'wl_admin_secret';
  let CUSTOMERS = [];
  let CURRENT_SECRET = '';

  // ─── DOM refs ─────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const loginScreen  = $('login-screen');
  const dashboard    = $('dashboard');
  const loginInput   = $('login-input');
  const loginBtn     = $('login-btn');
  const loginError   = $('login-error');
  const statsEl      = $('stats');
  const searchEl     = $('search');
  const listContainer= $('list-container');
  const exportBtn    = $('export-btn');
  const logoutBtn    = $('logout-btn');
  const toastEl      = $('toast');

  // ─── Helpers ──────────────────────────────────────────────
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('is-visible'), 2500);
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return '—'; }
  }

  function formatMoney(n) {
    if (!n || isNaN(n)) return '₹0';
    return '₹' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function initials(name, phone) {
    if (name && name.trim()) {
      const parts = name.trim().split(/\\s+/);
      return ((parts[0]||'')[0] || '' + (parts[1]||'')[0] || '').toUpperCase().substring(0,2) || '?';
    }
    if (phone) return phone.replace(/\\D/g, '').slice(-2);
    return '?';
  }

  // ─── Login ────────────────────────────────────────────────
  async function tryLogin(secret) {
    loginError.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';
    try {
      const res = await fetch('/api/admin?data=customers&secret=' + encodeURIComponent(secret));
      if (res.status === 401) {
        loginError.textContent = 'Incorrect secret.';
        return false;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      CUSTOMERS = data.customers || [];
      CURRENT_SECRET = secret;
      sessionStorage.setItem(LS_KEY, secret);
      loginScreen.style.display = 'none';
      dashboard.style.display = 'block';
      render();
      return true;
    } catch (e) {
      loginError.textContent = 'Could not load. Try again.';
      console.error(e);
      return false;
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign in';
    }
  }

  loginBtn.addEventListener('click', () => {
    const secret = loginInput.value.trim();
    if (!secret) return;
    tryLogin(secret);
  });
  loginInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') loginBtn.click();
  });

  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem(LS_KEY);
    CURRENT_SECRET = '';
    CUSTOMERS = [];
    dashboard.style.display = 'none';
    loginScreen.style.display = 'block';
    loginInput.value = '';
    // Strip ?secret= from URL so refresh doesn't re-login
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  });

  // ─── Render ───────────────────────────────────────────────
  function render() {
    renderStats();
    renderList(CUSTOMERS);
  }

  function renderStats() {
    const totalCustomers = CUSTOMERS.length;
    const totalItems = CUSTOMERS.reduce((s, c) => s + c.items.length, 0);
    const avgItems = totalCustomers ? (totalItems / totalCustomers).toFixed(1) : '0';
    const mostWishlisted = CUSTOMERS.reduce((m, c) => Math.max(m, c.items.length), 0);

    statsEl.innerHTML = \`
      <div class="stat"><div class="stat-label">Customers</div><div class="stat-value">\${totalCustomers}</div></div>
      <div class="stat"><div class="stat-label">Total wishlist items</div><div class="stat-value">\${totalItems}</div></div>
      <div class="stat"><div class="stat-label">Avg items/customer</div><div class="stat-value">\${avgItems}</div></div>
      <div class="stat"><div class="stat-label">Most wishlisted</div><div class="stat-value">\${mostWishlisted}</div></div>
    \`;
  }

  function renderList(list) {
    if (!list.length) {
      listContainer.innerHTML = '<div class="customers"><div class="empty">No customers yet.</div></div>';
      return;
    }

    const html = list.map((c, idx) => {
      const itemsHTML = c.items.map(it => \`
        <div class="item">
          \${it.product_image
            ? \`<img class="item-img" src="\${escapeHTML(ensureHttps(it.product_image))}" alt="" loading="lazy" onerror="this.style.display='none'" />\`
            : \`<div class="item-img-placeholder">🛍️</div>\`}
          <div class="item-info">
            <div class="item-title">\${escapeHTML(it.product_title || 'Untitled product')}</div>
            <div class="item-meta">Added \${formatDate(it.added_at)}</div>
          </div>
          <div class="item-price">\${formatMoney(it.product_price)}</div>
        </div>
      \`).join('');

      const displayName = c.name ? escapeHTML(c.name) : escapeHTML(c.phone);
      const subtitle = c.name
        ? \`\${escapeHTML(c.phone)} · \${c.items.length} item\${c.items.length === 1 ? '' : 's'} · Last added \${formatDate(c.last_added)} · \${formatMoney(c.total_value)}\`
        : \`\${c.items.length} item\${c.items.length === 1 ? '' : 's'} wishlisted · Last added \${formatDate(c.last_added)} · \${formatMoney(c.total_value)}\`;

      return \`
        <div class="customer" data-idx="\${idx}">
          <div class="customer-head">
            <div class="avatar">\${escapeHTML(initials(c.name, c.phone))}</div>
            <div class="customer-info">
              <div class="customer-name">\${displayName}</div>
              <div class="customer-meta">\${subtitle}</div>
            </div>
            <div class="badge">\${c.items.length}</div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
          </div>
          <div class="items">\${itemsHTML}</div>
        </div>
      \`;
    }).join('');

    listContainer.innerHTML = '<div class="customers">' + html + '</div>';

    // Attach expand handlers
    listContainer.querySelectorAll('.customer-head').forEach(head => {
      head.addEventListener('click', () => {
        head.parentElement.classList.toggle('is-open');
      });
    });
  }

  function ensureHttps(url) {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('http')) return url;
    return 'https://' + url;
  }

  // ─── Search ───────────────────────────────────────────────
  searchEl.addEventListener('input', () => {
    const q = searchEl.value.trim().toLowerCase();
    if (!q) { renderList(CUSTOMERS); return; }
    const filtered = CUSTOMERS.filter(c =>
      (c.phone || '').toLowerCase().includes(q) ||
      (c.name || '').toLowerCase().includes(q)
    );
    renderList(filtered);
  });

  // ─── CSV Export ───────────────────────────────────────────
  exportBtn.addEventListener('click', () => {
    if (!CUSTOMERS.length) { showToast('Nothing to export'); return; }

    const rows = [
      ['Name', 'Phone', 'Product Title', 'Product Handle', 'Variant ID', 'Price', 'Added At']
    ];
    CUSTOMERS.forEach(c => {
      c.items.forEach(it => {
        rows.push([
          c.name || '',
          c.phone || '',
          it.product_title || '',
          it.product_handle || '',
          it.variant_id || '',
          it.product_price || '',
          it.added_at || '',
        ]);
      });
    });

    const csv = rows.map(r =>
      r.map(cell => {
        const s = String(cell == null ? '' : cell);
        if (/[",\\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      }).join(',')
    ).join('\\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wishlist-customers-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('CSV downloaded');
  });

  // ─── Boot: prefer ?secret= in URL, then sessionStorage, then show login ───
  function getUrlSecret() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('secret') || '';
    } catch { return ''; }
  }

  const urlSecret = getUrlSecret();
  if (urlSecret) {
    tryLogin(urlSecret);
  } else {
    const savedSecret = sessionStorage.getItem(LS_KEY);
    if (savedSecret) tryLogin(savedSecret);
    else loginInput.focus();
  }
})();
</script>
</body>
</html>`;
}
