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
    zonas: [],         // zonas dibujadas en el plano: { nombre, tipo, poly }
    ejes: [],          // ejes dibujados en el plano
    dibujo: null,      // dibujo en curso: { tipo: zona o eje, pts: [] }
    excavaciones: [], // zonas excavadas/rellenadas: { nombre, poly, cota, paso }
    quiebres: [],      // líneas de quiebre: { poly: [{E,N}] }
    triEliminados: new Set(),  // triángulos borrados por el usuario (claves)
    triCreados: [],    // triángulos creados por el usuario: [[{E,N},{E,N},{E,N}]]
    modoTin: null,     // null | 'borrar' | 'crear' (edición de triángulos)
    triTmp: [],        // puntos elegidos para crear un triángulo
    verTri: false,     // mostrar la red de triángulos
    vb: null,          // viewBox actual del mapa (coordenadas locales)
    origen: null,      // origen local del mapa: { x: minE, y: maxN }
    escala0: 1,        // ancho inicial de la vista (base para límites de zoom)
    marco: { activo: false, escala: 500, formato: 'A3', orient: 'h', E0: null, N0: null, cuadricula: 50,
             norte: true, escalaGraf: true, plano: '', proyecto: '', dibujo: '', fecha: '' }
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
        c.bloque = prev ? (prev.bloque || '') : '';
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
    actualizarSelectoresCortes();
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
    const superf = Core.superficie(estado.puntos);
    // Una línea de quiebre cerrada es un cuerpo de agua: dentro, el terreno queda a una sola cota
    // (la media de sus puntos) y sus bordes también, así las curvas no lo atraviesan.
    const lagos = [];
    const quiebresAbiertos = [];
    estado.quiebres.forEach(q => {
      const P = q.poly;
      const cerrada = P.length > 3 && Math.hypot(P[0].E - P[P.length - 1].E, P[0].N - P[P.length - 1].N) < 1e-3;
      if (cerrada) {
        const anillo = P.slice(0, -1);
        const hs = anillo.map(p => superf.alturaEn(p.E, p.N)).filter(h => h !== null);
        if (hs.length) lagos.push({ nombre: 'Lago', poly: anillo, cota: hs.reduce((s, h) => s + h, 0) / hs.length, paso: 1.0, lago: true });
      } else {
        quiebresAbiertos.push(q);
      }
    });
    const excav = estado.excavaciones.concat(lagos);
    const terreno = excav.length ? Core.terrenoConExcavaciones(estado.puntos, excav) : estado.puntos;
    const quiebres = quiebresAbiertos.map(q => q.poly.map(p => ({ E: p.E, N: p.N, h: superf.alturaEn(p.E, p.N) })));
    estado.curvas = Core.curvasNivel(terreno, eq, bordesDeCapas(), {
      suave: $('chkSuave').checked,
      quiebres: quiebres,
      triEdit: { eliminados: estado.triEliminados, creados: estado.triCreados }
    });
    const c = estado.curvas;
    if (c.puntos < 3) {
      $('resumenCurvas').textContent = 'Se necesitan al menos 3 puntos con altura para calcular curvas.';
      return;
    }
    $('resumenCurvas').innerHTML =
      '<b>Altura mín.:</b> ' + c.hMin.toFixed(2) + ' m · <b>máx.:</b> ' + c.hMax.toFixed(2) + ' m' +
      ' · <b>Niveles:</b> ' + c.curvas.length +
      (c.sinAltura ? ' · <b>Puntos sin altura (no entran):</b> ' + c.sinAltura : '') +
      (estado.excavaciones.length ? '<br><b>Terreno excavado:</b> ' + estado.excavaciones.map(e => esc(e.nombre) + ' a ' + e.cota.toFixed(2) + ' m').join(', ') : '');
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
        '<td><input type="text" class="bloque" data-i="' + i + '" value="' + esc(c.bloque || '') + '" placeholder="ARBOL" style="width:90px"></td>' +
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

  // Contenido del plano (pantalla e impresión): puntos, figuras, zonas, ejes y curvas con cota
  function construirDibujo(u, act, o) {
    const sx = p => p.E - o.x;
    const sy = p => -(p.N - o.y);
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

    // Zonas y ejes dibujados sobre el plano
    estado.zonas.concat(estado.ejes).forEach(t => {
      const trazo = t.poly.map(p => sx(p) + ',' + sy(p)).join(' ');
      if (t.tipo === 'zona') {
        g += '<polygon points="' + trazo + '" fill="#f59e0b" fill-opacity="0.12" stroke="#d97706" stroke-width="' + (u * 1.5) +
             '" stroke-dasharray="' + (u * 4) + ' ' + (u * 2) + '"/>';
      } else {
        g += '<polyline points="' + trazo + '" fill="none" stroke="#7c3aed" stroke-width="' + (u * 1.5) + '"/>';
      }
      const cx = t.poly.reduce((acc, p) => acc + sx(p), 0) / t.poly.length;
      const cy = t.poly.reduce((acc, p) => acc + sy(p), 0) / t.poly.length;
      g += '<text x="' + cx + '" y="' + cy + '" font-size="' + (u * 5) + '" text-anchor="middle" fill="' +
           (t.tipo === 'zona' ? '#92400e' : '#5b21b6') + '">' + esc(t.nombre) + '</text>';
    });
    if (estado.dibujo && estado.dibujo.pts.length) {
      const dp = estado.dibujo.pts;
      g += '<polyline points="' + dp.map(p => sx(p) + ',' + sy(p)).join(' ') + '" fill="none" stroke="#dc2626" stroke-width="' +
           (u * 1.2) + '" stroke-dasharray="' + (u * 3) + ' ' + (u * 2) + '"/>';
      dp.forEach(p => { g += '<circle cx="' + sx(p) + '" cy="' + sy(p) + '" r="' + (u * 2) + '" fill="#dc2626"/>'; });
    }

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
        // Cota a lo largo de la curva: girada según la dirección de la línea, con halo blanco para leerla
        const n = l.pts.length, k = Math.floor(n / 2);
        const pa = l.pts[Math.max(0, k - 1)], pb = l.pts[Math.min(n - 1, k + 1)];
        let ang = Math.atan2(sy(pb) - sy(pa), sx(pb) - sx(pa)) * 180 / Math.PI;
        if (ang > 90) ang -= 180;
        if (ang < -90) ang += 180;
        g += '<text transform="translate(' + sx(l.etiqueta) + ',' + sy(l.etiqueta) + ') rotate(' + ang + ')" dy="' + (-u * 0.6) +
             '" text-anchor="middle" font-size="' + (u * 3.5) + '" fill="#5b3a1a" stroke="#ffffff" stroke-width="' + (u * 0.9) +
             '" paint-order="stroke">' + cv.nivel.toFixed(2) + '</text>';
      }));
    }
    return { g: g, hits: hits };
  }

  function pintarMapa() {
    const svg = $('mapa');
    const act = activas();
    pintarResumen(act);

    const pts = puntosDe(act);
    if (!pts.length) { svg.innerHTML = ''; return; }

    if (!estado.vb) {
      const extra = estado.zonas.concat(estado.ejes).reduce((acc, t) => acc.concat(t.poly), []);
      ajustar(Core.extension(puntosParaAjustar(act).concat(extra)));
    }
    const o = estado.origen;
    // Tamaño en pantalla: los puntos y textos mantienen su tamaño al hacer zoom
    const u = (svg.clientWidth && svg.clientHeight) ? escalaPx(svg) * 3 : Math.max(estado.vb.w, 1e-6) / 400;
    const d = construirDibujo(u, act, o);
    const marco = estado.marco.activo ? construirMarco(o, false) : '';
    let red = '';
    if (estado.verTri && estado.curvas && estado.curvas.triangulos) {
      estado.curvas.triangulos.forEach(T => {
        red += '<polygon points="' + T.map(p => (p.E - o.x) + ',' + (-(p.N - o.y))).join(' ') +
               '" fill="none" stroke="#0ea5e9" stroke-opacity="0.55" stroke-width="' + (u * 0.4) + '"/>';
      });
    }
    estado.quiebres.forEach(q => {
      red += '<polyline points="' + q.poly.map(p => (p.E - o.x) + ',' + (-(p.N - o.y))).join(' ') +
             '" fill="none" stroke="#0369a1" stroke-width="' + (u * 1.2) + '" stroke-dasharray="' + (u * 3) + ' ' + (u * 1.5) + '"/>';
    });
    svg.innerHTML = d.g + red + marco + d.hits;
    aplicarVB();
  }

  /* ---------- marco de impresión, rótulo, cuadrícula, norte y escala ---------- */

  const FORMATOS = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841] };   // [corto, largo] en mm

  // Centro del marco en la vista actual del plano
  function centrarMarco(o) {
    const v = estado.vb;
    if (!o || !v) return;
    estado.marco.E0 = v.x + v.w / 2 + o.x;
    estado.marco.N0 = o.y - (v.y + v.h / 2);
  }

  // Tamaño y posición del marco en metros de terreno. Se ajusta a la escala elegida.
  function marcoGeometria(o) {
    const m = estado.marco;
    const f = FORMATOS[m.formato] || FORMATOS.A3;
    const wMM = m.orient === 'v' ? f[0] : f[1];
    const hMM = m.orient === 'v' ? f[1] : f[0];
    if (m.E0 === null || m.N0 === null) {
      if (estado.vb) centrarMarco(o);
      else { m.E0 = o.x; m.N0 = o.y; }
    }
    const mm = x => x * m.escala / 1000;     // metros de terreno que representa 1 mm de papel
    const wM = mm(wMM), hM = mm(hMM);
    return { wMM: wMM, hMM: hMM, mm: mm,
      minE: m.E0 - wM / 2, maxE: m.E0 + wM / 2, minN: m.N0 - hM / 2, maxN: m.N0 + hM / 2 };
  }

  function escalaNice(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    let mejor = p;
    [1, 2, 5, 10].forEach(k => { if (p * k <= x) mejor = p * k; });
    return mejor;
  }

  // Marco completo. soloFondo: rectángulo blanco que va debajo del dibujo al imprimir
  function construirMarco(o, soloFondo) {
    const m = estado.marco;
    const G = marcoGeometria(o);
    const mm = G.mm;
    const sx = E => E - o.x;
    const sy = N => -(N - o.y);
    const X0 = sx(G.minE), X1 = sx(G.maxE), Y0 = sy(G.maxN), Y1 = sy(G.minN);
    if (soloFondo) {
      return '<rect x="' + X0 + '" y="' + Y0 + '" width="' + (X1 - X0) + '" height="' + (Y1 - Y0) + '" fill="#ffffff"/>';
    }
    const mar = mm(10);
    const IX0 = X0 + mar, IX1 = X1 - mar, IY0 = Y0 + mar, IY1 = Y1 - mar;
    let s = '';
    const txt = (x, y, t, size, extra) => '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="#111"' + (extra || '') + '>' + t + '</text>';

    // Cuadrícula de coordenadas, con valores en los bordes
    const paso = Number(m.cuadricula);
    if (paso > 0) {
      const ne0 = G.minE + mar, ne1 = G.maxE - mar, nn0 = G.minN + mar, nn1 = G.maxN - mar;
      for (let E = Math.ceil(ne0 / paso) * paso; E <= ne1; E += paso) {
        s += '<line x1="' + sx(E) + '" y1="' + IY0 + '" x2="' + sx(E) + '" y2="' + IY1 + '" stroke="#64748b" stroke-width="' + mm(0.15) +
             '" stroke-dasharray="' + mm(2) + ' ' + mm(1) + '"/>';
        s += txt(sx(E), Y0 + mar * 0.7, Math.round(E), mm(3), ' text-anchor="middle"');
      }
      for (let N = Math.ceil(nn0 / paso) * paso; N <= nn1; N += paso) {
        s += '<line x1="' + IX0 + '" y1="' + sy(N) + '" x2="' + IX1 + '" y2="' + sy(N) + '" stroke="#64748b" stroke-width="' + mm(0.15) +
             '" stroke-dasharray="' + mm(2) + ' ' + mm(1) + '"/>';
        s += '<text transform="translate(' + (X0 + mar * 0.5) + ',' + sy(N) + ') rotate(-90)" font-size="' + mm(3) +
             '" fill="#111" text-anchor="middle">' + Math.round(N) + '</text>';
      }
    }

    // Borde del papel y área de trabajo
    s += '<rect x="' + X0 + '" y="' + Y0 + '" width="' + (X1 - X0) + '" height="' + (Y1 - Y0) + '" fill="none" stroke="#111" stroke-width="' + mm(0.6) + '"/>';
    s += '<rect x="' + IX0 + '" y="' + IY0 + '" width="' + (IX1 - IX0) + '" height="' + (IY1 - IY0) + '" fill="none" stroke="#111" stroke-width="' + mm(0.3) + '"/>';

    // Rótulo: bloque abajo a la derecha
    const rw = mm(140), rh = mm(52), RX = IX1 - rw, RY = IY1 - rh, fila = mm(9.5);
    s += '<rect x="' + RX + '" y="' + RY + '" width="' + rw + '" height="' + rh + '" fill="#ffffff" stroke="#111" stroke-width="' + mm(0.4) + '"/>';
    const filas = [
      ['PLANO', m.plano || '—'],
      ['PROYECTO', m.proyecto || '—'],
      ['ESCALA', '1:' + m.escala + '   FORMATO ' + m.formato + (m.orient === 'v' ? ' vertical' : ' horizontal')],
      ['FECHA', m.fecha || '—'],
      ['DIBUJÓ', m.dibujo || '—']
    ];
    filas.forEach((f, i) => {
      const y = RY + fila * (i + 1) - mm(2.8);
      s += '<text x="' + (RX + mm(3)) + '" y="' + y + '" font-size="' + mm(i === 0 ? 5 : 3.6) + '" fill="#111"' +
           (i === 0 ? ' font-weight="bold"' : '') + '>' + esc(f[0]) + ': ' + esc(f[1]) + '</text>';
      if (i < filas.length - 1) {
        s += '<line x1="' + RX + '" y1="' + (RY + fila * (i + 1)) + '" x2="' + (RX + rw) + '" y2="' + (RY + fila * (i + 1)) +
             '" stroke="#111" stroke-width="' + mm(0.2) + '"/>';
      }
    });

    // Norte: flecha arriba a la derecha
    if (m.norte) {
      const cx = IX1 - mm(9);
      s += '<polygon points="' + cx + ',' + (IY0 + mm(7)) + ' ' + (cx - mm(6)) + ',' + (IY0 + mm(22)) + ' ' + (cx + mm(6)) + ',' + (IY0 + mm(22)) +
           '" fill="#111"/>';
      s += txt(cx, IY0 + mm(5), 'N', mm(7), ' text-anchor="middle" font-weight="bold"');
    }

    // Escala gráfica: barra abajo a la izquierda (40 mm de papel)
    if (m.escalaGraf) {
      const L = escalaNice(40 * m.escala / 1000);          // metros que se representan
      const Lmm = L * 1000 / m.escala;                     // longitud de la barra en mm
      const x0 = IX0 + mm(6), y0 = IY1 - mm(12);
      s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + mm(Lmm / 2) + '" height="' + mm(1.5) + '" fill="#111"/>';
      s += '<rect x="' + (x0 + mm(Lmm / 2)) + '" y="' + y0 + '" width="' + mm(Lmm / 2) + '" height="' + mm(1.5) + '" fill="#ffffff" stroke="#111" stroke-width="' + mm(0.2) + '"/>';
      s += txt(x0, y0 + mm(5), '0', mm(3), ' text-anchor="middle"');
      s += txt(x0 + mm(Lmm / 2), y0 + mm(5), (L / 2 >= 1000 ? (L / 2000) + ' km' : (L / 2) + ' m'), mm(3), ' text-anchor="middle"');
      s += txt(x0 + mm(Lmm), y0 + mm(5), (L >= 1000 ? (L / 1000) + ' km' : L + ' m'), mm(3), ' text-anchor="middle"');
    }
    return s;
  }

  // Marco, cuadrícula, rótulo, norte y escala como líneas y textos en metros (para el DXF)
  function primitivasMarco(o) {
    const m = estado.marco;
    const G = marcoGeometria(o);
    const mm = G.mm;
    const L = [], T = [];
    const ln = (x1, y1, x2, y2, cap) => L.push([x1, y1, x2, y2, cap]);
    const rect = (x0, y0, x1, y1, cap) => { ln(x0, y0, x1, y0, cap); ln(x1, y0, x1, y1, cap); ln(x1, y1, x0, y1, cap); ln(x0, y1, x0, y0, cap); };
    const tx = (x, y, s, h, cap, rot) => T.push({ E: x, N: y, s: String(s), h: h, cap: cap, rot: rot || 0 });
    const mar = mm(10);
    const IX0 = G.minE + mar, IX1 = G.maxE - mar, IY0 = G.minN + mar, IY1 = G.maxN - mar;
    rect(G.minE, G.minN, G.maxE, G.maxN, 'MARCO');
    rect(IX0, IY0, IX1, IY1, 'MARCO');
    const paso = Number(m.cuadricula);
    if (paso > 0) {
      for (let E = Math.ceil(IX0 / paso) * paso; E <= IX1; E += paso) {
        ln(E, IY0, E, IY1, 'MARCO');
        tx(E - mm(4), G.maxN - mar * 0.7, Math.round(E), mm(3), 'MARCO');
      }
      for (let N = Math.ceil(IY0 / paso) * paso; N <= IY1; N += paso) {
        ln(IX0, N, IX1, N, 'MARCO');
        tx(G.minE + mar * 0.2, N - mm(4), Math.round(N), mm(3), 'MARCO', 90);
      }
    }
    // Rótulo
    const rw = mm(140), rh = mm(52), RX = IX1 - rw, RY = IY1 - rh, fila = mm(9.5);
    rect(RX, RY, RX + rw, RY + rh, 'ROTULO');
    const filas = [
      ['PLANO', m.plano || '-'],
      ['PROYECTO', m.proyecto || '-'],
      ['ESCALA', '1:' + m.escala + '   FORMATO ' + m.formato + (m.orient === 'v' ? ' vertical' : ' horizontal')],
      ['FECHA', m.fecha || '-'],
      ['DIBUJO', m.dibujo || '-']
    ];
    filas.forEach((f, i) => {
      tx(RX + mm(3), RY + fila * (i + 1) - mm(2.8), f[0] + ': ' + f[1], mm(i === 0 ? 5 : 3.6), 'ROTULO');
      if (i < filas.length - 1) ln(RX, RY + fila * (i + 1), RX + rw, RY + fila * (i + 1), 'ROTULO');
    });
    // Norte
    if (m.norte) {
      const cx = IX1 - mm(9);
      const yt = IY0 + mm(7), yb = IY0 + mm(22);
      ln(cx, yt, cx - mm(6), yb, 'MARCO');
      ln(cx - mm(6), yb, cx + mm(6), yb, 'MARCO');
      ln(cx + mm(6), yb, cx, yt, 'MARCO');
      tx(cx - mm(2.5), IY0 + mm(3), 'N', mm(7), 'MARCO');
    }
    // Escala gráfica
    if (m.escalaGraf) {
      const Lm = escalaNice(40 * m.escala / 1000);
      const Lmm = Lm * 1000 / m.escala;
      const x0 = IX0 + mm(6), y0 = IY1 - mm(12);
      rect(x0, y0, x0 + mm(Lmm / 2), y0 + mm(1.5), 'MARCO');
      rect(x0 + mm(Lmm / 2), y0, x0 + mm(Lmm), y0 + mm(1.5), 'MARCO');
      tx(x0, y0 - mm(4), '0', mm(3), 'MARCO');
      tx(x0 + mm(Lmm / 2), y0 - mm(4), Lm / 2 >= 1000 ? (Lm / 2000) + ' km' : (Lm / 2) + ' m', mm(3), 'MARCO');
      tx(x0 + mm(Lmm), y0 - mm(4), Lm >= 1000 ? (Lm / 1000) + ' km' : Lm + ' m', mm(3), 'MARCO');
    }
    return { L: L, T: T };
  }

  // SVG del plano listo para imprimir o guardar: el marco y su contenido a escala de papel
  function svgDelPlano() {
    const o = estado.origen;
    if (!o || !estado.vb) return null;
    const act = activas();
    const G = marcoGeometria(o);
    const d = construirDibujo(G.mm(0.5), act, o);
    const X0 = G.minE - o.x, X1 = G.maxE - o.x, Y0 = -(G.maxN - o.y), Y1 = -(G.minN - o.y);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + G.wMM + 'mm" height="' + G.hMM + 'mm" viewBox="' +
      X0 + ' ' + Y0 + ' ' + (X1 - X0) + ' ' + (Y1 - Y0) + '">' +
      construirMarco(o, true) + d.g + construirMarco(o, false) + '</svg>';
  }

  function imprimirPlano() {
    const svgTxt = svgDelPlano();
    if (!svgTxt) return mostrar('Primero carga puntos para imprimir el plano.', true);
    const G = marcoGeometria(estado.origen);
    const w = window.open('', '_blank');
    if (!w) return mostrar('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes.', true);
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Plano</title><style>' +
      '@page { size: ' + G.wMM + 'mm ' + G.hMM + 'mm; margin: 0; }' +
      'html, body { margin: 0; padding: 0; }' +
      'svg { display: block; width: ' + G.wMM + 'mm; height: ' + G.hMM + 'mm; }</style></head><body>' +
      svgTxt + '</body></html>');
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  }

  // Lee los datos del marco desde la pestaña y el rótulo
  function leerMarco() {
    const m = estado.marco;
    m.activo = $('chkMarco').checked;
    const esc2 = Number(String($('marcoEscala').value).replace(',', '.'));
    if (isFinite(esc2) && esc2 > 0) m.escala = esc2;
    m.formato = $('marcoFormato').value;
    m.orient = $('marcoOrient').value;
    const cu = Number(String($('marcoCuadricula').value).replace(',', '.'));
    m.cuadricula = isFinite(cu) && cu >= 0 ? cu : 0;
    m.norte = $('marcoNorte').checked;
    m.escalaGraf = $('marcoEscalaGraf').checked;
    m.plano = $('marcoPlano').value.trim();
    m.proyecto = $('marcoProyecto').value.trim();
    m.dibujo = $('marcoDibujo').value.trim();
    m.fecha = $('marcoFecha').value.trim();
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
    let marcoArr = null;   // arrastre del marco de impresión
    let distAnterior = null;
    let toque = null;   // para detectar un toque sobre un punto

    svg.addEventListener('pointerdown', e => {
      marcoArr = null;
      if (estado.marco.activo && estado.origen && punteros.size === 0) {
        const q = svgPunto(svg, e.clientX, e.clientY);
        const E = q.x + estado.origen.x, N = estado.origen.y - q.y;
        const G = marcoGeometria(estado.origen);
        if (E >= G.minE && E <= G.maxE && N >= G.minN && N <= G.maxN) marcoArr = { x: e.clientX, y: e.clientY };
      }
      toque = { x: e.clientX, y: e.clientY, obj: e.target, pid: e.pointerId };
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      svg.setPointerCapture(e.pointerId);
      distAnterior = null;
    });

    svg.addEventListener('pointermove', e => {
      if (marcoArr && punteros.size === 1) {
        const k = escalaPx(svg);
        estado.marco.E0 += (e.clientX - marcoArr.x) * k;
        estado.marco.N0 -= (e.clientY - marcoArr.y) * k;
        marcoArr = { x: e.clientX, y: e.clientY };
        pintarMapa();
        return;
      }
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
      marcoArr = null;
      if (toque && toque.pid === e.pointerId && Math.hypot(e.clientX - toque.x, e.clientY - toque.y) < 6) {
        // Busca el punto que está bajo el dedo o el cursor al soltar (no depende de la captura)
        const bajo = document.elementFromPoint(e.clientX, e.clientY);
        const id = bajo && bajo.getAttribute ? bajo.getAttribute('data-o') : null;
        if (estado.dibujo) {
          agregarVertice(e, bajo, id);
        } else if (estado.modoTin) {
          tocarTriangulo(e, bajo, id);
        } else if (id !== null && bajo.classList.contains('pt')) {
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

  /* ---------- cortes y rellenos ---------- */

  // Zonas (polilíneas cerradas) y ejes (líneas) que existen en el croquis
  function actualizarSelectoresCortes() {
    const sz = $('selZona'), se = $('selEje');
    const zonaAnt = sz.value, ejeAnt = se.value;
    // Zonas: solo las que se crean picando en el plano (no las figuras cerradas del croquis)
    const zonas = estado.zonas.map(t => t.nombre);
    const ejesCroquis = estado.capas.filter(c => c.croquis && (c.tipo === 'linea' || c.tipo === 'arco' || c.tipo === 'polilinea')).map(c => c.nombre);
    const ejes = estado.ejes.map(t => t.nombre).concat(ejesCroquis);
    sz.innerHTML = zonas.map(n => '<option value="' + esc(n) + '">' + esc(n) +
      (estado.excavaciones.some(e => e.nombre === n) ? ' (excavada)' : '') + '</option>').join('');
    se.innerHTML = ejes.map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
    if (zonas.indexOf(zonaAnt) >= 0) sz.value = zonaAnt;
    if (ejes.indexOf(ejeAnt) >= 0) se.value = ejeAnt;
  }

  /* ---------- dibujar zonas y ejes sobre el plano ---------- */

  function iniciarDibujo(tipo) {
    estado.dibujo = { tipo: tipo, pts: [] };
    actualizarEstadoDibujo();
    pintarMapa();
    mostrar(tipo === 'zona' ? 'Toca el plano para marcar la zona. Al tocar el primer punto se cierra.' :
            tipo === 'quiebre' ? 'Toca el plano para marcar la línea de quiebre. Para cerrarla (lago), toca el primer punto; si no, pulsa Terminar.' :
            'Toca el plano para marcar el eje. Pulsa Terminar al acabar.');
  }

  function actualizarEstadoDibujo() {
    const t = $('estadoDibujo');
    const d = estado.dibujo;
    if (!d) { t.textContent = ''; return; }
    const n = d.pts.length;
    const nombreTipo = { zona: 'Dibujando zona', eje: 'Dibujando eje', quiebre: 'Dibujando línea de quiebre' }[d.tipo];
    t.textContent = nombreTipo + ': ' + n + ' punto' + (n === 1 ? '' : 's') +
      (d.tipo === 'zona' ? '. Toca el primer punto para cerrarla o pulsa Terminar.' : '. Pulsa Terminar al acabar.');
  }

  // Toque durante el dibujo: agrega un vértice (si tocaste un punto del levantamiento, usa sus coordenadas)
  function agregarVertice(e, bajo, id) {
    const svg = $('mapa'), o = estado.origen, d = estado.dibujo;
    if (!o || !d) return;
    const q = svgPunto(svg, e.clientX, e.clientY);
    if ((d.tipo === 'zona' || d.tipo === 'quiebre') && d.pts.length >= 3) {
      const f = d.pts[0];
      const fx = f.E - o.x, fy = -(f.N - o.y);
      if (Math.hypot(q.x - fx, q.y - fy) < escalaPx(svg) * 14) {
        if (d.tipo === 'quiebre') d.pts.push({ E: f.E, N: f.N });   // cierra la línea (lago)
        return terminarDibujo();
      }
    }
    let E = q.x + o.x, N = o.y - q.y;
    if (id !== null && bajo && bajo.classList && bajo.classList.contains('pt')) {
      const p = estado.puntos.find(x => x.orden === Number(id));
      if (p) { E = p.E; N = p.N; }
    }
    d.pts.push({ E: E, N: N });
    actualizarEstadoDibujo();
    pintarMapa();
  }

  function terminarDibujo() {
    const d = estado.dibujo;
    if (!d) return;
    if (d.tipo === 'zona' && d.pts.length < 3) return mostrar('Una zona necesita al menos 3 puntos.', true);
    if (d.tipo === 'eje' && d.pts.length < 2) return mostrar('Un eje necesita al menos 2 puntos.', true);
    if (d.tipo === 'quiebre') {
      if (d.pts.length < 2) return mostrar('Una línea de quiebre necesita al menos 2 puntos.', true);
      estado.quiebres.push({ poly: d.pts.slice() });
      estado.dibujo = null;
      actualizarEstadoDibujo();
      recalcCurvas();
      pintarMapa();
      mostrar('Línea de quiebre ' + estado.quiebres.length + ' guardada. Las curvas se recalcularon.');
      return;
    }
    const lista = d.tipo === 'zona' ? estado.zonas : estado.ejes;
    const nombre = (d.tipo === 'zona' ? 'Z' : 'E') + (lista.length + 1);
    const poly = d.pts.slice();
    poly.cerrada = d.tipo === 'zona';
    lista.push({ nombre: nombre, tipo: d.tipo, poly: poly });
    estado.dibujo = null;
    actualizarEstadoDibujo();
    actualizarSelectoresCortes();
    pintarMapa();
    mostrar(nombre + ' guardada.');
    if (d.tipo === 'zona') mostrarCoordenadas(nombre);
  }

  /* ---------- líneas de quiebre y red de triángulos ---------- */

  function puntoEnTriangulo(E, N, T) {
    const s = (p, q, r) => (p.E - r.E) * (q.N - r.N) - (q.E - r.E) * (p.N - r.N);
    const d1 = s({ E: E, N: N }, T[0], T[1]), d2 = s({ E: E, N: N }, T[1], T[2]), d3 = s({ E: E, N: N }, T[2], T[0]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }

  function distPuntoSegmento(E, N, A, B) {
    const dx = B.E - A.E, dy = B.N - A.N;
    const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((E - A.E) * dx + (N - A.N) * dy) / L2));
    return Math.hypot(E - (A.E + t * dx), N - (A.N + t * dy));
  }

  // Modo borrar líneas: toca cerca de una línea de la red. Modo crear: toca tres puntos.
  function tocarTriangulo(e, bajo, id) {
    const svg = $('mapa'), o = estado.origen;
    if (!o) return;
    const q = svgPunto(svg, e.clientX, e.clientY);
    const E = q.x + o.x, N = o.y - q.y;
    if (estado.modoTin === 'borrar') {
      // Borra una LÍNEA (arista) de la red: los dos triángulos que la comparten forman un cuadrilátero
      // que se vuelve a triangular por la otra diagonal. Así no quedan huecos y las curvas se recalculan.
      const tris = (estado.curvas && estado.curvas.triangulos) || [];
      const tol = escalaPx(svg) * 6;
      let mejor = null, dmin = tol;
      tris.forEach((T, t) => {
        for (let k = 0; k < 3; k++) {
          const A = T[k], B = T[(k + 1) % 3];
          const dd = distPuntoSegmento(E, N, A, B);
          if (dd < dmin) { dmin = dd; mejor = { t: t, A: A, B: B }; }
        }
      });
      if (!mejor) return mostrar('Toca cerca de una línea de la red de triángulos (se ven con Ver triángulos).', true);
      const A = mejor.A, B = mejor.B;
      const esArista = T => T.some(p => p === A) && T.some(p => p === B);
      const vecinos = tris.map((T, t) => t).filter(t => t !== mejor.t && esArista(tris[t]));
      if (!vecinos.length) return mostrar('Esa línea está en el borde de la red: no tiene dos triángulos que la compartan.', true);
      const C = tris[mejor.t].find(p => p !== A && p !== B);
      const D = tris[vecinos[0]].find(p => p !== A && p !== B);
      // El cuadrilátero debe ser convexo: la nueva diagonal CD tiene que cruzar AB
      const orient = (p, q, r) => (q.E - p.E) * (r.N - p.N) - (q.N - p.N) * (r.E - p.E);
      const cruza = orient(A, B, C) * orient(A, B, D) < 0 && orient(C, D, A) * orient(C, D, B) < 0;
      if (!cruza) return mostrar('No se puede borrar esta línea: el cuadrilátero no es convexo y los triángulos se cruzarían.', true);
      estado.triEliminados.add(Core.claveTri([A, B, C]));
      estado.triEliminados.add(Core.claveTri([A, B, D]));
      estado.triCreados.push([C, A, D].map(p => ({ E: p.E, N: p.N })));
      estado.triCreados.push([C, B, D].map(p => ({ E: p.E, N: p.N })));
      recalcCurvas(); pintarMapa();
      mostrar('Línea borrada. La red se volvió a triangular y las curvas se recalcularon.');
      return;
    }
    if (estado.modoTin === 'crear') {
      // Elige el punto del levantamiento más cercano al toque (si hay uno cerca)
      let mejor = null, dist = escalaPx(svg) * 18;
      estado.puntos.forEach(p => {
        const dd = Math.hypot(p.E - E, p.N - N);
        if (dd < dist) { dist = dd; mejor = p; }
      });
      if (!mejor) return mostrar('Toca cerca de un punto del levantamiento (son 3 puntos para el triángulo).', true);
      if (estado.triTmp.some(p => p.orden === mejor.orden)) return mostrar('Ese punto ya está en el triángulo.', true);
      estado.triTmp.push(mejor);
      if (estado.triTmp.length === 3) {
        estado.triCreados.push(estado.triTmp.map(p => ({ E: p.E, N: p.N })));
        estado.triTmp = [];
        recalcCurvas(); pintarMapa();
        mostrar('Triángulo creado. Las curvas se recalcularon.');
      } else {
        mostrar('Punto ' + estado.triTmp.length + ' de 3 elegido. Toca el siguiente punto.');
      }
      actualizarEstadoModo();
    }
  }

  function actualizarEstadoModo() {
    const t = $('estadoDibujo');
    if (estado.dibujo) return;
    if (estado.modoTin === 'borrar') t.textContent = 'Modo borrar líneas: toca una línea de triángulo para quitarla.';
    else if (estado.modoTin === 'crear') t.textContent = 'Modo crear triángulo: toca 3 puntos del levantamiento (' + estado.triTmp.length + ' de 3).';
    else t.textContent = '';
  }

  // Trazo por nombre: primero los dibujados en el plano, luego los del croquis
  function obtenerTrazo(nombre) {
    const z = estado.zonas.find(t => t.nombre === nombre);
    if (z) return z.poly;
    const e = estado.ejes.find(t => t.nombre === nombre);
    if (e) return e.poly;
    return figuraDelCroquis(nombre);
  }

  // Mensajes de la sección 5: se muestran debajo de los botones y la pantalla baja hasta ahí
  function avisoCortes(texto, error) {
    const box = $('resumenVolumen');
    box.innerHTML = '<span class="' + (error ? 'error' : 'ok') + '">' + esc(texto) + '</span>';
    // Abre la sección que contiene el mensaje para que se vea aunque esté cerrada
    if (window.verPanel) window.verPanel('panel-resultado');
  }

  // Zona de volumen: solo las dibujadas en el plano
  function zonaElegida() {
    const z = estado.zonas.find(t => t.nombre === $('selZona').value);
    return z ? z.poly : null;
  }

  function numeroDe(id, defecto) {
    const v = Number(String($(id).value).replace(',', '.'));
    return isFinite(v) && v > 0 ? v : defecto;
  }

  // Polígono (zona) o trazo (eje) de una figura del croquis, por nombre
  function figuraDelCroquis(nombre) {
    const c = estado.capas.find(x => x.croquis && x.nombre === nombre);
    if (!c) return null;
    return Core.figuras(c).figs[0] || null;
  }

  function cotaDiseno() {
    const v = Number(String($('cotaDiseno').value).replace(',', '.'));
    return ($('cotaDiseno').value.trim() !== '' && isFinite(v)) ? v : null;
  }

  // Tabla con los vértices de una zona dibujada o del croquis
  function mostrarCoordenadas(nombre) {
    const zona = obtenerTrazo(nombre);
    if (!zona || zona.length < 2) return avisoCortes('Elige una zona (o dibújala) para ver sus coordenadas.', true);
    const filas = zona.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + p.E.toFixed(3) + '</td><td>' + p.N.toFixed(3) + '</td></tr>').join('');
    $('resumenVolumen').innerHTML = '<b>Coordenadas de ' + esc(nombre) + '</b> (' + zona.length + ' vértices)' +
      '<div class="tabla-alturas"><table><thead><tr><th>Vértice</th><th>Este (E)</th><th>Norte (N)</th></tr></thead><tbody>' + filas + '</tbody></table></div>';
    if (window.verPanel) window.verPanel('panel-resultado');
  }

  function calcularVolumen() {
    const cota = cotaDiseno();
    if (cota === null) return avisoCortes('Escribe la cota de diseño (ej. 997.50) en el recuadro de arriba de esta sección.', true);
    const zona = zonaElegida();
    if (!zona || zona.length < 3 || !zona.cerrada) return avisoCortes('Primero dibuja una zona en el plano (botón Dibujar zona) y elígela en Zona.', true);
    const S = Core.superficie(estado.puntos);
    const r = Core.volumenCorteRelleno(S, zona, cota, numeroDe('pasoCalc', 0.5));
    let txt = '<b>Zona ' + esc($('selZona').value) + '</b> · Cota de diseño ' + cota.toFixed(2) + ' m · ' +
      '<b>Área:</b> ' + r.area.toFixed(2) + ' m² · <b>Corte:</b> ' + r.corte.toFixed(2) + ' m³ · ' +
      '<b>Relleno:</b> ' + r.relleno.toFixed(2) + ' m³ · <b>Diferencia (corte − relleno):</b> ' + r.neto.toFixed(2) + ' m³';
    txt += '<div class="tabla-alturas"><table><thead><tr><th>Vértice</th><th>Este (E)</th><th>Norte (N)</th></tr></thead><tbody>' +
      zona.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + p.E.toFixed(3) + '</td><td>' + p.N.toFixed(3) + '</td></tr>').join('') +
      '</tbody></table></div>';
    if (r.sinDato > 0) {
      const total = r.area + r.sinDato * r.paso * r.paso;
      const pct = (r.sinDato * r.paso * r.paso / total * 100).toFixed(0);
      txt += '<br><span class="error">Atención: el ' + pct + '% de la zona no tiene puntos medidos alrededor y no se cuenta. ' +
             'Mide con el GNSS los puntos del borde de la zona y agrégalos (sección 1) o en el croquis.</span>';
    }
    $('resumenVolumen').innerHTML = txt;
    if (window.verPanel) window.verPanel('panel-resultado');
  }

  // Gráfico SVG: terreno, cota de diseño y áreas de corte (rojo) y relleno (azul)
  function svgPerfil(datos, cota, titulo, W, H) {
    const validos = datos.filter(d => d.h !== null && d.h !== undefined);
    if (!validos.length) return '<p class="error">' + esc(titulo) + ': sin datos de terreno.</p>';
    const xs = datos.map(d => d.x);
    const xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    const hs = validos.map(d => d.h).concat([cota]);
    let ymin = Math.min.apply(null, hs), ymax = Math.max.apply(null, hs);
    if (ymax - ymin < 0.2) { ymin -= 0.1; ymax += 0.1; }
    const pad = (ymax - ymin) * 0.08; ymin -= pad; ymax += pad;
    const X = x => 45 + (x - xmin) / ((xmax - xmin) || 1) * (W - 60);
    const Y = h => H - 28 - (h - ymin) / (ymax - ymin) * (H - 50);
    let g = '<text x="10" y="18" font-size="13" fill="#111">' + esc(titulo) + '</text>';
    g += '<line x1="45" y1="' + (H - 28) + '" x2="' + (W - 15) + '" y2="' + (H - 28) + '" stroke="#999"/>';
    g += '<line x1="45" y1="25" x2="45" y2="' + (H - 28) + '" stroke="#999"/>';
    g += '<text x="4" y="' + (Y(ymax) + 4) + '" font-size="11" fill="#555">' + ymax.toFixed(2) + '</text>';
    g += '<text x="4" y="' + (Y(ymin) + 4) + '" font-size="11" fill="#555">' + ymin.toFixed(2) + '</text>';
    for (let i = 0; i < datos.length - 1; i++) {
      const a = datos[i], b = datos[i + 1];
      if (a.h === null || b.h === null || a.h === undefined || b.h === undefined) continue;
      const corte = (a.h + b.h) / 2 > cota;
      g += '<polygon points="' + X(a.x) + ',' + Y(a.h) + ' ' + X(b.x) + ',' + Y(b.h) + ' ' + X(b.x) + ',' + Y(cota) + ' ' + X(a.x) + ',' + Y(cota) +
           '" fill="' + (corte ? '#ef4444' : '#3b82f6') + '" fill-opacity="0.3"/>';
    }
    g += '<line x1="45" y1="' + Y(cota) + '" x2="' + (W - 15) + '" y2="' + Y(cota) + '" stroke="#16a34a" stroke-dasharray="6 4" stroke-width="1.5"/>';
    let tramo = [];
    const cerrarTramo = () => { if (tramo.length > 1) g += '<polyline points="' + tramo.join(' ') + '" fill="none" stroke="#8b5a2b" stroke-width="2"/>'; tramo = []; };
    datos.forEach(d => {
      if (d.h === null || d.h === undefined) return cerrarTramo();
      tramo.push(X(d.x) + ',' + Y(d.h));
    });
    cerrarTramo();
    g += '<text x="' + (W - 120) + '" y="' + (Y(cota) - 4) + '" font-size="11" fill="#166534">Diseño ' + cota.toFixed(2) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' + g + '</svg>';
  }

  function dibujarCortes() {
    const cota = cotaDiseno();
    if (cota === null) return avisoCortes('Escribe la cota de diseño (ej. 997.50) en el recuadro de arriba de esta sección.', true);
    const eje = obtenerTrazo($('selEje').value);
    if (!eje || eje.length < 2) return avisoCortes('Primero dibuja un eje en el plano (botón Dibujar eje) y elígelo en Eje.', true);
    const S = Core.superficie(estado.puntos);
    const paso = numeroDe('pasoCalc', 0.5), inter = numeroDe('intervaloSec', 5), semi = numeroDe('semiancho', 10);
    const per = Core.perfilLongitudinal(S, eje, cota, paso);
    const perfilSvg = svgPerfil(per.datos.map(d => ({ x: d.s, h: d.h })), cota,
      'Perfil longitudinal · eje ' + $('selEje').value + ' · longitud ' + per.longitud.toFixed(2) + ' m', 800, 300);
    const secs = Core.seccionesTransversales(S, eje, cota, inter, semi, paso);
    const seccionesHtml = secs.map(sec => svgPerfil(sec.perfil.map(p => ({ x: p.d, h: p.h })), cota,
      'Sección en ' + sec.s.toFixed(1) + ' m · corte ' + sec.areaCorte.toFixed(2) + ' m² · relleno ' + sec.areaRelleno.toFixed(2) + ' m²', 300, 200)).join('');
    $('graficosCortes').innerHTML = perfilSvg + '<h3>Secciones transversales</h3><div class="grid-secciones">' + seccionesHtml + '</div>';
    $('resumenVolumen').innerHTML = '<span class="ok">Perfil y ' + secs.length + ' secciones calculados.</span>';
    if (window.verPanel) window.verPanel('panel-resultado');
  }

  function exportarCortes() {
    const cota = cotaDiseno();
    if (cota === null) return avisoCortes('Escribe la cota de diseño.', true);
    const eje = obtenerTrazo($('selEje').value);
    const zona = zonaElegida();
    if (!eje || eje.length < 2) return avisoCortes('Primero dibuja un eje en el plano.', true);
    const S = Core.superficie(estado.puntos);
    const paso = numeroDe('pasoCalc', 0.5), inter = numeroDe('intervaloSec', 5), semi = numeroDe('semiancho', 10);
    const f = v => (v === null || v === undefined) ? '' : Number(v).toFixed(3);
    const filas = [];
    if (zona && zona.length >= 3 && zona.cerrada) {
      const v = Core.volumenCorteRelleno(S, zona, cota, paso);
      filas.push(['VOLUMEN', 'zona', $('selZona').value, 'cota', f(cota), 'area_m2', f(v.area), 'corte_m3', f(v.corte), 'relleno_m3', f(v.relleno), 'diferencia_m3', f(v.neto)]);
      filas.push([]);
    }
    filas.push(['PERFIL', 'estacion_m', 'E', 'N', 'terreno_m', 'diseno_m']);
    Core.perfilLongitudinal(S, eje, cota, paso).datos.forEach(d => filas.push(['PERFIL', f(d.s), f(d.E), f(d.N), f(d.h), f(cota)]));
    filas.push([]);
    filas.push(['SECCION', 'estacion_m', 'desplazamiento_m', 'E', 'N', 'terreno_m', 'diseno_m', 'corte_m2', 'relleno_m2']);
    Core.seccionesTransversales(S, eje, cota, inter, semi, paso).forEach(sec => {
      sec.perfil.forEach(p => filas.push(['SECCION', f(sec.s), f(p.d), f(p.E), f(p.N), f(p.h), f(cota), f(sec.areaCorte), f(sec.areaRelleno)]));
    });
    const csv = filas.map(r => r.map(x => /[",;\r\n]/.test(String(x)) ? '"' + String(x).replace(/"/g, '""') + '"' : String(x)).join(',')).join('\r\n') + '\r\n';
    descargar(estado.nombreBase + '_cortes.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8');
    avisoCortes('CSV de cortes y rellenos generado (revisa tu carpeta de descargas).', false);
  }

  /* ---------- exportación ---------- */

  function exportarDXF() {
    const act = activas();
    if (!act.length) return mostrar('Selecciona al menos una capa.', true);
    const ext = Core.extension(puntosDe(act));
    if (!ext) return mostrar('No hay puntos para exportar.', true);
    const alt = Math.max(ext.w, ext.h, 1) / 200;   // altura de texto proporcional al dibujo
    const curvas = $('chkCurvasDXF').checked && estado.curvas && estado.curvas.curvas.length ? estado.curvas : null;
    const marco = (estado.marco.activo && $('chkMarcoDXF').checked && estado.origen) ? primitivasMarco(estado.origen) : null;
    const txt = Core.generarDXF(act, {
      marco: marco,
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
      } else if (e.target.classList.contains('bloque')) {
        estado.capas[i].bloque = e.target.value.trim().toUpperCase().replace(/\s+/g, '_');
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

    // Borrador del croquis: se guarda al escribir y se restaura al abrir la página
    const claveBorrador = 'linderos-croquis';
    try { const guardado = localStorage.getItem(claveBorrador); if (guardado) $('croquis').value = guardado; } catch (e) {}
    $('croquis').addEventListener('input', () => {
      try { localStorage.setItem(claveBorrador, $('croquis').value); } catch (e) {}
    });
    $('btnCroquis').addEventListener('click', () => {
      estado.croquis = $('croquis').value;
      if (estado.puntos.length) regrupar();
    });

    $('btnAgregarPunto').addEventListener('click', () => {
      const num = $('addNum').value.trim();
      const N = Number(String($('addN').value).replace(',', '.'));
      const E = Number(String($('addE').value).replace(',', '.'));
      const hTxt = $('addH').value.trim().replace(',', '.');
      if (!$('addN').value.trim() || !$('addE').value.trim() || !isFinite(N) || !isFinite(E)) {
        return mostrar('Escribe el Norte y el Este del punto.', true);
      }
      const h = hTxt === '' ? null : Number(hTxt);
      if (h !== null && !isFinite(h)) return mostrar('La altura no es un número.', true);
      const orden = estado.puntos.reduce((m, p) => Math.max(m, p.orden), -1) + 1;
      const nombre = num !== '' ? num : String(orden + 1);
      estado.puntos.push({ orden: orden, nombre: nombre, codigo: $('addDesc').value.trim(), N: N, E: E, h: h });
      estado.puntos.sort((x, y) => x.orden - y.orden);
      regrupar();
      $('addN').value = ''; $('addE').value = ''; $('addH').value = ''; $('addNum').value = ''; $('addDesc').value = '';
      mostrar('Punto ' + nombre + ' agregado. Total: ' + estado.puntos.length + ' puntos.');
    });

    $('btnFormato').addEventListener('click', () => {
      if (!estado.puntos.length) return mostrar('No hay puntos para descargar.', true);
      descargar(estado.nombreBase + '_autocad.csv', Core.aFormatoAutocad(estado.puntos), 'text/csv;charset=utf-8');
      mostrar('Archivo en formato AutoCAD: ' + estado.puntos.length + ' puntos.');
    });

    $('btnCalcVolumen').addEventListener('click', calcularVolumen);
    $('btnQuiebre').addEventListener('click', () => iniciarDibujo('quiebre'));
    $('btnTerminarQuiebre').addEventListener('click', terminarDibujo);
    $('chkTriangulos').addEventListener('change', () => { estado.verTri = $('chkTriangulos').checked; pintarMapa(); });
    $('btnModoBorrarTri').addEventListener('click', () => { estado.modoTin = 'borrar'; actualizarEstadoModo(); mostrar('Toca una línea de triángulo para quitarla (las curvas se recalculan).'); });
    $('btnModoCrearTri').addEventListener('click', () => { estado.modoTin = 'crear'; estado.triTmp = []; actualizarEstadoModo(); mostrar('Toca 3 puntos del levantamiento para crear un triángulo.'); });
    $('btnSalirModo').addEventListener('click', () => { estado.modoTin = null; estado.triTmp = []; actualizarEstadoModo(); });
    $('btnResetTri').addEventListener('click', () => { estado.triEliminados = new Set(); estado.triCreados = []; recalcCurvas(); pintarMapa(); mostrar('Triángulos restaurados a la red original.'); });
    $('btnQuitarQuiebres').addEventListener('click', () => { estado.quiebres = []; recalcCurvas(); pintarMapa(); mostrar('Líneas de quiebre quitadas.'); });
    $('btnVerCoords').addEventListener('click', () => mostrarCoordenadas($('selZona').value));
    $('btnAplicarExcPanel').addEventListener('click', () => $('btnAplicarExc').click());
    $('btnAplicarExc').addEventListener('click', () => {
      const cota = cotaDiseno();
      if (cota === null) return avisoCortes('Escribe la cota de diseño antes de aplicar la excavación.', true);
      const zona = zonaElegida();
      if (!zona || zona.length < 3 || !zona.cerrada) return avisoCortes('Elige una zona cerrada (Dibujar zona) antes de aplicar la excavación.', true);
      const nombre = $('selZona').value;
      estado.excavaciones = estado.excavaciones.filter(e => e.nombre !== nombre);
      estado.excavaciones.push({ nombre: nombre, poly: zona.map(p => ({ E: p.E, N: p.N })), cota: cota, paso: numeroDe('pasoCalc', 0.5) });
      $('chkCurvas').checked = true;
      refrescar();
      avisoCortes('Excavación aplicada en ' + nombre + ' a ' + cota.toFixed(2) + ' m. Las curvas ya son del terreno nuevo.', false);
    });
    $('btnQuitarExc').addEventListener('click', () => {
      const nombre = $('selZona').value;
      if (!nombre) return avisoCortes('Elige una zona para quitar su excavación.', true);
      const antes = estado.excavaciones.length;
      estado.excavaciones = estado.excavaciones.filter(e => e.nombre !== nombre);
      if (estado.excavaciones.length === antes) return avisoCortes(nombre + ' no está excavada.', true);
      refrescar();
      avisoCortes('Se quitó la excavación de ' + nombre + '. Las demás zonas no cambian.', false);
    });
    $('btnDibujarZona').addEventListener('click', () => iniciarDibujo('zona'));
    $('btnDibujarEje').addEventListener('click', () => iniciarDibujo('eje'));
    $('btnTerminarDibujo').addEventListener('click', terminarDibujo);
    $('btnDeshacerVertice').addEventListener('click', () => {
      if (!estado.dibujo) return;
      estado.dibujo.pts.pop(); actualizarEstadoDibujo(); pintarMapa();
    });
    $('btnCancelarDibujo').addEventListener('click', () => {
      estado.dibujo = null; actualizarEstadoDibujo(); pintarMapa();
      mostrar('Dibujo cancelado.');
    });
    $('btnBorrarTrazo').addEventListener('click', () => {
      const elegidos = [$('selZona').value, $('selEje').value].filter((v, i, arr) => v && arr.indexOf(v) === i);
      if (!elegidos.length) return avisoCortes('No hay zona ni eje elegido. Elígelo en la lista de arriba.', true);
      let n = 0;
      elegidos.forEach(nombre => {
        // Zonas y ejes dibujados en el plano
        const antes = estado.zonas.length + estado.ejes.length;
        estado.zonas = estado.zonas.filter(t => t.nombre !== nombre);
        estado.ejes = estado.ejes.filter(t => t.nombre !== nombre);
        n += antes - (estado.zonas.length + estado.ejes.length);
        // Figuras del croquis con ese nombre: se quita su línea del cuadro
        const lineas = $('croquis').value.split(/\r?\n/);
        const nuevas = lineas.filter(l => {
          const t = l.trim();
          if (!t || t.charAt(0) === '#') return true;
          const nom = t.split(/[\/|]/)[0].trim().toUpperCase();
          if (nom === nombre.toUpperCase()) { n++; return false; }
          return true;
        });
        if (nuevas.length !== lineas.length) {
          $('croquis').value = nuevas.join('\n');
          estado.croquis = $('croquis').value;
        }
      });
      if (!n) return avisoCortes('No encontré esa zona o eje en el plano ni en el croquis.', true);
      regrupar();
      actualizarSelectoresCortes();
      pintarMapa();
      avisoCortes(n + ' elemento(s) borrado(s): ' + elegidos.join(', ') + '.', false);
    });
    $('btnPerfil').addEventListener('click', dibujarCortes);
    $('btnCortesCSV').addEventListener('click', exportarCortes);
    // Marco e impresión
    ['chkMarco', 'marcoEscala', 'marcoFormato', 'marcoOrient', 'marcoCuadricula', 'marcoNorte', 'marcoEscalaGraf',
     'marcoPlano', 'marcoProyecto', 'marcoDibujo', 'marcoFecha'].forEach(id => {
      $(id).addEventListener('change', () => { leerMarco(); pintarMapa(); });
      $(id).addEventListener('input', () => { leerMarco(); pintarMapa(); });
    });
    $('btnCentrarMarco').addEventListener('click', () => { centrarMarco(estado.origen); pintarMapa(); });
    $('btnSVG').addEventListener('click', () => {
      const s = svgDelPlano();
      if (!s) return mostrar('Primero carga puntos para generar el plano.', true);
      descargar(estado.nombreBase + '_plano.svg', s, 'image/svg+xml');
      mostrar('Plano guardado como SVG (ábrelo en el navegador o en AutoCAD/Inkscape).');
    });
    $('btnImprimir').addEventListener('click', imprimirPlano);
    $('btnDXF').addEventListener('click', exportarDXF);
    $('btnCSV').addEventListener('click', exportarCSV);

    iniciarMapa();
    // Evita que el gesto sobre el plano mueva la página (incluye iOS antiguos)
    $('mapa').addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  }

  iniciar();
})();
