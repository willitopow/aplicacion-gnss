/*!
 * linderos-gnss · core.js
 * Lógica sin DOM: lectura de TXT / CSV / XLS(X), agrupación por código,
 * orden de unión (según croquis), cálculo de áreas y generación de DXF / CSV.
 * Licencia: MIT
 */
(function (root) {
  'use strict';

  // Nombres de columna reconocidos (cabecera). Se pueden ampliar aquí.
  const ALIAS = {
    name: /^(nombre|name|id|punto|pto|pt|point)$/i,
    code: /^(c[oó]digo|code|capa|layer|descripci[oó]n|desc)$/i,
    N:    /^(n|norte|northing|y)$/i,
    E:    /^(e|este|easting|x)$/i,
    h:    /^(h|z|cota|elev|elevaci[oó]n|altura)$/i
  };
  // Orden por defecto cuando el archivo NO trae cabecera (igual al CSV de APKSURV)
  const ORDEN_DEFECTO = { name: 0, code: 1, N: 2, E: 3, h: 4 };

  // Sugerencias de tipo según el nombre de la capa (el usuario puede cambiarlo)
  const POLI_RE  = /lindero|predio|lote|casa|edif|pergol|fuente|kiosk|piscin|[áa]rea|constru|terreno|vivienda|bodega|cancha|techo/i;
  const LINEA_RE = /cerca|v[ií]a|camino|calle|muro|tuber|drenaje|l[ií]nea|borde|acera|grada|canal|cord[oó]n|cuneta/i;

  // Colores AutoCAD (índice ACI) para las capas
  const PALETA = [1, 3, 5, 6, 2, 4, 30, 140, 200, 250, 160, 210];

  /* ---------- utilidades ---------- */

  function limpiar(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/^\uFEFF/, '')
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .trim();
  }

  // Acepta 868072.68 y también 868072,68 (decimal con coma)
  function aNumero(v) {
    if (typeof v === 'number') return v;
    let s = limpiar(v).replace(/\s/g, '');
    if (s === '') return NaN;
    if (s.indexOf(',') >= 0 && s.indexOf('.') < 0) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    return Number(s);
  }

  // Quita acentos y caracteres no ASCII (DXF R12 trabaja con ASCII/ANSI)
  function sinAcentos(s) {
    return String(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, '_');
  }

  // Número del punto para etiquetas y para el orden de unión: PT12 -> "12", Base_0 -> "0"
  function numeroPunto(p) {
    const nombre = String(p.nombre || '');
    const m = nombre.match(/(\d+)\s*$/);
    return m ? String(Number(m[1])) : nombre;
  }

  function normalizarNumero(t) {
    const s = String(t).replace(/^[A-Za-z]+/, '').trim();   // PT12 -> 12
    return /^\d+$/.test(s) ? String(Number(s)) : s;
  }

  /* ---------- lectura ---------- */

  // Texto (TXT / CSV / TSV) -> filas de celdas. Detecta el separador.
  function textoAFilas(texto) {
    const lineas = String(texto)
      .replace(/^\uFEFF/, '')
      .split(/\r\n|\r|\n/)
      .filter(l => l.trim() !== '');
    if (!lineas.length) return [];

    const primera = lineas[0];
    const cuenta = c => primera.split(c).length - 1;
    let sep = [',', ';', '\t'].reduce((a, b) => (cuenta(b) > cuenta(a) ? b : a), ',');
    if (cuenta(sep) === 0) sep = /\s+/;   // TXT separado por espacios

    return lineas.map(l => l.split(sep).map(limpiar));
  }

  // Libro Excel (XLS / XLSX) -> filas. Requiere la librería SheetJS (XLSX) ya cargada.
  function libroAFilas(XLSX, datos) {
    const libro = XLSX.read(datos, { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    return XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '' });
  }

  function tipoColumna(texto) {
    const t = limpiar(texto);
    for (const k of ['name', 'code', 'N', 'E', 'h']) {
      if (ALIAS[k].test(t)) return k;
    }
    return null;
  }

  // Archivo sin cabecera: detecta qué es cada columna por su contenido.
  //  - columna numérica entera y primera  -> número / nombre del punto
  //  - numéricas grandes (>1000)          -> coordenadas: la primera es el Norte, la segunda el Este
  //  - numérica pequeña                   -> altura
  //  - texto                              -> descripción (código)
  // Sirve para: Nombre,Código,N,E,h  |  Número,N,E,h,Código  |  Nombre,N,E,h  |  etc.
  function detectarSinCabecera(filas) {
    const ncol = Math.max.apply(null, filas.map(f => f.length));
    const estad = [];
    for (let c = 0; c < ncol; c++) {
      let num = 0, tot = 0, suma = 0, enteros = 0;
      filas.forEach(f => {
        const v = limpiar(f[c]);
        if (v === '') return;
        tot++;
        const x = aNumero(f[c]);
        if (isFinite(x)) { num++; suma += Math.abs(x); if (Number.isInteger(x)) enteros++; }
      });
      estad.push({
        numerica: tot > 0 && num / tot > 0.9,
        media: num ? suma / num : 0,
        entera: tot > 0 && enteros === tot
      });
    }
    const mapa = {};
    // Columna 0 entera -> número del punto (no es coordenada)
    let inicio = 0;
    if (estad[0].numerica && estad[0].entera) { mapa.name = 0; inicio = 1; }
    const coords = [], alturas = [], textos = [];
    for (let c = inicio; c < ncol; c++) {
      const e = estad[c];
      if (e.numerica && e.media > 1000) coords.push(c);
      else if (e.numerica) alturas.push(c);
      else textos.push(c);
    }
    if (coords.length < 2) return Object.assign({}, ORDEN_DEFECTO);   // no se pudo detectar: formato de APKSURV
    mapa.N = coords[0];
    mapa.E = coords[1];
    if (alturas.length) mapa.h = alturas[0];
    if (mapa.name === undefined && textos.length) { mapa.name = textos[0]; textos.shift(); }
    if (textos.length) mapa.code = textos[0];
    return mapa;
  }

  // Filas -> puntos { nombre, codigo, N, E, h }
  function filasAPuntos(filas) {
    filas = filas.filter(f => f && f.some(c => limpiar(c) !== ''));
    if (!filas.length) throw new Error('El archivo está vacío.');

    const tipos = filas[0].map(tipoColumna);
    let mapa, inicio = 0;
    if (tipos.indexOf('N') >= 0 && tipos.indexOf('E') >= 0) {
      mapa = {};
      tipos.forEach((t, i) => { if (t && mapa[t] === undefined) mapa[t] = i; });
      inicio = 1;
    } else {
      mapa = detectarSinCabecera(filas);
    }
    if (mapa.N === undefined || mapa.E === undefined) {
      throw new Error('No encuentro las columnas N (norte) y E (este).');
    }

    const puntos = [], omitidos = [];
    filas.slice(inicio).forEach((f, i) => {
      const N = aNumero(f[mapa.N]);
      const E = aNumero(f[mapa.E]);
      if (!isFinite(N) || !isFinite(E)) { omitidos.push(i + inicio + 1); return; }
      const h = mapa.h !== undefined ? aNumero(f[mapa.h]) : NaN;
      const nombre = mapa.name !== undefined ? limpiar(f[mapa.name]) : '';
      puntos.push({
        orden: puntos.length,
        nombre: nombre || String(puntos.length + 1),
        codigo: mapa.code !== undefined ? limpiar(f[mapa.code]) : '',
        N: N,
        E: E,
        h: isFinite(h) ? h : null
      });
    });
    if (!puntos.length) throw new Error('No hay puntos con N y E válidos.');
    return { puntos: puntos, omitidos: omitidos, mapa: mapa, encabezado: inicio === 1 };
  }

  /* ---------- agrupación ---------- */

  // Orden numérico natural: PT2 < PT10
  function ordenar(puntos) {
    return puntos.slice().sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es', { numeric: true, sensitivity: 'base' }) ||
      a.orden - b.orden);
  }

  function nombreCapa(codigo) {
    return (limpiar(codigo) || 'SIN_CODIGO').toUpperCase();
  }

  // Nombre del layer (capa DXF) a partir de la figura: ZV1 -> ZV, GR12 -> GR, CASA -> CASA
  function capaDeFigura(nombre) {
    const s = String(nombre).replace(/[\s_\-]*\d+$/, '');
    return s || nombre;
  }

  function tipoSugerido(nombre) {
    if (/fuente/i.test(nombre)) return 'circulo';
    if (POLI_RE.test(nombre)) return 'poligono';
    if (LINEA_RE.test(nombre)) return 'linea';
    return 'puntos';
  }

  // Cada código es una figura (ZV1, ZV2, C1…). Con la opción "separar" el layer
  // es el nombre sin número (ZV). Sin ella, cada código es su propio layer.
  function agrupar(puntos, opciones) {
    const separar = !!(opciones && opciones.quitarNumero);
    const mapa = new Map();
    puntos.forEach(p => {
      const k = nombreCapa(p.codigo);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(p);
    });
    return Array.from(mapa, ([nombre, pts]) => ({
      nombre: nombre,
      layer: separar ? capaDeFigura(nombre) : nombre,
      tipo: 'puntos',
      puntos: ordenar(pts),
      union: ''
    }));
  }

  /* ---------- orden de unión (croquis) ---------- */

  // Convierte el texto de unión en figuras.
  //  "1-2-3-4-1"       -> una figura (si es polígono, se cierra)
  //  "1-2-3; 5-6-7"    -> dos figuras separadas por ";"
  // Si la capa es "puntos", el orden de unión no se aplica.
  // Arco: curva suave que pasa por los puntos en orden (Catmull-Rom).
  // Si la lista se cierra (repite el primer número), la curva vuelve al inicio.
  function muestrearArco(pts, cerrada) {
    const n = pts.length;
    if (n < 2) return pts;
    const k = 12;
    const P = i => cerrada ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
    const mix = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    const out = [];
    const seg = cerrada ? n : n - 1;
    for (let q = 0; q < seg; q++) {
      const p0 = P(q - 1), p1 = P(q), p2 = P(q + 1), p3 = P(q + 2);
      for (let j = 0; j < k; j++) {
        const t = j / k;
        const h = (p1.h !== null && p1.h !== undefined && p2.h !== null && p2.h !== undefined) ? p1.h + (p2.h - p1.h) * t : null;
        out.push({ E: mix(p0.E, p1.E, p2.E, p3.E, t), N: mix(p0.N, p1.N, p2.N, p3.N, t), h: h });
      }
    }
    const fin = cerrada ? pts[0] : pts[n - 1];
    out.push({ E: fin.E, N: fin.N, h: fin.h });
    out.origen = pts;
    out.cerrada = cerrada;
    return out;
  }

  function figuras(capa) {
    if (capa.tipo === 'puntos' || !limpiar(capa.union)) {
      return { figs: [capa.puntos], avisos: [] };
    }
    const porNum = new Map();
    capa.puntos.forEach(p => {
      const k = normalizarNumero(numeroPunto(p));
      if (!porNum.has(k)) porNum.set(k, p);
    });

    const figs = [], avisos = [];
    String(capa.union).split(';').forEach(grupo => {
      const tokens = grupo.trim().split(/[\s,\-]+/).filter(Boolean);
      if (!tokens.length) return;
      const pts = [];
      tokens.forEach(t => {
        const p = porNum.get(normalizarNumero(t));
        if (p) pts.push(p);
        else avisos.push('No existe el punto ' + t);
      });
      // Si el último punto repite el primero, el polígono ya queda cerrado
      const cerrada = (capa.tipo === 'polilinea' || capa.tipo === 'poligono' || capa.tipo === 'arco') &&
        pts.length > 1 && pts[0] === pts[pts.length - 1];
      if (cerrada) pts.pop();
      pts.cerrada = cerrada;
      if (capa.tipo === 'arco') { if (pts.length) figs.push(muestrearArco(pts, cerrada)); return; }
      if (pts.length) figs.push(pts);
    });
    return { figs: figs, avisos: avisos };
  }

  /* ---------- geometría ---------- */

  function distancia(a, b) {
    return Math.hypot(b.E - a.E, b.N - a.N);
  }

  function perimetro(pts, cerrado) {
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) L += distancia(pts[i], pts[i + 1]);
    if (cerrado && pts.length > 2) L += distancia(pts[pts.length - 1], pts[0]);
    return L;
  }

  // Fórmula de Gauss (lazos). Se resta el primer punto para evitar errores
  // de redondeo con coordenadas grandes (p. ej. 1058864.29).
  function areaGauss(pts) {
    if (pts.length < 3) return 0;
    const x0 = pts[0].E, y0 = pts[0].N;
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += (a.E - x0) * (b.N - y0) - (b.E - x0) * (a.N - y0);
    }
    return Math.abs(s) / 2;
  }

  // Círculo que mejor se ajusta a los puntos (mínimos cuadrados).
  // Con 3 puntos no alineados es el círculo exacto que pasa por ellos.
  function ajusteCirculo(pts) {
    const n = pts.length;
    if (n < 3) return null;
    let mx = 0, my = 0;
    pts.forEach(p => { mx += p.E; my += p.N; });
    mx /= n; my /= n;
    let Suu = 0, Svv = 0, Suv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
    pts.forEach(p => {
      const u = p.E - mx, v = p.N - my;
      Suu += u * u; Svv += v * v; Suv += u * v;
      Suuu += u * u * u; Svvv += v * v * v;
      Suvv += u * v * v; Svuu += v * u * u;
    });
    const D = (Suuu + Suvv) / 2, E = (Svvv + Svuu) / 2;
    const den = Suu * Svv - Suv * Suv;
    if (Math.abs(den) < 1e-9) return null;          // puntos alineados
    const uc = (D * Svv - Suv * E) / den;
    const vc = (Suu * E - Suv * D) / den;
    const r = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);
    const cx = mx + uc, cy = my + vc;
    let desv = 0;
    pts.forEach(p => { desv = Math.max(desv, Math.abs(Math.hypot(p.E - cx, p.N - cy) - r)); });
    return { cx: cx, cy: cy, r: r, desv: desv };
  }

  // Tolerancia aceptable de desviación de los puntos respecto al círculo
  function tolerancia(r) { return Math.max(0.05, 0.01 * r); }

  // Calcula sobre todas las figuras de la capa
  function calcular(capa) {
    const f = figuras(capa);
    const avisos = f.avisos.slice();
    const r = { n: 0, area: 0, ha: 0, perimetro: 0, longitud: 0, aviso: '' };
    f.figs.forEach(pts => {
      r.n += (pts.origen || pts).length;
      if (capa.tipo === 'circulo') {
        const c = ajusteCirculo(pts);
        if (!c) { avisos.push('Un círculo necesita 3 puntos no alineados'); return; }
        if (c.desv > tolerancia(c.r)) avisos.push('Puntos fuera del círculo (desviación máx. ' + c.desv.toFixed(2) + ' m)');
        r.area += Math.PI * c.r * c.r;
        r.perimetro += 2 * Math.PI * c.r;
        return;
      }
      if (capa.tipo === 'poligono' || (capa.tipo === 'polilinea' && pts.cerrada)) {
        if (pts.length < 3) avisos.push('Una figura tiene menos de 3 puntos');
        r.area += areaGauss(pts);
        r.perimetro += perimetro(pts, true);
      } else if (capa.tipo === 'polilinea' || capa.tipo === 'arco') {
        if (pts.length < 2) avisos.push('Una línea tiene menos de 2 puntos');
        r.longitud += perimetro(pts, !!pts.cerrada && capa.tipo === 'arco');
      } else if (capa.tipo === 'linea' || capa.tipo === 'borde') {
        if (pts.length < 2) avisos.push('Una línea tiene menos de 2 puntos');
        r.longitud += perimetro(pts, false);
      }
    });
    r.ha = r.area / 10000;
    r.aviso = avisos.join('; ');
    return r;
  }

  function extension(puntos) {
    if (!puntos || !puntos.length) return null;
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    puntos.forEach(p => {
      if (p.E < minE) minE = p.E;
      if (p.E > maxE) maxE = p.E;
      if (p.N < minN) minN = p.N;
      if (p.N > maxN) maxN = p.N;
    });
    return { minE: minE, maxE: maxE, minN: minN, maxN: maxN, w: maxE - minE, h: maxN - minN };
  }

  // Croquis: una línea por figura, "NOMBRE / tipo / orden de unión" (también acepta |).
  // Los números pueden pertenecer a cualquier código. Líneas con # se ignoran.
  function croquis(texto, puntos) {
    const porNum = new Map();
    puntos.forEach(p => {
      const k = normalizarNumero(numeroPunto(p));
      if (!porNum.has(k)) porNum.set(k, p);
    });
    const capas = [], avisos = [];
    String(texto || '').split(/\r?\n/).forEach(linea => {
      const l = linea.trim();
      if (!l || l.charAt(0) === '#') return;
      const partes = l.split(/[\/|]/).map(x => x.trim());
      if (partes.length < 3 || !partes[0]) {
        avisos.push('Línea mal escrita (usa NOMBRE | tipo | orden): ' + l);
        return;
      }
      const nombre = partes[0].toUpperCase();
      const t = partes[1].toLowerCase();
      const tipo = t.indexOf('pun') === 0 || t === 'p' ? 'puntos'
        : t.indexOf('lin') === 0 || t === 'l' ? 'linea'
        : t.indexOf('cir') === 0 || t === 'c' ? 'circulo'
        : t.indexOf('bor') === 0 || t === 'b' ? 'borde'
        : t.indexOf('arc') === 0 || t.indexOf('cur') === 0 || t === 'a' ? 'arco'
        : 'polilinea';
      const union = partes.slice(2).join('/');
      const usados = [];
      union.split(';').forEach(g => {
        g.trim().split(/[\s,\-]+/).filter(Boolean).forEach(tok => {
          const p = porNum.get(normalizarNumero(tok));
          if (p) { if (usados.indexOf(p) < 0) usados.push(p); }
          else avisos.push('No existe el punto ' + tok + ' (' + nombre + ')');
        });
      });
      capas.push({ nombre: nombre, layer: capaDeFigura(nombre), tipo: tipo, puntos: usados, union: union, croquis: true });
    });
    return { capas: capas, avisos: avisos };
  }

  /* ---------- triangulación y curvas de nivel ---------- */

  // Triangulación de Delaunay (Bowyer–Watson). Devuelve triángulos [i, j, k] (índices de pts).
  function triangular(pts) {
    const n = pts.length;
    if (n < 3) return [];
    let mx = 0, my = 0;
    pts.forEach(p => { mx += p.E; my += p.N; });
    mx /= n; my /= n;
    const P = pts.map(p => ({ x: p.E - mx, y: p.N - my }));   // coordenadas locales (precisión)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    P.forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const dm = Math.max(maxX - minX, maxY - minY) || 1;
    P.push({ x: 0, y: 20 * dm }, { x: -20 * dm, y: -20 * dm }, { x: 20 * dm, y: -20 * dm });

    function circ(i, j, k) {
      const a = P[i], b = P[j], c = P[k];
      const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
      if (Math.abs(d) < 1e-12) return { x: 0, y: 0, r: Infinity };
      const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
      const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
      const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
      return { x: x, y: y, r: Math.hypot(a.x - x, a.y - y) };
    }
    const crear = (i, j, k) => ({ v: [i, j, k], cc: circ(i, j, k) });

    let tris = [crear(n, n + 1, n + 2)];
    for (let i = 0; i < n; i++) {
      const p = P[i];
      const malos = [], buenos = [];
      tris.forEach(t => {
        const d = Math.hypot(p.x - t.cc.x, p.y - t.cc.y);
        if (d < t.cc.r) malos.push(t); else buenos.push(t);
      });
      const aristas = new Map();
      malos.forEach(t => {
        const v = t.v;
        [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]].forEach(([u, w]) => {
          const k = u < w ? u + ',' + w : w + ',' + u;
          aristas.set(k, (aristas.get(k) || 0) + 1);
        });
      });
      const nuevos = [];
      aristas.forEach((cnt, k) => {
        if (cnt === 1) {
          const [u, w] = k.split(',').map(Number);
          nuevos.push(crear(u, w, i));
        }
      });
      tris = buenos.concat(nuevos);
    }
    return tris.filter(t => t.v[0] < n && t.v[1] < n && t.v[2] < n).map(t => t.v);
  }

  // Clave de punto para unir segmentos: redondeo a 0.1 mm; el +0 evita -0 frente a 0
  function claveP(p) { return (Math.round(p.E * 1e4) + 0) + ',' + (Math.round(p.N * 1e4) + 0); }

  // ¿Los segmentos ab y cd se cruzan (también si uno pasa justo por un extremo del otro)?
  function cruza(a, b, c, d) {
    const o = (p, q, r) => (q.E - p.E) * (r.N - p.N) - (q.N - p.N) * (r.E - p.E);
    const enSeg = (p, q, r) =>
      Math.min(p.E, q.E) - 1e-9 <= r.E && r.E <= Math.max(p.E, q.E) + 1e-9 &&
      Math.min(p.N, q.N) - 1e-9 <= r.N && r.N <= Math.max(p.N, q.N) + 1e-9;
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    if (d1 === 0 && enSeg(c, d, a)) return true;
    if (d2 === 0 && enSeg(c, d, b)) return true;
    if (d3 === 0 && enSeg(a, b, c)) return true;
    if (d4 === 0 && enSeg(a, b, d)) return true;
    return false;
  }

  // Cruce estricto: solo cuenta si las dos líneas se cruzan de verdad (no al tocarse en un extremo)
  function cruzaEstricto(a, b, c, d) {
    const o = (p, q, r) => (q.E - p.E) * (r.N - p.N) - (q.N - p.N) * (r.E - p.E);
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  // Corte de esquinas (Chaikin): cada vuelta suaviza la línea. Los extremos de una curva abierta se mantienen.
  function chaikin(pts, cerrada) {
    const out = [];
    const mezcla = (A, B) => [
      { E: 0.75 * A.E + 0.25 * B.E, N: 0.75 * A.N + 0.25 * B.N },
      { E: 0.25 * A.E + 0.75 * B.E, N: 0.25 * A.N + 0.75 * B.N }
    ];
    if (cerrada) {
      const n = pts.length;
      for (let i = 0; i < n; i++) out.push(...mezcla(pts[i], pts[(i + 1) % n]));
      return out;
    }
    out.push({ E: pts[0].E, N: pts[0].N });
    for (let i = 0; i < pts.length - 1; i++) out.push(...mezcla(pts[i], pts[i + 1]));
    const u = pts[pts.length - 1];
    out.push({ E: u.E, N: u.N });
    return out;
  }

  // Suaviza una curva sin dejar que ninguna vuelta cruce un borde
  function suavizarLinea(pts, muros, vueltas) {
    if (pts.length < 3) return pts;
    const cerrada = Math.hypot(pts[0].E - pts[pts.length - 1].E, pts[0].N - pts[pts.length - 1].N) < 1e-3;
    let base = cerrada ? pts.slice(0, -1) : pts.slice();
    let actual = pts;
    for (let k = 0; k < vueltas; k++) {
      const nuevo = chaikin(base, cerrada);
      const seq = cerrada ? nuevo.concat([nuevo[0]]) : nuevo;
      let choca = false;
      for (let i = 0; i < seq.length - 1 && !choca; i++) {
        for (const m of muros) {
          if (cruzaEstricto(seq[i], seq[i + 1], m[0], m[1])) { choca = true; break; }
        }
      }
      if (choca) break;
      base = nuevo;
      actual = seq;
    }
    return actual;
  }

  // Curvas de nivel.
  //  puntos:  todos los puntos (con altura h)
  //  bordes:  [{ pts: [punto, ...], cerrado: true/false }]
  // Un borde se interpola entre sus propios puntos (cada 1 m) y actúa como barrera:
  // ningún triángulo cruza el borde, así que las alturas de un lado no se mezclan
  // con las del otro, y las curvas terminan en el borde.
  function curvasNivel(puntos, equidistancia, bordes, opciones) {
    const eq = Number(equidistancia);
    const o = Object.assign({ suave: false, vueltas: 3 }, opciones || {});
    const pts = puntos.filter(p => p.h !== null && p.h !== undefined && isFinite(p.h));
    const res = { curvas: [], puntos: pts.length, sinAltura: puntos.length - pts.length, hMin: null, hMax: null };
    if (pts.length < 3 || !(eq > 0)) return res;

    let hMin = Infinity, hMax = -Infinity;
    pts.forEach(p => { hMin = Math.min(hMin, p.h); hMax = Math.max(hMax, p.h); });
    res.hMin = hMin; res.hMax = hMax;

    // Lista de puntos para la triangulación (incluye los puntos densificados del borde)
    const todos = pts.slice();
    const idx = new Map();
    todos.forEach((p, i) => idx.set(p, i));
    const indiceDe = p => {
      if (!idx.has(p)) { idx.set(p, todos.length); todos.push(p); }
      return idx.get(p);
    };

    const aristasMuro = new Set();   // "i,j" de aristas que forman parte de un borde
    const vertMuro = new Set();      // índices de los puntos que forman el borde
    const muros = [];                // segmentos de borde (para detectar triángulos que lo cruzan)
    (bordes || []).forEach(b => {
      const v = b.pts;
      if (!v || v.length < 2) return;
      if (v.some(p => !p || p.h === null || p.h === undefined || !isFinite(p.h))) return;  // borde sin alturas: se omite
      const n = b.cerrado ? v.length : v.length - 1;
      for (let q = 0; q < n; q++) {
        const A = v[q], B = v[(q + 1) % v.length];
        if (A === B) continue;
        // Cortes exactos: en cada tramo, el punto donde pasa cada curva pedida (múltiplo de la equidistancia)
        const cortes = [];
        if (B.h !== A.h) {
          const h0 = Math.min(A.h, B.h), h1 = Math.max(A.h, B.h);
          for (let m = Math.ceil(h0 / eq); m * eq <= h1; m++) {
            const L = m * eq;
            const t = (L - A.h) / (B.h - A.h);
            if (t <= 1e-9 || t >= 1 - 1e-9) continue;   // coincide con un vértice (ya existe)
            cortes.push({ t: t, h: L });
          }
          cortes.sort((x, y) => x.t - y.t);
        }
        const secuencia = cortes
          .map(c => ({ E: A.E + c.t * (B.E - A.E), N: A.N + c.t * (B.N - A.N), h: c.h }))
          .concat([B]);
        let anterior = indiceDe(A);
        secuencia.forEach(obj => {
          const actual = indiceDe(obj);
          aristasMuro.add(Math.min(anterior, actual) + ',' + Math.max(anterior, actual));
          vertMuro.add(anterior); vertMuro.add(actual);
          muros.push([todos[anterior], todos[actual]]);
          anterior = actual;
        });
      }
    });

    // Triángulos que no cruzan ningún borde
    const tris = triangular(todos).filter(([i, j, k]) => {
      const T = [i, j, k];
      for (let e = 0; e < 3; e++) {
        const a = T[e], b = T[(e + 1) % 3];
        const clave = a < b ? a + ',' + b : b + ',' + a;
        if (aristasMuro.has(clave)) continue;          // arista del borde: permitida (el borde termina la curva)
        const ta = todos[a], tb = todos[b];
        for (const m of muros) {
          // Aristas que comparten un vértice con el borde no cuentan como cruce
          if (m[0] === ta || m[0] === tb || m[1] === ta || m[1] === tb) continue;
          if (cruza(ta, tb, m[0], m[1])) return false;
        }
      }
      return true;
    });

    const porNivel = new Map();   // m (múltiplo de eq) -> [[cruce, cruce], ...]
    tris.forEach((I, t) => {
      const T = I.map(i => todos[i]);
      const tmin = Math.min(T[0].h, T[1].h, T[2].h);
      const tmax = Math.max(T[0].h, T[1].h, T[2].h);
      for (let m = Math.ceil(tmin / eq); m * eq <= tmax; m++) {
        // Nivel desplazado 1e-7 veces la equidistancia: ningún vértice queda justo sobre la curva
        const L = m * eq + eq * 1e-7;
        const cruces = [];
        for (let e = 0; e < 3; e++) {
          const f = (e + 1) % 3;
          const lo = I[e] < I[f] ? e : f, hi = I[e] < I[f] ? f : e;
          const a = T[lo], b = T[hi];
          let ha = a.h - L, hb = b.h - L;
          if ((ha < 0) !== (hb < 0)) {
            const tt = ha / (ha - hb);
            const pt = { E: a.E + tt * (b.E - a.E), N: a.N + tt * (b.N - a.N) };
            const clave = I[lo] < I[hi] ? I[lo] + ',' + I[hi] : I[hi] + ',' + I[lo];
            // En un borde, cada lado tiene su propia clave: la curva termina allí.
            // Cruces justo en un vértice del borde también se separan por lado.
            const enBorde = aristasMuro.has(clave) ||
              (vertMuro.has(I[lo]) && tt < 1e-3) || (vertMuro.has(I[hi]) && tt > 1 - 1e-3);
            pt.k = enBorde ? 'M' + t + '_' + e : claveP(pt);
            cruces.push(pt);
          }
        }
        if (cruces.length === 2 && cruces[0].k !== cruces[1].k &&
            Math.hypot(cruces[0].E - cruces[1].E, cruces[0].N - cruces[1].N) > 1e-9) {
          if (!porNivel.has(m)) porNivel.set(m, []);
          porNivel.get(m).push(cruces);
        }
      }
    });

    porNivel.forEach((segs, m) => {
      const adj = new Map();
      segs.forEach((s, i) => s.forEach((p, end) => {
        if (!adj.has(p.k)) adj.set(p.k, []);
        adj.get(p.k).push({ i: i, end: end });
      }));
      const usado = segs.map(() => false);
      const extender = (linea, alFinal) => {
        for (;;) {
          const p = alFinal ? linea[linea.length - 1] : linea[0];
          const cand = (adj.get(p.k) || []).find(x => !usado[x.i]);
          if (!cand) break;
          usado[cand.i] = true;
          const otro = segs[cand.i][cand.end === 0 ? 1 : 0];
          if (alFinal) linea.push(otro); else linea.unshift(otro);
        }
      };
      const lineas = [];
      segs.forEach((s, i) => {
        if (usado[i]) return;
        usado[i] = true;
        const linea = [s[0], s[1]];
        extender(linea, true);
        extender(linea, false);
        const suave = o.suave ? suavizarLinea(linea, muros, o.vueltas) : linea;
        const mid = suave[Math.floor(suave.length / 2)];
        lineas.push({ pts: suave, etiqueta: { E: mid.E, N: mid.N } });
      });
      res.curvas.push({ nivel: m * eq, lineas: lineas });
    });
    res.curvas.sort((a, b) => a.nivel - b.nivel);
    return res;
  }

  /* ---------- DXF (AutoCAD R12, ASCII) ---------- */

  function nombreLayerDXF(nombre, usados) {
    const base = sinAcentos(nombre)
      .replace(/[<>\/\\":;?*|=`,]/g, '_')
      .replace(/\s+/g, '_')
      .toUpperCase()
      .slice(0, 255) || 'CAPA';
    let nombreFinal = base, k = 2;
    while (usados.has(nombreFinal)) nombreFinal = base + '_' + (k++);
    usados.add(nombreFinal);
    return nombreFinal;
  }

  // capas: [{ nombre, layer, tipo, puntos, union }] -> texto DXF (un layer por nombre común)
  function generarDXF(capas, opciones) {
    const o = Object.assign({ etiquetasPuntos: true, etiquetasArea: true, alturaTexto: 1 }, opciones || {});
    const out = [];
    const par = (codigo, valor) => { out.push(String(codigo), String(valor)); };
    const num = v => Number(v).toFixed(4);
    const z = p => (p.h === null || p.h === undefined ? 0 : p.h);

    const usados = new Set(['0']);
    const mapaCapa = new Map();   // nombre de layer -> { ly, color }
    capas.forEach(c => {
      const clave = c.layer || c.nombre;
      if (!mapaCapa.has(clave)) {
        mapaCapa.set(clave, { ly: nombreLayerDXF(clave, usados), color: PALETA[mapaCapa.size % PALETA.length] });
      }
    });
    const items = capas.map(c => ({ capa: c, ly: mapaCapa.get(c.layer || c.nombre).ly }));
    let lyCurvas = null, lyTxt = null;
    if (o.curvas && o.curvas.curvas && o.curvas.curvas.length) {
      lyCurvas = nombreLayerDXF('CURVAS', usados);
      lyTxt = nombreLayerDXF('CURVAS_TXT', usados);
      mapaCapa.set('__curvas', { ly: lyCurvas, color: 8 });
      mapaCapa.set('__txt', { ly: lyTxt, color: 2 });
    }

    const texto = (ly, x, y, s, alt) => {
      par(0, 'TEXT'); par(8, ly); par(10, num(x)); par(20, num(y)); par(30, '0');
      par(40, num(alt)); par(1, sinAcentos(s));
    };

    // HEADER
    par(0, 'SECTION'); par(2, 'HEADER');
    par(9, '$ACADVER'); par(1, 'AC1009');
    par(9, '$DWGCODEPAGE'); par(3, 'ANSI_1252');
    par(9, '$INSUNITS'); par(70, 6);            // 6 = metros
    par(0, 'ENDSEC');

    // TABLES (capas)
    par(0, 'SECTION'); par(2, 'TABLES');
    par(0, 'TABLE'); par(2, 'LAYER'); par(70, mapaCapa.size + 1);
    par(0, 'LAYER'); par(2, '0'); par(70, 0); par(62, 7); par(6, 'CONTINUOUS');
    mapaCapa.forEach(v => {
      par(0, 'LAYER'); par(2, v.ly); par(70, 0); par(62, v.color); par(6, 'CONTINUOUS');
    });
    par(0, 'ENDTAB');
    par(0, 'ENDSEC');

    // ENTITIES
    par(0, 'SECTION'); par(2, 'ENTITIES');
    items.forEach(it => {
      const capa = it.capa, ly = it.ly, alt = o.alturaTexto;

      if (capa.tipo === 'puntos') {
        capa.puntos.forEach(p => {
          par(0, 'POINT'); par(8, ly); par(10, num(p.E)); par(20, num(p.N)); par(30, num(z(p)));
          if (o.etiquetasPuntos) texto(ly, p.E + alt * 0.5, p.N + alt * 0.5, numeroPunto(p), alt);
        });
        return;
      }

      if (capa.tipo === 'circulo') {
        figuras(capa).figs.forEach(fig => {
          const c = ajusteCirculo(fig);
          if (!c) return;
          par(0, 'CIRCLE'); par(8, ly); par(10, num(c.cx)); par(20, num(c.cy)); par(30, '0'); par(40, num(c.r));
          if (o.etiquetasArea) texto(ly, c.cx, c.cy, capa.nombre + ' ' + (Math.PI * c.r * c.r).toFixed(2) + ' m2', alt);
        });
        return;
      }

      const cerradoDe = fig => capa.tipo === 'poligono' ? true
        : (capa.tipo === 'polilinea' || capa.tipo === 'arco') ? !!fig.cerrada : false;
      figuras(capa).figs.forEach(fig => {
        const cerrado = cerradoDe(fig);
        if (fig.length < 2 || (cerrado && fig.length < 3)) return;

        par(0, 'POLYLINE'); par(8, ly); par(66, 1);
        par(10, '0'); par(20, '0'); par(30, '0');
        par(70, cerrado ? 1 : 0);
        fig.forEach(p => {
          par(0, 'VERTEX'); par(8, ly); par(10, num(p.E)); par(20, num(p.N)); par(30, num(z(p))); par(70, 0);
        });
        par(0, 'SEQEND'); par(8, ly);

        if (cerrado && capa.tipo !== 'arco' && o.etiquetasArea) {
          const area = calcular({ tipo: 'poligono', puntos: fig }).area;
          const cx = fig.reduce((s, p) => s + p.E, 0) / fig.length;
          const cy = fig.reduce((s, p) => s + p.N, 0) / fig.length;
          texto(ly, cx, cy, capa.nombre + ' ' + area.toFixed(2) + ' m2', alt);
        }
      });
    });

    if (lyCurvas) {
      o.curvas.curvas.forEach(cv => {
        cv.lineas.forEach(l => {
          const pts = l.pts, f = pts[0], u = pts[pts.length - 1];
          const cerrada = pts.length > 2 && Math.hypot(f.E - u.E, f.N - u.N) < 1e-3;
          par(0, 'POLYLINE'); par(8, lyCurvas); par(66, 1);
          par(10, '0'); par(20, '0'); par(30, num(cv.nivel));
          par(70, cerrada ? 1 : 0);
          pts.forEach(p => {
            par(0, 'VERTEX'); par(8, lyCurvas); par(10, num(p.E)); par(20, num(p.N));
            par(30, num(cv.nivel)); par(70, 0);
          });
          par(0, 'SEQEND'); par(8, lyCurvas);
          texto(lyTxt, l.etiqueta.E, l.etiqueta.N, cv.nivel.toFixed(2), o.alturaTexto);
        });
      });
    }

    par(0, 'ENDSEC');
    par(0, 'EOF');
    return out.join('\r\n') + '\r\n';
  }

  /* ---------- formato de puntos para AutoCAD (número, Norte, Este, altura, descripción) ---------- */

  // Número del punto para el formato: si el nombre es numérico se usa; si no, el orden
  function numeroParaFormato(p) {
    const m = String(p.nombre || '').match(/^\s*(\d+)\s*$/);
    return m ? String(Number(m[1])) : String(p.orden + 1);
  }

  // Puntos ordenados por número y en el formato que pide AutoCAD al importar
  function aFormatoAutocad(puntos) {
    const ordenados = puntos.slice().sort((a, b) => Number(numeroParaFormato(a)) - Number(numeroParaFormato(b)));
    const lineas = ordenados.map(p => {
      const alt = (p.h === null || p.h === undefined) ? '' : Number(p.h).toFixed(3);
      const desc = String(p.codigo || '').replace(/[,;\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
      return [numeroParaFormato(p), Number(p.N).toFixed(3), Number(p.E).toFixed(3), alt, desc].join(',');
    });
    return lineas.join('\r\n') + '\r\n';
  }

  /* ---------- superficie del terreno, cortes y rellenos ---------- */

  // Superficie del terreno: triangulación de los puntos con altura y altura en cualquier punto
  function superficie(puntos) {
    const pts = puntos.filter(p => p.h !== null && p.h !== undefined && isFinite(p.h));
    const tris = triangular(pts);
    return {
      alturaEn(E, N) {
        for (let k = 0; k < tris.length; k++) {
          const a = pts[tris[k][0]], b = pts[tris[k][1]], c = pts[tris[k][2]];
          const d = (b.N - c.N) * (a.E - c.E) + (c.E - b.E) * (a.N - c.N);
          if (Math.abs(d) < 1e-12) continue;
          const w1 = ((b.N - c.N) * (E - c.E) + (c.E - b.E) * (N - c.N)) / d;
          const w2 = ((c.N - a.N) * (E - c.E) + (a.E - c.E) * (N - c.N)) / d;
          const w3 = 1 - w1 - w2;
          const eps = -1e-9;
          if (w1 >= eps && w2 >= eps && w3 >= eps) return w1 * a.h + w2 * b.h + w3 * c.h;
        }
        return null;
      }
    };
  }

  // ¿El punto (E,N) está dentro del polígono? (poly: lista de {E,N} sin repetir el primero)
  function dentroDePoligono(E, N, poly) {
    let dentro = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.N > N) !== (b.N > N) && E < (b.E - a.E) * (N - a.N) / (b.N - a.N) + a.E) dentro = !dentro;
    }
    return dentro;
  }

  // Volumen de corte (terreno sobre la cota de diseño) y relleno (terreno bajo la cota) en una zona
  function volumenCorteRelleno(superf, poly, cota, paso) {
    const p = paso > 0 ? paso : 0.5;
    const minE = Math.min.apply(null, poly.map(q => q.E)), maxE = Math.max.apply(null, poly.map(q => q.E));
    const minN = Math.min.apply(null, poly.map(q => q.N)), maxN = Math.max.apply(null, poly.map(q => q.N));
    let area = 0, corte = 0, relleno = 0, sinDato = 0;
    for (let x = minE + p / 2; x < maxE; x += p) {
      for (let y = minN + p / 2; y < maxN; y += p) {
        if (!dentroDePoligono(x, y, poly)) continue;
        const h = superf.alturaEn(x, y);
        if (h === null) { sinDato++; continue; }
        area += p * p;
        const dz = h - cota;
        if (dz > 0) corte += dz * p * p; else relleno -= dz * p * p;
      }
    }
    return { area: area, corte: corte, relleno: relleno, neto: corte - relleno, sinDato: sinDato, paso: p };
  }

  // Punto a una distancia s a lo largo de una línea, con la dirección de la línea en ese punto
  function puntoEnLinea(linea, s) {
    let acum = 0;
    for (let i = 0; i < linea.length - 1; i++) {
      const a = linea[i], b = linea[i + 1];
      const L = Math.hypot(b.E - a.E, b.N - a.N);
      if (L === 0) continue;
      if (s <= acum + L || i === linea.length - 2) {
        const t = Math.min(1, Math.max(0, (s - acum) / L));
        return { E: a.E + t * (b.E - a.E), N: a.N + t * (b.N - a.N), dE: (b.E - a.E) / L, dN: (b.N - a.N) / L };
      }
      acum += L;
    }
    const a = linea[linea.length - 2], b = linea[linea.length - 1];
    const L = Math.hypot(b.E - a.E, b.N - a.N) || 1;
    return { E: b.E, N: b.N, dE: (b.E - a.E) / L, dN: (b.N - a.N) / L };
  }

  function longitudLinea(linea) {
    let L = 0;
    for (let i = 0; i < linea.length - 1; i++) L += Math.hypot(linea[i + 1].E - linea[i].E, linea[i + 1].N - linea[i].N);
    return L;
  }

  // Perfil longitudinal: terreno a lo largo del eje, cada "paso" metros
  function perfilLongitudinal(superf, linea, cota, paso) {
    const p = paso > 0 ? paso : 1;
    const L = longitudLinea(linea);
    const datos = [];
    for (let s = 0; s <= L + 1e-9; s += p) {
      const q = puntoEnLinea(linea, Math.min(s, L));
      datos.push({ s: s, E: q.E, N: q.N, h: superf.alturaEn(q.E, q.N), cota: cota });
    }
    if (datos.length && datos[datos.length - 1].s < L - 1e-9) {
      const q = puntoEnLinea(linea, L);
      datos.push({ s: L, E: q.E, N: q.N, h: superf.alturaEn(q.E, q.N), cota: cota });
    }
    return { longitud: L, datos: datos };
  }

  // Secciones transversales perpendiculares al eje, cada "intervalo" metros, a ambos lados "semi" metros
  function seccionesTransversales(superf, linea, cota, intervalo, semi, paso) {
    const inter = intervalo > 0 ? intervalo : 5;
    const p = paso > 0 ? paso : 0.5;
    const L = longitudLinea(linea);
    const estaciones = [];
    for (let s = 0; s <= L + 1e-9; s += inter) estaciones.push(Math.min(s, L));
    if (estaciones[estaciones.length - 1] < L - 1e-9) estaciones.push(L);
    return estaciones.map(s => {
      const q = puntoEnLinea(linea, s);
      const nE = -q.dN, nN = q.dE;                  // perpendicular al eje
      const perfil = [];
      for (let d = -semi; d <= semi + 1e-9; d += p) {
        const E = q.E + d * nE, N = q.N + d * nN;
        perfil.push({ d: d, E: E, N: N, h: superf.alturaEn(E, N) });
      }
      let areaCorte = 0, areaRelleno = 0;
      for (let i = 0; i < perfil.length - 1; i++) {
        const a = perfil[i], b = perfil[i + 1];
        if (a.h === null || b.h === null) continue;
        const za = a.h - cota, zb = b.h - cota;
        const ancho = b.d - a.d;
        if (za >= 0 && zb >= 0) areaCorte += (za + zb) / 2 * ancho;
        else if (za <= 0 && zb <= 0) areaRelleno += (-za - zb) / 2 * ancho;
        else {
          // cruce de la cota dentro del tramo
          const t = za / (za - zb);
          const zc = za + (zb - za) * t, ancho1 = t * ancho, ancho2 = (1 - t) * ancho;
          if (za > 0) { areaCorte += za / 2 * ancho1; areaRelleno += (-zb) / 2 * ancho2; }
          else { areaRelleno += (-za) / 2 * ancho1; areaCorte += zb / 2 * ancho2; }
        }
      }
      return { s: s, E: q.E, N: q.N, perfil: perfil, areaCorte: areaCorte, areaRelleno: areaRelleno };
    });
  }

  // Terreno después de excavar o rellenar: dentro de cada zona el terreno queda a la cota de diseño.
  // Los puntos del borde conservan su altura natural (para que el talud quede bien) y los puntos
  // medidos dentro de la zona se reemplazan por la superficie nueva.
  function terrenoConExcavaciones(puntos, excavaciones) {
    const orig = puntos.filter(p => p.h !== null && p.h !== undefined && isFinite(p.h));
    const superf = superficie(orig);            // altura natural de cada zona (independiente de las demás)
    const lista = excavaciones || [];
    // Se quitan los puntos medidos que caen dentro de cualquier zona excavada
    let base = orig.filter(p => !lista.some(ex => dentroDePoligono(p.E, p.N, ex.poly)));
    lista.forEach(ex => {
      const poly = ex.poly;
      const paso = ex.paso > 0 ? ex.paso : 0.5;
      const minE = Math.min.apply(null, poly.map(q => q.E)), maxE = Math.max.apply(null, poly.map(q => q.E));
      const minN = Math.min.apply(null, poly.map(q => q.N)), maxN = Math.max.apply(null, poly.map(q => q.N));
      const nuevos = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const L = Math.hypot(b.E - a.E, b.N - a.N);
        const k = Math.max(1, Math.ceil(L / paso));
        for (let j = 0; j < k; j++) {
          const t = j / k;
          const E = a.E + t * (b.E - a.E), N = a.N + t * (b.N - a.N);
          const h = superf.alturaEn(E, N);
          if (h !== null) nuevos.push({ E: E, N: N, h: h });
        }
      }
      for (let x = minE + paso / 2; x < maxE; x += paso) {
        for (let y = minN + paso / 2; y < maxN; y += paso) {
          if (dentroDePoligono(x, y, poly)) nuevos.push({ E: x, N: y, h: ex.cota });
        }
      }
      base = base.concat(nuevos);
    });
    return base;
  }

  /* ---------- CSV de resultados ---------- */

  function campoCSV(v) {
    const s = String(v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function generarCSV(capas) {
    const filas = [['Capa', 'Tipo', 'Puntos', 'Area_m2', 'Area_ha', 'Perimetro_m', 'Longitud_m']];
    capas.forEach(c => {
      const r = calcular(c);
      filas.push([c.nombre, c.tipo, r.n, r.area.toFixed(3), r.ha.toFixed(6),
                  r.perimetro.toFixed(3), r.longitud.toFixed(3)]);
    });
    return filas.map(f => f.map(campoCSV).join(',')).join('\r\n') + '\r\n';
  }

  const API = {
    aNumero, sinAcentos, numeroPunto,
    textoAFilas, libroAFilas, filasAPuntos,
    agrupar, tipoSugerido, figuras, croquis, ajusteCirculo,
    triangular, curvasNivel, cruza, suavizarLinea,
    calcular, extension,
    nombreLayerDXF, generarDXF, generarCSV, aFormatoAutocad,
    superficie, volumenCorteRelleno, perfilLongitudinal, seccionesTransversales, dentroDePoligono, terrenoConExcavaciones
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Linderos = API;

})(typeof window !== 'undefined' ? window : globalThis);
