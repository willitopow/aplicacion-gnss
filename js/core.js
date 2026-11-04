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
      mapa = Object.assign({}, ORDEN_DEFECTO);
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
      tipo: tipoSugerido(nombre),
      puntos: ordenar(pts),
      union: ''
    }));
  }

  /* ---------- orden de unión (croquis) ---------- */

  // Convierte el texto de unión en figuras.
  //  "1-2-3-4-1"       -> una figura (si es polígono, se cierra)
  //  "1-2-3; 5-6-7"    -> dos figuras separadas por ";"
  // Si la capa es "puntos", el orden de unión no se aplica.
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
      if (pts.length > 1 && pts[0] === pts[pts.length - 1]) pts.pop();
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
      r.n += pts.length;
      if (capa.tipo === 'circulo') {
        const c = ajusteCirculo(pts);
        if (!c) { avisos.push('Un círculo necesita 3 puntos no alineados'); return; }
        if (c.desv > tolerancia(c.r)) avisos.push('Puntos fuera del círculo (desviación máx. ' + c.desv.toFixed(2) + ' m)');
        r.area += Math.PI * c.r * c.r;
        r.perimetro += 2 * Math.PI * c.r;
        return;
      }
      if (capa.tipo === 'poligono') {
        if (pts.length < 3) avisos.push('Una figura tiene menos de 3 puntos');
        r.area += areaGauss(pts);
        r.perimetro += perimetro(pts, true);
      } else if (capa.tipo === 'linea') {
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

  // Croquis: una línea por figura, "NOMBRE | tipo | orden de unión".
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
      const partes = l.split('|').map(x => x.trim());
      if (partes.length < 3 || !partes[0]) {
        avisos.push('Línea mal escrita (usa NOMBRE | tipo | orden): ' + l);
        return;
      }
      const nombre = partes[0].toUpperCase();
      const t = partes[1].toLowerCase();
      const tipo = t.indexOf('pun') === 0 || t === 'p' ? 'puntos'
        : t.indexOf('lin') === 0 || t === 'l' ? 'linea'
        : t.indexOf('cir') === 0 || t === 'c' ? 'circulo' : 'poligono';
      const union = partes.slice(2).join('|');
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

      const cerrado = capa.tipo === 'poligono';
      figuras(capa).figs.forEach(fig => {
        if (fig.length < 2 || (cerrado && fig.length < 3)) return;

        par(0, 'POLYLINE'); par(8, ly); par(66, 1);
        par(10, '0'); par(20, '0'); par(30, '0');
        par(70, cerrado ? 1 : 0);
        fig.forEach(p => {
          par(0, 'VERTEX'); par(8, ly); par(10, num(p.E)); par(20, num(p.N)); par(30, num(z(p))); par(70, 0);
        });
        par(0, 'SEQEND'); par(8, ly);

        if (cerrado && o.etiquetasArea) {
          const area = calcular({ tipo: 'poligono', puntos: fig }).area;
          const cx = fig.reduce((s, p) => s + p.E, 0) / fig.length;
          const cy = fig.reduce((s, p) => s + p.N, 0) / fig.length;
          texto(ly, cx, cy, capa.nombre + ' ' + area.toFixed(2) + ' m2', alt);
        }
      });
    });

    par(0, 'ENDSEC');
    par(0, 'EOF');
    return out.join('\r\n') + '\r\n';
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
    calcular, extension,
    nombreLayerDXF, generarDXF, generarCSV
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Linderos = API;

})(typeof window !== 'undefined' ? window : globalThis);
