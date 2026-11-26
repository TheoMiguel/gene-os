# GENE_OS — Especificación Funcional Completa (Handoff Document)

> [!IMPORTANT]
> Este documento es el **spec de handoff** para que otra IA implemente GENE_OS desde cero o continúe el desarrollo existente. Contiene exclusivamente **requisitos funcionales** — las decisiones técnicas de implementación quedan a criterio del implementador salvo donde se indica la arquitectura existente.

---

## 1. Visión General

### 1.1 ¿Qué es GENE_OS?

GENE_OS es una **estación de trabajo de bioinformática de escritorio** — una aplicación todo-en-uno que combina las funcionalidades de programas como SnapGene, Benchling, ApE, Serial Cloner y NEB Cutter en una sola herramienta.

### 1.2 Propuesta de valor

> *"Todas las herramientas de biología molecular que necesitás, en una sola app de escritorio, gratis, offline y sin cuenta."*

### 1.3 Público objetivo

| Perfil | Uso |
|--------|-----|
| Estudiantes de biología / biotecnología / bioquímica | Prácticas de clonado, análisis de secuencias, aprendizaje |
| Investigadores / biólogos moleculares | Diseño de estrategias de clonado, diseño de primers, análisis de restricción |
| Técnicos de laboratorio | Verificación rápida de secuencias, mapas de plásmidos |

### 1.4 Modos de interfaz

La aplicación debe ofrecer dos modos:

- **Modo Default (simplificado)**: Oculta opciones avanzadas y parámetros poco comunes. Ideal para estudiantes y uso rápido.
- **Modo Avanzado**: Muestra todas las opciones, parámetros configurables y herramientas completas.

> **Nota para el implementador**: Queda a tu criterio qué elementos se ocultan en modo default y cuáles se muestran solo en avanzado. El criterio general es: lo que un estudiante de 2do año de biología necesita va en default; lo que un PhD/postdoc configuraría va en avanzado.

---

## 2. Arquitectura Existente

### 2.1 Stack actual

- **Framework**: Tauri v2 (Rust backend + webview frontend)
- **Frontend**: HTML + CSS + JS nativo (ES modules, zero-bundler)
- **Backend**: Rust (`src-tauri/src/main.rs`)
- **Config**: `src-tauri/tauri.conf.json` — `frontendDist` apunta a `../src`
- **Empaquetado**: MSI + NSIS para Windows
- **Sin bundler**: No usa Vite, Webpack ni similares. Los módulos JS se cargan directamente con `<script type="module">`
- **Dependencias Tauri**: `tauri-plugin-dialog`, `tauri-plugin-fs`

### 2.2 Estructura de archivos actual

```
gene-os/
├── src/
│   ├── index.html                    # HTML principal
│   ├── data/bio_catalog.json         # Catálogo de enzimas y features
│   ├── fonts/                        # 14 archivos .woff2 (Chakra Petch, Inter, JetBrains Mono)
│   ├── styles/
│   │   ├── main.css                  # Hoja de estilos principal
│   │   └── fonts.css                 # @font-face rules
│   └── js/
│       ├── bio-engine.js             # Motor de análisis bioinformático
│       ├── main.js                   # Bootstrap y wiring de la app
│       ├── presets.js                # Secuencias de ejemplo precargadas
│       ├── renderers/
│       │   ├── organism-card.js      # Inferencia de organismo + SVG
│       │   ├── plasmid-map.js        # Mapa circular de plásmido
│       │   ├── sequence-viewer.js    # Visor de secuencia paginado
│       │   └── stages.js            # Gráficos (DNA stage, hydropathy, GC, gel)
│       └── ui/
│           ├── audio.js              # Sonidos de interacción
│           ├── exports.js            # Exportación (Tauri nativo + fallback browser)
│           ├── i18n.js               # Diccionarios EN/ES/PT
│           ├── libraries.js          # Carga desde NCBI/ENA/UniProt/presets
│           └── themes.js             # Temas de color y animaciones de fondo
├── src-tauri/
│   ├── src/main.rs                   # Backend Rust
│   ├── tauri.conf.json
│   ├── Cargo.toml
│   └── icons/                        # Iconos de la app
├── tests/
│   └── bio-engine.test.mjs           # Tests del motor
└── package.json
```

### 2.3 Catálogo de datos existente (`bio_catalog.json`)

**15 enzimas de restricción**: EcoRI, BamHI, HindIII, NotI, XhoI, NdeI, NcoI, XbaI, SalI, PstI, KpnI, SacI, EcoRV, SmaI, BsaI.

**12 features anotables**: T7 Promoter, lacUV5 Promoter, lac Operator, CMV Promoter, RBS (Shine-Dalgarno), Kozak Consensus, 6xHis-Tag, FLAG-Tag, T7 Terminator, SV40 PolyA Signal, ColE1/pUC Origin, AmpR (bla) Core.

**3 presets de secuencia**: pUC19 cassette (1,660 bp), PETase chimera (1,076 bp), eGFP reporter (843 bp).

> **Nota para el implementador**: El catálogo debe expandirse significativamente. Agregar todas las enzimas de restricción comercialmente relevantes (NEB, Thermo Fisher, etc.) y todos los features/partes biológicas comunes.

### 2.4 Funcionalidades del motor existente (`bio-engine.js`)

El motor ya implementa:
- Composición de nucleótidos y aminoácidos
- Traducción en 6 marcos de lectura
- Cálculo de peso molecular (DNA y proteína)
- Punto isoeléctrico (pI) por bisección
- Contenido GC y GC skew
- Escaneo de enzimas de restricción (doble hebra)
- Escaneo de features conocidos
- Detección de ORFs
- Análisis de primers (Tm, GC%, dímeros, hairpins)
- PCR virtual (incluido circular)
- Formateo GenBank
- Inferencia de organismo por composición

---

## 3. Interfaz de Usuario

### 3.1 Layout general

```
┌──────────────────────────────────────────────────────────────┐
│  [Logo] GENE_OS  [+]  [Tab1] [Tab2] [Tab3]  ...    [⚙]     │
│──────────────────────────────────────────────────────────────│
│                                                              │
│                   CONTENIDO DEL TAB ACTIVO                   │
│                                                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

- **Header fijo** con:
  - Logo (ver sección 3.2)
  - Título "GENE_OS"
  - Botón **"+"** (como en navegadores) para agregar nueva pestaña/secuencia
  - Tabs de secuencias abiertas (cerrable con ×)
  - Botón de **engranaje ⚙** para configuración (ver sección 3.6)
- **Sin sidebar**. Todo el contenido va en el área principal.
- Cada tab de secuencia contiene sub-tabs con las distintas vistas de análisis.

### 3.2 Logo

El logo debe ser una **letra "G" estilizada con motifs de ADN** (doble hélice integrada en la forma de la G, pares de bases como barras horizontales dentro de la curva). Debe funcionar bien en tamaños pequeños (favicon, 32×32) y grandes.

### 3.3 Multi-secuencia

- El usuario puede tener **múltiples secuencias abiertas** simultáneamente.
- Cada secuencia es un **tab** en el header (similar a pestañas de navegador).
- Al hacer click en **"+"** se abre una vista para cargar una nueva secuencia:
  - Input de texto (pegar secuencia o accession number)
  - Botón de abrir archivo
  - Zona de drag & drop
  - Presets de ejemplo
  - Búsqueda en bases de datos online
- Los tabs se pueden cerrar individualmente con un botón ×.

### 3.4 Sub-tabs de análisis (dentro de cada secuencia)

> **Nota**: La estructura de tabs internos actual es la base. Los cambios solicitados son:

1. **El tab de GC Skew se fusiona dentro del tab de Summary** — el gráfico de GC content y skew se muestra como sección dentro del resumen general.
2. **Plasmid Map + Sequence Viewer + Restriction Analysis se fusionan en un solo tab** — una vista unificada de "visualización de secuencia" donde conviven el mapa, el visor y los sitios de restricción.
3. **El resto de tabs se mantiene** como estaba (con las herramientas adicionales nuevas que se describen abajo).

### 3.5 Área de input de secuencia

- **Drag & drop**: Arrastrar archivos directamente sobre la ventana.
- **Botón "Abrir archivo"**: Diálogo nativo del sistema operativo (Tauri).
- **Input de texto**: Textarea para pegar secuencias.
- **Formatos aceptados**: FASTA, GenBank/EMBL, texto crudo (secuencia pura), SnapGene (.dna), AB1 (cromatogramas de Sanger), y cualquier otro formato estándar utilizado en biología molecular. Cubrir todos los formatos que se usen en el rubro.

### 3.6 Menú de Configuración (⚙ Gear)

Al hacer click en el ícono de engranaje se abre un **panel flotante o modal** con:

| Categoría | Opciones |
|-----------|----------|
| **Idioma** | Español, English, Português (autodetectado por defecto según el sistema operativo) |
| **Tema de color** | Selector de paleta de colores (ya existen 7 paletas) |
| **Modo de luminosidad** | Oscuro / Dusk ("no tan oscuro") / Claro |
| **Animación de fondo** | Partículas, Double Helix 3D, Hex Biomatrix, Telemetry Waves, etc. |
| **Sonidos** | On/Off, volumen |
| **Modo** | Default / Avanzado |

### 3.7 Sonidos de interacción

Los sonidos de UI deben tener estética **sci-fi/tech** (inspiración: Omnitrix de Ben 10). Sonidos sintéticos con modulación FM, filtros resonantes, secuencias de múltiples osciladores.

Eventos con sonido:
- Click en tabs / botones
- Carga de secuencia exitosa
- Exportación completada
- Error / advertencia
- Apertura/cierre de paneles

### 3.8 Fondos animados

La app debe tener animaciones de fondo sutiles seleccionables:
- Partículas flotantes (ya existe)
- Doble hélice 3D rotando
- Grilla hexagonal "biomatrix"
- Ondas de telemetría
- Más opciones a criterio del implementador

### 3.9 Scroll

Ningún tab debe forzar un scrollbar sobre toda la aplicación. Cada panel de contenido debe manejar su propio scroll interno sin afectar al header ni a la estructura general.

### 3.10 Tipografía

La app usa tres familias tipográficas, **ya incluidas como archivos `.woff2` offline**:

- **Chakra Petch** (Semi-Bold 600, Bold 700): Para títulos y el nombre "GENE_OS"
- **Inter** (Regular 400, Medium 500): Para cuerpo de texto y UI general
- **JetBrains Mono** (Regular 400, Medium 500): Para secuencias, código, datos monoespaciados

> Las fuentes deben cargarse localmente desde `src/fonts/`, sin CDN.

---

## 4. Funcionalidades de Análisis

### 4.1 Resumen de secuencia (Summary)

Cuando se carga una secuencia, mostrar un resumen completo:
- Nombre y descripción de la secuencia
- Largo (bp o aa)
- Tipo detectado (DNA, RNA, Proteína)
- Topología inferida (lineal / circular)
- Inferencia de organismo (por composición GC, codón usage, etc.) con SVG representativo
- Composición de nucleótidos / aminoácidos (tabla + gráfico)
- Peso molecular
- Punto isoeléctrico (si es proteína o traducción)
- **Gráfico de contenido GC y GC Skew** (integrado aquí, no en tab separado)
- Features detectados automáticamente (promotores, terminadores, orígenes, resistencias)

### 4.2 Restricción enzimática

#### Digestión simple
- Escanear la secuencia con todas las enzimas del catálogo (o una selección del usuario).
- Mostrar: posición de corte, enzima, secuencia reconocida, tipo de extremo generado.

#### Digestión doble
- El usuario selecciona dos enzimas y ve los fragmentos resultantes de la digestión combinada.

#### Simulación de gel
- Visualizar los fragmentos de restricción como bandas en un **gel de agarosa virtual**.
- Incluir **marcador de peso molecular** (el programa debe sugerir un marcador comercial apropiado según el rango de tamaños, ej: 1kb Ladder, 100bp Ladder, etc.).

#### Filtrado
- Filtrar enzimas por **tipo de extremo**: cohesivo 5', cohesivo 3', romo (blunt).
- Filtrar por número de cortes (únicas, doble, múltiple, no-cutters).
- Filtrar por proveedor comercial.

### 4.3 Diseño y análisis de primers

#### Análisis de primers (usuario ingresa manualmente)
- Tm (múltiples métodos: nearest-neighbor, básico)
- Contenido GC (%)
- Largo
- Detección de dímeros (self-dimer y cross-dimer entre par de primers)
- Detección de hairpins
- Estabilidad del extremo 3'
- Verificación de especificidad contra la secuencia cargada

#### Diseño automático de primers
- El usuario selecciona una **región de la secuencia** y el programa diseña primers óptimos para amplificarla.
- Parámetros configurables (con valores por defecto razonables):
  - Rango de Tm deseado
  - Rango de largo del primer
  - Rango de %GC
  - Máxima autocomplementariedad
  - Máximo ΔTm entre forward y reverse
- Debe generar múltiples opciones ranqueadas por calidad.

### 4.4 PCR virtual

- El usuario ingresa (o diseña) un par de primers y la secuencia template.
- El programa **simula la PCR** y muestra:
  - Producto esperado (secuencia completa)
  - Largo del producto
  - Visualización en gel virtual (con marcador comercial sugerido)
- Soporte para:
  - PCR sobre secuencia lineal
  - PCR sobre plásmido circular
  - Colony PCR (simular amplificación desde un plásmido insertado)

### 4.5 Clonación molecular

La app debe soportar el **diseño de estrategia completa** y la **simulación del resultado** para los siguientes métodos de clonación:

| Método | Funcionalidad esperada |
|--------|----------------------|
| **Restricción + Ligación clásica** | Elegir enzimas, digerir vector e inserto, ligar, ver constructo final |
| **Gibson Assembly** | Diseñar primers con overhangs de homología, simular el ensamblaje |
| **Golden Gate Assembly** | Elegir enzima Type IIS, diseñar overhangs internos, simular |
| **Gateway Cloning** | Definir att sites, simular reacciones BP y LR |
| **TOPO Cloning** | Simular inserción directa en vector TOPO |
| **In-Fusion Cloning** | Diseñar primers con overhangs de 15bp, simular recombinación |

Para cada método, el flujo general es:
1. El usuario elige un **inserto** (secuencia o región seleccionada)
2. El usuario elige un **vector** (de la biblioteca o cargado)
3. El programa **diseña los primers necesarios** (con overhangs, sitios de restricción, etc. según el método)
4. El programa **simula el constructo final** y lo muestra como nueva secuencia analizable
5. Se pueden visualizar los primers, fragmentos y producto en las distintas vistas

> **Nota para el implementador**: Cubrir tantos métodos de clonación como sea razonablemente implementable. Los listados arriba son el mínimo. Si existen otros métodos relevantes (ej: ligation-independent cloning, recombineering, etc.), incluirlos.

### 4.6 Alineamiento de secuencias

El usuario debe poder realizar alineamientos y **elegir el tipo**:

- **Pairwise (dos secuencias)**: Alineamiento global (Needleman-Wunsch) o local (Smith-Waterman)
- **Múltiple (MSA)**: Para 3+ secuencias

Visualización:
- Mostrar identidad, gaps, mismatches con coloreado
- Score de alineamiento
- Porcentaje de identidad / similitud

> El usuario puede seleccionar secuencias de los tabs abiertos para alinear entre sí.

### 4.7 Detección de ORFs (Open Reading Frames)

- Escanear la secuencia buscando **marcos de lectura abiertos**.
- Parámetros configurables (con defaults razonables):
  - Largo mínimo del ORF (default: 100 codones)
  - Codón de inicio (ATG por defecto, opción de codones alternativos)
  - Búsqueda en ambas hebras
  - Marcos de lectura (+1, +2, +3, -1, -2, -3)
- Mostrar todos los ORFs encontrados en una tabla y mapeados sobre la secuencia.
- Click en un ORF → ver su traducción a proteína.

### 4.8 Traducción y análisis de proteínas

- Traducir secuencia de DNA a proteína en el marco seleccionado (o todos los marcos).
- Para cada traducción / proteína ingresada, calcular:
  - Peso molecular
  - Punto isoeléctrico (pI)
  - Perfil de hidrofobicidad (gráfico Kyte-Doolittle)
  - Composición de aminoácidos
  - Predicción de dominios (si es factible sin dependencias externas pesadas)
  - Carga neta a pH fisiológico
  - Índice de inestabilidad
  - Coeficiente de extinción

### 4.9 Anotación manual de features

- El usuario puede **agregar, editar y borrar** anotaciones sobre la secuencia:
  - Seleccionar rango de posiciones (inicio - fin)
  - Asignar tipo (Promoter, Gene, Terminator, Origin, Resistance, Tag, Custom, etc.)
  - Nombre y descripción
  - Color
  - Dirección (forward / reverse)
- Las anotaciones se reflejan en:
  - El mapa de plásmido
  - El visor de secuencia
  - La exportación GenBank

### 4.10 Búsqueda en la secuencia

- Buscar **subcadenas** dentro de la secuencia (DNA o proteína)
- Buscar **motivos** o patrones
- Buscar **sitios de restricción** por nombre de enzima
- Soporte para **expresiones regulares**
- Resaltar resultados en el visor de secuencia
- Navegación entre resultados (siguiente / anterior)

### 4.11 Gráficos y charts

Ofrecer la mayor cantidad posible de gráficos analíticos:

- Contenido GC (ventana deslizante)
- GC Skew
- Hidrofobicidad (Kyte-Doolittle)
- Codon usage (frecuencia de codones, comparación con tablas de organismos)
- Tm a lo largo de la secuencia (sliding window)
- Contenido AT
- Contenido purina/pirimidina
- Perfil de complejidad de secuencia
- Cualquier otro gráfico analítico relevante a criterio del implementador

---

## 5. Visualización

### 5.1 Mapa de plásmido (Plasmid Map)

- Representación **circular** de la secuencia (si es un plásmido).
- Mostrar:
  - Features coloreados por tipo (genes, promotores, terminadores, orígenes, resistencias, tags)
  - Sitios de restricción (enzimas únicas destacadas)
  - Primers mapeados (si se han diseñado o ingresado)
  - Escala de pares de bases
  - Nombre del plásmido y tamaño en el centro
- **Interactivo**: Click en un feature → navega al visor de secuencia en esa posición.
- Hover → muestra tooltip con info del feature.
- Labels con manejo de colisiones (que no se superpongan).
- **Exportable** como imagen (SVG y PNG).

### 5.2 Visor de secuencia (Sequence Viewer)

Ofrecer **múltiples modos de vista** seleccionables por el usuario:

- **Vista texto** (tipo ApE): Secuencia como texto continuo con anotaciones coloreadas.
- **Vista bloques** (tipo SnapGene): Agrupada en bloques de 10, con numeración.
- **Vista multimarco**: Traducción en 6 marcos de lectura (+1/+2/+3 y -1/-2/-3) debajo de la secuencia.
- **Vista de marco correcto**: Solo el marco de lectura principal.

En todos los modos:
- Paginación o scroll suave para secuencias largas
- Numeración de posición
- Resaltado de features anotados
- Resaltado de sitios de restricción
- Resaltado de resultados de búsqueda
- Selección de rango (click + drag) para operaciones
- Función "jump to position" (ir a un bp específico)
- Secuencia complementaria visible

### 5.3 Gel virtual (Virtual Gel)

- Simulación de electroforesis en gel de agarosa.
- Usado para:
  - Fragmentos de **digestión de restricción** (simple y doble)
  - Productos de **PCR virtual**
- Incluye **marcador de peso molecular** — el programa sugiere automáticamente un marcador comercial apropiado según el rango de tamaños de los fragmentos (ej: GeneRuler 1kb, 100bp Ladder, etc.).
- Las bandas deben reflejar intensidad relativa (fragmentos más grandes → bandas más gruesas/intensas).
- Visualización realista (gradiente de migración, wells, etc.).

---

## 6. Bases de Datos y Bibliotecas

### 6.1 Búsqueda online (requiere conexión)

- **NCBI** (GenBank, RefSeq): Buscar por accession number o keywords
- **ENA** (European Nucleotide Archive)
- **UniProt** (proteínas)

> **Nota para el implementador**: El diseño de UX para la búsqueda en bases de datos queda a tu criterio. Puede ser un buscador con resultados, ingreso directo de accession number, o lo que consideres mejor experiencia de usuario.

### 6.2 Contenido offline

- **Presets de ejemplo**: Secuencias de ejemplo precargadas para exploración (pUC19, PETase, eGFP y más).
- **Catálogo de enzimas**: Todas las enzimas de restricción comercialmente relevantes, cargadas localmente.
- **Catálogo de features**: Todos los features/partes biológicas comunes para detección automática.
- Todos los análisis (restricción, primers, PCR, traducción, ORFs, etc.) funcionan **sin conexión a internet**.

---

## 7. Exportación y Guardado

### 7.1 Formatos de exportación

La app debe soportar exportar a **todos los formatos razonablemente posibles**:

| Categoría | Formatos |
|-----------|----------|
| **Secuencias** | GenBank (.gb/.gbk), FASTA (.fasta/.fa), EMBL, SnapGene (.dna), texto plano |
| **Datos/tablas** | CSV, TSV, JSON (resultados de análisis, listas de enzimas, primers, etc.) |
| **Imágenes** | SVG, PNG (mapa de plásmido, gráficos, gel virtual) |
| **Reportes** | PDF (ver sección 7.3) |
| **Proyecto** | Formato de proyecto GENE_OS (ver sección 7.2) |

### 7.2 Archivo de proyecto

- El usuario puede **guardar toda su sesión** en un archivo de proyecto GENE_OS.
- El proyecto incluye:
  - Todas las secuencias cargadas
  - Anotaciones manuales
  - Resultados de análisis
  - Primers diseñados
  - Estrategias de clonado
  - Configuración de vista
- Al reabrir el archivo de proyecto, se restaura todo exactamente como estaba.

### 7.3 Informe comparativo PDF

**Feature destacada**: El usuario puede generar un **informe PDF completo comparando dos secuencias distintas**.

El informe debe incluir:
- Resumen de cada secuencia (nombre, largo, tipo, composición)
- Alineamiento entre ambas
- Diferencias detectadas (mutaciones, inserciones, deleciones)
- Mapa de restricción comparado
- Gráficos comparados (GC content, etc.)
- Resumen estadístico de identidad/similitud
- Fecha, nombre del proyecto, branding GENE_OS

### 7.4 Copiar al portapapeles

Poder copiar al portapapeles (Ctrl+C o botón):
- Secuencia (sentido)
- Secuencia complementaria reversa
- Traducción a proteína
- Primers individuales
- Fragmentos de restricción
- Subsecuencias seleccionadas
- Datos tabulares de resultados
- Cualquier otro dato analítico visible

### 7.5 Exportación nativa

Usar diálogos nativos del sistema operativo (vía Tauri) para elegir ubicación y nombre de archivo al exportar. Con fallback a descarga por navegador si no está disponible.

---

## 8. Persistencia y Sesión

### 8.1 Restauración de sesión

Al cerrar y reabrir GENE_OS, la app debe **restaurar automáticamente el estado** tal como el usuario lo dejó:
- Secuencias cargadas
- Tab activo
- Configuración (tema, idioma, modo, etc.)
- Anotaciones y análisis en curso

### 8.2 Undo / Redo

- Soporte completo de **deshacer / rehacer** para:
  - Cambios en la secuencia
  - Agregar / editar / borrar anotaciones
  - Modificaciones de parámetros de análisis
- Shortcuts: Ctrl+Z / Ctrl+Y (o Ctrl+Shift+Z)

---

## 9. Atajos de Teclado

La app debe tener shortcuts de teclado para las operaciones más comunes:

| Atajo | Acción |
|-------|--------|
| Ctrl+S | Guardar proyecto |
| Ctrl+O | Abrir archivo |
| Ctrl+N | Nueva secuencia (tab +) |
| Ctrl+W | Cerrar tab activo |
| Ctrl+F | Buscar en secuencia |
| Ctrl+Z | Deshacer |
| Ctrl+Y | Rehacer |
| Ctrl+C | Copiar selección |
| Ctrl+A | Seleccionar toda la secuencia |
| Ctrl+G | Ir a posición (Jump to bp) |
| Ctrl+E | Exportar |

> El implementador puede agregar más shortcuts según lo considere útil.

---

## 10. Internacionalización (i18n)

### 10.1 Idiomas soportados

- **Español** (es)
- **English** (en)
- **Português** (pt)

### 10.2 Autodetección

El idioma se **autodetecta** según la configuración del sistema operativo al primer uso. El usuario puede cambiarlo manualmente desde el menú de configuración (⚙).

### 10.3 Cobertura

**Toda** la interfaz debe estar traducida: labels, tooltips, mensajes de error, nombres de tabs, opciones de menú, placeholder texts, etc.

---

## 11. Conectividad

| Funcionalidad | Requiere conexión |
|---------------|:-:|
| Análisis de restricción | ❌ |
| Diseño de primers | ❌ |
| PCR virtual | ❌ |
| Traducción / ORFs | ❌ |
| Alineamiento | ❌ |
| Clonación | ❌ |
| Mapa de plásmido | ❌ |
| Gráficos y charts | ❌ |
| Exportación | ❌ |
| Búsqueda en NCBI/ENA/UniProt | ✅ |
| Descarga de secuencias de bases de datos | ✅ |

> La app es **offline-first**. Las funciones analíticas nunca requieren conexión. Solo la consulta de bases de datos externas necesita red.

---

## 12. Resumen de Cambios Pendientes (desde V1.2.0)

Estos son cambios que fueron solicitados sobre la versión funcional V1.2.0 y deben implementarse:

1. ✅ **Restaurar tipografía estilosa**: Las fuentes Chakra Petch / Inter / JetBrains Mono deben cargarse correctamente desde los archivos locales.
2. ✅ **Fusionar tab GC Skew dentro de Summary**.
3. ✅ **Fusionar Plasmid Map + Sequence + Restriction en un solo tab**.
4. ✅ **Corregir scrollbar de Libraries**: Ningún tab debe forzar scrollbar global.
5. ✅ **Mover customización al menú ⚙** en el header (eliminar del sidebar).
6. ✅ **Eliminar sidebar** — reemplazar por botón "+" en el header.
7. ✅ **Sonidos Omnitrix** (sci-fi/tech).
8. ✅ **Modo "Dusk"** (no-tan-oscuro) como tercera opción entre dark y light.
9. ✅ **Más animaciones de fondo**: Double Helix 3D, Hex Biomatrix, Telemetry Waves.
10. ✅ **Logo nuevo**: G con motifs de ADN.
11. ✅ **Multi-secuencia** con tabs tipo navegador.
12. ✅ **Archivo de proyecto** guardable y restaurable.
13. ✅ **Restauración automática de sesión**.

---

## 13. Criterios de Calidad

- **Código**: Nivel de senior reviewer. Sin lógica duplicada, helpers compartidos, docstrings.
- **Performance**: Debe manejar secuencias de varios MB sin congelarse (usar streaming/chunking para archivos grandes).
- **Tests**: Tests unitarios para el motor de análisis y tests funcionales para la UI.
- **Accesibilidad**: Labels en inputs, contraste adecuado, navegación por teclado.
- **Sin errores de consola**: La app debe correr con cero errores y cero warnings en la consola del webview.

---

> [!TIP]
> **Para el implementador**: Este spec describe el QUÉ, no el CÓMO. Las decisiones de arquitectura interna, patrones de diseño, estructura de datos, algoritmos específicos y organización del código quedan a tu criterio profesional. Priorizá la experiencia del usuario y la robustez del análisis biológico.
