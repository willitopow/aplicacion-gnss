#!/usr/bin/env bash
# dxf_a_dwg.sh
# Convierte archivos DXF a DWG usando ODA File Converter (gratuito):
#   https://www.opendesign.com/guestfiles/oda_file_converter
#
# Uso:
#   tools/dxf_a_dwg.sh carpeta_con_dxf [carpeta_salida] [version]
#
# Variables opcionales:
#   ODA_BIN   ruta al ejecutable ODAFileConverter (por defecto: ODAFileConverter)
#
# Ejemplo:
#   ODA_BIN="/usr/bin/ODAFileConverter" tools/dxf_a_dwg.sh ./mis_dxf ./dwg_salida ACAD2018
#
# Nota: en Linux, ODA File Converter suele necesitar un entorno gráfico
# virtual (xvfb-run). En Windows y macOS funciona directamente.

set -euo pipefail

ENTRADA="${1:?Uso: $0 carpeta_con_dxf [carpeta_salida] [version]}"
SALIDA="${2:-./dwg_salida}"
VERSION="${3:-ACAD2018}"          # ACAD2018 es compatible con AutoCAD 2018 en adelante
ODA="${ODA_BIN:-ODAFileConverter}"

if ! command -v "$ODA" >/dev/null 2>&1 && [ ! -x "$ODA" ]; then
  echo "No encuentro ODAFileConverter. Instálalo o define ODA_BIN." >&2
  exit 1
fi

mkdir -p "$SALIDA"

# Argumentos: carpeta_entrada carpeta_salida versión tipo recursivo auditoría
#   tipo: DWG | DXF | DWF ...   recursivo: 0 no, 1 sí   auditoría: 0 no, 1 sí
"$ODA" "$ENTRADA" "$SALIDA" "$VERSION" "DWG" "0" "1"

echo "Listo. Archivos DWG en: $SALIDA"
