const $ = (id) => document.getElementById(id);

// Auth via cookie sesi httpOnly (dari POST /api/login).
// fetch same-origin otomatis membawa cookie — tidak ada token di JS.
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { ...(opts.headers || {}) } });
  if (r.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  return r;
}
window.addEventListener('unhandledrejection', (e) => {
  if (String(e.reason?.message || e.reason) === 'unauthorized') e.preventDefault();
});

function showApp() {
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('btn-logout').classList.remove('hidden');
  $('login-err').textContent = '';
  $('token').value = '';
  loadPhotos();
  loadAudit();
}

function showLogin() {
  $('login').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('btn-logout').classList.add('hidden');
}

// Coba sesi yang masih berlaku
api('/api/photos').then((r) => {
  if (r.ok) showApp();
  else showLogin();
}).catch(() => showLogin());

$('btn-login').onclick = async () => {
  const pw = $('token').value;
  if (!pw) return;
  const r = await fetch('/api/login', {
    body: JSON.stringify({ password: pw }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!r.ok) {
    $('login-err').textContent = r.status === 429 ? 'Terlalu sering. Coba lagi nanti.' : 'Password salah.';
    return;
  }
  showApp();
};
$('token').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-login').click();
});
$('btn-logout').onclick = async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch { /* abaikan */ }
  showLogin();
};

document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    ['upload', 'photos', 'audit'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab));
  };
});

$('btn-upload').onclick = () => {
  const f = $('file').files[0];
  if (!f) {
    $('up-status').textContent = 'Pilih file dulu.';
    return;
  }
  const fd = new FormData();
  fd.append('photo', f);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/photos');
  // Cookie sesi otomatis terkirim (same-origin)
  $('prog').classList.remove('hidden');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) $('prog').value = Math.round((e.loaded / e.total) * 100);
  };
  xhr.onload = () => {
    $('prog').classList.add('hidden');
    if (xhr.status === 401) {
      showLogin();
      return;
    }
    if (xhr.status === 201) {
      $('up-status').textContent = 'Upload berhasil.';
      $('file').value = '';
      loadPhotos();
    } else {
      try {
        $('up-status').textContent = 'Gagal: ' + JSON.parse(xhr.responseText).error;
      } catch {
        $('up-status').textContent = 'Upload gagal.';
      }
    }
  };
  xhr.onerror = () => {
    $('up-status').textContent = 'Jaringan gagal.';
  };
  xhr.send(fd);
};

function fmtSize(b) {
  b = Number(b) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

async function loadPhotos() {
  const r = await api('/api/photos');
  const j = await r.json();
  const box = $('photos');
  box.innerHTML = '';
  $('photos-empty').classList.toggle('hidden', j.photos.length > 0);
  const sel = $('s-photo');
  sel.innerHTML = '';
  j.photos.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `${p.filename} (${fmtSize(p.size)})`;
    sel.appendChild(o);
    const d = document.createElement('div');
    d.className = 'pcard';
    const badge = p.guest ? ' · <b>GUEST</b> (auto-hapus)' : '';
    d.innerHTML = `
      <img loading="lazy" src="/api/photos/${p.id}/thumb?w=640"/>
      <div class="meta">${escapeHtml(p.filename)} · ${fmtSize(p.size)} · ${new Date(p.created_at).toLocaleString('id-ID')} · links: ${p.links}${badge}</div>
      <div class="btnrow"><button data-del="${p.id}">Hapus original</button></div>`;
    box.appendChild(d);
  });
  box.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Hapus foto original + semua link-nya?')) return;
      await api('/api/photos/' + b.dataset.del, { method: 'DELETE' });
      loadPhotos();
    };
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('s-wm').onchange = () => $('wm-warn').classList.toggle('hidden', $('s-wm').checked);

$('btn-share').onclick = async () => {
  const body = {
    expiresInSec: $('s-exp').value ? Number($('s-exp').value) : null,
    maxViews: $('s-max').value ? Number($('s-max').value) : null,
    oneTime: $('s-once').checked,
    openDurationSec: Number($('s-open').value),
    photoId: $('s-photo').value,
    watermarkEnabled: $('s-wm').checked,
  };
  const r = await api('/api/shares', { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
  const j = await r.json();
  if (!r.ok) {
    alert('Gagal: ' + (j.error || r.status));
    return;
  }
  const full = j.shortUrl || j.url || (j.shortPath ? location.origin + j.shortPath : location.origin + j.urlPath);
  $('share-out').classList.remove('hidden');
  $('share-link').value = full;
  if (j.warning) alert(j.warning);
};

$('btn-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('share-link').value);
    $('btn-copy').textContent = 'Tersalin ✓';
  } catch {
    $('share-link').select();
    document.execCommand('copy');
  }
};

$('btn-wa').onclick = async () => {
  const url = $('share-link').value;
  if (navigator.share) {
    try {
      await navigator.share({ text: url, title: 'GlympFoto', url });
    } catch { /* batal */ }
  } else {
    location.href = 'https://wa.me/?text=' + encodeURIComponent(url);
  }
};

function fmtLoc(l) {
  const parts = [];
  if (l.lat != null && l.lon != null) {
    const acc = l.accuracy != null ? ` ±${Math.round(l.accuracy)}m` : '';
    parts.push(`<a href="https://maps.google.com/?q=${l.lat},${l.lon}" target="_blank" rel="noopener">📍 ${l.lat.toFixed(4)}, ${l.lon.toFixed(4)}${acc}</a>`);
  }
  if (l.city || l.country) {
    const loc = [l.city, l.country].filter(Boolean).join(', ');
    parts.push(`<span title="${escapeHtml(l.city || '')} ${escapeHtml(l.country || '')}">🏙️ ${escapeHtml(loc)}</span>`);
  }
  if (l.ip) parts.push(`ip: <code>${escapeHtml(l.ip)}</code>`);
  return parts.join(' · ') || 'lokasi: -';
}

// ---- Riwayat: filter, pencarian, sorot sesi, muat lagi ----
const PAGE = 100;
let auditRows = [];
let auditFilter = 'all';
let auditOffset = 0;

const ACTION_LABEL = {
  LOGIN: ['Masuk admin', '🔐'],
  LOGOUT: ['Keluar admin', '🔐'],
  UPLOAD: ['Upload foto', '⬆️'],
  SHARE_CREATE: ['Link dibuat', '🔗'],
  SHARE_REVOKE: ['Link dicabut', '⛔'],
  SHARE_DELETE: ['Link dihapus', '🗑️'],
  PHOTO_DELETE: ['Foto dihapus', '🗑️'],
  VIEW_PAGE: ['Halaman viewer dibuka', '👁️'],
  VIEW_OPEN: ['Foto dibuka (sesi mulai)', '🔓'],
  VIEW_IMAGE: ['Foto dilihat', '🖼️'],
  VIEW_STATUS: ['Cek status sesi', '⏱️'],
  VIEW_EXPIRED: ['Sesi kedaluwarsa', '⏰'],
  VIEW_EVENT: ['Event dari client', '⚡'],
  VIEW_LOCATION: ['Lokasi GPS diterima', '📍'],
  INVALID_TOKEN: ['Token tidak valid', '🚫'],
  DOWNLOAD_ATTEMPT: ['Akses ilegal dicegah', '🛡️'],
  AUDIT_CLEANUP: ['Bersih-bersih log', '🧹'],
};

const GROUPS = {
  view: ['VIEW_PAGE', 'VIEW_OPEN', 'VIEW_IMAGE', 'VIEW_STATUS', 'VIEW_EXPIRED', 'VIEW_EVENT', 'VIEW_LOCATION'],
  sec: ['INVALID_TOKEN', 'DOWNLOAD_ATTEMPT'],
  admin: ['LOGIN', 'LOGOUT', 'UPLOAD', 'SHARE_CREATE', 'SHARE_REVOKE', 'SHARE_DELETE', 'PHOTO_DELETE', 'AUDIT_CLEANUP'],
};

function statusBadge(s) {
  if (s === 'ok') return '<span class="badge ok">berhasil</span>';
  if (s === 'rejected') return '<span class="badge bad">ditolak</span>';
  if (s === 'expired') return '<span class="badge warn">kedaluwarsa</span>';
  if (s === 'error') return '<span class="badge bad">error</span>';
  return `<span class="badge">${escapeHtml(s)}</span>`;
}

// Waktu: jam saja untuk hari ini (mis. 19.42.35), disertai tanggal kalau beda hari.
// Timestamp penuh tetap ada di tooltip saat dihover.
function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('id-ID');
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString())
    return 'kemarin ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return (
    d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  );
}

// Model → merk. Chrome baru menyembunyikan model di UA ("...Android 10; K"),
// model didapat dari Client Hints (kolom device) atau UA WebView lama
// ("...; CPH2387 Build/..."). Kode CPH = Oppo, RMX = realme, dst.
function brandOf(model) {
  const m = String(model || '');
  if (/^CPH/i.test(m)) return 'OPPO';
  if (/^RMX/i.test(m)) return 'realme';
  if (/^V\d{4}|vivo/i.test(m)) return 'vivo';
  if (/^M\d{4}|Redmi|POCO/i.test(m)) return 'Xiaomi';
  if (/^SM-/i.test(m)) return 'Samsung';
  if (/^itel/i.test(m)) return 'itel';
  if (/^Infinix|X\d{3,4}/i.test(m)) return 'Infinix';
  if (/^TECNO|KI\d/i.test(m)) return 'TECNO';
  if (/iPhone/i.test(m)) return 'Apple';
  return '';
}

// Ambil model dari UA WebView lama ("...; <MODEL> Build/..."), null kalau
// UA sudah direduksi ("...; K ...").
function modelFromUa(ua) {
  if (!ua) return '';
  const dev = String(ua).match(/Android[^;]*;\s*([^;]+?)\s+Build/i)?.[1]?.trim();
  if (dev && dev !== 'K' && dev.length <= 40) return dev;
  return '';
}

function deviceOf(l) {
  return l.device || modelFromUa(l.user_agent) || '';
}

function fmtDevice(l) {
  const raw = deviceOf(l);
  if (!raw) return '';
  const brand = brandOf(raw);
  const label = brand ? `${brand} ${raw}` : raw;
  return `<span class="ua" title="${escapeHtml(raw)}">📱 ${escapeHtml(label)}</span>`;
}

// User agent → ringkasan "vivo 1904 · Chrome 152", teks penuh di tooltip
function fmtUa(ua) {
  if (!ua || ua === 'unknown') return '';
  let os = ua.match(/(iPhone|iPad|Android|Windows NT 10|Macintosh|Linux)/i)?.[0]?.replace('Windows NT 10', 'Windows');
  // Nama device Android (mis. "vivo 1904", "RMX3430"); "K" = tidak disebut
  const dev = ua.match(/Android[^;]*;\s*([^;]+?)\s+Build/i)?.[1]?.trim();
  if (dev && dev !== 'K' && dev.length <= 40)
    os = dev.replace(/\b\w/g, (c) => c.toUpperCase());
  const br = ua.match(/(Edg|Edge|OPR|Firefox|SamsungBrowser|Chrome|Safari)[\/ ]([\d]+)/);
  const short = [os, br ? br[1].replace('Edg', 'Edge').replace('OPR', 'Opera') + ' ' + br[2].split('.')[0] : null]
    .filter(Boolean)
    .join(' · ');
  return short ? `<span class="ua" title="${escapeHtml(ua)}">💻 ${escapeHtml(short)}</span>` : '';
}

function filteredRows() {
  const q = ($('audit-q').value || '').trim().toLowerCase();
  let rows = auditRows;
  if (auditFilter === 'loc') rows = rows.filter((r) => r.action === 'VIEW_LOCATION');
  else if (auditFilter !== 'all') rows = rows.filter((r) => GROUPS[auditFilter]?.includes(r.action));
  if (q)
    rows = rows.filter((r) =>
      [r.view_id, r.share_token, r.ip, r.user_agent, r.detail, r.action, r.city, r.country, r.device, deviceOf(r), brandOf(deviceOf(r))]
        .some((v) => String(v || '').toLowerCase().includes(q)),
    );
  return rows;
}

function renderLog(l) {
  const [label, icon] = ACTION_LABEL[l.action] || [l.action, '📋'];
  const vid = l.view_id;
  const loginNote = l.action === 'LOGIN' && l.status === 'rejected' ? ' (password salah)' : '';
  return `<div class="log${vid ? ' clickable' : ''}"${vid ? ` data-vid="${escapeHtml(vid)}"` : ''}>
    <div class="log-head">
      <span class="log-ico">${icon}</span>
      <b>${escapeHtml(label)}${loginNote}</b>
      ${statusBadge(l.status)}
      <span class="log-time" title="${new Date(l.timestamp).toLocaleString('id-ID')}">${fmtTime(l.timestamp)}</span>
    </div>
    <div class="log-meta">
      ${vid ? `sesi <code>${escapeHtml(vid.slice(0, 8))}</code> · ` : ''}
      ${l.share_token ? `token <code>${escapeHtml(l.share_token.slice(0, 10))}</code> · ` : ''}
      ${fmtDevice(l)}
      ${fmtUa(l.user_agent)}
    </div>
    <div class="log-loc">${fmtLoc(l)}</div>
    ${l.detail ? `<div class="log-detail">${escapeHtml(l.detail)}</div>` : ''}
  </div>`;
}

function renderAudit() {
  const rows = filteredRows();
  const box = $('logs');
  box.innerHTML = rows.length
    ? rows.map(renderLog).join('')
    : '<p class="muted" style="padding:4px 12px">Tidak ada catatan untuk filter ini.</p>';
  $('audit-count').textContent = `${rows.length} ditampilkan · ${auditRows.length} dimuat`;
  box.querySelectorAll('[data-vid]').forEach((el) => {
    el.onclick = () => {
      const vid = el.dataset.vid;
      const els = [...box.querySelectorAll(`.log[data-vid="${vid}"]`)];
      const wasHl = els.every((x) => x.classList.contains('hl'));
      box.querySelectorAll('.log.hl').forEach((x) => x.classList.remove('hl'));
      if (!wasHl) els.forEach((x) => x.classList.add('hl'));
    };
  });
}

async function loadAudit(append = false) {
  if (!append) auditOffset = 0;
  const r = await api(`/api/audit?limit=${PAGE}&offset=${auditOffset}`);
  const j = await r.json();
  auditRows = append ? [...auditRows, ...j.logs] : j.logs;
  auditOffset += j.logs.length;
  renderAudit();
  $('btn-more').classList.toggle('hidden', j.logs.length < PAGE);
  const s = await (await api('/api/settings')).json();
  const row = (s.settings || []).find((x) => x.key === 'audit_retention_days');
  if (row) $('ret').value = row.value;
}
$('btn-photos-reload').onclick = () => {
  loadPhotos();
};
$('btn-audit').onclick = () => loadAudit();
$('btn-more').onclick = () => loadAudit(true);
$('audit-q').oninput = renderAudit;
document.querySelectorAll('#audit-pills .pill').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#audit-pills .pill').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    auditFilter = b.dataset.f;
    renderAudit();
  };
});
$('btn-cleanup').onclick = async () => {
  await api('/api/audit/cleanup', { method: 'POST' });
  loadAudit();
};
$('btn-ret').onclick = async () => {
  await api('/api/settings', { body: JSON.stringify({ auditRetentionDays: Number($('ret').value) }), headers: { 'Content-Type': 'application/json' }, method: 'PUT' });
  alert('Retensi tersimpan.');
};
