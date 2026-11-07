/* Pruebas de core.js. Ejecutar con: npm test  (o: node tests/test_core.js) */
'use strict';
const assert = require('assert');
const Core = require('../js/core.js');

let ok = 0;
function test(nombre, fn) {
  try { fn(); ok++; console.log('  ✔ ' + nombre); }
  catch (e) { console.error('  ✘ ' + nombre + '\n    ' + e.message); process.exitCode = 1; }
}

test('CSV con cabecera estilo APKSURV (Nombre,Código,N,E,h) y BOM', () => {
  const csv = '\uFEFFNombre,Código,N,E,h\n' +
    'Base_0,,100.0,200.0,10\n' +
    'CASA1,casa,0,0,1\nCASA2,casa,0,10,1\nCASA3,casa,10,10,1\nCASA4,casa,10,0,1\n';
  const r = Core.filasAPuntos(Core.textoAFilas(csv));
  assert.strictEqual(r.puntos.length, 5);
  assert.strictEqual(r.encabezado, true);
  const capas = Core.agrupar(r.puntos);
  const casa = capas.find(c => c.nombre === 'CASA');
  assert.ok(casa, 'debe existir la capa CASA');
  assert.strictEqual(casa.tipo, 'puntos');   // al importar, los códigos son puntos; las figuras van en el croquis
  assert.deepStrictEqual(casa.puntos.map(p => p.nombre), ['CASA1', 'CASA2', 'CASA3', 'CASA4']);
});

test('Área de un cuadrado de 10 x 10 m = 100 m²; perímetro = 40 m', () => {
  const capa = { tipo: 'poligono', puntos: [
    { N: 0, E: 0 }, { N: 0, E: 10 }, { N: 10, E: 10 }, { N: 10, E: 0 }] };
  const r = Core.calcular(capa);
  assert.ok(Math.abs(r.area - 100) < 1e-9);
  assert.ok(Math.abs(r.ha - 0.01) < 1e-12);
  assert.ok(Math.abs(r.perimetro - 40) < 1e-9);
});

test('Área correcta con coordenadas grandes (UTM-like)', () => {
  const base = { N: 868072.6863, E: 1058864.2938 };
  const capa = { tipo: 'poligono', puntos: [
    base,
    { N: base.N, E: base.E + 20 },
    { N: base.N + 5, E: base.E + 20 },
    { N: base.N + 5, E: base.E }] };
  assert.ok(Math.abs(Core.calcular(capa).area - 100) < 1e-3);
});

test('Sin cabecera: columnas por defecto Nombre,Código,N,E,h; decimal con coma en ;', () => {
  const r = Core.filasAPuntos(Core.textoAFilas('PT1;linderos;868072,5;1058864,3;997,1\nPT2;linderos;868073,5;1058865,3\n'));
  assert.strictEqual(r.encabezado, false);
  assert.strictEqual(r.puntos[0].N, 868072.5);
  assert.strictEqual(r.puntos[0].E, 1058864.3);
  assert.strictEqual(r.puntos[1].h, null);
});

test('Orden natural de puntos: PT2 antes que PT10', () => {
  const pts = [
    { nombre: 'PT10', codigo: 'a', N: 0, E: 0, orden: 0 },
    { nombre: 'PT2', codigo: 'a', N: 0, E: 0, orden: 1 }];
  const capa = Core.agrupar(pts)[0];
  assert.deepStrictEqual(capa.puntos.map(p => p.nombre), ['PT2', 'PT10']);
});

test('Con separar figuras: ZV1, ZV2 son figuras distintas en el mismo layer ZV', () => {
  const pts = ['zv1','zv1','zv1','zv2','zv2','zv2'].map((c,i) => ({ nombre: 'P'+i, codigo: c, N: i, E: i, orden: i }));
  const capas = Core.agrupar(pts, { quitarNumero: true });
  assert.strictEqual(capas.length, 2);
  assert.deepStrictEqual(capas.map(c => c.nombre), ['ZV1', 'ZV2']);
  assert.ok(capas.every(c => c.layer === 'ZV'));
  assert.strictEqual(capas[0].puntos.length, 3);
});

test('Tipo sugerido según el nombre de la capa', () => {
  assert.strictEqual(Core.tipoSugerido('LINDERO NORTE'), 'poligono');
  assert.strictEqual(Core.tipoSugerido('CERCA'), 'linea');
  assert.strictEqual(Core.tipoSugerido('PALMA'), 'puntos');
});

test('Nombres de capa DXF válidos y sin duplicados', () => {
  const usados = new Set(['0']);
  assert.strictEqual(Core.nombreLayerDXF('Área/Lote 1', usados), 'AREA_LOTE_1');
  assert.strictEqual(Core.nombreLayerDXF('Área/Lote 1', usados), 'AREA_LOTE_1_2');
  assert.strictEqual(Core.nombreLayerDXF('0', usados), '0_2');
});

test('DXF: estructura válida, capas, polilínea cerrada y puntos', () => {
  const capas = [
    { nombre: 'CASA', tipo: 'poligono', puntos: [
      { nombre: 'C1', N: 0, E: 0, h: 1 }, { nombre: 'C2', N: 0, E: 10, h: 1 },
      { nombre: 'C3', N: 10, E: 10, h: 1 }, { nombre: 'C4', N: 10, E: 0, h: 1 }] },
    { nombre: 'PALMA', tipo: 'puntos', puntos: [{ nombre: 'P1', N: 5, E: 5, h: null }] }
  ];
  const dxf = Core.generarDXF(capas, { etiquetasPuntos: false });
  const lineas = dxf.split('\r\n');
  assert.strictEqual(lineas[0], '0');
  assert.strictEqual(lineas[1], 'SECTION');
  assert.ok(dxf.includes('POLYLINE'));
  assert.ok(dxf.includes('SEQEND'));
  assert.ok(dxf.includes('POINT'));
  assert.ok(dxf.includes('CASA'));
  assert.ok(dxf.includes('PALMA'));
  assert.ok(/\r\n70\r\n1\r\n/.test(dxf), 'la polilínea debe estar marcada como cerrada');
  assert.ok(dxf.endsWith('0\r\nEOF\r\n'));
  // Cada VERTEX debe estar en la capa CASA (8 = layer)
  const veces = (dxf.match(/\n0\r?\nVERTEX/g) || []).length;
  assert.strictEqual(veces, 4);
});

test('CSV de resultados con cabecera y una fila por capa', () => {
  const capas = [{ nombre: 'CASA', tipo: 'poligono', puntos: [
    { N: 0, E: 0 }, { N: 0, E: 10 }, { N: 10, E: 10 }, { N: 10, E: 0 }] }];
  const csv = Core.generarCSV(capas);
  const filas = csv.trim().split('\r\n');
  assert.strictEqual(filas.length, 2);
  assert.ok(filas[1].startsWith('CASA,poligono,4,100.000'));
});

test('Orden de unión: figuras separadas por ; y cierre automático', () => {
  const pts = [1,2,3,4,5,6,7].map(n => ({ nombre: 'PT' + n, codigo: 'lindero', N: n, E: n * 2, orden: n }));
  const capa = { tipo: 'poligono', puntos: pts, union: '1-2-3-1; 4-5-6-7-4' };
  const f = Core.figuras(capa);
  assert.strictEqual(f.figs.length, 2);
  assert.deepStrictEqual(f.figs[0].map(Core.numeroPunto), ['1', '2', '3']);
  assert.deepStrictEqual(f.figs[1].map(Core.numeroPunto), ['4', '5', '6', '7']);
});

test('Orden de unión: número inexistente genera aviso', () => {
  const pts = [1,2,3].map(n => ({ nombre: 'PT' + n, codigo: 'casa', N: n, E: n, orden: n }));
  const r = Core.calcular({ tipo: 'poligono', puntos: pts, union: '1-2-3-9' });
  assert.ok(r.aviso.includes('9'));
});

test('Etiqueta muestra solo el número del punto', () => {
  assert.strictEqual(Core.numeroPunto({ nombre: 'PT12' }), '12');
  assert.strictEqual(Core.numeroPunto({ nombre: 'Base_0' }), '0');
});

test('Croquis: une puntos de cualquier código por número', () => {
  const pts = [127,128,129,130,131,132].map((n,i) => ({ nombre: 'PT'+n, codigo: 'palma', N: n, E: n, orden: i }));
  const cr = Core.croquis('FUENTE | poligono | 127-128-129-130-131-132-127\n# comentario', pts);
  assert.strictEqual(cr.capas.length, 1);
  assert.strictEqual(cr.capas[0].tipo, 'polilinea');
  const r = Core.calcular(cr.capas[0]);
  assert.strictEqual(r.n, 6);
  assert.strictEqual(r.aviso, '');
});

test('Croquis: avisa de números inexistentes y de líneas mal escritas', () => {
  const pts = [1,2,3].map(n => ({ nombre: 'PT'+n, codigo: 'x', N: n, E: n, orden: n }));
  const cr = Core.croquis('CASA | poligono | 1-2-3-99\nMAL', pts);
  assert.strictEqual(cr.avisos.length, 2);
});

test('Círculo: 3 puntos definen el círculo exacto', () => {
  // círculo centro (10,20) radio 5
  const ang = [0, 2.1, 4.3].map(a => ({ E: 10 + 5 * Math.cos(a), N: 20 + 5 * Math.sin(a) }));
  const c = Core.ajusteCirculo(ang);
  assert.ok(Math.abs(c.cx - 10) < 1e-6 && Math.abs(c.cy - 20) < 1e-6 && Math.abs(c.r - 5) < 1e-6);
  const r = Core.calcular({ tipo: 'circulo', puntos: ang.map((p, i) => ({ ...p, nombre: 'P' + i })) });
  assert.ok(Math.abs(r.area - Math.PI * 25) < 1e-6);
});

test('Círculo: 6 puntos sobre la fuente se ajustan bien', () => {
  const pts = [0, 60, 120, 180, 240, 300].map(a => ({ E: 5 * Math.cos(a * Math.PI / 180), N: 5 * Math.sin(a * Math.PI / 180) }));
  const c = Core.ajusteCirculo(pts);
  assert.ok(Math.abs(c.r - 5) < 1e-6 && c.desv < 1e-6);
});

test('Círculo: puntos alineados avisan y no calculan', () => {
  const pts = [{ E: 0, N: 0, nombre: 'A' }, { E: 1, N: 1, nombre: 'B' }, { E: 2, N: 2, nombre: 'C' }];
  const r = Core.calcular({ tipo: 'circulo', puntos: pts });
  assert.ok(r.aviso.includes('círculo'));
  assert.strictEqual(r.area, 0);
});

test('Curvas de nivel: cono de altura r da curvas de radio igual al nivel', () => {
  const pts = [];
  for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) pts.push({ E: x, N: y, h: Math.hypot(x, y) });
  const c = Core.curvasNivel(pts, 2);
  assert.ok(c.curvas.length >= 3);
  c.curvas.forEach(cv => cv.lineas.forEach(l => l.pts.forEach(p => {
    assert.ok(Math.abs(Math.hypot(p.E, p.N) - cv.nivel) < 0.1, 'radio fuera de la curva ' + cv.nivel);
  })));
});

test('Curvas de nivel: el nivel 2 del cono es un solo lazo cerrado', () => {
  const pts = [];
  for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) pts.push({ E: x, N: y, h: Math.hypot(x, y) });
  const cv = Core.curvasNivel(pts, 2).curvas.find(v => v.nivel === 2);
  assert.strictEqual(cv.lineas.length, 1);
  const l = cv.lineas[0].pts;
  assert.ok(Math.hypot(l[0].E - l[l.length - 1].E, l[0].N - l[l.length - 1].N) < 1e-3);
});

test('Curvas de nivel: puntos sin altura no entran y se cuentan', () => {
  const pts = [{ E: 0, N: 0, h: 1 }, { E: 5, N: 0, h: 2 }, { E: 0, N: 5, h: 3 }, { E: 5, N: 5, h: null }];
  const c = Core.curvasNivel(pts, 1);
  assert.strictEqual(c.puntos, 3);
  assert.strictEqual(c.sinAltura, 1);
});

test('DXF con curvas: capas CURVAS y CURVAS_TXT', () => {
  const pts = [];
  for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) pts.push({ E: x, N: y, h: Math.hypot(x, y) });
  const c = Core.curvasNivel(pts, 2);
  const dxf = Core.generarDXF([], { curvas: c });
  assert.ok(dxf.includes('CURVAS'));
  assert.ok(dxf.includes('CURVAS_TXT'));
  assert.ok(dxf.includes('POLYLINE'));
});

test('Bordes: ninguna curva cruza un borde cerrado', () => {
  const pts = [];
  for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) pts.push({ E: x, N: y, h: x + y });
  const cor = [[-2.5, -2.5], [2.5, -2.5], [2.5, 2.5], [-2.5, 2.5]].map(([E, N]) => ({ E: E, N: N, h: E + N }));
  const c = Core.curvasNivel(pts, 1, [{ pts: cor, cerrado: true }]);
  const dentro = p => Math.abs(p.E) < 2.5 - 1e-6 && Math.abs(p.N) < 2.5 - 1e-6;
  const fuera = p => Math.abs(p.E) > 2.5 + 1e-6 || Math.abs(p.N) > 2.5 + 1e-6;
  let lineas = 0;
  c.curvas.forEach(cv => cv.lineas.forEach(l => {
    lineas++;
    assert.ok(!(l.pts.some(dentro) && l.pts.some(fuera)), 'una curva cruza el borde en nivel ' + cv.nivel);
  }));
  assert.ok(lineas > 0);
});

test('Bordes: la altura interpolada del borde aparece en la curva que lo toca', () => {
  // Borde abierto entre dos puntos con alturas 10 y 12: la curva de 11 debe tocarlo
  const pts = [{ E: 0, N: 0, h: 10 }, { E: 4, N: 0, h: 12 }, { E: 0, N: 4, h: 10 }, { E: 4, N: 4, h: 12 }];
  const borde = [{ E: 0, N: 0, h: 10 }, { E: 4, N: 0, h: 12 }];
  const c = Core.curvasNivel(pts, 1, [{ pts: borde, cerrado: false }]);
  assert.ok(c.curvas.length > 0);
});

test('Bordes: ninguna curva cruza el borde, para cualquier equidistancia', () => {
  const pts = [];
  for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) pts.push({ E: x, N: y, h: x + y });
  const cor = [[-2.5, -2.5], [2.5, -2.5], [2.5, 2.5], [-2.5, 2.5]].map(([E, N]) => ({ E: E, N: N, h: E + N }));
  const dentro = p => Math.abs(p.E) < 2.5 - 1e-3 && Math.abs(p.N) < 2.5 - 1e-3;
  const fuera = p => Math.abs(p.E) > 2.5 + 1e-3 || Math.abs(p.N) > 2.5 + 1e-3;
  [1, 0.5, 0.33, 0.3, 0.2, 0.1, 0.25, 0.9].forEach(eq => {
    const c = Core.curvasNivel(pts, eq, [{ pts: cor, cerrado: true }]);
    c.curvas.forEach(cv => cv.lineas.forEach(l => {
      assert.ok(!(l.pts.some(dentro) && l.pts.some(fuera)), 'cruce con equidistancia ' + eq);
    }));
  });
});

test('Curvas suaves: no cruzan el borde y reducen el giro', () => {
  const pts = [];
  for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++)
    pts.push({ E: x + 0.3 * Math.sin(y), N: y, h: Math.hypot(x + 0.3 * Math.sin(y), y) + 0.2 * Math.sin(3 * x) });
  const cor = [[-2.5, -2.5], [2.5, -2.5], [2.5, 2.5], [-2.5, 2.5]].map(([E, N]) => ({ E: E, N: N, h: E + N }));
  const dentro = p => Math.abs(p.E) < 2.5 - 1e-3 && Math.abs(p.N) < 2.5 - 1e-3;
  const fuera = p => Math.abs(p.E) > 2.5 + 1e-3 || Math.abs(p.N) > 2.5 + 1e-3;
  const c = Core.curvasNivel(pts, 0.5, [{ pts: cor, cerrado: true }], { suave: true });
  c.curvas.forEach(cv => cv.lineas.forEach(l => {
    assert.ok(!(l.pts.some(dentro) && l.pts.some(fuera)), 'curva suave cruza el borde');
  }));
  const giro = (cv) => { let t = 0, n = 0; cv.curvas.forEach(v => v.lineas.forEach(l => {
    for (let i = 1; i < l.pts.length - 1; i++) {
      const p = l.pts[i - 1], q = l.pts[i], r = l.pts[i + 1];
      let d = Math.abs(Math.atan2(r.N - q.N, r.E - q.E) - Math.atan2(q.N - p.N, q.E - p.E));
      d = Math.min(d, 2 * Math.PI - d); t += d; n++;
    } })); return t / n; };
  const recta = Core.curvasNivel(pts, 0.5, [], { suave: false });
  const suave = Core.curvasNivel(pts, 0.5, [], { suave: true });
  assert.ok(giro(suave) < giro(recta));
});

test('Sin cabecera: formato Número,N,E,h,Código se lee bien', () => {
  const r = Core.filasAPuntos(Core.textoAFilas('1,868022.866,1058917.907,992.08,edificio\n2,868011.761,1058927.591,991.94,palma\n'));
  assert.deepStrictEqual(r.mapa, { name: 0, N: 1, E: 2, h: 3, code: 4 });
  assert.ok(Math.abs(r.puntos[0].N - 868022.866) < 1e-6);
  assert.ok(Math.abs(r.puntos[0].E - 1058917.907) < 1e-6);
  assert.strictEqual(r.puntos[0].codigo, 'edificio');
});

test('Formato AutoCAD: exporta número,N,E,altura,descripción y vuelve a leerse igual', () => {
  const pts = [
    { orden: 0, nombre: '2', codigo: 'palma', N: 868011.5, E: 1058927.25, h: 992.0412 },
    { orden: 1, nombre: '1', codigo: 'edificio, norte', N: 868022.75, E: 1058917.5, h: null }
  ];
  const txt = Core.aFormatoAutocad(pts);
  const lineas = txt.trim().split('\r\n');
  assert.strictEqual(lineas[0], '1,868022.750,1058917.500,,edificio norte');   // ordenado por número, sin altura
  assert.strictEqual(lineas[1], '2,868011.500,1058927.250,992.041,palma');
  const r = Core.filasAPuntos(Core.textoAFilas(txt));
  assert.strictEqual(r.puntos.length, 2);
  assert.ok(Math.abs(r.puntos[1].h - 992.041) < 1e-6);
});

test('Cualquier formato sin cabecera se convierte al mismo formato (número, N, E, altura, descripción)', () => {
  const casos = [
    '1,868022.866,1058917.907,992.081,edificio\n2,868011.761,1058927.592,991.941,palma',
    '1,edificio,868022.866,1058917.907,992.081\n2,palma,868011.761,1058927.592,991.941',
    '1;868022,866;1058917,907;992,081;edificio\n2;868011,761;1058927,592;991,941;palma',
    '1 868022.866 1058917.907 992.081 edificio\n2 868011.761 1058927.592 991.941 palma'
  ];
  casos.forEach(t => {
    const r = Core.filasAPuntos(Core.textoAFilas(t));
    assert.ok(Math.abs(r.puntos[0].N - 868022.866) < 1e-6, 'N en ' + t);
    assert.ok(Math.abs(r.puntos[0].E - 1058917.907) < 1e-6, 'E en ' + t);
    assert.ok(Math.abs(r.puntos[0].h - 992.081) < 1e-6, 'h en ' + t);
    assert.strictEqual(r.puntos[0].codigo, 'edificio');
  });
});

test('Polilinea: cerrada si repite el primer número (área), abierta (longitud)', () => {
  const pts = [1, 2, 3, 4].map((n, i) => ({ nombre: 'PT' + n, codigo: 'x', N: [0, 0, 10, 10][i], E: [0, 10, 10, 0][i], orden: i }));
  const cerrada = Core.croquis('L / polilinea / 1-2-3-4-1', pts).capas[0];
  const rc = Core.calcular(cerrada);
  assert.ok(Math.abs(rc.area - 100) < 1e-9);
  const abierta = Core.croquis('L / polilinea / 1-2-3-4', pts).capas[0];
  const ra = Core.calcular(abierta);
  assert.strictEqual(ra.area, 0);
  assert.ok(Math.abs(ra.longitud - 30) < 1e-9);
});

test('Arco: curva que pasa por los puntos (longitud mayor que la cuerda)', () => {
  const pts = [0, 1, 2].map(i => ({ nombre: 'P' + (i + 1), codigo: 'c', N: [0, 5, 0][i], E: [0, 5, 10][i], orden: i }));
  const arco = Core.croquis('C / arco / 1-2-3', pts).capas[0];
  const r = Core.calcular(arco);
  assert.ok(r.longitud > 10.5);    // la cuerda 1-3 mide 10; el arco pasa por el punto 2
  const dist = (a, b) => Math.hypot(a.E - b.E, a.N - b.N);
  const trazo = Core.figuras(arco).figs[0];
  assert.ok(Math.abs(trazo[0].E - 0) < 1e-9 && Math.abs(trazo[trazo.length - 1].E - 10) < 1e-9);
  assert.ok(dist(trazo[Math.floor(trazo.length / 2)], { E: 5, N: 5 }) < 0.6);   // pasa cerca del punto 2
});

console.log('\n' + ok + ' pruebas correctas' + (process.exitCode ? ' (hay fallos)' : ''));
