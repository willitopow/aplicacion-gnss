/*!
 * linderos-gnss · ui.js
 * Pestañas de la cinta, paneles flotantes y cierre de paneles.
 * Licencia: MIT
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const PANELES = ['panel-puntos', 'panel-capas', 'panel-resultado', 'panel-pegar', 'panel-agregar', 'panel-croquis'];

  function activarPestana(nombre) {
    document.querySelectorAll('.pestana').forEach(b => b.classList.toggle('activa', b.dataset.tab === nombre));
    document.querySelectorAll('.grupo').forEach(g => { g.hidden = g.dataset.tab !== nombre; });
  }

  // Muestra un panel flotante y cierra los demás
  function verPanel(id) {
    PANELES.forEach(p => { const el = $(p); if (el) el.hidden = (p !== id); });
  }

  function cerrarPaneles() {
    PANELES.forEach(p => { const el = $(p); if (el) el.hidden = true; });
  }

  window.verPanel = verPanel;
  window.cerrarPaneles = cerrarPaneles;

  document.querySelectorAll('.pestana').forEach(b =>
    b.addEventListener('click', () => activarPestana(b.dataset.tab)));

  document.querySelectorAll('[data-panel]').forEach(b =>
    b.addEventListener('click', () => {
      const id = b.dataset.panel;
      const el = $(id);
      if (el && el.hidden) verPanel(id); else cerrarPaneles();
    }));

  document.querySelectorAll('.cerrar-panel').forEach(b =>
    b.addEventListener('click', cerrarPaneles));

  // Pestaña inicial
  activarPestana('inicio');
})();
