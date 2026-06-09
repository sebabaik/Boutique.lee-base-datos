// ── Estado global ──────────────────────────────────────
    let allPrendas      = [];
    let allVentas       = [];
    let editingId       = null;
    let talleCount      = 0;
    let scannerStream   = null;
    let scannerInterval = null;
    let ventaArt        = null;
    let elimArt         = null;
    let _chartVentas    = null;  // instancia del gráfico Chart.js

    // ── Utilidades ────────────────────────────────────────

    function fmtPeso(n) {
      return '$' + Number(n).toLocaleString('es-AR');
    }

    function calcEf(precio) {
      return Math.ceil(precio * 0.9 / 500) * 500;
    }

    function stockTotal(talles) {
      return Object.values(talles || {}).reduce((acc, v) => acc + (parseInt(v.stock) || 0), 0);
    }

    function stockClass(n) {
      if (n === 0) return 'zero';
      if (n === 1) return 'low';
      return 'ok';
    }

    function badgeClass(n) {
      if (n === 0) return 'badge-zero';
      if (n === 1) return 'badge-low';
      return 'badge-ok';
    }

    /** Formatea una fecha JS como "DD/MM/AAAA HH:MM" */
    function fmtFecha(date) {
      const d = new Date(date);
      return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    }

    /** Formatea una fecha JS como "AAAA-MM-DD" para agrupar por día */
    function fmtDia(date) {
      const d = new Date(date);
      return d.toISOString().slice(0, 10);
    }

    const TALLE_ORDER = ['XXS','XS','S','M','L','XL','XXL','XXXL'];
    function sortTalles(tallesObj) {
      return Object.entries(tallesObj).sort(([a], [b]) => {
        const ia = TALLE_ORDER.indexOf(a.toUpperCase());
        const ib = TALLE_ORDER.indexOf(b.toUpperCase());
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        const na = parseFloat(a), nb = parseFloat(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
      });
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[ch]));
    }

    function ventaDate(v) {
      const ts = v.fecha?.toMillis ? v.fecha.toMillis() : (v.fecha || 0);
      return new Date(ts);
    }

    function diaLocal(date) {
      const d = new Date(date);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    function deduplicarPrendas(prendas) {
      const mapa = new Map();
      prendas.forEach(p => {
        const colorKey = (p.color || '').trim();
        if (!mapa.has(p.art)) mapa.set(p.art, { id: p.art, art: p.art, modelo: p.modelo, colores: new Map() });
        const entrada = mapa.get(p.art);
        if (!entrada.colores.has(colorKey)) {
          entrada.colores.set(colorKey, { nombre: colorKey, talles: { ...p.talles }, ids: [p.id] });
        } else {
          const ec = entrada.colores.get(colorKey);
          ec.ids.push(p.id);
          Object.entries(p.talles || {}).forEach(([talle, val]) => {
            if (ec.talles[talle]) ec.talles[talle] = { ...ec.talles[talle], stock: (parseInt(ec.talles[talle].stock)||0) + (parseInt(val.stock)||0) };
            else ec.talles[talle] = { ...val };
          });
        }
      });
      return [...mapa.values()].map(p => {
        const colores = [...p.colores.values()];
        const tallesTotales = {};
        colores.forEach(c => {
          Object.entries(c.talles || {}).forEach(([talle, val]) => {
            if (tallesTotales[talle]) tallesTotales[talle] = { ...tallesTotales[talle], stock: (parseInt(tallesTotales[talle].stock)||0) + (parseInt(val.stock)||0) };
            else tallesTotales[talle] = { ...val };
          });
        });
        return { ...p, colores, talles: tallesTotales };
      });
    }

    // ── Toast ─────────────────────────────────────────────
    let _toastTimer = null;
    function showToast(msg, onUndo, duration = 5000) {
      if (_toastTimer) clearTimeout(_toastTimer);
      const el      = document.getElementById('toast');
      const msgEl   = document.getElementById('toast-msg');
      const undoBtn = document.getElementById('toast-undo-btn');
      const progEl  = document.getElementById('toast-progress');
      msgEl.textContent = msg;
      if (typeof onUndo === 'function') { undoBtn.style.display = ''; undoBtn._handler = onUndo; }
      else                              { undoBtn.style.display = 'none'; undoBtn._handler = null; }
      progEl.classList.remove('running');
      progEl.style.transform = 'scaleX(1)';
      el.classList.add('show');
      void progEl.offsetWidth;
      progEl.style.transitionDuration = duration + 'ms';
      progEl.classList.add('running');
      _toastTimer = setTimeout(() => { el.classList.remove('show'); progEl.classList.remove('running'); }, duration);
    }

    // ── Navegación ────────────────────────────────────────
    function showView(name, el) {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('view-' + name).classList.add('active');
      el.classList.add('active');
      if (name === 'qr')       renderQR();
      if (name === 'historial') renderHistorial();
      if (name === 'asistente') renderAsistente();
      if (name !== 'scanner')  stopScanner();
    }
    window.showView = showView;

    // ── Stock ─────────────────────────────────────────────
    async function loadStock() {
      try {
        const q    = window._q(window._col(window._db, 'prendas'), window._ord('art'));
        const snap = await window._get(q);
        allPrendas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        buildCatFilter();
        renderStock();
      } catch (e) {
        document.getElementById('stock-tbody').innerHTML =
          '<tr><td colspan="9" class="loading" style="color:#e05252">Error al cargar. Verificá la conexión a Firebase.</td></tr>';
      }
    }
    window.loadStock = loadStock;

    function buildCatFilter() {
      const cats = [...new Set(allPrendas.map(p => p.art.split('-')[0]))].sort();
      const sel  = document.getElementById('filtCat');
      sel.innerHTML = '<option value="">Todas las categorías</option>';
      cats.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = 'ART ' + c; sel.appendChild(o); });
    }

    function filterStock() {
      const q   = document.getElementById('search').value.toLowerCase();
      const cat = document.getElementById('filtCat').value;
      const st  = document.getElementById('filtStockStatus').value;
      const filtered = allPrendas.filter(p => {
        const total  = stockTotal(p.talles);
        const matchQ = !q  || p.art.toLowerCase().includes(q) || p.modelo.toLowerCase().includes(q) || p.color.toLowerCase().includes(q);
        const matchC = !cat || p.art.startsWith(cat);
        const matchS = !st || (st==='ok'&&total>1) || (st==='low'&&total===1) || (st==='zero'&&total===0);
        return matchQ && matchC && matchS;
      });
      renderStock(filtered);
    }
    window.filterStock = filterStock;

    function renderStock(prendas) {
      const list  = deduplicarPrendas(prendas || allPrendas);
      const tbody = document.getElementById('stock-tbody');
      if (!list.length) { tbody.innerHTML = '<tr><td colspan="9"><div class="empty"><p>No hay prendas. Agregá la primera con "+ Nueva prenda".</p></div></td></tr>'; return; }
      tbody.innerHTML = list.map(p => {
        const rowId      = 'row-' + p.art.replace(/[^a-zA-Z0-9]/g, '_');
        const total      = stockTotal(p.talles);
        const soloUnColor = p.colores.length === 1;
        const colorChips = p.colores.map((c, idx) => {
          const ac = soloUnColor ? 'solo' : (idx === 0 ? 'active' : '');
          return `<span class="color-chip ${ac}" onclick="event.stopPropagation();selectColor('${rowId}',${idx})" data-cidx="${idx}">${c.nombre}</span>`;
        }).join('');
        const colorActivo = p.colores[0];
        const tChips = sortTalles(colorActivo.talles || {}).filter(([,v])=>parseInt(v.stock)>0).map(([t])=>`<span class="talle-chip">${t}</span>`).join('') || '<span style="color:var(--text3);font-size:11px">sin stock</span>';
        const editId0 = p.colores[0].ids[0];
        return `
          <tr onclick="toggleDetail('${rowId}')">
            <td><button class="expand-btn" id="exp-${rowId}">▸</button></td>
            <td><span class="art-code">${p.art}</span></td>
            <td class="modelo-name">${p.modelo}</td>
            <td id="clr-${rowId}">${colorChips}</td>
            <td id="tch-${rowId}">${tChips}</td>
            <td><span class="badge ${badgeClass(total)}">${total}</span></td>
            <td><button class="btn btn-ghost btn-sm" id="edt-${rowId}" onclick="event.stopPropagation();editPrenda('${editId0}')">Editar</button></td>
            <td><button class="btn btn-vender btn-sm" onclick="event.stopPropagation();openVentaModal('${p.art}')">Vender</button></td>
            <td><button class="btn btn-eliminar btn-sm" onclick="event.stopPropagation();openEliminarModal('${p.art}')">Eliminar</button></td>
          </tr>
          <tr id="detail-${rowId}" style="display:none" class="detail-row">
            <td colspan="9"><div class="detail-inner" id="det-inner-${rowId}"></div></td>
          </tr>`;
      }).join('');
      window._renderedList = list;
    }

    function buildDetalleHtml(p, cidx) {
      const color = p.colores[cidx];
      const cards = sortTalles(color.talles || {}).map(([t, v]) => {
        const s  = parseInt(v.stock) || 0;
        const pr = parseFloat(v.precio) || 0;
        const ef = pr > 0 ? calcEf(pr) : 0;
        const sc = stockClass(s);
        const preciosHtml = pr > 0
          ? `<div class="precios">Lista: ${fmtPeso(pr)}<br><span class="ef">Efectivo: ${fmtPeso(ef)}</span></div>`
          : `<div class="precios" style="color:var(--text3)">sin precio</div>`;
        return `<div class="detail-card ${sc}"><div class="tl">Talle ${t}</div><div class="val">${s} unid.</div>${preciosHtml}</div>`;
      }).join('');
      const label = p.colores.length > 1 ? `Detalle por talle — ${p.modelo} · <strong>${color.nombre}</strong>` : `Detalle por talle — ${p.modelo} · ${color.nombre}`;
      return `<div class="detail-color-label">${label}</div><div class="detail-grid">${cards}</div>`;
    }

    function selectColor(rowId, cidx) {
      const p = (window._renderedList || []).find(x => 'row-' + x.art.replace(/[^a-zA-Z0-9]/g, '_') === rowId);
      if (!p) return;
      document.querySelectorAll(`#clr-${rowId} .color-chip`).forEach((el, i) => el.classList.toggle('active', i === cidx));
      const color = p.colores[cidx];
      const tChips = sortTalles(color.talles || {}).filter(([,v])=>parseInt(v.stock)>0).map(([t])=>`<span class="talle-chip">${t}</span>`).join('') || '<span style="color:var(--text3);font-size:11px">sin stock</span>';
      document.getElementById('tch-' + rowId).innerHTML = tChips;
      const editBtn = document.getElementById('edt-' + rowId);
      if (editBtn) editBtn.onclick = (e) => { e.stopPropagation(); editPrenda(color.ids[0]); };
      const detRow = document.getElementById('detail-' + rowId);
      if (detRow && detRow.style.display !== 'none') document.getElementById('det-inner-' + rowId).innerHTML = buildDetalleHtml(p, cidx);
    }
    window.selectColor = selectColor;

    function toggleDetail(rowId) {
      const row = document.getElementById('detail-' + rowId);
      const btn = document.getElementById('exp-'    + rowId);
      const isHidden = row.style.display === 'none';
      if (isHidden) {
        const p = (window._renderedList || []).find(x => 'row-' + x.art.replace(/[^a-zA-Z0-9]/g, '_') === rowId);
        if (p) {
          let cidx = 0;
          document.querySelectorAll(`#clr-${rowId} .color-chip`).forEach((el, i) => { if (el.classList.contains('active')) cidx = i; });
          document.getElementById('det-inner-' + rowId).innerHTML = buildDetalleHtml(p, cidx);
        }
      }
      row.style.display = isHidden ? '' : 'none';
      btn.textContent   = isHidden ? '▾' : '▸';
    }
    window.toggleDetail = toggleDetail;

    // ── Modal nueva/editar prenda ─────────────────────────
    const COLORES_PRESET = ['Blanco','Negro','Gris','Beige','Crema','Rosa','Rojo','Bordó','Naranja','Amarillo','Celeste','Azul','Marino','Verde','Lila','Violeta','Estampado'];
    const TALLES_PRESET  = ['S','M','L','XL','XXL','XXXL','2','3','4','5','6','7','8','9','10','11','12'];

    let _coloresDisp = [...COLORES_PRESET];
    let _coloresSel  = new Set();
    let _tallesDisp  = [...TALLES_PRESET];
    let _tallesSel   = new Set();

    function renderColorChips() {
      document.getElementById('color-chips-wrap').innerHTML = _coloresDisp.map(c => {
        const sel = _coloresSel.has(c);
        const isCustom = !COLORES_PRESET.includes(c);
        return `<span class="sel-chip ${sel?'selected':''}" onclick="toggleColorSel('${c}')">${c}${isCustom?`<span class="chip-remove" onclick="event.stopPropagation();quitarColorCustom('${c}')">×</span>`:''}</span>`;
      }).join('');
      document.getElementById('colores-seleccionados-hint').textContent = _coloresSel.size > 0 ? `Seleccionados: ${[..._coloresSel].join(', ')}` : 'Ningún color seleccionado';
    }

    function renderTalleChips() {
      document.getElementById('talle-chips-wrap').innerHTML = _tallesDisp.map(t => {
        const sel = _tallesSel.has(t);
        const isCustom = !TALLES_PRESET.includes(t);
        return `<span class="sel-chip ${sel?'selected':''}" onclick="toggleTalleSel('${t}')">${t}${isCustom?`<span class="chip-remove" onclick="event.stopPropagation();quitarTalleCustom('${t}')">×</span>`:''}</span>`;
      }).join('');
      sincronizarTallesContainer();
    }

    function toggleColorSel(c) { _coloresSel.has(c) ? _coloresSel.delete(c) : _coloresSel.add(c); renderColorChips(); }
    window.toggleColorSel = toggleColorSel;
    function toggleTalleSel(t) { _tallesSel.has(t) ? _tallesSel.delete(t) : _tallesSel.add(t); renderTalleChips(); }
    window.toggleTalleSel = toggleTalleSel;

    function agregarColorCustom() {
      const inp = document.getElementById('f-color-custom');
      const val = inp.value.trim();
      if (!val) return;
      const norm = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
      if (!_coloresDisp.includes(norm)) _coloresDisp.push(norm);
      _coloresSel.add(norm);
      inp.value = '';
      renderColorChips();
    }
    window.agregarColorCustom = agregarColorCustom;

    function quitarColorCustom(c) { _coloresDisp = _coloresDisp.filter(x => x !== c); _coloresSel.delete(c); renderColorChips(); }
    window.quitarColorCustom = quitarColorCustom;

    function agregarTalleCustom() {
      const inp = document.getElementById('f-talle-custom');
      const val = inp.value.trim().toUpperCase();
      if (!val) return;
      if (!_tallesDisp.includes(val)) _tallesDisp.push(val);
      _tallesSel.add(val);
      inp.value = '';
      renderTalleChips();
    }
    window.agregarTalleCustom = agregarTalleCustom;

    function quitarTalleCustom(t) { _tallesDisp = _tallesDisp.filter(x => x !== t); _tallesSel.delete(t); renderTalleChips(); }
    window.quitarTalleCustom = quitarTalleCustom;

    function sincronizarTallesContainer() {
      const container = document.getElementById('talles-container');
      const existentes = new Map();
      container.querySelectorAll('.talle-row').forEach(row => existentes.set(row.dataset.talle, row));
      sortTalles(Object.fromEntries([..._tallesSel].map(t => [t, {}]))).forEach(([t]) => {
        if (!existentes.has(t)) container.appendChild(crearFilaTalle(t));
        else existentes.get(t).style.display = '';
      });
      existentes.forEach((row, t) => { if (!_tallesSel.has(t)) row.style.display = 'none'; });
      sortTalles(Object.fromEntries([..._tallesSel].map(t => [t, {}]))).map(([t]) => t).forEach(t => {
        const row = container.querySelector(`[data-talle="${t}"]`);
        if (row) container.appendChild(row);
      });
    }

    function crearFilaTalle(talle, stock = '', precio = '') {
  talleCount++;
  const div = document.createElement('div');
  div.className = 'talle-row'; div.dataset.talle = talle; div.id = 'tr-' + talleCount;
  div.innerHTML = `
    <div><label>Talle</label><input type="text" class="t-nombre" value="${talle}" readonly style="background:var(--bg3);color:var(--text2);cursor:default;font-weight:600"/></div>
    <div><label>Stock</label><input type="number" class="t-stock" placeholder="0" min="0" value="${stock}"/></div>
    <div>
      <label>Precio lista ($)</label>
      <input type="number" class="t-precio" placeholder="19000" value="${precio}" oninput="updateEfPreview(this,${talleCount})"/>
      <div class="ef-prev" id="ef-${talleCount}">${precio?'Efectivo: '+fmtPeso(calcEf(parseFloat(precio))):''}</div>
    </div>
    <span style="width:24px"></span>`;

  // Navegación con flechas entre casillas
  div.querySelectorAll('input').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();

      // Todos los inputs editables del container (excluye los readonly de talle)
      const allInputs = [...document.querySelectorAll('#talles-container .talle-row:not([style*="display: none"]) input:not([readonly])')];
      const idx = allInputs.indexOf(e.target);
      if (idx === -1) return;

      // ArrowDown → siguiente, ArrowUp → anterior
      const next = allInputs[e.key === 'ArrowDown' ? idx + 1 : idx - 1];
      if (next) next.focus();
    });
  });

  return div;
}

    function openModal() {
      editingId = null;
      document.getElementById('modal-title').textContent = 'Nueva prenda';
      ['f-art','f-modelo','f-color-custom','f-talle-custom'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('talles-container').innerHTML = '';
      document.getElementById('modal-color-hint').style.display = 'none';
      talleCount = 0; _coloresDisp = [...COLORES_PRESET]; _coloresSel = new Set(); _tallesDisp = [...TALLES_PRESET]; _tallesSel = new Set();
      renderColorChips(); renderTalleChips();
      document.getElementById('modal').classList.add('open');
    }
    window.openModal = openModal;

    function editPrenda(id) {
      const p = allPrendas.find(x => x.id === id); if (!p) return;
      editingId = id;
      document.getElementById('modal-title').textContent = `Editar — ${p.modelo}`;
      document.getElementById('f-art').value    = p.art;
      document.getElementById('f-modelo').value = p.modelo;
      ['f-color-custom','f-talle-custom'].forEach(i => document.getElementById(i).value = '');
      document.getElementById('talles-container').innerHTML = '';
      talleCount = 0;
      _coloresDisp = [...new Set([...COLORES_PRESET, p.color])]; _coloresSel = new Set([p.color]);
      const tallesExistentes = Object.keys(p.talles || {});
      _tallesDisp = [...new Set([...TALLES_PRESET, ...tallesExistentes])]; _tallesSel = new Set(tallesExistentes);
      renderColorChips(); renderTalleChips();
      Object.entries(p.talles || {}).forEach(([t, v]) => {
        const row = document.querySelector(`#talles-container [data-talle="${t}"]`);
        if (row) { row.querySelector('.t-stock').value = v.stock ?? ''; const pi = row.querySelector('.t-precio'); pi.value = v.precio ?? ''; updateEfPreview(pi, parseInt(row.id.replace('tr-',''),10)); }
      });
      const hint = document.getElementById('modal-color-hint');
      const otros = allPrendas.filter(x => x.art === p.art && x.id !== p.id).map(x => x.color);
      hint.style.display = otros.length > 0 ? '' : 'none';
      if (otros.length > 0) hint.innerHTML = `Editando solo el color <strong>${p.color}</strong>. Otros colores (${otros.join(', ')}) no se modificarán.`;
      document.getElementById('modal').classList.add('open');
    }
    window.editPrenda = editPrenda;

    function closeModal() { document.getElementById('modal').classList.remove('open'); }
    window.closeModal = closeModal;

    function updateEfPreview(input, idx) {
      const p = parseFloat(input.value);
      const el = document.getElementById('ef-' + idx);
      if (el) el.textContent = p > 0 ? 'Efectivo: ' + fmtPeso(calcEf(p)) : '';
    }
    window.updateEfPreview = updateEfPreview;

    async function guardarPrenda() {
      const art    = document.getElementById('f-art').value.trim();
      const modelo = document.getElementById('f-modelo').value.trim();
      if (!art || !modelo)          { showToast('Completá artículo y nombre del modelo'); return; }
      if (_coloresSel.size === 0)   { showToast('Seleccioná al menos un color'); return; }
      if (_tallesSel.size  === 0)   { showToast('Seleccioná al menos un talle'); return; }
      const talles = {};
      let precioFaltante = false;
      document.querySelectorAll('#talles-container .talle-row').forEach(row => {
        if (row.style.display === 'none') return;
        const nombre = row.dataset.talle;
        const stock  = parseInt(row.querySelector('.t-stock').value) || 0;
        const precio = parseFloat(row.querySelector('.t-precio').value) || 0;
        if (nombre) { if (!precio) precioFaltante = true; talles[nombre] = { stock, precio }; }
      });
      if (precioFaltante)              { showToast('Ingresá el precio de lista para cada talle'); return; }
      if (!Object.keys(talles).length) { showToast('Agregá al menos un talle'); return; }
      try {
        if (editingId) {
          const color = [..._coloresSel][0];
          await window._upd(window._doc(window._db, 'prendas', editingId), { art, modelo, color, talles });
          showToast('Prenda actualizada');
        } else {
          for (const color of _coloresSel) await window._add(window._col(window._db, 'prendas'), { art, modelo, color, talles });
          showToast(`Prenda guardada en ${_coloresSel.size} color${_coloresSel.size > 1 ? 'es' : ''}`);
        }
        closeModal(); loadStock();
      } catch (e) { showToast('Error al guardar. Revisá la conexión.'); }
    }
    window.guardarPrenda = guardarPrenda;

    // ── Scanner ───────────────────────────────────────────
    function startScanner() {
  const video = document.getElementById('scanner-video');
  const ph    = document.getElementById('scanner-ph');

  navigator.mediaDevices.getUserMedia({ 
    video: { 
      facingMode: 'environment',
      width:  { ideal: 1280 },
      height: { ideal: 720 }
    } 
  })
  .then(stream => {
    scannerStream = stream;
    video.srcObject = stream;
    video.style.display = 'block';
    ph.style.display = 'none';

    // Canvas persistente — se crea una sola vez y se reutiliza
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d', { willReadFrequently: true });

    video.addEventListener('loadedmetadata', () => {
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
    });

    scannerInterval = setInterval(() => {
      // Esperar que el video tenga datos Y dimensiones válidas
      if (video.readyState < video.HAVE_ENOUGH_DATA) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      // Re-sincronizar si el tamaño cambió (rotación de pantalla)
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'   // más rápido; cambiá a 'attemptBoth' si hay QRs invertidos
      });

      if (code) {
        stopScanner();
        searchByCode(code.data);
      }
    }, 200); // 200ms es más responsivo que 300ms
  })
  .catch(err => {
    console.error('Camera error:', err);
    showToast('No se pudo acceder a la cámara. Verificá los permisos.');
  });
}
window.startScanner = startScanner;

    function stopScanner() {
      if (scannerStream)   { scannerStream.getTracks().forEach(t => t.stop()); scannerStream = null; }
      if (scannerInterval) { clearInterval(scannerInterval); scannerInterval = null; }
      document.getElementById('scanner-video').style.display = 'none';
      document.getElementById('scanner-ph').style.display    = 'flex';
    }

    function buildScanTalles(talles) {
      const con = sortTalles(talles || {}).filter(([,v]) => parseInt(v.stock) > 0);
      if (!con.length) return '<p style="color:var(--text3);font-size:12px;text-align:center;padding:8px 0">Sin stock en este color</p>';
      return con.map(([t, v]) => {
        const s = parseInt(v.stock) || 0, pr = parseFloat(v.precio) || 0, ef = pr > 0 ? calcEf(pr) : 0;
        return `<div class="scan-talle"><div class="st-t">Talle ${t}</div><div class="st-s">${s}</div>${pr>0?`<div class="st-p">Lista: ${fmtPeso(pr)}</div><div class="st-ef">Ef: ${fmtPeso(ef)}</div>`:''}</div>`;
      }).join('');
    }

    function scanSelectColor(art, colorNombre) {
      document.querySelectorAll('.scan-color-chip').forEach(el => el.classList.toggle('scan-chip-active', el.dataset.color === colorNombre));
      const labelEl = document.getElementById('scan-color-label');
      if (labelEl) labelEl.textContent = colorNombre;
      const prendas = allPrendas.filter(p => p.art === art.trim() && p.color === colorNombre);
      const talles  = {};
      prendas.forEach(p => { Object.entries(p.talles || {}).forEach(([t, v]) => { if (talles[t]) talles[t] = { ...talles[t], stock: (parseInt(talles[t].stock)||0)+(parseInt(v.stock)||0) }; else talles[t] = { ...v }; }); });
      document.getElementById('scan-talles-grid').innerHTML = buildScanTalles(talles);
    }
    window.scanSelectColor = scanSelectColor;

    async function searchByCode(code) {
      if (!allPrendas.length) await loadStock();
      const resultDiv = document.getElementById('scanner-result');
      const art       = code.trim();
      const prendas   = allPrendas.filter(p => p.art === art);
      if (!prendas.length) { resultDiv.innerHTML = `<div class="scan-result" style="text-align:center;color:var(--text2)"><p>No se encontró ninguna prenda con el código <strong>${art}</strong></p></div>`; return; }
      const modelo = prendas[0].modelo;
      const coloresMap = new Map();
      prendas.forEach(p => { const key = p.color || ''; if (!coloresMap.has(key)) coloresMap.set(key, {}); const ct = coloresMap.get(key); Object.entries(p.talles || {}).forEach(([t, v]) => { if (ct[t]) ct[t] = { ...ct[t], stock: (parseInt(ct[t].stock)||0)+(parseInt(v.stock)||0) }; else ct[t] = { ...v }; }); });
      const colores = [...coloresMap.entries()];
      const colorChipsHtml = colores.map(([nombre, talles], i) => {
        const totalStock = Object.values(talles).reduce((a, v) => a + (parseInt(v.stock)||0), 0);
        const sinStock   = totalStock === 0;
        return `<button class="scan-color-chip ${i===0?'scan-chip-active':''} ${sinStock?'scan-chip-zero':''}" data-color="${nombre}" onclick="scanSelectColor('${art}','${nombre}')" ${sinStock?'disabled':''}>${nombre}${sinStock?' <span style="font-size:9px;opacity:.6">sin stock</span>':''}</button>`;
      }).join('');
      const [primerColor, primerTalles] = colores[0];
      resultDiv.innerHTML = `
        <div class="scan-result">
          <span class="scan-art">${art}</span>
          <div class="scan-name">${modelo}</div>
          <div style="font-size:11px;color:var(--text2);margin:10px 0 6px;font-weight:500;text-transform:uppercase;letter-spacing:.4px">Colores disponibles</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${colorChipsHtml}</div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px">Talles con stock — <strong id="scan-color-label">${primerColor}</strong></div>
          <div class="scan-talles" id="scan-talles-grid">${buildScanTalles(primerTalles)}</div>
          <div style="margin-top:14px;text-align:center">
            <button class="btn btn-accent" style="width:100%" onclick="openVentaModal('${art}')">🛍 Registrar venta</button>
          </div>
        </div>`;
    }
    window.searchByCode = searchByCode;

    // ── QR ────────────────────────────────────────────────
    function renderQR() {
      const q    = (document.getElementById('qr-search')?.value || '').toLowerCase();
      const grid = document.getElementById('qr-grid');
      grid.innerHTML = '';
      const artsCodigos = [...new Set(allPrendas.map(p => p.art))].filter(art => { if (!q) return true; const prenda = allPrendas.find(p => p.art === art); return art.toLowerCase().includes(q) || prenda?.modelo.toLowerCase().includes(q); });
      if (!artsCodigos.length) { grid.innerHTML = '<p style="color:var(--text2);font-size:13px">No hay prendas cargadas aún.</p>'; return; }
      artsCodigos.forEach(art => {
    const prenda = allPrendas.find(p => p.art === art);
    const card   = document.createElement('div'); card.className = 'qr-card';
    const qrDiv  = document.createElement('div');
    card.appendChild(qrDiv);
    card.innerHTML += `<div class="qr-art">${art}</div><div class="qr-name">${prenda?.modelo||''}</div>`;
    card.insertBefore(qrDiv, card.firstChild);
    grid.appendChild(card);
    try {
      const url = `${location.origin}${location.pathname}?art=${encodeURIComponent(art)}`;
      new QRCode(qrDiv, { text: url, width: 120, height: 120, correctLevel: QRCode.CorrectLevel.M });
    } catch(e) {}
});
    }
    window.renderQR = renderQR;

    // ── Historial de ventas ───────────────────────────────

    /** Carga las ventas desde Firebase */
    async function loadVentas() {
      try {
        const q    = window._q(window._col(window._db, 'ventas'), window._ord('fecha', 'desc'));
        const snap = await window._get(q);
        allVentas  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (e) {
        allVentas = [];
      }
    }

    // ── Asistente / agentes ───────────────────────────────
    function agenteStockBajo() {
      const items = [];
      allPrendas.forEach(p => {
        sortTalles(p.talles || {}).forEach(([talle, data]) => {
          const stock = parseInt(data.stock);
          if (!Number.isFinite(stock) || stock > 1) return;
          items.push({ art: p.art || '', modelo: p.modelo || '', color: p.color || '', talle, stock });
        });
      });
      return items.sort((a, b) => a.stock - b.stock || a.art.localeCompare(b.art) || a.talle.localeCompare(b.talle));
    }

    function agenteResumenDiario() {
      const hoy = diaLocal(new Date());
      const ventasHoy = allVentas.filter(v => diaLocal(ventaDate(v)) === hoy);
      const unidades = ventasHoy.reduce((a, v) => a + (parseInt(v.cantidad) || 0), 0);
      const totalLista = ventasHoy.reduce((a, v) => a + ((parseFloat(v.precioLista) || 0) * (parseInt(v.cantidad) || 0)), 0);
      const totalEf = ventasHoy.reduce((a, v) => a + ((parseFloat(v.precioEfectivo) || 0) * (parseInt(v.cantidad) || 0)), 0);
      const porArticulo = {};
      ventasHoy.forEach(v => {
        const key = `${v.art || 'Sin artículo'} · ${v.modelo || 'Sin modelo'}`;
        porArticulo[key] = (porArticulo[key] || 0) + (parseInt(v.cantidad) || 0);
      });
      const top = Object.entries(porArticulo).sort((a, b) => b[1] - a[1])[0] || null;
      return { ventasHoy, unidades, totalLista, totalEf, top };
    }

    function agenteControlErrores() {
      const errores = [];
      const porArtColor = new Map();

      allPrendas.forEach(p => {
        const art = (p.art || '').trim();
        const modelo = (p.modelo || '').trim();
        const color = (p.color || '').trim();
        const label = `${art || 'Sin artículo'} · ${modelo || 'Sin modelo'}${color ? ' · ' + color : ''}`;

        if (!art) errores.push({ tipo: 'danger', titulo: 'Prenda sin artículo', detalle: label });
        if (!modelo) errores.push({ tipo: 'warning', titulo: 'Prenda sin modelo', detalle: label });
        if (!color) errores.push({ tipo: 'warning', titulo: 'Prenda sin color', detalle: label });
        if (!p.talles || !Object.keys(p.talles).length) errores.push({ tipo: 'danger', titulo: 'Prenda sin talles', detalle: label });

        const dupKey = `${art.toLowerCase()}|${color.toLowerCase()}`;
        if (art && color) porArtColor.set(dupKey, (porArtColor.get(dupKey) || 0) + 1);

        Object.entries(p.talles || {}).forEach(([talle, data]) => {
          const stock = parseInt(data.stock);
          const precio = parseFloat(data.precio);
          if (!Number.isFinite(stock) || stock < 0) errores.push({ tipo: 'danger', titulo: 'Stock inválido', detalle: `${label} · T.${talle}: ${data.stock ?? 'vacío'}` });
          if (!Number.isFinite(precio) || precio <= 0) errores.push({ tipo: 'warning', titulo: 'Precio faltante o inválido', detalle: `${label} · T.${talle}` });
        });
      });

      porArtColor.forEach((cant, key) => {
        if (cant <= 1) return;
        const [art, color] = key.split('|');
        errores.push({ tipo: 'warning', titulo: 'Artículo/color duplicado', detalle: `${art} · ${color} aparece ${cant} veces` });
      });

      allVentas.forEach(v => {
        if (!v.art) errores.push({ tipo: 'warning', titulo: 'Venta sin artículo', detalle: fmtFecha(ventaDate(v)) });
        if ((parseInt(v.cantidad) || 0) <= 0) errores.push({ tipo: 'danger', titulo: 'Venta con cantidad inválida', detalle: `${v.art || 'Sin artículo'} · ${fmtFecha(ventaDate(v))}` });
        if ((parseFloat(v.precioLista) || 0) <= 0 && (parseFloat(v.precioEfectivo) || 0) <= 0) errores.push({ tipo: 'warning', titulo: 'Venta sin precio', detalle: `${v.art || 'Sin artículo'} · ${fmtFecha(ventaDate(v))}` });
      });

      return errores;
    }

    function renderAgentList(containerId, items, emptyText, renderItem, max = 12) {
      const el = document.getElementById(containerId);
      if (!items.length) {
        el.innerHTML = `<div class="agent-empty">${escapeHtml(emptyText)}</div>`;
        return;
      }
      const visible = items.slice(0, max);
      const resto = items.length - visible.length;
      el.innerHTML = visible.map(renderItem).join('') +
        (resto > 0 ? `<div class="agent-empty">Y ${resto} más...</div>` : '');
    }

    async function renderAsistente() {
      document.getElementById('agent-stock-bajo').innerHTML = '<div class="loading">Analizando stock...</div>';
      document.getElementById('agent-resumen-diario').innerHTML = '<div class="loading">Calculando ventas de hoy...</div>';
      document.getElementById('agent-control-errores').innerHTML = '<div class="loading">Revisando datos...</div>';

      if (!allPrendas.length) await loadStock();
      await loadVentas();

      const stockBajo = agenteStockBajo();
      document.getElementById('agent-stock-count').textContent = stockBajo.length;
      renderAgentList('agent-stock-bajo', stockBajo, 'No hay prendas con stock bajo.', item => `
        <div class="agent-item ${item.stock === 0 ? 'danger' : 'warning'}">
          <div class="agent-title"><span>${escapeHtml(item.art)}</span><span class="agent-value">${item.stock}</span></div>
          <div class="agent-meta">${escapeHtml(item.modelo)} · ${escapeHtml(item.color)} · T.${escapeHtml(item.talle)}</div>
        </div>
      `);

      const resumen = agenteResumenDiario();
      document.getElementById('agent-resumen-count').textContent = resumen.ventasHoy.length;
      document.getElementById('agent-resumen-diario').innerHTML = `
        <div class="agent-summary">
          <div class="agent-stat"><div class="label">Ventas</div><div class="value">${resumen.ventasHoy.length}</div></div>
          <div class="agent-stat"><div class="label">Unidades</div><div class="value">${resumen.unidades}</div></div>
          <div class="agent-stat"><div class="label">Lista</div><div class="value">${fmtPeso(resumen.totalLista)}</div></div>
          <div class="agent-stat"><div class="label">Efectivo</div><div class="value">${fmtPeso(resumen.totalEf)}</div></div>
        </div>
        <div class="agent-item">
          <div class="agent-title"><span>Más vendido hoy</span><span class="agent-value">${resumen.top ? resumen.top[1] : 0}</span></div>
          <div class="agent-meta">${resumen.top ? escapeHtml(resumen.top[0]) : 'Sin ventas registradas hoy.'}</div>
        </div>
      `;

      const errores = agenteControlErrores();
      document.getElementById('agent-error-count').textContent = errores.length;
      renderAgentList('agent-control-errores', errores, 'No se encontraron inconsistencias importantes.', item => `
        <div class="agent-item ${escapeHtml(item.tipo)}">
          <div class="agent-title"><span>${escapeHtml(item.titulo)}</span></div>
          <div class="agent-meta">${escapeHtml(item.detalle)}</div>
        </div>
      `);
    }
    window.renderAsistente = renderAsistente;

    /** Renderiza el historial completo: stats + gráfico + tabla */
    async function renderHistorial() {
      if (!allVentas.length) await loadVentas();

      const dias   = parseInt(document.getElementById('hist-filtro').value);
      const busq   = document.getElementById('hist-search').value.toLowerCase();
      const ahora  = Date.now();
      const cutoff = dias > 0 ? ahora - dias * 86400000 : 0;

      // Filtrar ventas
      const ventas = allVentas.filter(v => {
        const ts = v.fecha?.toMillis ? v.fecha.toMillis() : (v.fecha || 0);
        const matchFecha = !cutoff || ts >= cutoff;
        const matchBusq  = !busq || (v.art||'').toLowerCase().includes(busq) || (v.modelo||'').toLowerCase().includes(busq) || (v.color||'').toLowerCase().includes(busq);
        return matchFecha && matchBusq;
      });

      renderHistStats(ventas);
      renderHistChart(ventas);
      renderHistTabla(ventas);
    }
    window.renderHistorial = renderHistorial;

    /** Renderiza las tarjetas de resumen */
    function renderHistStats(ventas) {
      const totalUnidades = ventas.reduce((a, v) => a + (parseInt(v.cantidad) || 0), 0);
      const totalLista    = ventas.reduce((a, v) => a + ((parseFloat(v.precioLista) || 0) * (parseInt(v.cantidad) || 0)), 0);
      const totalEf       = ventas.reduce((a, v) => a + ((parseFloat(v.precioEfectivo) || 0) * (parseInt(v.cantidad) || 0)), 0);
      const cantVentas    = ventas.length;

      document.getElementById('hist-stats').innerHTML = `
        <div class="hist-stat"><div class="hs-label">Ventas registradas</div><div class="hs-val">${cantVentas}</div><div class="hs-sub">transacciones</div></div>
        <div class="hist-stat"><div class="hs-label">Unidades vendidas</div><div class="hs-val">${totalUnidades}</div><div class="hs-sub">prendas</div></div>
        <div class="hist-stat"><div class="hs-label">Monto lista</div><div class="hs-val" style="font-size:16px">${fmtPeso(totalLista)}</div><div class="hs-sub">precio lista total</div></div>
        <div class="hist-stat"><div class="hs-label">Monto efectivo</div><div class="hs-val" style="font-size:16px;color:var(--success)">${fmtPeso(totalEf)}</div><div class="hs-sub">precio efectivo total</div></div>`;
    }

    /** Renderiza el gráfico de ventas por día */
    function renderHistChart(ventas) {
      // Agrupar unidades vendidas por día
      const porDia = {};
      ventas.forEach(v => {
        const ts  = v.fecha?.toMillis ? v.fecha.toMillis() : (v.fecha || 0);
        const dia = fmtDia(new Date(ts));
        porDia[dia] = (porDia[dia] || 0) + (parseInt(v.cantidad) || 0);
      });

      // Ordenar días
      const labels = Object.keys(porDia).sort();
      const data   = labels.map(d => porDia[d]);

      const ctx = document.getElementById('chart-ventas').getContext('2d');

      // Destruir instancia anterior si existe
      if (_chartVentas) { _chartVentas.destroy(); _chartVentas = null; }

      if (!labels.length) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        return;
      }

      _chartVentas = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels.map(d => { const [y,m,dia] = d.split('-'); return `${dia}/${m}`; }),
          datasets: [{
            label: 'Unidades vendidas',
            data,
            backgroundColor: 'rgba(201,169,110,0.7)',
            borderColor:     '#8b6f47',
            borderWidth: 1,
            borderRadius: 4,
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#e2dfd9' } },
            x: { grid: { display: false } }
          }
        }
      });
    }

    /** Renderiza la tabla de ventas */
    function renderHistTabla(ventas) {
      const tbody = document.getElementById('hist-tbody');
      if (!ventas.length) { tbody.innerHTML = '<tr><td colspan="9"><div class="hist-empty">No hay ventas en este período.</div></td></tr>'; return; }
      tbody.innerHTML = ventas.map(v => {
        const ts     = v.fecha?.toMillis ? v.fecha.toMillis() : (v.fecha || 0);
        const fecha  = fmtFecha(new Date(ts));
        const lista  = parseFloat(v.precioLista)    || 0;
        const ef     = parseFloat(v.precioEfectivo) || 0;
        const cant   = parseInt(v.cantidad)         || 0;
        const monto  = ef * cant;
        return `<tr>
          <td class="hist-fecha">${fecha}</td>
          <td><span class="hist-row-art">${v.art || '—'}</span></td>
          <td>${v.modelo || '—'}</td>
          <td>${v.color  || '—'}</td>
          <td>${v.talle  || '—'}</td>
          <td style="text-align:center">${cant}</td>
          <td style="font-family:'DM Mono',monospace;font-size:12px">${lista > 0 ? fmtPeso(lista) : '—'}</td>
          <td style="font-family:'DM Mono',monospace;font-size:12px">${ef   > 0 ? fmtPeso(ef)    : '—'}</td>
          <td class="hist-monto">${monto > 0 ? fmtPeso(monto) : '—'}</td>
        </tr>`;
      }).join('');
    }

    /** Abre el modal de confirmación para resetear el historial */
    function confirmarResetHistorial() {
      document.getElementById('modal-reset').classList.add('open');
    }
    window.confirmarResetHistorial = confirmarResetHistorial;

    /** Borra todas las ventas de Firebase */
    async function ejecutarResetHistorial() {
      document.getElementById('modal-reset').classList.remove('open');
      try {
        // Borrar en lotes de 500 (límite de writeBatch)
        const snap = await window._get(window._col(window._db, 'ventas'));
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i += 500) {
          const batch = window._writeBatch(window._db);
          docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
        allVentas = [];
        renderHistorial();
        showToast('✓ Historial reseteado correctamente', null, 3000);
      } catch (e) {
        showToast('Error al resetear. Revisá la conexión.', null, 3000);
      }
    }
    window.ejecutarResetHistorial = ejecutarResetHistorial;

    // ── Registrar venta ───────────────────────────────────
    function openVentaModal(art, colorInicial) {
      ventaArt = art ? art.trim() : null;
      const prendas = allPrendas.filter(p => p.art === ventaArt);
      if (!prendas.length) { showToast('No se encontró el artículo'); return; }
      const modelo = prendas[0].modelo;
      document.getElementById('venta-art-code').textContent   = ventaArt;
      document.getElementById('venta-art-modelo').textContent = modelo;
      document.getElementById('venta-art-info').style.display = '';
      document.getElementById('venta-title').textContent = 'Registrar venta — ' + ventaArt;
      const coloresMap = new Map();
      prendas.forEach(p => { const key = (p.color||'').trim(); if (!coloresMap.has(key)) coloresMap.set(key, {}); const ct = coloresMap.get(key); Object.entries(p.talles||{}).forEach(([t,v])=>{ if(ct[t]) ct[t]={...ct[t],stock:(parseInt(ct[t].stock)||0)+(parseInt(v.stock)||0)}; else ct[t]={...v}; }); });
      const selColor = document.getElementById('venta-color');
      selColor.innerHTML = '<option value="">— Seleccioná un color —</option>';
      [...coloresMap.entries()].forEach(([nombre]) => { const o = document.createElement('option'); o.value = nombre; o.textContent = nombre; selColor.appendChild(o); });
      if (colorInicial) selColor.value = colorInicial;
      const selTalle = document.getElementById('venta-talle');
      selTalle.innerHTML = '<option value="">— Seleccioná un talle —</option>'; selTalle.disabled = !colorInicial;
      document.getElementById('venta-qty').value = 1;
      document.getElementById('venta-resumen').style.display = 'none';
      document.getElementById('venta-error').style.display   = 'none';
      document.getElementById('btn-confirmar-venta').disabled = true;
      if (colorInicial) ventaOnColorChange();
      document.getElementById('modal-venta').classList.add('open');
    }
    window.openVentaModal = openVentaModal;

    function closeVentaModal() { document.getElementById('modal-venta').classList.remove('open'); ventaArt = null; }
    window.closeVentaModal = closeVentaModal;

    function ventaOnColorChange() {
      const color    = document.getElementById('venta-color').value;
      const selTalle = document.getElementById('venta-talle');
      document.getElementById('venta-resumen').style.display = 'none';
      document.getElementById('venta-error').style.display   = 'none';
      document.getElementById('btn-confirmar-venta').disabled = true;
      if (!color) { selTalle.innerHTML = '<option value="">— Seleccioná un talle —</option>'; selTalle.disabled = true; return; }
      const prendas   = allPrendas.filter(p => p.art === ventaArt && (p.color||'').trim() === color);
      const tallesMap = {};
      prendas.forEach(p => { Object.entries(p.talles||{}).forEach(([t,v])=>{ if(tallesMap[t]) tallesMap[t]={...tallesMap[t],stock:(parseInt(tallesMap[t].stock)||0)+(parseInt(v.stock)||0)}; else tallesMap[t]={...v}; }); });
      selTalle.innerHTML = '<option value="">— Seleccioná un talle —</option>';
      sortTalles(tallesMap).forEach(([t, v]) => { const s = parseInt(v.stock)||0; const o = document.createElement('option'); o.value = t; o.textContent = `Talle ${t}  (${s} en stock)`; if(s===0){o.textContent+=' — sin stock';o.disabled=true;} selTalle.appendChild(o); });
      selTalle.disabled = false; selTalle.value = '';
    }
    window.ventaOnColorChange = ventaOnColorChange;

    function ventaOnTalleChange() { ventaActualizarResumen(); }
    window.ventaOnTalleChange = ventaOnTalleChange;
    function ventaOnQtyChange()  { ventaActualizarResumen(); }
    window.ventaOnQtyChange = ventaOnQtyChange;

    function ventaActualizarResumen() {
      const color = document.getElementById('venta-color').value;
      const talle = document.getElementById('venta-talle').value;
      const qty   = parseInt(document.getElementById('venta-qty').value) || 0;
      const errEl = document.getElementById('venta-error');
      const btn   = document.getElementById('btn-confirmar-venta');
      errEl.style.display = 'none'; btn.disabled = true;
      if (!color || !talle) { document.getElementById('venta-resumen').style.display = 'none'; return; }
      const prendas = allPrendas.filter(p => p.art === ventaArt && (p.color||'').trim() === color);
      let stockActual = 0, precio = 0;
      prendas.forEach(p => { const tv = p.talles?.[talle]; if(tv){stockActual+=(parseInt(tv.stock)||0); if(!precio&&tv.precio) precio=parseFloat(tv.precio);} });
      const despues = stockActual - qty;
      document.getElementById('venta-resumen').style.display = '';
      document.getElementById('vr-stock-actual').textContent = stockActual + ' unid.';
      document.getElementById('vr-stock-actual').className   = 'vr-val ' + stockClass(stockActual);
      if (despues >= 0) { document.getElementById('vr-stock-despues').textContent = despues + ' unid.'; document.getElementById('vr-stock-despues').className = 'vr-val ' + stockClass(despues); }
      else               { document.getElementById('vr-stock-despues').textContent = '—'; document.getElementById('vr-stock-despues').className = 'vr-val zero'; }
      if (precio > 0) { document.getElementById('vr-precio-row').style.display=''; document.getElementById('vr-ef-row').style.display=''; document.getElementById('vr-precio').textContent=fmtPeso(precio); document.getElementById('vr-ef').textContent=fmtPeso(calcEf(precio)); }
      else            { document.getElementById('vr-precio-row').style.display='none'; document.getElementById('vr-ef-row').style.display='none'; }
      if (qty <= 0)          { errEl.textContent = 'La cantidad debe ser mayor a 0.'; errEl.style.display = ''; return; }
      if (qty > stockActual) { errEl.textContent = `No hay suficiente stock. Disponible: ${stockActual} unid.`; errEl.style.display = ''; return; }
      btn.disabled = false;
    }

    /** Confirma la venta y guarda el registro en Firebase */
    async function confirmarVenta() {
      const color = document.getElementById('venta-color').value;
      const talle = document.getElementById('venta-talle').value;
      const qty   = parseInt(document.getElementById('venta-qty').value) || 0;
      const btn   = document.getElementById('btn-confirmar-venta');
      if (!color || !talle || qty <= 0 || !ventaArt) return;
      btn.disabled = true; btn.textContent = 'Guardando...';
      try {
        const docs = allPrendas.filter(p => p.art === ventaArt && (p.color||'').trim() === color && p.talles?.[talle] && (parseInt(p.talles[talle].stock)||0) > 0);
        let restante = qty;
        const cambios = [];

        // Obtener precio del talle
        let precioLista = 0;
        docs.forEach(p => { if (!precioLista && p.talles?.[talle]?.precio) precioLista = parseFloat(p.talles[talle].precio); });
        const precioEfectivo = precioLista > 0 ? calcEf(precioLista) : 0;

        for (const p of docs) {
          if (restante <= 0) break;
          const stockDoc  = parseInt(p.talles[talle].stock) || 0;
          const descuento = Math.min(stockDoc, restante);
          restante -= descuento;
          cambios.push({ id: p.id, tallesAntes: { ...p.talles }, tallesDespues: { ...p.talles, [talle]: { ...p.talles[talle], stock: stockDoc - descuento } } });
        }
        if (restante > 0) throw new Error('Stock insuficiente');

        const modelo = allPrendas.find(p => p.art === ventaArt)?.modelo || '';
        const batch = window._writeBatch(window._db);
        cambios.forEach(c => {
          batch.update(window._doc(window._db, 'prendas', c.id), { talles: c.tallesDespues });
        });
        batch.set(window._doc(window._col(window._db, 'ventas')), {
          fecha:          window._Timestamp.now(),
          art:            ventaArt,
          modelo,
          color,
          talle,
          cantidad:       qty,
          precioLista,
          precioEfectivo,
        });
        await batch.commit();

        // Actualizar cache local de ventas
        allVentas = []; // forzar recarga la próxima vez

        const label = `${ventaArt} · ${color} · T.${talle} · ×${qty}`;
        closeVentaModal();
        await loadStock();
        btn.textContent = 'Confirmar venta';

        showToast(`✓ Venta registrada — ${label}`, async () => {
          await deshacerCambios(cambios, label);
        }, 8000);

      } catch (e) {
        document.getElementById('venta-error').textContent = 'Error al guardar. Revisá la conexión.';
        document.getElementById('venta-error').style.display = '';
        btn.disabled = false; btn.textContent = 'Confirmar venta';
      }
    }
    window.confirmarVenta = confirmarVenta;

    function deshacerUltimaVenta() {
      const btn = document.getElementById('toast-undo-btn');
      if (btn._handler) btn._handler();
      document.getElementById('toast').classList.remove('show');
      if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
    }
    window.deshacerUltimaVenta = deshacerUltimaVenta;

    async function deshacerCambios(cambios, label) {
      try {
        for (const c of cambios) await window._upd(window._doc(window._db, 'prendas', c.id), { talles: c.tallesAntes });
        // También borrar la última venta guardada
        const snap = await window._get(window._q(window._col(window._db, 'ventas'), window._ord('fecha','desc')));
        if (!snap.empty) await window._del(snap.docs[0].ref);
        allVentas = [];
        await loadStock();
        showToast(`↩ Venta revertida — ${label}`, null, 3000);
      } catch (e) { showToast('Error al revertir.', null, 3000); }
    }

    // ── Eliminar ──────────────────────────────────────────
    function openEliminarModal(art) {
      elimArt = art.trim();
      const prendas = allPrendas.filter(p => p.art === elimArt);
      if (!prendas.length) { showToast('No se encontró el artículo'); return; }
      const modelo  = prendas[0].modelo;
      const colores = [...new Set(prendas.map(p => (p.color||'').trim()).filter(Boolean))];
      document.getElementById('elim-title').textContent      = 'Eliminar — ' + elimArt;
      document.getElementById('elim-art-code').textContent   = elimArt;
      document.getElementById('elim-art-modelo').textContent = modelo;
      document.getElementById('elim-art-colores').textContent = colores.length > 1 ? `Colores: ${colores.join(', ')}` : `Color: ${colores[0]||'—'}`;
      const sel = document.getElementById('elim-color-sel');
      sel.innerHTML = '<option value="">— Seleccioná un color —</option>';
      colores.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
      document.getElementById('elim-color-detalle').style.display = 'none';
      document.getElementById('btn-elim-color').disabled = true;
      document.getElementById('elim-bloque-color').style.display = colores.length > 1 ? '' : 'none';
      const totalDocs = prendas.length, totalStock = prendas.reduce((s,p)=>s+stockTotal(p.talles),0);
      document.getElementById('elim-total-desc').textContent = `Se eliminarán ${totalDocs} registro${totalDocs>1?'s':''} (${colores.length} color${colores.length>1?'es':''}, ${totalStock} unid. en stock).`;
      document.getElementById('modal-eliminar').classList.add('open');
    }
    window.openEliminarModal = openEliminarModal;

    function closeEliminarModal() { document.getElementById('modal-eliminar').classList.remove('open'); elimArt = null; }
    window.closeEliminarModal = closeEliminarModal;

    function elimOnColorChange() {
      const color = document.getElementById('elim-color-sel').value;
      const det   = document.getElementById('elim-color-detalle');
      const btn   = document.getElementById('btn-elim-color');
      if (!color) { det.style.display = 'none'; btn.disabled = true; return; }
      const prendas = allPrendas.filter(p => p.art === elimArt && (p.color||'').trim() === color);
      const stock   = prendas.reduce((s,p)=>s+stockTotal(p.talles),0);
      const talles  = {};
      prendas.forEach(p => Object.entries(p.talles||{}).forEach(([t,v])=>{ talles[t]=(parseInt(talles[t]||0))+(parseInt(v.stock)||0); }));
      const talleStr = Object.entries(talles).map(([t,s])=>`T.${t}: ${s}`).join(' · ') || 'sin stock';
      det.style.display = ''; det.textContent = `Stock: ${stock} unid. — ${talleStr}`; btn.disabled = false;
    }
    window.elimOnColorChange = elimOnColorChange;

    async function confirmarEliminarColor() {
      const color = document.getElementById('elim-color-sel').value;
      if (!color || !elimArt) return;
      const prendas  = allPrendas.filter(p => p.art === elimArt && (p.color||'').trim() === color);
      const snapshot = prendas.map(p => ({...p})); const art = elimArt;
      try {
        for (const p of prendas) await window._del(window._doc(window._db, 'prendas', p.id));
        closeEliminarModal(); await loadStock();
        showToast(`🗑 Eliminado — ${art} · ${color}`, async () => { for (const p of snapshot) { const {id,...data}=p; await window._add(window._col(window._db,'prendas'),data); } await loadStock(); showToast(`↩ Restaurado — ${art} · ${color}`,null,3000); }, 8000);
      } catch (e) { showToast('Error al eliminar.', null, 3000); }
    }
    window.confirmarEliminarColor = confirmarEliminarColor;

    async function confirmarEliminarTodo() {
      if (!elimArt) return;
      const prendas  = allPrendas.filter(p => p.art === elimArt);
      const snapshot = prendas.map(p => ({...p})); const art = elimArt; const modelo = prendas[0]?.modelo || art;
      try {
        for (const p of prendas) await window._del(window._doc(window._db, 'prendas', p.id));
        closeEliminarModal(); await loadStock();
        showToast(`🗑 Eliminado — ${art} · ${modelo}`, async () => { for (const p of snapshot) { const {id,...data}=p; await window._add(window._col(window._db,'prendas'),data); } await loadStock(); showToast(`↩ Restaurado — ${art} · ${modelo}`,null,3000); }, 8000);
      } catch (e) { showToast('Error al eliminar.', null, 3000); }
    }
    window.confirmarEliminarTodo = confirmarEliminarTodo;
