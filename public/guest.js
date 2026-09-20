const $ = (id) => document.getElementById(id);

$('btn-send').onclick = () => {
  const f = $('file').files[0];
  if (!f) {
    $('status').textContent = 'Pilih foto dulu.';
    return;
  }
  const fd = new FormData();
  fd.append('photo', f);
  fd.append('openDurationSec', $('s-open').value);
  fd.append('maxViews', $('s-max').value || '5');
  fd.append('oneTime', $('s-once').checked ? '1' : '0');
  fd.append('expiresInSec', $('s-exp').value);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/guest/upload');
  $('prog').classList.remove('hidden');
  $('status').textContent = 'Mengunggah…';
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) $('prog').value = Math.round((e.loaded / e.total) * 100);
  };
  xhr.onload = () => {
    $('prog').classList.add('hidden');
    if (xhr.status === 201) {
      const j = JSON.parse(xhr.responseText);
      $('status').textContent = 'Berhasil.';
      $('out').classList.remove('hidden');
      $('share-link').value = j.shortUrl || j.url || location.origin + (j.shortPath || j.urlPath);
      $('file').value = '';
    } else if (xhr.status === 429) {
      $('status').textContent = 'Terlalu sering. Coba lagi nanti.';
    } else {
      try {
        $('status').textContent = 'Gagal: ' + JSON.parse(xhr.responseText).error;
      } catch {
        $('status').textContent = 'Gagal mengirim.';
      }
    }
  };
  xhr.onerror = () => {
    $('status').textContent = 'Jaringan gagal.';
  };
  xhr.send(fd);
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
$('btn-share').onclick = async () => {
  const url = $('share-link').value;
  if (navigator.share) {
    try {
      await navigator.share({ text: url, title: 'GlympFoto', url });
    } catch { /* batal */ }
  } else {
    location.href = 'https://wa.me/?text=' + encodeURIComponent(url);
  }
};

