(() => {
  const token = location.pathname.split('/')[2] || '';
  const $ = (id) => document.getElementById(id);
  const show = (id) => {
    ['state-loading', 'state-error', 'state-photo', 'state-expired'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
    const cw = $('countdown-wrap');
    if (cw) cw.classList.toggle('hidden', id !== 'state-photo');
  };

  // Deterrence saja — BUKAN klaim anti-screenshot.
  // Screenshot diambil OS dari framebuffer di luar jangkauan browser,
  // jadi tidak ada JS yang bisa mencegahnya. Yang bisa dilakukan:
  // persulit (hold-to-view), persempit waktu tayang, dan beri jejak.
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('selectstart', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'u', 'c'].includes(k)) e.preventDefault();
    if (e.key === 'PrintScreen') e.preventDefault();
  });
  window.addEventListener('beforeprint', () => {
    conceal();
    beacon('print_attempt');
  });

  let viewId = null;
  let statusUrl = null;
  let expiresAt = 0;
  let timer = null;
  let objUrl = null;

  function beacon(event) {
    try {
      navigator.sendBeacon(`/v/${token}/event`, new Blob([JSON.stringify({ event, viewId })], { type: 'application/json' }));
    } catch { /* abaikan */ }
  }

  // Laporkan model device via User-Agent Client Hints. Chrome 100+
  // menyembunyikan model di UA ("Android 10; K"), tapi
  // navigator.userAgentData.getHighEntropyValues(['model']) tetap
  // mengembalikannya (mis. "CPH2387" = Oppo). Server menempelkannya
  // ke baris VIEW_OPEN agar tampil di riwayat admin.
  function reportDevice() {
    try {
      if (!viewId) return;
      try {
        if (sessionStorage.getItem('dev_' + viewId)) return;
      } catch {}
      const ua = navigator.userAgentData;
      if (!ua || !ua.getHighEntropyValues) return;
      ua.getHighEntropyValues(['model', 'platform']).then((h) => {
        const model = String((h && h.model) || '').slice(0, 64);
        if (!model) return;
        try {
          sessionStorage.setItem('dev_' + viewId, '1');
        } catch {}
        fetch(`/v/${token}/event`, {
          body: JSON.stringify({ event: 'device_model', model, platform: String((h && h.platform) || '').slice(0, 32), viewId }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }).catch(() => {});
      }).catch(() => {});
    } catch { /* abaikan */ }
  }

  // Lokasi presisi: langsung pakai prompt resmi Chrome, tanpa tulisan custom.
  // Fallback kota/IP tetap tercatat via audit di server.
  // Diminta di awal buka link (sebelum foto siap) — kalau viewId belum ada,
  // koordinat ditampung dulu lalu dikirim begitu sesi view diperoleh.
  let locSent = false;
  let locRequested = false;
  let pendingLoc = null;
  let locFallback = false;
  function sendLocation(lat, lon, accuracy) {
    if (locSent) return;
    if (!viewId) {
      // sesi belum ada — tampung, dikirim setelah boot() dapat viewId
      pendingLoc = { accuracy, lat, lon };
      return;
    }
    locSent = true;
    try {
      sessionStorage.setItem('loc_' + viewId, '1');
    } catch {}
    fetch(`/v/${token}/location`, {
      body: JSON.stringify({ accuracy, lat, lon, viewId }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }).catch(() => {});
  }
  function flushPendingLoc() {
    if (pendingLoc && viewId && !locSent) {
      const p = pendingLoc;
      pendingLoc = null;
      sendLocation(p.lat, p.lon, p.accuracy);
    }
  }
  function requestNativeLocation() {
    if (locRequested || locSent) return;
    if (!navigator.geolocation) return;
    if (viewId) {
      try {
        if (sessionStorage.getItem('loc_' + viewId)) return;
      } catch {}
    }
    locRequested = true;
    // GPS cold start sering >8 detik (terutama di dalam gedung) → pakai 15s.
    // Kalau gagal/timeout (bukan ditolak), coba sekali lagi tanpa high-accuracy
    // (lebih cepat dari WiFi/cell). Setiap kegagalan dicatat ke audit agar
    // admin tahu kenapa koordinat kosong.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        sendLocation(latitude, longitude, accuracy);
      },
      (err) => {
        if (viewId) {
          try {
            sessionStorage.setItem('loc_' + viewId, '1');
          } catch {}
        }
        const denied = err && err.code === err.PERMISSION_DENIED;
        if (!locFallback && !denied) {
          locFallback = true;
          navigator.geolocation.getCurrentPosition(
            (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
            (e2) => beacon('loc_' + (e2 && e2.code === e2.PERMISSION_DENIED ? 'denied' : 'timeout')),
            { enableHighAccuracy: false, maximumAge: 30000, timeout: 10000 },
          );
        } else {
          beacon('loc_' + (denied ? 'denied' : 'timeout'));
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  function ready() {
    // Gambar siap — sembunyikan status loading, tampilkan tombol tahan.
    // (Minta lokasi sudah dilakukan di awal boot, tidak di sini.)
    $('img-status')?.classList.add('hidden');
    const holdEl = $('hold');
    if (holdEl) {
      holdEl.classList.remove('hidden');
      return;
    }
    // Fallback: HTML lama tanpa overlay hold (seharusnya tidak terjadi
    // karena HTML no-store) — tampilkan foto langsung.
    const img = $('photo');
    if (img && objUrl) {
      img.src = objUrl;
      img.classList.remove('hidden');
    }
  }
  function reveal() {
    const img = $('photo');
    if (objUrl && img) {
      img.src = objUrl;
      img.classList.remove('hidden');
      $('hold')?.classList.add('hidden');
    }
  }
  function conceal() {
    const img = $('photo');
    if (img) {
      img.classList.add('hidden');
      img.removeAttribute('src');
    }
    if (!$('state-photo')?.classList.contains('hidden')) {
      $('hold')?.classList.remove('hidden');
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      conceal();
      beacon('hidden');
    }
  });
  document.addEventListener('pagehide', () => beacon('pagehide'));
  window.addEventListener('blur', () => conceal());

  function expire() {
    clearInterval(timer);
    const img = $('photo');
    if (img) {
      img.removeAttribute('src');
      img.remove();
    }
    if (objUrl) {
      URL.revokeObjectURL(objUrl);
      objUrl = null;
    }
    show('state-expired');
    beacon('expired_client');
  }

  function tick() {
    const left = expiresAt - Date.now();
    if (left <= 0) {
      $('countdown').textContent = '0';
      $('countdown-wrap')?.classList.add('danger');
      expire();
      return;
    }
    const s = Math.ceil(left / 1000);
    $('countdown').textContent = String(s);
    $('countdown-wrap')?.classList.toggle('danger', s <= 5);
  }

  async function syncServer() {
    // Sinkronisasi kebenaran server tiap 2 detik; jika server bilang expired → expire.
    if (!statusUrl) return;
    try {
      const r = await fetch(statusUrl, { cache: 'no-store' });
      if (r.status === 410) {
        expire();
        return;
      }
      const j = await r.json();
      if (j.expiresAt) expiresAt = j.expiresAt;
      else if (typeof j.remainingMs === 'number') expiresAt = j.serverNow + j.remainingMs;
    } catch { /* pakai clock lokal */ }
  }

  function bindHold() {
    const btn = $('hold-btn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      reveal();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
      btn.addEventListener(ev, () => conceal()),
    );
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  async function boot() {
    if (!token) {
      show('state-error');
      return;
    }
    // Minta lokasi native langsung di awal — dialog resmi Chrome muncul
    // sebelum foto siap, tanpa menunggu watermark selesai.
    requestNativeLocation();
    let r;
    try {
      r = await fetch(`/v/${token}/open`, { cache: 'no-store', method: 'POST' });
    } catch {
      show('state-error');
      return;
    }
    if (!r.ok) {
      show(r.status === 410 ? 'state-expired' : 'state-error');
      return;
    }
    const j = await r.json();
    viewId = j.viewId;
    statusUrl = j.statusUrl;
    // Kirim lokasi yang sudah didapat duluan (kalau ada)
    flushPendingLoc();
    // Laporkan model device untuk riwayat admin (best-effort)
    reportDevice();
    // Percaya serverNow untuk hindari clock-skew client
    const skew = j.serverNow - Date.now();
    expiresAt = j.expiresAt - skew;
    show('state-photo');
    bindHold();
    tick();
    timer = setInterval(async () => {
      tick();
      await syncServer();
    }, 1000);
    // Muat gambar sebagai blob tanpa cache — jangan tampilkan dulu,
    // tunggu penerima menahan tombol.
    try {
      const img = await fetch(j.imageUrl, { cache: 'no-store' });
      if (img.status === 410) {
        expire();
        return;
      }
      if (!img.ok) {
        show('state-error');
        return;
      }
      const blob = await img.blob();
      objUrl = URL.createObjectURL(blob);
      ready();
    } catch {
      show('state-error');
    }
  }
  boot();
})();
