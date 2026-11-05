# Linderos GNSS

Aplicación web para dibujar levantamientos topográficos a partir de los puntos que exporta **APKSURV** (controladores APEKS CJ3i y similares). Lee CSV, TXT, XLS y XLSX, agrupa los puntos por código, calcula áreas, perímetros y longitudes, y exporta a **DXF** y **CSV**.

Funciona en el navegador del controlador, el PC y el celular, con conexión a internet.

## Qué hace

- **Lee** archivos `.csv`, `.txt`, `.tsv`, `.xls`, `.xlsx`, `.xlsm`, o texto pegado.
- **Detecta columnas** por cabecera (`Nombre`, `Código`, `N`, `E`, `h`, y sinónimos como `Norte`, `Este`, `Cota`). Si no hay cabecera, asume el orden de APKSURV: `Nombre, Código, N, E, h`.
- **Agrupa por código**: todos los puntos con el mismo código forman una capa (`casa`, `lindero`, `cerca`, `palma`…).
- **Une los puntos** en orden natural del nombre (PT1, PT2, PT10…).
- **Tipo de dibujo por capa**: puntos, línea abierta (cercas, vías, gradas) o polígono cerrado (linderos, casas, fuentes).
- **Calcula**: área en m² y ha, perímetro en m, longitud de líneas.
- **Exporta**: DXF (AutoCAD R12, con una capa por código) y CSV de resultados.
- **Mapa** con zoom (rueda o pinza) y paneo (arrastrar), norte arriba.

## Uso

1. Abre `index.html` en el navegador (Chrome recomendado).
2. Elige el archivo exportado desde APKSURV, o pega los datos.
3. Revisa la tabla de capas: ajusta el tipo (puntos / línea / polígono) y desmarca lo que no quieras exportar.
4. Pulsa **Exportar DXF**. El archivo se descarga y se abre en AutoCAD, BricsCAD, LibreCAD, QGIS o Civil 3D.

Prueba rápida con `ejemplos/ejemplo_apksurv.csv`.

### Consejo para agrupar

Cada código es una capa. Si tienes varios objetos del mismo tipo (dos casas), dales códigos distintos en APKSURV (`casa1`, `casa2`) y activa la casilla **"Agrupar por nombre sin número"**, que los une en la capa `CASA`. Si necesitas que cada objeto sea su propia capa, no actives esa casilla.

## Uso en PC, celular y controlador

La aplicación es una **PWA**: se instala como un ícono y se usa con internet, siempre con la versión más reciente.

1. **Publícala en GitHub Pages** (ver más abajo). Así tienes una dirección `https://` que todos los equipos pueden abrir.
2. **Abre la dirección una vez con internet** en cada equipo. Esto guarda la app en el dispositivo.
3. **Instálala:**
   - *PC (Chrome o Edge):* icono de instalar en la barra de direcciones, o el botón **Instalar en este dispositivo** del pie de página.
   - *Celular Android y CJ3i (Chrome):* menú ⋮ → **Instalar aplicación** o **Añadir a la pantalla de inicio**.
   - *iPhone (Safari):* botón Compartir → **Añadir a pantalla de inicio**. En iPhone el botón automático no aparece; hay que hacerlo desde el menú.
4. **Los datos no salen del equipo:** la app se descarga desde internet, pero el archivo que cargas se procesa en el propio dispositivo y no se sube a ningún lado.

Para pasar archivos del controlador al PC: copia el `.csv` o `.dxf` por cable USB, por almacenamiento compartido o por correo. Como todo se procesa en el dispositivo, el archivo no sale de él salvo que tú lo envíes.

**Actualizaciones:** al subir cambios a GitHub, la app se actualiza sola en el siguiente uso (con **Ctrl + F5** en PC si el navegador conserva una copia).

## Croquis: figuras y bordes

Al importar, cada código aparece solo como **puntos**. Las figuras se arman en el croquis, con una línea por figura:

```
NOMBRE / tipo / orden
```

- `poligono`: cerrado (un lindero, una casa). Repite el primer número al final.
- `circulo`: con 3 o más puntos (fuente, árbol grande).
- `linea`: abierta (cerca, vía, gradas).
- `borde`: barrera punteada (un hueco, una caída). Se calcula su longitud.
- `puntos`: solo los puntos.

## Curvas de nivel

En la sección **4. Curvas de nivel y alturas**:

- **Equidistancia:** escribe cada cuánto quieres las curvas (0.05, 0.2, 0.5, 1 m…) o usa los botones rápidos. Se recalculan al instante.
- **Altura de cada punto:** cambia el valor en la tabla. Las curvas y el mapa se actualizan solos.
- **Corregir en el plano:** toca un punto del dibujo. Aparece su panel con el número, la altura, y los botones **Cambiar altura** y **Borrar punto** (en computadora también sirve la tecla Suprimir). Las curvas se recalculan para ver cómo quedan.
- **Borrar desde la tabla:** cada fila tiene su botón Borrar.
- **Restaurar:** **Restaurar puntos borrados** devuelve los puntos borrados.
- Las curvas se dibujan acotadas (con su altura), y en el DXF salen en las capas `CURVAS` (con la altura como cota Z) y `CURVAS_TXT`.

Las curvas se calculan con triangulación de Delaunay e interpolación lineal. Solo existen dentro del área que cubren los puntos con altura.

## Sobre DWG

DWG es un formato propietario de Autodesk y no se puede generar de forma fiable desde el navegador. La aplicación exporta **DXF**, que AutoCAD y casi todos los programas CAD abren directamente. Si necesitas DWG:

- **Opción sin programar:** abre el DXF en AutoCAD o BricsCAD y guarda como DWG (o en LibreCAD).
- **Opción automática:** instala [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter) (gratuito) y ejecuta `tools/dxf_a_dwg.sh`.

## Instalación en GitHub

```bash
git clone https://github.com/TU_USUARIO/linderos-gnss.git
cd linderos-gnss
# (copia aquí los archivos de este proyecto)
git add .
git commit -m "Primera versión: lectura APKSURV, capas y exportación DXF"
git push -u origin main
```

Para usarla desde cualquier lugar con enlace, activa **GitHub Pages** en *Settings → Pages* (rama `main`, carpeta `/root`). Luego abre `https://TU_USUARIO.github.io/linderos-gnss/` en el CJ3i.

## Excel (XLS / XLSX)

La lectura de Excel usa [SheetJS](https://sheetjs.com/). Se carga desde internet automáticamente. Si prefieres tenerla en el repositorio, descárgala en `libs/`:

```bash
curl -L -o libs/xlsx.full.min.js https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
```



## Pruebas

```bash
npm test
```

Ejecuta las pruebas de `js/core.js` (lectura, agrupación, áreas, DXF y CSV). No necesita navegador.

## Estructura

```
linderos-gnss/
├── index.html          Interfaz (PWA instalable)
├── manifest.webmanifest Datos de instalación (nombre, íconos, colores)
├── sw.js               Service worker: funcionamiento sin internet
├── icons/              Íconos de la app (192, 512, 180 px y SVG)
├── css/estilo.css      Estilos (pensados para pantalla táctil)
├── js/core.js          Lógica: lectura, agrupación, geometría, DXF, CSV (sin DOM)
├── js/app.js           Interfaz: tabla, mapa, eventos y descargas
├── libs/               Librerías opcionales (xlsx.full.min.js)
├── ejemplos/           Archivo de ejemplo con datos sintéticos
├── tests/test_core.js  Pruebas automáticas
└── tools/dxf_a_dwg.sh  Conversión DXF → DWG con ODA File Converter (opcional)
```

## Limitaciones conocidas

- Las áreas están en las unidades de las coordenadas. Usa coordenadas planas (UTM o la grilla local del proyecto), no grados.
- Un código con varios objetos separados se dibuja como un solo polígono o línea, en el orden de sus nombres. Para objetos separados, usa códigos distintos.
- El formato de la exportación DXF es AutoCAD R12 (AC1009), que es el más compatible.
- Los textos del DXF se escriben sin tildes (ASCII) para evitar problemas de codificación.
- Probado con el CSV de APKSURV (formato `Nombre, Código, N, E, h`). Si tu versión de APKSURV usa otro orden o separador, la detección por cabecera debería bastar; si no, avísame con una muestra.

## Próximos pasos posibles

- Envolver la aplicación en una app Android (WebView) para instalarla en el CJ3i.
- Guardar proyectos y editar códigos directamente desde la tabla.
- Exportar a DXF con puntos de elevación (Z) como texto en el plano.
- Importar DXF como referencia de fondo.

## Licencia

MIT. Ver [LICENSE](LICENSE).
