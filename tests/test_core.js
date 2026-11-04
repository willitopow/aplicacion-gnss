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
  assert.strictEqual(casa.tipo, 'poligono');
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

test('Quitar número del código agrupa CASA1..CASA4 en una sola capa', () => {
  const pts = ['casa1', 'casa2', 'casa3'].map((c, i) => ({ nombre: 'P' + i, codigo: c, N: i, E: i, orden: i }));
  const capas = Core.agrupar(pts, { quitarNumero: true });
  assert.strictEqual(capas.length, 1);
  assert.strictEqual(capas[0].nombre, 'CASA');
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
  assert.strictEqual(cr.capas[0].tipo, 'poligono');
  const r = Core.calcular(cr.capas[0]);
  assert.strictEqual(r.n, 6);
  assert.strictEqual(r.aviso, '');
});

test('Croquis: avisa de números inexistentes y de líneas mal escritas', () => {
  const pts = [1,2,3].map(n => ({ nombre: 'PT'+n, codigo: 'x', N: n, E: n, orden: n }));
  const cr = Core.croquis('CASA | poligono | 1-2-3-99\nMAL', pts);
  assert.strictEqual(cr.avisos.length, 2);
});

console.log('\n' + ok + ' pruebas correctas' + (process.exitCode ? ' (hay fallos)' : ''));
