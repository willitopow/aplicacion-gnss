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
    capas: [],         // capas { nombre, tipo, puntos, union, incluir, color }
    nombreBase: 'proyecto',
    croquis: '',       // texto del croquis
    avisosCroquis: [],
    equidistancia: 1,
    curvas: null,      // resultado de Core.curvasNivel
    borrados: [],      // puntos borrados (se pueden restaurar)
    sel: null,         // orden del punto seleccionado en el mapa
    vb: null,          // viewBox actual del mapa (coordenadas locales)
    origen: null,      // origen local del mapa: { x: minE, y: maxN }
    escala0: 1         // ancho inicial de la vista (base para límites de zoom)
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

  // Para ajustar la vista se ignoran capas de un solo punto (p. ej. Base_0),
  // que pueden estar alejadas y dejar el dibujo pequeño.
  function puntosParaAjustar(act) {
    const grandes = act.filter(c => c.puntos.length > 1);
    return puntosDe(grandes.length ? grandes : act);
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
    estado.borrados = [];
    estado.sel = null;
    estado.croquis = '';          // al importar no quedan figuras del croquis anterior
    $('croquis').value = '';      // y el cuadro del croquis se vacía (para no volver a aplicar figuras viejas)
    estado.capas = [];
    estado.vb = null;
    regrupar();

    let txt = r.puntos.length + ' puntos leídos. Columnas: ' + cols + '. Capas: ' + estado.capas.length + '.';
    if (r.omitidos.length) txt += ' Filas omitidas (sin N/E válidos): ' + r.omitidos.length + '.';
    mostrar(txt);
  }

  // Capas por código + figuras del croquis. Conserva tipo, unión e inclusión ya elegidos.
  function regrupar() {
    const clave = c => (c.croquis ? 'C:' : 'P:') + c.nombre;
    const previos = new Map(estado.capas.map(c => [clave(c), c]));
    const base = Core.agrupar(estado.puntos, { quitarNumero: $('chkQuitar').checked });
    const cr = Core.croquis(estado.croquis, estado.puntos);
    estado.avisosCroquis = cr.avisos;
    estado.capas = base.concat(cr.capas);
    estado.capas.forEach((c, i) => {
      const prev = previos.get(clave(c));
      if (!c.croquis) {
        c.tipo = prev ? prev.tipo : c.tipo;
        c.union = prev ? prev.union : '';
      }
      // Todas las capas se dibujan (los puntos se ven); el ajuste de vista ignora las de un solo punto
      c.incluir = prev ? prev.incluir : true;
    });
    // Color por layer: figuras del mismo layer comparten color
    const colorDeCapa = new Map();
    estado.capas.forEach(c => {
      const k = c.layer || c.nombre;
      if (!colorDeCapa.has(k)) colorDeCapa.set(k, COLORES[colorDeCapa.size % COLORES.length]);
      c.color = colorDeCapa.get(k);
    });
    $('avisoCroquis').textContent = estado.avisosCroquis.join(' · ');
    refrescar();
  }

  function refrescar() {
    recalcCurvas();
    pintarTabla();
    pintarTablaAlturas();
    pintarMapa();
  }

  /* ---------- puntos: seleccionar, cambiar altura y borrar ---------- */

  function borrarPunto(orden) {
    const p = estado.puntos.find(x => x.orden === orden);
    if (!p) return;
    estado.borrados.push(p);
    estado.puntos = estado.puntos.filter(x => x !== p);
    if (estado.sel === orden) estado.sel = null;
    regrupar();
    mostrarPanel();
    mostrar('Punto ' + Core.numeroPunto(p) + ' borrado. Quedan ' + estado.puntos.length + ' puntos.');
  }

  function seleccionar(orden) {
    estado.sel = orden;
    mostrarPanel();
    pintarMapa();
  }

  function mostrarPanel() {
    const panel = $('panelPunto');
    const p = estado.sel === null ? null : estado.puntos.find(x => x.orden === estado.sel);
    if (!p) { panel.hidden = true; estado.sel = null; return; }
    panel.hidden = false;
    $('selNum').textContent = Core.numeroPunto(p);
    $('selE').textContent = p.E.toFixed(2);
    $('selN').textContent = p.N.toFixed(2);
    $('selH').value = p.h === null ? '' : p.h.toFixed(3);
  }

  /* ---------- curvas de nivel y alturas ---------- */

  // Bordes del croquis (tipo borde) que se tienen en cuenta al calcular las curvas
  function bordesDeCapas() {
    const out = [];
    estado.capas.forEach(c => {
      if (!c.incluir || c.tipo !== 'borde') return;
      Core.figuras(c).figs.forEach(f => out.push({
        pts: f,
        cerrado: f.length > 2 && f[0] === f[f.length - 1]
      }));
    });
    return out;
  }

  function recalcCurvas() {
    const eq = estado.equidistancia;
    if (!(eq > 0)) {
      estado.curvas = null;
      $('resumenCurvas').textContent = 'Escribe una equidistancia mayor que 0 (por ejemplo 0.5 o 1).';
      return;
    }
    estado.curvas = Core.curvasNivel(estado.puntos, eq, bordesDeCapas(), { suave: $('chkSuave').checked });
    const c = estado.curvas;
    if (c.puntos < 3) {
      $('resumenCurvas').textContent = 'Se necesitan al menos 3 puntos con altura para calcular curvas.';
      return;
    }
    $('resumenCurvas').innerHTML =
      '<b>Altura mín.:</b> ' + c.hMin.toFixed(2) + ' m · <b>máx.:</b> ' + c.hMax.toFixed(2) + ' m' +
      ' · <b>Niveles:</b> ' + c.curvas.length +
      (c.sinAltura ? ' · <b>Puntos sin altura (no entran):</b> ' + c.sinAltura : '');
  }

  // Lista de puntos con altura editable y botón para borrar
  function pintarTablaAlturas() {
    const tb = $('tbodyAlturas');
    tb.innerHTML = '';
    estado.puntos.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + esc(etiquetaPunto(p)) + '</td>' +
        '<td>' + p.E.toFixed(2) + '</td>' +
        '<td>' + p.N.toFixed(2) + '</td>' +
        '<td><input type="text" class="altura" inputmode="decimal" data-o="' + p.orden + '" value="' +
          (p.h === null ? '' : p.h.toFixed(3)) + '"></td>' +
        '<td><button type="button" class="borrar" data-o="' + p.orden + '">Borrar</button></td>';
      tb.appendChild(tr);
    });
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
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input type="checkbox" class="inc" data-i="' + i + '"' + (c.incluir ? ' checked' : '') + '></td>' +
        '<td><span class="sw" style="background:' + c.color + '"></span>' + esc(c.nombre) +
          (c.layer && c.layer !== c.nombre ? ' <small>(capa ' + esc(c.layer) + ')</small>' : '') + '</td>' +
        '<td><select class="tipo" data-i="' + i + '">' +
          opcionTipo('puntos', 'Puntos', c.tipo) +
          opcionTipo('linea', 'Línea abierta', c.tipo) +
          opcionTipo('borde', 'Borde (barrera)', c.tipo) +
          opcionTipo('polilinea', 'Polilínea', c.tipo) +
          opcionTipo('arco', 'Arco (curva)', c.tipo) +
          opcionTipo('circulo', 'Círculo (3+ puntos)', c.tipo) +
        '</select></td>' +
        '<td>' + r.n + '</td>' +
        '<td>' + (r.area > 0 ? r.area.toFixed(2) : '—') + '</td>' +
        '<td>' + (r.area > 0 ? r.ha.toFixed(4) : '—') + '</td>' +
        '<td>' + (r.perimetro > 0 ? r.perimetro.toFixed(2) : r.longitud > 0 ? r.longitud.toFixed(2) : '—') + '</td>' +
        '<td><input type="text" class="union" data-i="' + i + '" value="' + esc(c.union || '') +
          '" placeholder="ej: 1-2-3-4-1"' + (c.tipo === 'puntos' ? ' disabled' : '') + '></td>' +
        '<td class="aviso">' + esc(r.aviso) + '</td>';
      tb.appendChild(tr);
    });
  }

  /* ---------- mapa (SVG, norte arriba) ---------- */

  function aplicarVB() {
    const v = estado.vb;
    $('mapa').setAttribute('viewBox', [v.x, v.y, v.w, v.h].join(' '));
  }

  // Redibuja después del zoom o paneo (una vez por cuadro, para que sea fluido)
  let redibujoPendiente = false;
  function programarMapa() {
    if (redibujoPendiente) return;
    redibujoPendiente = true;
    requestAnimationFrame(() => { redibujoPendiente = false; pintarMapa(); });
  }

  // Ajusta la vista para que todo el dibujo quepa de una vez
  function ajustar(ext) {
    const pad = Math.max(ext.w, ext.h) * 0.05 || 1;
    estado.origen = { x: ext.minE, y: ext.maxN };
    // Coordenadas locales: x va de 0 a w (este), y va de 0 a h (sur, porque y = maxN - N)
    estado.vb = { x: -pad, y: -pad, w: ext.w + 2 * pad, h: ext.h + 2 * pad };
    estado.escala0 = estado.vb.w;
  }

  function pintarMapa() {
    const svg = $('mapa');
    const act = activas();
    pintarResumen(act);

    const pts = puntosDe(act);
    if (!pts.length) { svg.innerHTML = ''; return; }

    if (!estado.vb) ajustar(Core.extension(puntosParaAjustar(act)));

    const o = estado.origen;
    const sx = p => p.E - o.x;
    const sy = p => -(p.N - o.y);
    // Tamaño en pantalla: los puntos y textos mantienen su tamaño al hacer zoom
    const u = (svg.clientWidth && svg.clientHeight) ? escalaPx(svg) * 3 : Math.max(estado.vb.w, 1e-6) / 400;   // ~3 px por unidad
    const etqPts = $('chkEtqPts').checked;
    const etqArea = $('chkEtqArea').checked;

    let g = '';
    let hits = '';   // áreas de toque de los puntos (encima de todo)
    const dibujados = new Set();   // cada punto se dibuja una sola vez, aunque esté en varias capas
    act.forEach(c => {
      const col = c.color;
      if (c.tipo === 'puntos') {
        c.puntos.forEach(p => {
          if (dibujados.has(p.orden)) return;
          dibujados.add(p.orden);
          hits += '<circle class="pt" data-o="' + p.orden + '" cx="' + sx(p) + '" cy="' + sy(p) + '" r="' + (u * 6) + '" fill="rgba(0,0,0,0)" pointer-events="all"/>';
          g += '<circle cx="' + sx(p) + '" cy="' + sy(p) + '" r="' + (u * 1.5) + '" fill="' + col + '" pointer-events="none"/>';
          if (etqPts) {
            g += '<text x="' + (sx(p) + u * 2) + '" y="' + (sy(p) - u * 1.5) +
                 '" font-size="' + (u * 5) + '" fill="#222">' + esc(etiquetaPunto(p)) + '</text>';
          }
        });
        return;
      }

      if (c.tipo === 'circulo') {
        Core.figuras(c).figs.forEach(fig => {
          const ci = Core.ajusteCirculo(fig);
          if (!ci) return;
          const ctr = { E: ci.cx, N: ci.cy };
          g += '<circle cx="' + sx(ctr) + '" cy="' + sy(ctr) + '" r="' + ci.r +
               '" fill="' + col + '" fill-opacity="0.2" stroke="' + col + '" stroke-width="' + (u * 1.5) + '"/>';
          // Los vértices de la figura no se dibujan ni llevan número: el punto ya se ve en su capa.
          // Solo quedan como área de toque invisible para poder seleccionarlos.
          fig.forEach(p => {
            hits += '<circle class="pt" data-o="' + p.orden + '" cx="' + sx(p) + '" cy="' + sy(p) + '" r="' + (u * 6) + '" fill="rgba(0,0,0,0)" pointer-events="all"/>';
          });
          if (etqArea) {
            const area = Math.PI * ci.r * ci.r;
            g += '<text x="' + sx(ctr) + '" y="' + sy(ctr) + '" font-size="' + (u * 5) +
                 '" text-anchor="middle" fill="#222">' + esc(c.nombre) + '</text>';
            g += '<text x="' + sx(ctr) + '" y="' + (sy(ctr) + u * 6) + '" font-size="' + (u * 4) +
                 '" text-anchor="middle" fill="#222">' + area.toFixed(1) + ' m²</text>';
          }
        });
        return;
      }

      Core.figuras(c).figs.forEach(fig => {
        if (fig.length < 2) return;
        const cerrado = (c.tipo === 'poligono' || (c.tipo === 'polilinea' && fig.cerrada)) && fig.length >= 3;
        const d = fig.map(p => sx(p) + ',' + sy(p)).join(' ');
        g += cerrado
          ? '<polygon points="' + d + '" fill="' + col + '" fill-opacity="0.2" stroke="' + col + '" stroke-width="' + (u * 1.5) + '"/>'
          : '<polyline points="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + (u * 1.5) +
          '" stroke-dasharray="' + (c.tipo === 'borde' ? (u * 4) + ' ' + (u * 2) : 'none') + '"/>';
        // Vértices sin dibujo ni número (ver arriba): solo área de toque invisible
        (fig.origen || fig).forEach(p => {
          hits += '<circle class="pt" data-o="' + p.orden + '" cx="' + sx(p) + '" cy="' + sy(p) + '" r="' + (u * 6) + '" fill="rgba(0,0,0,0)" pointer-events="all"/>';
        });

        if (cerrado && etqArea) {
          const cx = fig.reduce((s, p) => s + sx(p), 0) / fig.length;
          const cy = fig.reduce((s, p) => s + sy(p), 0) / fig.length;
          const area = Core.calcular({ tipo: 'poligono', puntos: fig }).area;
          g += '<text x="' + cx + '" y="' + cy + '" font-size="' + (u * 5) +
               '" text-anchor="middle" fill="#222">' + esc(c.nombre) + '</text>';
          g += '<text x="' + cx + '" y="' + (cy + u * 6) + '" font-size="' + (u * 4) +
               '" text-anchor="middle" fill="#222">' + area.toFixed(1) + ' m²</text>';
        }
      });
    });

    if (estado.sel !== null) {
      const ps = estado.puntos.find(x => x.orden === estado.sel);
      if (ps && act.some(c => c.puntos.indexOf(ps) >= 0)) {
        g += '<circle cx="' + sx(ps) + '" cy="' + sy(ps) + '" r="' + (u * 3) +
             '" fill="none" stroke="#dc2626" stroke-width="' + (u * 0.8) + '"/>';
      }
    }
    if ($('chkCurvas').checked && estado.curvas && estado.curvas.curvas.length) {
      estado.curvas.curvas.forEach(cv => cv.lineas.forEach(l => {
        const d = l.pts.map(p => sx(p) + ',' + sy(p)).join(' ');
        g += '<polyline points="' + d + '" fill="none" stroke="#8b5a2b" stroke-width="' + (u * 0.6) + '"/>';
        g += '<text x="' + sx(l.etiqueta) + '" y="' + sy(l.etiqueta) + '" font-size="' + (u * 3.5) +
             '" text-anchor="middle" fill="#5b3a1a">' + cv.nivel.toFixed(2) + '</text>';
      }));
    }
    svg.innerHTML = g + hits;
    aplicarVB();
  }

  // Etiqueta de un punto: número, y si está activado, su altura (ej. "12 · 997.53")
  function etiquetaPunto(p) {
    const num = Core.numeroPunto(p);
    return ($('chkAlturas').checked && p.h !== null && p.h !== undefined) ? num + ' · ' + p.h.toFixed(2) : num;
  }

  function pintarResumen(act) {
    let n = 0, area = 0, per = 0, lon = 0;
    act.forEach(c => {
      const r = Core.calcular(c);
      n += r.n;
      if (c.tipo === 'poligono' || c.tipo === 'circulo' || c.tipo === 'polilinea') { area += r.area; per += r.perimetro; }
      if (c.tipo === 'linea' || c.tipo === 'borde' || c.tipo === 'arco' || c.tipo === 'polilinea') lon += r.longitud;
    });
    $('resumen').innerHTML =
      '<b>Capas incluidas:</b> ' + act.length +
      ' · <b>Puntos:</b> ' + n +
      ' · <b>Área polígonos:</b> ' + area.toFixed(2) + ' m² (' + (area / 10000).toFixed(4) + ' ha)' +
      ' · <b>Perímetros:</b> ' + per.toFixed(2) + ' m' +
      ' · <b>Longitud líneas:</b> ' + lon.toFixed(2) + ' m';
  }

  /* ---------- zoom y paneo ---------- */

  function svgPunto(svg, x, y) {
    const pt = svg.createSVGPoint();
    pt.x = x; pt.y = y;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  // Acerca (f < 1) o aleja (f > 1) alrededor del punto p, con límites
  function zoomEn(p, f) {
    const v = estado.vb;
    const min = estado.escala0 * 0.02;   // acercamiento máximo
    const max = estado.escala0 * 20;     // alejamiento máximo
    let nw = v.w * f;
    if (nw < min || nw > max) {
      nw = nw < min ? min : max;
      f = nw / v.w;
    }
    v.x = p.x - (p.x - v.x) * f;
    v.y = p.y - (p.y - v.y) * f;
    v.w = nw;
    v.h *= f;
  }

  function escalaPx(svg) {
    const v = estado.vb;
    return Math.max(v.w / svg.clientWidth, v.h / svg.clientHeight);
  }

  function iniciarMapa() {
    const svg = $('mapa');

    // Rueda: suave. Se normaliza según el tipo de desplazamiento; el touchpad
    // envía muchos eventos pequeños, así que el factor es bajo.
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      if (!estado.vb) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomEn(svgPunto(svg, e.clientX, e.clientY), Math.exp(dy * 0.0015));
      aplicarVB();
      programarMapa();
    }, { passive: false });

    // Pantalla táctil: un dedo mueve, dos dedos hacen zoom (pinza)
    const punteros = new Map();
    let distAnterior = null;
    let toque = null;   // para detectar un toque sobre un punto

    svg.addEventListener('pointerdown', e => {
      toque = { x: e.clientX, y: e.clientY, obj: e.target, pid: e.pointerId };
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      svg.setPointerCapture(e.pointerId);
      distAnterior = null;
    });

    svg.addEventListener('pointermove', e => {
      if (!punteros.has(e.pointerId) || !estado.vb) return;
      const prev = punteros.get(e.pointerId);
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (punteros.size === 1) {
        const k = escalaPx(svg);
        estado.vb.x -= (e.clientX - prev.x) * k;
        estado.vb.y -= (e.clientY - prev.y) * k;
      } else if (punteros.size === 2) {
        const [a, b] = Array.from(punteros.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (distAnterior && d > 0) {
          zoomEn(svgPunto(svg, (a.x + b.x) / 2, (a.y + b.y) / 2), distAnterior / d);
        }
        distAnterior = d;
      }
      aplicarVB();
      programarMapa();
    });

    const soltar = e => {
      if (toque && toque.pid === e.pointerId && Math.hypot(e.clientX - toque.x, e.clientY - toque.y) < 6) {
        // Busca el punto que está bajo el dedo o el cursor al soltar (no depende de la captura)
        const bajo = document.elementFromPoint(e.clientX, e.clientY);
        const id = bajo && bajo.getAttribute ? bajo.getAttribute('data-o') : null;
        if (id !== null && bajo.classList.contains('pt')) {
          seleccionar(Number(id));
          mostrar('Punto ' + Core.numeroPunto(estado.puntos.find(x => x.orden === Number(id)) || {}) + ' seleccionado. Edítalo abajo.');
        }
      }
      toque = null;
      punteros.delete(e.pointerId);
      distAnterior = null;
    };
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
    const curvas = $('chkCurvasDXF').checked && estado.curvas && estado.curvas.curvas.length ? estado.curvas : null;
    const txt = Core.generarDXF(act, {
      etiquetasPuntos: $('chkEtqPts').checked,
      etiquetasArea: $('chkEtqArea').checked,
      alturaTexto: alt,
      curvas: curvas
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

    // Delegación: tipo, orden de unión e inclusión de cada capa
    $('tbody').addEventListener('change', e => {
      const i = Number(e.target.getAttribute('data-i'));
      if (e.target.classList.contains('tipo')) {
        estado.capas[i].tipo = e.target.value;
        refrescar();
      } else if (e.target.classList.contains('union')) {
        estado.capas[i].union = e.target.value;
        refrescar();
      } else if (e.target.classList.contains('inc')) {
        estado.capas[i].incluir = e.target.checked;
        pintarMapa();
      }
    });

    $('equi').addEventListener('change', () => {
      const v = Number(String($('equi').value).replace(',', '.'));
      estado.equidistancia = v > 0 ? v : 0;
      refrescar();
    });
    $('chkCurvas').addEventListener('change', pintarMapa);
    $('chkSuave').addEventListener('change', () => { recalcCurvas(); pintarMapa(); });
    $('chkAlturas').addEventListener('change', pintarMapa);

    document.querySelectorAll('button.eq').forEach(b => b.addEventListener('click', () => {
      $('equi').value = b.getAttribute('data-eq');
      estado.equidistancia = Number(b.getAttribute('data-eq'));
      refrescar();
    }));

    $('btnSelAplicar').addEventListener('click', () => {
      const p = estado.puntos.find(x => x.orden === estado.sel);
      if (!p) return;
      const txt = $('selH').value.trim().replace(',', '.');
      p.h = (txt === '' || !isFinite(Number(txt))) ? null : Number(txt);
      refrescar();
      mostrarPanel();
    });
    $('btnSelBorrar').addEventListener('click', () => {
      if (estado.sel !== null) borrarPunto(estado.sel);
    });
    // Quita las figuras de ejemplo (van a "borrados", se pueden restaurar)
    $('btnQuitarFiguras').addEventListener('click', () => {
      if (!estado.croquis.trim()) return mostrar('No hay figuras del croquis dibujadas.', true);
      estado.croquis = '';          // quita las figuras; los puntos no se tocan
      regrupar();
      mostrar('Figuras quitadas. Los puntos siguen. Para volver a dibujarlas, pulsa Aplicar croquis.');
    });

    $('btnSelCerrar').addEventListener('click', () => {
      estado.sel = null;
      mostrarPanel();
      pintarMapa();
    });
    // Tecla Suprimir borra el punto seleccionado (si no estás escribiendo en un campo)
    document.addEventListener('keydown', e => {
      if (e.key !== 'Delete' || estado.sel === null) return;
      const t = e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA') return;
      borrarPunto(estado.sel);
    });

    $('btnRestaurar').addEventListener('click', () => {
      if (!estado.borrados.length) return mostrar('No hay puntos borrados.', true);
      estado.puntos = estado.puntos.concat(estado.borrados).sort((a, b) => a.orden - b.orden);
      estado.borrados = [];
      estado.sel = null;
      regrupar();
      mostrarPanel();
      mostrar('Puntos restaurados.');
    });

    // Cambiar una altura: se recalculan curvas y mapa
    $('tbodyAlturas').addEventListener('change', e => {
      if (!e.target.classList.contains('altura')) return;
      const p = estado.puntos.find(x => x.orden === Number(e.target.getAttribute('data-o')));
      if (!p) return;
      const txt = e.target.value.trim().replace(',', '.');
      p.h = (txt === '' || !isFinite(Number(txt))) ? null : Number(txt);
      refrescar();
    });

    // Borrar un punto: sale de todas las capas, de las curvas y de las áreas
    $('tbodyAlturas').addEventListener('click', e => {
      if (!e.target.classList.contains('borrar')) return;
      borrarPunto(Number(e.target.getAttribute('data-o')));
    });

    $('btnCroquis').addEventListener('click', () => {
      estado.croquis = $('croquis').value;
      if (estado.puntos.length) regrupar();
    });

    $('btnFormato').addEventListener('click', () => {
      if (!estado.puntos.length) return mostrar('No hay puntos para descargar.', true);
      descargar(estado.nombreBase + '_autocad.csv', Core.aFormatoAutocad(estado.puntos), 'text/csv;charset=utf-8');
      mostrar('Archivo en formato AutoCAD: ' + estado.puntos.length + ' puntos.');
    });

    $('btnDXF').addEventListener('click', exportarDXF);
    $('btnCSV').addEventListener('click', exportarCSV);

    iniciarMapa();
    // Evita que el gesto sobre el plano mueva la página (incluye iOS antiguos)
    $('mapa').addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  }

  iniciar();
})();
