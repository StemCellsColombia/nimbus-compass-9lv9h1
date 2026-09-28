/* Publicador de la web nueva de Stem Cells Colombia — se ejecuta en Chrome, en una pestaña de https://stemcellscolombia.com/robots.txt
   con la sesión de wp-admin abierta (usa la cookie + nonce de WordPress; no necesita contraseña de aplicación).

   CARGA (una llamada de javascript_tool, standalone):
     await (async()=>{const s=await (await fetch('https://stemcellscolombia.github.io/nimbus-compass-9lv9h1/_wp/publicar_chrome.js?'+Date.now())).text();(0,eval)(s);return SCC.version})()

   USO (cada comando corre en segundo plano; consultar con SCC.estado()):
     SCC.acceso()                              -> usuario, permisos, plugin Redirection            (no escribe)
     SCC.medios({go:false|true})               -> sube las fotos nuevas a la Biblioteca de medios
     SCC.paginas({go:false|true, solo:[...], desde:0, hasta:136})
                                               -> por página: lee el contenido actual, lo RESPALDA (IndexedDB), cambia SOLO lo que hay entre
                                                  <main> y </main>, guarda y comprueba lo guardado. Se detiene en el primer error.
     SCC.redirecciones({go})                   -> los 301 en el plugin Redirection
     SCC.yoast({go})                           -> título SEO y meta descripción
     SCC.estado()                              -> progreso y últimas líneas del registro
     SCC.descargarRespaldos()                  -> baja un .json con TODO lo respaldado (para guardarlo en el computador)
     SCC.restaurar({solo:[...], go})           -> vuelve a poner el contenido respaldado (deshacer)
   Sin go:true nada se escribe (simulación). */
(function () {
  const PKG = 'https://stemcellscolombia.github.io/nimbus-compass-9lv9h1/_wp/';
  const IMG = 'https://stemcellscolombia.github.io/nimbus-compass-9lv9h1/img/';
  const REF_PAGE = 8307, REF_POST = 6311;   // rodilla (shortcode de reseñas y header/footer de referencia) · un post de referencia
  const S = window.SCC = window.SCC || {};
  S.version = '2026-09-28';
  S.log = S.log || [];
  S.busy = false;
  const log = (m) => { S.log.push(new Date().toISOString().slice(11, 19) + ' ' + m); if (S.log.length > 2000) S.log.shift(); };
  S.estado = () => JSON.stringify({ ocupado: S.busy, paso: S.paso || '', hechas: S.hechas || 0, total: S.total || 0, errores: S.errores || 0, ultimas: S.log.slice(-12) });

  let NONCE = null;
  async function nonce() {
    if (!NONCE) NONCE = await (await fetch('/wp-admin/admin-ajax.php?action=rest-nonce', { credentials: 'same-origin' })).text();
    if (!/^[0-9a-f]{10}$/.test(NONCE)) throw new Error('no hay sesión de wp-admin en esta pestaña (nonce inválido)');
    return NONCE;
  }
  async function api(method, path, body, headers) {
    const h = Object.assign({ 'X-WP-Nonce': await nonce() }, headers || {});
    let b = body;
    if (body !== undefined && !(body instanceof Blob) && typeof body !== 'string') { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const r = await fetch('/wp-json' + path, { method, headers: h, body: b, credentials: 'same-origin', cache: 'no-store' });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch (e) { j = t; }
    return { status: r.status, data: j };
  }
  async function pkg(file, asText) {
    const r = await fetch(PKG + file + '?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('no pude bajar ' + file + ' (' + r.status + ')');
    return asText ? r.text() : r.json();
  }
  async function sha256(s) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // ---------------- respaldos en IndexedDB (más espacio que localStorage)
  function db() {
    return new Promise((ok, ko) => { const q = indexedDB.open('scc_respaldos', 1); q.onupgradeneeded = () => q.result.createObjectStore('raw'); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); });
  }
  async function guardar(key, val) { const d = await db(); return new Promise((ok, ko) => { const t = d.transaction('raw', 'readwrite'); t.objectStore('raw').put(val, key); t.oncomplete = ok; t.onerror = () => ko(t.error); }); }
  async function leer(key) { const d = await db(); return new Promise((ok, ko) => { const q = d.transaction('raw').objectStore('raw').get(key); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); }); }
  async function todos() { const d = await db(); return new Promise((ok, ko) => { const out = {}; const q = d.transaction('raw').objectStore('raw').openCursor(); q.onsuccess = () => { const c = q.result; if (c) { out[c.key] = c.value; c.continue(); } else ok(out); }; q.onerror = () => ko(q.error); }); }
  S.descargarRespaldos = async () => {
    const all = await todos(); const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(all)], { type: 'application/json' }));
    a.download = 'scc_respaldos_' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json'; a.click();
    return Object.keys(all).length + ' respaldos';
  };

  function background(name, fn) {
    if (S.busy) return 'ocupado con: ' + S.paso;
    S.busy = true; S.paso = name; S.hechas = 0; S.total = 0; S.errores = 0; log('=== ' + name);
    fn().then(r => { log('=== fin ' + name + (r ? ': ' + r : '')); }).catch(e => { S.errores++; log('ERROR ' + name + ': ' + e.message); }).finally(() => { S.busy = false; });
    return 'corriendo en segundo plano: consultar SCC.estado()';
  }

  // ---------------- acceso
  S.acceso = () => background('acceso', async () => {
    const me = await api('GET', '/wp/v2/users/me?context=edit&_fields=name,roles,capabilities');
    if (me.status !== 200) throw new Error('sin sesión o sin permisos (' + me.status + ')');
    const c = me.data.capabilities || {};
    log('usuario ' + me.data.name + ' · roles ' + me.data.roles);
    for (const k of ['edit_pages', 'edit_published_pages', 'edit_posts', 'edit_published_posts', 'upload_files', 'unfiltered_html']) log('  ' + k + ': ' + (c[k] ? 'sí' : 'NO'));
    if (!c.unfiltered_html) log('OJO: sin unfiltered_html WordPress borra <style>/<script>: usar un administrador');
    const rd = await api('GET', '/redirection/v1/redirect?per_page=1');
    log('plugin Redirection: ' + (rd.status === 200 ? 'sí' : 'no (' + rd.status + ')'));
    const man = await pkg('manifiesto.json'); log('paquete: ' + man.filter(x => x.accion === 'reemplazar_main').length + ' páginas para publicar');
  });

  // ---------------- medios
  function xhrUpload(blob, name, type) {
    return new Promise(async (ok, ko) => {
      const x = new XMLHttpRequest(); x.open('POST', '/wp-json/wp/v2/media');
      x.setRequestHeader('X-WP-Nonce', await nonce()); x.setRequestHeader('Content-Type', type);
      x.setRequestHeader('Content-Disposition', 'attachment; filename="' + name + '"');
      x.onload = () => { try { const j = JSON.parse(x.responseText); x.status === 201 || x.status === 200 ? ok(j) : ko(new Error(x.status + ' ' + (j.message || ''))); } catch (e) { ko(new Error(x.status + ' ' + x.responseText.slice(0, 120))); } };
      x.onerror = () => ko(new Error('red')); x.send(blob);
    });
  }
  async function mapaMedios() {
    const med = await pkg('medios.json'); const out = {};
    for (const m of med) {
      const stem = m.archivo.replace(/\.[^.]+$/, '');
      const r = await api('GET', '/wp/v2/media?search=' + encodeURIComponent(stem) + '&per_page=20&_fields=id,source_url');
      const hit = (Array.isArray(r.data) ? r.data : []).find(f => f.source_url.split('/').pop() === m.archivo);
      if (hit) out[m.archivo] = hit.source_url;
    }
    return { med, out };
  }
  S.medios = (o = {}) => background('medios' + (o.go ? '' : ' (simulación)'), async () => {
    const { med, out } = await mapaMedios(); S.total = med.length;
    for (const m of med) {
      if (out[m.archivo]) { log('ya está   ' + m.archivo); S.hechas++; continue; }
      if (!o.go) { log('SUBIRÍA   ' + m.archivo + ' (' + Math.round(m.bytes / 1024) + ' KB)'); S.hechas++; continue; }
      const blob = await (await fetch(IMG + m.archivo, { cache: 'no-store' })).blob();
      const type = m.archivo.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const j = await xhrUpload(blob, m.archivo, type);
      if (j.source_url.split('/').pop() !== m.archivo) log('OJO: WordPress la renombró: ' + j.source_url);
      log('subida    ' + m.archivo + ' → ' + j.source_url); S.hechas++;
    }
    const again = await mapaMedios(); S.medios_ok = again.out;
    return Object.keys(again.out).length + ' de ' + med.length + ' fotos en WordPress';
  });

  // ---------------- páginas
  const ref = {};
  async function raw(tipo, id) {
    const r = await api('GET', '/wp/v2/' + tipo + 's/' + id + '?context=edit&_fields=content,template,modified,status');
    if (r.status !== 200 || !r.data.content || typeof r.data.content.raw !== 'string') throw new Error('no pude leer ' + tipo + ' ' + id + ' (' + r.status + ')');
    return r.data;
  }
  function split(s) { const mo = s.indexOf('<main'), mc = s.lastIndexOf('</main>'); if (mo < 0 || mc < mo) return null; return [s.slice(0, s.indexOf('>', mo) + 1), s.slice(mc)]; }
  async function armar(x, cur, media) {
    let kx = await pkg(x.archivo, true);
    if (await sha256(kx) !== x.sha256) throw new Error('el archivo del paquete no coincide con el manifiesto');
    let parts = split(cur), note = '';
    if (!parts || parts[0].indexOf('<header') < 0 || parts[1].indexOf('<footer') < 0) {
      const t = x.tipo;
      if (!ref[t]) ref[t] = (await raw(t, t === 'post' ? REF_POST : REF_PAGE)).content.raw;
      parts = split(ref[t]); note = 'header/footer de referencia';
    }
    if (kx.indexOf('<!--SCC-REVIEWS-->') >= 0) {
      if (!ref.page) ref.page = (await raw('page', REF_PAGE)).content.raw;
      const sc = (cur.match(/\[trustindex[^\]]*\]/) || ref.page.match(/\[trustindex[^\]]*\]/) || [''])[0];
      if (!sc) throw new Error('no encuentro el shortcode [trustindex …]');
      kx = kx.split('<!--SCC-REVIEWS-->').join(sc);
    }
    kx = kx.replace(/\{\{IMG:([^}]+)\}\}/g, (m, n) => { if (!media[n]) throw new Error('falta subir la foto ' + n); return media[n]; });
    const nu = parts[0] + '\n' + kx + parts[1];
    for (const t of ['<header', '<footer', '<main', '<div id="kx"']) if (nu.indexOf(t) < 0) throw new Error('el resultado perdió ' + t);
    if (/nimbus-compass|VISTA PREVIA|\{\{IMG:/.test(nu)) throw new Error('el resultado trae restos de la vista previa');
    return { nu, note };
  }
  S.paginas = (o = {}) => background('paginas' + (o.go ? '' : ' (simulación)'), async () => {
    let man = (await pkg('manifiesto.json')).filter(x => x.accion === 'reemplazar_main');
    if (o.solo) man = man.filter(x => o.solo.indexOf(x.ruta) >= 0);
    man = man.slice(o.desde || 0, o.hasta || man.length);
    S.total = man.length;
    let media = S.medios_ok;
    if (!media) media = (await mapaMedios()).out;
    if (!o.go) { const med = await pkg('medios.json'); for (const m of med) if (!media[m.archivo]) media[m.archivo] = '/wp-content/uploads/SIMULADA/' + m.archivo; }
    for (const x of man) {
      const d = await raw(x.tipo, x.id); const cur = d.content.raw;
      let res;
      try { res = await armar(x, cur, media); } catch (e) { S.errores++; log('ERROR ' + x.ruta + ': ' + e.message); throw new Error('me detengo en ' + x.ruta); }
      if (!o.go) { log('lista     ' + x.ruta + '  ' + cur.length + ' → ' + res.nu.length + ' ' + res.note); S.hechas++; continue; }
      const key = x.id + '@' + d.modified;
      if (!(await leer(key))) await guardar(key, { ruta: x.ruta, tipo: x.tipo, id: x.id, template: d.template, modified: d.modified, raw: cur });
      const body = { content: res.nu };
      if (res.note && d.template !== 'elementor_canvas') body.template = 'elementor_canvas';
      const w = await api('POST', '/wp/v2/' + x.tipo + 's/' + x.id, body);
      if (w.status !== 200) { S.errores++; log('ERROR ' + x.ruta + ': WordPress respondió ' + w.status + ' ' + JSON.stringify(w.data).slice(0, 160)); throw new Error('me detengo en ' + x.ruta); }
      const chk = (await raw(x.tipo, x.id)).content.raw;
      if (chk.length !== res.nu.length || chk.indexOf('<div id="kx"') < 0 || chk.indexOf('<footer') < 0) { S.errores++; log('ERROR ' + x.ruta + ': lo guardado no coincide (' + chk.length + ' vs ' + res.nu.length + '). Restaurar con SCC.restaurar({solo:["' + x.ruta + '"],go:true})'); throw new Error('me detengo en ' + x.ruta); }
      log('PUBLICADA ' + x.ruta + ' ' + res.note); S.hechas++;
    }
    return S.hechas + ' de ' + S.total + (o.go ? ' publicadas' : ' listas (simulación)');
  });

  // ---------------- 301
  S.redirecciones = (o = {}) => background('redirecciones' + (o.go ? '' : ' (simulación)'), async () => {
    const red = await pkg('redirecciones.json'); S.total = red.length;
    const cur = await api('GET', '/redirection/v1/redirect?per_page=200&filterBy%5Burl%5D=' + encodeURIComponent('-'));
    const have = new Set(((cur.data && cur.data.items) || []).map(i => i.url.replace(/\/?$/, '/')));
    for (const r of red) {
      if (have.has(r.origen)) { log('ya existe ' + r.origen); S.hechas++; continue; }
      if (!o.go) { log('CREARÍA   ' + r.origen + ' → ' + r.destino); S.hechas++; continue; }
      const w = await api('POST', '/redirection/v1/redirect', { url: r.origen, action_data: { url: r.destino }, action_type: 'url', action_code: 301, match_type: 'url', group_id: 1,
        match_data: { source: { flag_query: 'ignore', flag_case: true, flag_trailing: true } } });
      log((w.status === 200 || w.status === 201 ? 'creada    ' : 'ERROR ' + w.status + ' ') + r.origen + ' → ' + r.destino); S.hechas++;
    }
  });

  // ---------------- Yoast
  S.yoast = (o = {}) => background('yoast' + (o.go ? '' : ' (simulación)'), async () => {
    const man = (await pkg('manifiesto.json')).filter(x => x.accion === 'reemplazar_main' && x.yoast && x.yoast.descripcion);
    S.total = man.length;
    const items = man.map(x => ({ id: x.id, seo_title: x.yoast.titulo, meta_description: x.yoast.descripcion }));
    if (!o.go) { items.slice(0, 5).forEach(i => log('YOAST ' + i.id + ' ' + i.seo_title)); S.hechas = items.length; return items.length + ' en simulación'; }
    for (let k = 0; k < items.length; k += 20) {
      const w = await api('POST', '/yoast/v1/bulk_editor/update_search', { items: items.slice(k, k + 20) });
      log('Yoast ' + (k + 1) + '-' + Math.min(k + 20, items.length) + ': ' + w.status); S.hechas = Math.min(k + 20, items.length);
    }
  });

  // ---------------- deshacer
  S.restaurar = (o = {}) => background('restaurar' + (o.go ? '' : ' (simulación)'), async () => {
    const all = await todos(); const last = {};
    for (const [k, v] of Object.entries(all)) { if (o.solo && o.solo.indexOf(v.ruta) < 0) continue; if (!last[v.id] || v.modified < last[v.id].modified) last[v.id] = v; }   // el más viejo = el original
    S.total = Object.keys(last).length;
    for (const v of Object.values(last)) {
      if (!o.go) { log('RESTAURARÍA ' + v.ruta); S.hechas++; continue; }
      const w = await api('POST', '/wp/v2/' + v.tipo + 's/' + v.id, { content: v.raw, template: v.template || '' });
      log((w.status === 200 ? 'restaurada ' : 'ERROR ' + w.status + ' ') + v.ruta); S.hechas++;
    }
  });
})();
