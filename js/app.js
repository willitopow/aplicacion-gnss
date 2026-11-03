/*!
 * linderos-gnss · app.js
 * Interfaz de usuario. Usa core.js (window.Linderos).
 * Licencia: MIT
 */
(function () {
  'use strict';

  const Core = window.Linderos;
  const $ = id => document.getElementById(id);
  const COLORES = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
                   '#42d4f4', '#f032e6', '#9a6324', '#808000', '#000075'];

  const estado = {
    puntos: [],        // todos los puntos leídos
    capas: [],         // capas agrupadas { nombre, tipo, puntos, incluir, color }
    nombreBase: 'proyecto',
    vb: null           // viewBox actual del mapa
  };

  /* ---------- utilidades ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function mostrar(texto, error) {
    const m = $('mensaje');
    m.textContent = texto;
    m.className = error ? 'error' : 'ok';
  }

  function leerTexto(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('No se pudo leer el archivo'));
      r.readAsText(file);
    });
  }

  function leerBinario(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('No se pudo leer el archivo'));
      r.readAsArrayBuffer(file);
    });
  }

  function cargarScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }

  // Carga SheetJS solo cuando hace falta: primero local (offline), luego CDN.
  async function obtenerXLSX() {
    if (window.XLSX) return window.XLSX;
    try {
      await cargarScript('libs/xlsx.full.min.js');
    } catch (e) {
      await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    }
    if (!window.XLSX) throw new Error('No se pudo cargar el lector de Excel');
    return window.XLSX;
  }

  function descargar(nombre, contenido, tipo) {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function activas() {
    return estado.capas.filter(c => c.incluir);
  }

  function puntosDe(capas) {
    return capas.reduce((acc, c) => acc.concat(c.puntos), []);
  }

  /* ---------- carga de datos ---------- */

  async function cargarArchivo(file) {
    estado.nombreBase = file.name.replace(/\.[^.]+$/, '');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    mostrar('Leyendo ' + file.name + '...');
    try {
      let filas;
      if (['xls', 'xlsx', 'xlsm'].includes(ext)) {
        const XLSX = await obtenerXLSX();
        filas = Core.libroAFilas(XLSX, new Uint8Array(await leerBinario(file)));
      } else {
        filas = Core.textoAFilas(await leerTexto(file));
      }
      procesar(filas);
    } catch (e) {
      mostrar('Error: ' + e.message, true);
    }
  }

  function procesar(filas) {
    const r = Core.filasAPuntos(filas);
    const nombres = { name: 'Nombre', code: 'Código', N: 'N', E: 'E', h: 'h' };
    const cols = Object.keys(r.mapa).map(k => nombres[k] + ' (col ' + (r.mapa[k] + 1) + ')').join(', ');

    estado.puntos = r.puntos;
    estado.capas = [];
    estado.vb = null;
    regrupar();

    let txt = r.puntos.length + ' puntos leídos. Columnas: ' + cols + '. Capas: ' + estado.capas.length + '.';
    if (r.omitidos.length) txt += ' Filas omitidas (sin N/E válidos): ' + r.omitidos.length + '.';
    mostrar(txt);
  }

  // Agrupa por código y conserva el tipo elegido por el usuario si la capa ya existía
  function regrupar() {
    const previos = new Map(estado.capas.map(c => [c.nombre, c]));
    estado.capas = Core.agrupar(estado.puntos, { quitarNumero: $('chkQuitar').checked });
    estado.capas.forEach((c, i) => {
      const prev = previos.get(c.nombre);
      c.tipo = prev ? prev.tipo : c.tipo;
      c.incluir = prev ? prev.incluir : true;
      c.color = COLORES[i % COLORES.length];
    });
    estado.vb = null;
    refrescar();
  }

  function refrescar() {
    pintarTabla();
    pintarMapa();
  }

  /* ---------- tabla de capas ---------- */

  function opcionTipo(valor, etiqueta, actual) {
    return '<option value="' + valor + '"' + (valor === actual ? ' selected' : '') + '>' + etiqueta + '</option>';
  }

  function pintarTabla() {
    const tb = $('tbody');
    tb.innerHTML = '';
    estado.capas.forEach((c, i) => {
      const r = Core.calcular(c);
      const esPoli = c.tipo === 'poligono';
      const esLinea = c.tipo === 'linea';
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input type="checkbox" class="inc" data-i="' + i + '"' + (c.incluir ? ' checked' : '') + '></td>' +
        '<td><span class="sw" style="background:' + c.color + '"></span>' + esc(c.nombre) + '</td>' +
        '<td><select class="tipo" data-i="' + i + '">' +
          opcionTipo('puntos', 'Puntos', c.tipo) +
          opcionTipo('linea', 'Línea abierta', c.tipo) +
          opcionTipo('poligono', 'Polígono cerrado', c.tipo) +
        '</select></td>' +
        '<td>' + r.n + '</td>' +
        '<td>' + (esPoli ? r.area.toFixed(2) : '—') + '</td>' +
        '<td>' + (esPoli ? r.ha.toFixed(4) : '—') + '</td>' +
        '<td>' + (esPoli ? r.perimetro.toFixed(2) : esLinea ? r.longitud.toFixed(2) : '—') + '</td>' +
        '<td class="aviso">' + esc(r.aviso) + '</td>';
      tb.appendChild(tr);
    });
  }

  /* ---------- mapa (SVG, norte arriba) ---------- */

  function aplicarVB() {
    const v = estado.vb;
    $('mapa').setAttribute('viewBox', [v.x, v.y, v.w, v.h].join(' '));
  }

  function pintarMapa() {
    const svg = $('mapa');
    const act = activas();
    const pts = puntosDe(act);
    pintarResumen(act);

    if (!pts.length) { svg.innerHTML = ''; return; }

    const ext = Core.extension(pts);
    if (!estado.vb) {
      const pad = Math.max(ext.w, ext.h) * 0.05 || 1;
      estado.vb = { x: -pad, y: -ext.h - pad, w: ext.w + 2 * pad, h: ext.h + 2 * pad };
    }
    // Coordenadas locales (restando el origen) para evitar problemas de precisión
    const sx = p => p.E - ext.minE;
    const sy = p => -(p.N - ext.maxN);
    const u = Math.max(estado.vb.w, 1e-6) / 400;   // tamaño relativo de puntos y textos
    const etqPts = $('chkEtqPts').checked;
    const etqArea = $('chkEtqArea').checked;

    let g = '';
    act.forEach(c => {
      const col = c.color;
      if (c.tipo === 'puntos') {
        c.puntos.forEach(p => {
          g += '<circle cx="' + sx(p) + '" cy="' + sy(p) + '" r="' + (u * 1.5) + '" fill="' + col + '"/>';
          if (etqPts) {
            g += '<text x="' + (sx(p) + u * 2) + '" y="' + (sy(p) - u * 1.5) +
                 '" font-size="' + (u * 5) + '" fill="#222">' + esc(p.nombre) + '</text>';
          }
        });
        return;
      }
      if (c.puntos.length < 2) return;

      const cerrado = c.tipo === 'poligono' && c.puntos.length >= 3;
      const d = c.puntos.map(p => sx(p) + ',' + sy(p)).join(' ');
      g += cerrado
        ? '<polygon points="' + d + '" fill="' + col + '" fill-opacity="0.2" stroke="' + col + '" stroke-width="' + (u * 1.5) + '"/>'
        : '<polyline points="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + (u * 1.5) + '"/>';
      c.puntos.forEach(p => {
        g += '<circle cx="' + sx(p) + '" cy="' + sy(p) + '" r="' + u + '" fill="' + col + '"/>';
      });

      if (cerrado && etqArea) {
        const cx = c.puntos.reduce((s, p) => s + sx(p), 0) / c.puntos.length;
        const cy = c.puntos.reduce((s, p) => s + sy(p), 0) / c.puntos.length;
        const area = Core.calcular(c).area;
        g += '<text x="' + cx + '" y="' + cy + '" font-size="' + (u * 5) +
             '" text-anchor="middle" fill="#222">' + esc(c.nombre) + '</text>';
        g += '<text x="' + cx + '" y="' + (cy + u * 6) + '" font-size="' + (u * 4) +
             '" text-anchor="middle" fill="#222">' + area.toFixed(1) + ' m²</text>';
      }
    });

    svg.innerHTML = g;
    aplicarVB();
  }

  function pintarResumen(act) {
    let n = 0, area = 0, per = 0, lon = 0;
    act.forEach(c => {
      const r = Core.calcular(c);
      n += r.n;
      if (c.tipo === 'poligono') { area += r.area; per += r.perimetro; }
      if (c.tipo === 'linea') lon += r.longitud;
    });
    $('resumen').innerHTML =
      '<b>Capas incluidas:</b> ' + act.length +
      ' · <b>Puntos:</b> ' + n +
      ' · <b>Área polígonos:</b> ' + area.toFixed(2) + ' m² (' + (area / 10000).toFixed(4) + ' ha)' +
      ' · <b>Perímetros:</b> ' + per.toFixed(2) + ' m' +
      ' · <b>Longitud líneas:</b> ' + lon.toFixed(2) + ' m';
  }

  // Zoom con la rueda y paneo arrastrando (también con el dedo)
  function svgPunto(svg, x, y) {
    const pt = svg.createSVGPoint();
    pt.x = x; pt.y = y;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function iniciarMapa() {
    const svg = $('mapa');
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      if (!estado.vb) return;
      const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const p = svgPunto(svg, e.clientX, e.clientY);
      const v = estado.vb;
      v.x = p.x - (p.x - v.x) * f;
      v.y = p.y - (p.y - v.y) * f;
      v.w *= f;
      v.h *= f;
      aplicarVB();
    }, { passive: false });

    let arrastre = null;
    svg.addEventListener('pointerdown', e => {
      arrastre = { x: e.clientX, y: e.clientY };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', e => {
      if (!arrastre || !estado.vb) return;
      const k = Math.max(estado.vb.w / svg.clientWidth, estado.vb.h / svg.clientHeight);
      estado.vb.x -= (e.clientX - arrastre.x) * k;
      estado.vb.y -= (e.clientY - arrastre.y) * k;
      arrastre = { x: e.clientX, y: e.clientY };
      aplicarVB();
    });
    const soltar = () => { arrastre = null; };
    svg.addEventListener('pointerup', soltar);
    svg.addEventListener('pointercancel', soltar);
  }

  /* ---------- exportación ---------- */

  function exportarDXF() {
    const act = activas();
    if (!act.length) return mostrar('Selecciona al menos una capa.', true);
    const ext = Core.extension(puntosDe(act));
    if (!ext) return mostrar('No hay puntos para exportar.', true);
    const alt = Math.max(ext.w, ext.h, 1) / 200;   // altura de texto proporcional al dibujo
    const txt = Core.generarDXF(act, {
      etiquetasPuntos: $('chkEtqPts').checked,
      etiquetasArea: $('chkEtqArea').checked,
      alturaTexto: alt
    });
    descargar(estado.nombreBase + '.dxf', txt, 'application/dxf');
    mostrar('DXF generado con ' + act.length + ' capas.');
  }

  function exportarCSV() {
    const act = activas();
    if (!act.length) return mostrar('Selecciona al menos una capa.', true);
    // BOM UTF-8 para que Excel lea bien las tildes
    descargar(estado.nombreBase + '_resultados.csv', '\uFEFF' + Core.generarCSV(act), 'text/csv;charset=utf-8');
    mostrar('CSV de resultados generado.');
  }

  /* ---------- eventos ---------- */

  function iniciar() {
    $('archivo').addEventListener('change', e => {
      if (e.target.files && e.target.files[0]) cargarArchivo(e.target.files[0]);
      e.target.value = '';   // permite volver a cargar el mismo archivo
    });

    $('btnPegado').addEventListener('click', () => {
      const texto = $('pegado').value;
      if (!texto.trim()) return mostrar('Pega primero los datos en el cuadro.', true);
      estado.nombreBase = 'pegado';
      try { procesar(Core.textoAFilas(texto)); }
      catch (e) { mostrar('Error: ' + e.message, true); }
    });

    $('chkQuitar').addEventListener('change', () => { if (estado.puntos.length) regrupar(); });
    $('chkEtqPts').addEventListener('change', pintarMapa);
    $('chkEtqArea').addEventListener('change', pintarMapa);
    $('btnVista').addEventListener('click', () => { estado.vb = null; pintarMapa(); });

    // Delegación: tipo de capa e inclusión
    $('tbody').addEventListener('change', e => {
      const i = Number(e.target.getAttribute('data-i'));
      if (e.target.classList.contains('tipo')) {
        estado.capas[i].tipo = e.target.value;
        refrescar();
      } else if (e.target.classList.contains('inc')) {
        estado.capas[i].incluir = e.target.checked;
        pintarMapa();
      }
    });

    $('btnDXF').addEventListener('click', exportarDXF);
    $('btnCSV').addEventListener('click', exportarCSV);

    iniciarMapa();
  }

  iniciar();
})();
