// ==========================================
// HELPERS
// ==========================================
function normalizeText(str) {
    if (!str) return '';
    return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\uFFFD/g, '')
        .replace(/[^A-Za-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 500);
}

// ==========================================
// DRAG & DROP
// ==========================================
const esPdf = file => file.type === 'application/pdf';
const esExcel = file => /\.xlsx?$/i.test(file.name);

function setupDropZone(dropZoneId, inputId, validar = esPdf, mensajeInvalido = 'Por favor, asegúrate de que el archivo sea un PDF.') {
    const dropZone = document.getElementById(dropZoneId);
    const fileInput = document.getElementById(inputId);
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            if (!validar(e.dataTransfer.files[0])) {
                alert(mensajeInvalido);
                return;
            }
            fileInput.files = e.dataTransfer.files;
            updateDropZone(dropZone, e.dataTransfer.files[0].name);
        }
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) updateDropZone(dropZone, fileInput.files[0].name);
    });
}

function updateDropZone(dropZone, fileName) {
    const textEl = dropZone.querySelector('.drop-text');
    const subEl  = dropZone.querySelector('.drop-subtext');
    if (textEl) textEl.textContent = '✅ Archivo cargado';
    if (subEl)  subEl.textContent  = fileName;
}

function resetDropZone(dropZone, text, sub) {
    const textEl = dropZone.querySelector('.drop-text');
    const subEl  = dropZone.querySelector('.drop-subtext');
    if (textEl) textEl.textContent = text;
    if (subEl)  subEl.textContent  = sub;
}

document.addEventListener('DOMContentLoaded', () => {
    setupDropZone('dropZone1', 'pdfFile1');
    setupDropZone('dropZone2', 'pdfFile2');
    setupDropZone('dropZone3', 'excelFile', esExcel, 'Por favor, asegúrate de que el archivo sea un Excel (.xlsx o .xls).');
});

// ==========================================
// EXTRACCIÓN DE TEXTO CON PDF.js
// ==========================================
async function extractPageTexts(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map(it => it.str).join(' ');
        pages.push(text);
    }
    return pages;
}

// ==========================================
// EXTRAER NOMBRE DE EMPRESA DEL OFICIO
// El formato es: "Señores NOMBRE_EMPRESA DIRECCION Teléfono..."
// ==========================================
function extractOficioCompany(text) {
    if (!text) return null;
    // Empresas: "Señores:" — personas: "Señor(a):"
    const idx = text.search(/Se[ñn]or(?:es|\(a\))\s*:?\s+/i);
    if (idx < 0) return null;
    let after = text.substring(idx).replace(/^Se[ñn]or(?:es|\(a\))\s*:?\s*/i, '').trim();

    let cutIdx = after.length;

    // 1) Cortar en salto de línea
    const nlIdx = after.search(/[\r\n]/);
    if (nlIdx > 0 && nlIdx < cutIdx) cutIdx = nlIdx;

    // 2) Cortar en doble espacio: cuando en el Excel de origen la dirección viene
    //    pegada en la misma celda de EMPRESA, suele quedar separada del nombre
    //    por dos o más espacios (p.ej. "ADECCO S.A.  Calle 38N # 4N-170...")
    const dsIdx = after.search(/ {2,}/);
    if (dsIdx > 2 && dsIdx < cutIdx) cutIdx = dsIdx;

    // 3) Cortar en marcadores de dirección, ciudad, teléfono, etc.
    const cutPatterns = [
        /\s+C[LR][A-Z]{0,3}\s*\d/i,       // CR 8, CL15, CRA 11, CLL 5
        /\s+CALLE?\s*\d/i,                 // CALLE 38N, CALL 17A
        /\s+DG\s*\d/i,                      // DG 24D (diagonal)
        /\s+AV[A-Z]*\s*\d/i,               // AV 6N, AVENIDA 3
        /\s+TV\s*\d/i,                     // TV 9
        /\s+KM\s*\d/i,                     // KM 1
        /\s+CONJ\b/i,
        /\s+SIN\s+DIREC/i,
        /\s+Tel[eé]fono/i,
        /\s+(?:NIT|C\.?\s?C\.?)\s*:/i,   // línea "NIT: ..." o "C.C: ..." tras el nombre
        /\s+U\.?\s*D\.?\s*S\.?/i,
        // Ciudades (por si no hay dirección)
        /\s+POPAY[AÁ]N\b/i,
        /\s+SANTANDER\b/i,
        /\s+BOGOT[AÁ]\b/i,
        /\s+SANTAFE\b/i,
        /\s+CALI\b/i,
        /\s+PASTO\b/i,
        /\s+IBAGU[EÉ]\b/i,
        /\s+GUAPI\b/i,
        /\s+ARGELIA\b/i,
        /\s+CORINTO\b/i,
        /\s+JAMUND[IÍ]\b/i,
        /\s+QUILICHAO\b/i,
        /\s+PUERTO\s+TEJADA\b/i,
        /\s+VILLAVICENCIO\b/i,
        /\s+BARRANQUILLA\b/i,
        /\s+GUACHENE\b/i,
        /\s+PIENDAMO\b/i,
        // 3) Cualquier secuencia de 6+ dígitos (por si viniera cédula pegada)
        /\s+\d{6,}/
    ];

    for (const p of cutPatterns) {
        const m = after.match(p);
        if (m && m.index > 2 && m.index < cutIdx) {
            cutIdx = m.index;
        }
    }

    let name = after.substring(0, cutIdx).trim();
    name = name.replace(/[\s.,;:\-]+$/, '').trim();
    if (name.length > 90) name = name.substring(0, 90).trim();
    return name || null;
}

// ==========================================
// EXTRAER DATOS DE LA PLANILLA (REPORTE)
// La primera página de cada planilla dice (todo junto, sin saltos de línea):
//   "Total Tarjetas de la Empresa: N  [Nit: X]  Empresa: NOMBRE  1 CEDULA NOMBRE_TRABAJADOR ..."
// El "Nit: X" es opcional (hay planillas sin NIT). Se ancla en "Total Tarjetas de la Empresa: N"
// para no confundir su "Empresa:" con el label real, y el nombre se corta antes del número de
// fila + documento del primer trabajador (si no, el "1" de la fila quedaría pegado al nombre).
// Las páginas siguientes de una planilla larga no repiten este encabezado.
// ==========================================
const REPORT_HEADER_RE = /Total\s+Tarjetas\s+de\s+la\s+Empresa\s*:\s*(\d+)\s+(?:Nit\s*:\s*([\d.\-\s]*?)\s*)?Empresa\s*:\s*/i;

function extractReportCompany(text) {
    if (!text) return null;
    const anchor = text.match(REPORT_HEADER_RE);
    if (!anchor) return null;
    const after = text.substring(anchor.index + anchor[0].length).trim();

    let cutIdx = after.length;
    const cutPatterns = [
        /\s+\d{1,3}\s+\d{5,}/,              // No. de fila + documento del primer trabajador
        /\s+\d{6,}/,                        // documento del primer trabajador
        /\s+No\./i,
        /\s+CEDULA\b/i,
        /\s+NOMBRE\s+TRABAJADOR/i,
        /\s+No\s+TARJETA/i,
        /\s+Nit\s*:/i,
        /\s+Total\s+Tarjetas/i
    ];
    for (const p of cutPatterns) {
        const m = after.match(p);
        if (m && m.index > 0 && m.index < cutIdx) cutIdx = m.index;
    }

    let name = after.substring(0, cutIdx).trim();
    name = name.replace(/[\s.,;:\-]+$/, '').trim();
    if (name.length > 100) name = name.substring(0, 100).trim();
    return name || null;
}

function extractReportCantidad(text) {
    const m = text && text.match(REPORT_HEADER_RE);
    return m ? parseInt(m[1], 10) : null;
}

// NIT impreso en la planilla (solo dígitos), o '' si la planilla no lo trae
function extractReportNit(text) {
    const m = text && text.match(REPORT_HEADER_RE);
    return m && m[2] ? m[2].replace(/\D/g, '') : '';
}

// Cantidad que declara el oficio: "Remito a usted listado, 4 Tarjeta (s) Corporativa (s)..."
function extractOficioCantidad(text) {
    // Empresa: "listado, 4 Tarjeta (s)"; persona: "su Tarjeta Corporativa" (1) o "sus 2 Tarjetas Corporativas"
    const m = text && (text.match(/listado,?\s*(\d+)\s*Tarjeta/i) || text.match(/sus\s+(\d+)\s+Tarjetas/i));
    if (m) return parseInt(m[1], 10);
    return text && /Remito a usted su Tarjeta/i.test(text) ? 1 : null;
}

// Una planilla puede ocupar varias páginas: la primera trae el encabezado con la empresa y las
// siguientes no. Se agrupan para tratarlas (y copiarlas al PDF final) como una sola unidad.
function agruparPaginasReporte(textos) {
    const unidades = [];
    textos.forEach((texto, i) => {
        if (unidades.length === 0 || REPORT_HEADER_RE.test(texto)) {
            unidades.push({ nombre: extractReportCompany(texto), nit: extractReportNit(texto), cant: extractReportCantidad(texto), paginas: [i], texto });
        } else {
            const u = unidades[unidades.length - 1];
            u.paginas.push(i);
            u.texto += ' ' + texto;
        }
    });
    return unidades;
}

// ==========================================
// EMPAREJAR OFICIOS CON PLANILLAS
// Nunca se adivina por posición. En orden de certeza:
//   1) nombre idéntico;
//   2) nombre truncado: el CB corta el nombre de la empresa a 40 caracteres, así que el de la
//      planilla puede ser solo el comienzo del nombre completo del oficio. Se acepta si la
//      cantidad de tarjetas coincide y la pareja es única en ambos lados;
//   3) el nombre (12+ caracteres) de uno aparece dentro del texto del otro, con cantidad
//      compatible y pareja única en ambos lados.
// Todo lo demás queda sin emparejar para que se revise.
// oficios / reportes: [{ nombre, cant, texto }] con nombre y texto ya normalizados.
// ==========================================
function emparejar(oficios, reportes) {
    const resultado = oficios.map(() => ({ reporte: -1, tipo: null }));
    const usado = new Array(reportes.length).fill(false);
    const cantCompatible = (a, b) => a.cant == null || b.cant == null || a.cant === b.cant;
    const asignar = (i, j, tipo) => { resultado[i] = { reporte: j, tipo }; usado[j] = true; };
    const MIN_PREFIJO = 20;   // el CB trunca a 40 caracteres: un prefijo corto no es evidencia
    const esPrefijo = (a, b) => {
        const corto = a.length < b.length ? a : b;
        const largo = a.length < b.length ? b : a;
        return corto.length >= MIN_PREFIJO && largo.startsWith(corto);
    };

    // 1) Nombre idéntico
    oficios.forEach((o, i) => {
        if (!o.nombre) return;
        const cands = reportes.map((r, j) => j).filter(j => !usado[j] && reportes[j].nombre === o.nombre);
        const j = cands.find(j => cantCompatible(o, reportes[j])) ?? cands[0];
        if (j !== undefined) asignar(i, j, 'exacto');
    });

    // 2) Nombre truncado + misma cantidad, solo si la pareja es única
    const pares = [];
    oficios.forEach((o, i) => {
        if (resultado[i].reporte >= 0 || !o.nombre) return;
        reportes.forEach((r, j) => {
            if (usado[j] || !r.nombre || !cantCompatible(o, r)) return;
            if (esPrefijo(o.nombre, r.nombre)) pares.push([i, j]);
        });
    });
    pares.forEach(([i, j]) => {
        if (pares.filter(([a, b]) => a === i || b === j).length === 1) asignar(i, j, 'truncado');
    });

    // 3) El nombre aparece dentro del texto del otro; también exige pareja única
    const MIN_CONTENIDO = 12;
    const pares3 = [];
    oficios.forEach((o, i) => {
        if (resultado[i].reporte >= 0) return;
        reportes.forEach((r, j) => {
            if (usado[j] || !cantCompatible(o, r)) return;
            const oficioEnReporte = o.nombre && o.nombre.length >= MIN_CONTENIDO && r.texto.includes(o.nombre);
            const reporteEnOficio = r.nombre && r.nombre.length >= MIN_CONTENIDO && o.texto.includes(r.nombre);
            if (oficioEnReporte || reporteEnOficio) pares3.push([i, j]);
        });
    });
    pares3.forEach(([i, j]) => {
        if (pares3.filter(([a, b]) => a === i || b === j).length === 1) asignar(i, j, 'contenido');
    });

    // Sugerencias para lo que quedó sin pareja: nombre parecido pero cantidad distinta
    const sugerencias = new Map();
    oficios.forEach((o, i) => {
        if (resultado[i].reporte >= 0 || !o.nombre) return;
        const js = reportes.map((r, j) => j).filter(j => !usado[j] && reportes[j].nombre && (reportes[j].nombre === o.nombre || esPrefijo(o.nombre, reportes[j].nombre)));
        if (js.length) sugerencias.set(i, js);
    });

    return { resultado, usado, sugerencias };
}

// ==========================================
// EMPAREJAR CON BASE EN EL EXCEL
// El Excel (la hoja que usan los oficios) es la lista exacta de empresas. Cada oficio y cada
// planilla se identifica contra esa lista y se empareja por la fila que comparten:
//  - Oficio: tras "Señores" viene el nombre completo de la empresa; se busca qué fila del Excel
//    es ese texto (la más larga que coincida), sin tener que adivinar dónde termina el nombre.
//  - Planilla: 1) NIT igual (si el nombre es compatible o la cantidad coincide),
//              2) nombre idéntico, 3) nombre truncado por el CB + misma cantidad (pareja única).
// Nunca se empareja por posición. Lo que no se identifique con certeza queda aparte, con el motivo.
// filas: [{ nombre, nit, cant }]; oficios: [{ texto, cant }]; unidades: [{ nombre, nit, cant }]
// (nombres y textos normalizados; nit solo dígitos).
// ==========================================
function emparejarConExcel(filas, oficios, unidades) {
    const MIN_PREFIJO = 20;   // el CB trunca a 40 caracteres: un prefijo corto no es evidencia
    const todas = filas.map((f, k) => k);
    const filaDeOficio = oficios.map(() => -1);
    const oficioDeFila = filas.map(() => -1);
    const filaDeUnidad = unidades.map(() => -1);
    const unidadDeFila = filas.map(() => -1);
    const tipoUnidad = unidades.map(() => null);
    const motivoOficio = new Map();
    const motivoUnidad = new Map();
    const cantOk = (k, c) => !(filas[k].cant > 0) || c == null || filas[k].cant === c;
    const relacionados = (a, b) => {
        if (!a || !b) return false;
        const corto = a.length < b.length ? a : b, largo = a.length < b.length ? b : a;
        return a === b || (corto.length >= MIN_PREFIJO && largo.startsWith(corto));
    };

    // ---- Oficios: la fila cuyo nombre es lo que viene tras "Señores" ----
    oficios.forEach((o, i) => {
        const mS = o.texto.match(/SENOR(?:ES|A) /);   // "Señores:" (empresa) o "Señor(a):" (persona)
        if (!mS) { motivoOficio.set(i, 'no se encontró "Señores" ni "Señor(a)" en la página'); return; }
        const resto = o.texto.substring(mS.index + mS[0].length);
        let cands = todas.filter(k => filas[k].nombre && (resto === filas[k].nombre || resto.startsWith(filas[k].nombre + ' ')));
        if (!cands.length) { motivoOficio.set(i, 'su empresa no está en el Excel'); return; }
        const largo = Math.max(...cands.map(k => filas[k].nombre.length));
        cands = cands.filter(k => filas[k].nombre.length === largo);
        const libres = cands.filter(k => oficioDeFila[k] < 0);
        const k = libres.find(k => filas[k].cant === o.cant) ?? libres[0];
        if (k === undefined) { motivoOficio.set(i, 'ya hay otro oficio para esa misma empresa del Excel (duplicado)'); return; }
        filaDeOficio[i] = k; oficioDeFila[k] = i;
    });

    // ---- Planillas ----
    const asignar = (j, k, tipo) => { filaDeUnidad[j] = k; unidadDeFila[k] = j; tipoUnidad[j] = tipo; };
    const libres = ks => ks.filter(k => unidadDeFila[k] < 0);

    // 1) NIT
    unidades.forEach((u, j) => {
        if (!u.nit) return;
        let cands = todas.filter(k => filas[k].nit && filas[k].nit === u.nit);
        if (!cands.length) return;
        if (cands.length > 1) {
            const porNombre = cands.filter(k => filas[k].nombre === u.nombre);
            cands = porNombre.length ? porNombre : cands.filter(k => filas[k].cant > 0 && cantOk(k, u.cant));
        }
        if (cands.length !== 1) { motivoUnidad.set(j, `el NIT ${u.nit} está en varias filas del Excel y no se puede decidir cuál`); return; }
        const k = cands[0];
        const exacta = todas.filter(x => filas[x].nombre === u.nombre);
        if (exacta.length && !exacta.includes(k)) { motivoUnidad.set(j, `el NIT apunta a "${filas[k].nombre}" pero el nombre coincide con otra fila ("${filas[exacta[0]].nombre}")`); return; }
        const nombreOk = relacionados(u.nombre, filas[k].nombre);
        if (!nombreOk && !(filas[k].cant > 0 && cantOk(k, u.cant))) { motivoUnidad.set(j, `el NIT coincide con "${filas[k].nombre}" pero ni el nombre ni la cantidad`); return; }
        if (unidadDeFila[k] >= 0) { motivoUnidad.set(j, `la fila "${filas[k].nombre}" ya está asignada a otra planilla (duplicado)`); return; }
        asignar(j, k, nombreOk ? (u.nombre === filas[k].nombre ? 'nombre' : 'truncado') : 'nit');
    });

    // 2) Nombre idéntico
    unidades.forEach((u, j) => {
        if (filaDeUnidad[j] >= 0 || motivoUnidad.has(j) || !u.nombre) return;
        const cands = libres(todas.filter(k => filas[k].nombre === u.nombre));
        if (!cands.length) return;
        asignar(j, cands.find(k => filas[k].cant > 0 && filas[k].cant === u.cant) ?? cands[0], 'nombre');
    });

    // 3) Nombre truncado + misma cantidad; solo si la pareja es única en ambos lados
    const pares = [];
    unidades.forEach((u, j) => {
        if (filaDeUnidad[j] >= 0 || motivoUnidad.has(j) || !u.nombre) return;
        libres(todas).forEach(k => {
            if (relacionados(u.nombre, filas[k].nombre) && cantOk(k, u.cant)) pares.push([j, k]);
        });
    });
    pares.forEach(([j, k]) => {
        if (pares.filter(([a, b]) => a === j || b === k).length === 1) asignar(j, k, 'truncado');
    });
    unidades.forEach((u, j) => {
        if (filaDeUnidad[j] >= 0 || motivoUnidad.has(j)) return;
        const hay = pares.filter(([a]) => a === j).length;
        motivoUnidad.set(j, hay > 1 ? 'su nombre es el comienzo de varias empresas del Excel con la misma cantidad' :
            hay === 1 ? 'otra planilla compite por la misma empresa del Excel' : 'no se encontró esta empresa en el Excel (ni por NIT, ni por nombre)');
    });

    // ---- Resultado en el mismo formato que usa el resto: por oficio, su planilla ----
    const matches = oficios.map((o, i) => {
        const k = filaDeOficio[i];
        const j = k >= 0 ? unidadDeFila[k] : -1;
        return { reporte: j, tipo: j >= 0 ? 'excel' : null };
    });
    const usado = unidades.map(() => false);
    matches.forEach(m => { if (m.reporte >= 0) usado[m.reporte] = true; });
    return { matches, usado, filaDeOficio, oficioDeFila, filaDeUnidad, unidadDeFila, tipoUnidad, motivoOficio, motivoUnidad };
}

// ==========================================
// LEER EL EXCEL DE EMPRESAS
// ==========================================
function detectarColumnas(headersRow, mapaBuscado) {
    const indices = {};
    headersRow.forEach((h, i) => {
        const key = normalizeText(h);
        for (const [campo, alias] of Object.entries(mapaBuscado)) {
            if (indices[campo] !== undefined) continue;
            for (const a of alias) {
                const aliasNorm = normalizeText(a);
                if (key === aliasNorm || (aliasNorm.length > 2 && key.includes(aliasNorm))) {
                    indices[campo] = i;
                    break;
                }
            }
        }
    });
    return indices;
}

async function leerEmpresasExcel(file, nombreHoja) {
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    const sheet = wb.Sheets[nombreHoja];
    if (!sheet) return { error: `El Excel no tiene la hoja "${nombreHoja}". Hojas encontradas: ${wb.SheetNames.join(', ')}.` };
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const cols = detectarColumnas(data[0] || [], {
        nit:    ['NIT'],
        nombre: ['EMPRESA', 'RAZON SOCIAL', 'RAZÓN SOCIAL'],
        cant:   ['CANT', 'CANTIDAD']
    });
    if (cols.nombre === undefined) return { error: `La hoja "${nombreHoja}" no tiene una columna EMPRESA.` };
    const filas = [];
    data.slice(1).forEach(row => {
        const nombre = String(row[cols.nombre] ?? '').trim();
        if (!nombre) return;
        filas.push({
            nombre,
            nit: cols.nit !== undefined ? String(row[cols.nit] ?? '').replace(/\D/g, '') : '',
            cant: cols.cant !== undefined ? (parseInt(row[cols.cant]) || 0) : 0
        });
    });
    return { filas, tieneNit: cols.nit !== undefined, tieneCant: cols.cant !== undefined };
}

// ==========================================
// COMBINAR PDFs
// ==========================================
async function combinarPDFs() {
    const pdfFile1 = document.getElementById('pdfFile1').files[0];
    const pdfFile2 = document.getElementById('pdfFile2').files[0];
    const excelFile = document.getElementById('excelFile').files[0];

    if (!pdfFile1 || !pdfFile2) {
        alert('Por favor, selecciona los dos archivos PDF.');
        return;
    }

    const messageEl = document.getElementById('message');
    const reportEl  = document.getElementById('validationReport');
    reportEl.innerHTML = '';
    messageEl.textContent = '⏳ Analizando PDFs...';
    messageEl.className = 'loading';

    try {
        // 0. Excel de empresas (opcional): si se carga, manda en el emparejamiento
        let excel = null;
        const hojaExcel = (document.getElementById('sheetExcel').value || '').trim() || 'Direcciones';
        if (excelFile) {
            messageEl.textContent = '⏳ Leyendo el Excel...';
            excel = await leerEmpresasExcel(excelFile, hojaExcel);
            if (!excel.error && excel.filas.length === 0) excel.error = `La hoja "${hojaExcel}" no tiene empresas.`;
            if (excel.error) {
                messageEl.textContent = '❌ ' + excel.error;
                messageEl.className = 'error';
                alert('❌ ' + excel.error);
                return;
            }
        }

        // 1. Cargar PDFs
        const pdf1Bytes = await pdfFile1.arrayBuffer();
        const pdf2Bytes = await pdfFile2.arrayBuffer();
        const pdfDoc1 = await PDFLib.PDFDocument.load(pdf1Bytes);
        const pdfDoc2 = await PDFLib.PDFDocument.load(pdf2Bytes);
        const totalOficios = pdfDoc1.getPageCount();
        const totalReportes = pdfDoc2.getPageCount();

        // 2. Extraer textos
        messageEl.textContent = '⏳ Extrayendo texto de los oficios...';
        const oficiosTexts = await extractPageTexts(pdfFile1);
        messageEl.textContent = '⏳ Extrayendo texto de los reportes...';
        const reportesTexts = await extractPageTexts(pdfFile2);

        // 3. Datos de cada oficio y de cada planilla (una planilla puede ocupar varias páginas)
        const unidades = agruparPaginasReporte(reportesTexts);
        const oficioCompanies = oficiosTexts.map(t => extractOficioCompany(t));
        const oficioCants = oficiosTexts.map(t => extractOficioCantidad(t));
        const oficiosN = oficiosTexts.map((t, i) => ({ nombre: normalizeText(oficioCompanies[i]), cant: oficioCants[i], texto: normalizeText(t) }));
        const reportesN = unidades.map(u => ({ nombre: normalizeText(u.nombre), nit: u.nit, cant: u.cant, texto: normalizeText(u.texto) }));
        const nombreReporte = j => unidades[j].nombre || '(sin nombre)';
        const nombreOficio = i => oficioCompanies[i] || '(sin nombre)';

        // ============= DIAGNÓSTICO =============
        console.log('═══════════════════════════════════════════');
        console.log(excel ? `MODO: con Excel (hoja "${hojaExcel}", ${excel.filas.length} empresas)` : 'MODO: sin Excel (solo por el texto de los PDFs)');
        console.log('EMPRESAS EN OFICIOS (primeras 15):');
        oficioCompanies.forEach((c, i) => { if (i < 15) console.log(`  Oficio ${i+1}: "${c}" (${oficioCants[i]} tarjetas)`); });
        console.log('EMPRESAS EN PLANILLAS (primeras 15):');
        unidades.forEach((u, j) => { if (j < 15) console.log(`  Planilla ${j+1} (pág. ${u.paginas[0] + 1}): "${u.nombre}" NIT ${u.nit || '-'} (${u.cant} tarjetas)`); });
        console.log('═══════════════════════════════════════════');

        // 4. Emparejamiento (nunca se adivina por posición)
        let matches, usedReporte, sugerencias = new Map(), ex = null;
        if (excel) {
            const filasN = excel.filas.map(f => ({ nombre: normalizeText(f.nombre), nit: f.nit, cant: f.cant }));
            ex = emparejarConExcel(filasN, oficiosN, reportesN);
            ({ matches, usado: usedReporte } = ex);
        } else {
            const r = emparejar(oficiosN, reportesN);
            ({ resultado: matches, usado: usedReporte, sugerencias } = r);
        }

        const oficiosSinReporte = [];
        matches.forEach((m, i) => { if (m.reporte < 0) oficiosSinReporte.push(i); });
        const reportesSinOficio = [];
        usedReporte.forEach((u, j) => { if (!u) reportesSinOficio.push(j); });
        const porTruncado = matches.map((m, i) => ({ i, m })).filter(x =>
            ex ? (x.m.reporte >= 0 && ex.tipoUnidad[x.m.reporte] === 'truncado') : x.m.tipo === 'truncado');
        const cantDistinta = matches.map((m, i) => ({ i, m })).filter(x => {
            if (x.m.reporte < 0) return false;
            const cs = [oficioCants[x.i], unidades[x.m.reporte].cant];
            if (ex) { const f = excel.filas[ex.filaDeOficio[x.i]]; if (f && f.cant > 0) cs.push(f.cant); }
            const conocidas = cs.filter(c => c != null);
            return conocidas.some(c => c !== conocidas[0]);
        });
        const emparejados = totalOficios - oficiosSinReporte.length;

        console.log('RESUMEN:');
        console.log(`  Oficios: ${totalOficios}, Planillas: ${unidades.length} (${totalReportes} páginas)`);
        console.log(`  Emparejados: ${emparejados} (por nombre truncado + cantidad: ${porTruncado.length})`);
        porTruncado.forEach(x => console.log(`    truncado: Oficio ${x.i + 1} "${nombreOficio(x.i)}" ↔ Planilla "${nombreReporte(x.m.reporte)}"`));
        oficiosSinReporte.forEach(p => console.log(`  Oficio sin planilla ${p + 1}: "${nombreOficio(p)}" (${oficioCants[p]})`));
        reportesSinOficio.forEach(p => console.log(`  Planilla sin oficio ${p + 1}: "${nombreReporte(p)}" (${unidades[p].cant})`));
        console.log('═══════════════════════════════════════════');

        // 5. Panel de resultado
        const ul = (items, fmt, max = 15) =>
            '<ul>' + items.slice(0, max).map(x => `<li>${fmt(x)}</li>`).join('') +
            (items.length > max ? `<li>... y ${items.length - max} más</li>` : '') + '</ul>';
        const esc = escapeHtml;
        const sugerido = i => {
            const js = sugerencias.get(i);
            return js ? ` — posible planilla con cantidad distinta: "${esc(nombreReporte(js[0]))}" (${unidades[js[0]].cant} tarjetas)` : '';
        };
        const motivoO = i => ex && ex.motivoOficio.get(i) ? ` — ${esc(ex.motivoOficio.get(i))}` : '';
        const motivoU = j => ex && ex.motivoUnidad.get(j) ? ` — ${esc(ex.motivoUnidad.get(j))}` : '';

        let html = '<div class="validation-box">';
        html += `<h3>📋 Resultado del análisis</h3><ul>`;
        html += excel
            ? `<li>📊 Emparejado con base en el Excel (hoja "${esc(hojaExcel)}", <strong>${excel.filas.length}</strong> empresas)</li>`
            : `<li>ℹ️ Sin Excel: emparejado solo por el texto de los PDFs. Carga el Excel para confirmarlo contra la lista de empresas.</li>`;
        html += `<li>📄 Oficios: <strong>${totalOficios}</strong> páginas</li>`;
        html += `<li>📄 Planillas: <strong>${unidades.length}</strong> (${totalReportes} páginas)</li>`;
        html += `<li>🔗 Emparejados: <strong>${emparejados}</strong></li>`;
        if (porTruncado.length > 0) {
            html += `<li>ℹ️ Emparejados por nombre truncado + misma cantidad (el CB corta el nombre; revisa que estén bien): <strong>${porTruncado.length}</strong>` +
                ul(porTruncado, x => `Oficio ${x.i + 1} "${esc(nombreOficio(x.i))}" ↔ Planilla "${esc(nombreReporte(x.m.reporte))}" (${oficioCants[x.i]} tarjetas)`) + `</li>`;
        }
        if (ex) {
            const porNit = matches.map((m, i) => ({ i, m })).filter(x => x.m.reporte >= 0 && ex.tipoUnidad[x.m.reporte] === 'nit');
            if (porNit.length > 0) {
                html += `<li>ℹ️ Planillas identificadas por NIT (el nombre difiere del Excel; revisa que estén bien): <strong>${porNit.length}</strong>` +
                    ul(porNit, x => `"${esc(excel.filas[ex.filaDeOficio[x.i]].nombre)}" ↔ Planilla "${esc(nombreReporte(x.m.reporte))}"`) + `</li>`;
            }
        }
        if (cantDistinta.length > 0) {
            html += `<li>⚠️ Emparejados pero con cantidad distinta (revísalos): <strong>${cantDistinta.length}</strong>` +
                ul(cantDistinta, x => {
                    const f = ex ? excel.filas[ex.filaDeOficio[x.i]] : null;
                    return `"${esc(nombreOficio(x.i))}": oficio ${oficioCants[x.i] ?? '?'}, planilla ${unidades[x.m.reporte].cant ?? '?'}` + (f && f.cant > 0 ? `, Excel ${f.cant}` : '');
                }) + `</li>`;
        }
        if (oficiosSinReporte.length > 0) {
            html += `<li>⚠️ Oficios sin planilla (se incluyen solos): <strong>${oficiosSinReporte.length}</strong>` +
                ul(oficiosSinReporte, p => `Oficio ${p + 1}: "${esc(nombreOficio(p))}" (${oficioCants[p] ?? '?'} tarjetas)${ex ? (motivoO(p) || ' — su empresa no tiene planilla') : sugerido(p)}`) + `</li>`;
        }
        if (reportesSinOficio.length > 0) {
            html += `<li>⚠️ Planillas sin oficio (NO se incluyen en el PDF): <strong>${reportesSinOficio.length}</strong>` +
                ul(reportesSinOficio, p => `Planilla pág. ${unidades[p].paginas[0] + 1}: "${esc(nombreReporte(p))}" (${unidades[p].cant ?? '?'} tarjetas)${motivoU(p)}`) + `</li>`;
        }
        if (ex) {
            const filasSinOficio = excel.filas.map((f, k) => k).filter(k => ex.oficioDeFila[k] < 0);
            const filasSinPlanilla = excel.filas.map((f, k) => k).filter(k => ex.unidadDeFila[k] < 0);
            if (filasSinOficio.length > 0) {
                html += `<li>⚠️ Empresas del Excel sin oficio en el PDF: <strong>${filasSinOficio.length}</strong>` +
                    ul(filasSinOficio, k => `${esc(excel.filas[k].nombre)} (${excel.filas[k].cant || '?'} tarjetas)`) + `</li>`;
            }
            if (filasSinPlanilla.length > 0) {
                html += `<li>⚠️ Empresas del Excel sin planilla en el PDF: <strong>${filasSinPlanilla.length}</strong>` +
                    ul(filasSinPlanilla, k => `${esc(excel.filas[k].nombre)} (${excel.filas[k].cant || '?'} tarjetas)`) + `</li>`;
            }
        }
        html += `</ul>`;
        if (ex) {
            const tipoTxt = { nombre: 'nombre', truncado: 'nombre truncado', nit: 'NIT' };
            const filasTabla = excel.filas.map((f, k) => {
                const i = ex.oficioDeFila[k], j = ex.unidadDeFila[k];
                const par = i >= 0 && j >= 0 && matches[i].reporte === j;
                const estado = par ? (cantDistinta.some(x => x.i === i) ? '⚠️ cantidad distinta' : '✅ ok') : (i < 0 ? '⚠️ sin oficio' : '⚠️ sin planilla');
                return `<tr><td>${k + 1}</td><td>${esc(f.nombre)}</td><td>${f.cant || ''}</td><td>${i >= 0 ? i + 1 : '—'}</td>` +
                    `<td>${j >= 0 ? unidades[j].paginas[0] + 1 : '—'}</td><td>${j >= 0 ? tipoTxt[ex.tipoUnidad[j]] : ''}</td><td>${estado}</td></tr>`;
            }).join('');
            html += `<details class="detalle"><summary>Ver el detalle por empresa (${excel.filas.length})</summary>` +
                `<div class="detalle-scroll"><table class="detalle-tabla"><thead><tr><th>#</th><th>Empresa (Excel)</th><th>Cant.</th><th>Oficio pág.</th><th>Planilla pág.</th><th>Identificada por</th><th>Estado</th></tr></thead>` +
                `<tbody>${filasTabla}</tbody></table></div></details>`;
        }
        html += `</div>`;
        reportEl.innerHTML = html;

        // 6. Confirmar si hay pendientes (nunca se fuerza un match por posición)
        if (oficiosSinReporte.length > 0 || reportesSinOficio.length > 0) {
            let detalle = '';
            if (oficiosSinReporte.length > 0) {
                detalle += `\nOficios SIN planilla (se incluyen solos) — ${oficiosSinReporte.length}:\n` +
                    oficiosSinReporte.slice(0, 10).map(p => `  • Oficio pág. ${p + 1}: "${nombreOficio(p)}" (${oficioCants[p] ?? '?'})`).join('\n');
                if (oficiosSinReporte.length > 10) detalle += `\n  ... y ${oficiosSinReporte.length - 10} más`;
            }
            if (reportesSinOficio.length > 0) {
                detalle += `\n\nPlanillas SIN oficio (NO se incluirán en el PDF) — ${reportesSinOficio.length}:\n` +
                    reportesSinOficio.slice(0, 10).map(p => `  • Planilla pág. ${unidades[p].paginas[0] + 1}: "${nombreReporte(p)}" (${unidades[p].cant ?? '?'})`).join('\n');
                if (reportesSinOficio.length > 10) detalle += `\n  ... y ${reportesSinOficio.length - 10} más`;
            }

            const proceed = confirm(
                `⚠️ ATENCIÓN:\n${detalle}\n\n` +
                `Los oficios y planillas que SÍ coinciden se combinarán normalmente. Las planillas sin oficio NO saldrán en el PDF final.\n\n` +
                `¿Deseas continuar?`
            );

            if (!proceed) {
                messageEl.textContent = '❌ Combinación cancelada. Revisa los PDFs.';
                messageEl.className = 'error';
                return;
            }
        }

        // 7. Intercalar: solo se combina lo que realmente coincide
        messageEl.textContent = '⏳ Combinando PDFs...';
        const pdfDocResult = await PDFLib.PDFDocument.create();

        for (let i = 0; i < totalOficios; i++) {
            const [oficioPage] = await pdfDocResult.copyPages(pdfDoc1, [i]);
            pdfDocResult.addPage(oficioPage);

            const j = matches[i].reporte;
            if (j >= 0) {
                const paginas = await pdfDocResult.copyPages(pdfDoc2, unidades[j].paginas);
                paginas.forEach(p => pdfDocResult.addPage(p));
            }
        }

        // Las planillas sin oficio NO se incluyen en el PDF final; solo se avisan en pantalla

        // 8. Descargar
        const resultBytes = await pdfDocResult.save();
        const blob = new Blob([resultBytes], { type: 'application/pdf' });
        downloadBlob(blob, 'PDF_Combinado.pdf');

        if (oficiosSinReporte.length === 0 && reportesSinOficio.length === 0) {
            messageEl.textContent = `✅ ${totalOficios} oficios combinados con sus planillas correctamente.`;
            messageEl.className = cantDistinta.length ? 'warning' : 'success';
            if (cantDistinta.length) messageEl.textContent += ` ⚠️ ${cantDistinta.length} con cantidad distinta (revisa el detalle arriba).`;
        } else {
            const partes = [];
            if (oficiosSinReporte.length > 0) partes.push(`${oficiosSinReporte.length} oficio(s) sin planilla`);
            if (reportesSinOficio.length > 0) partes.push(`${reportesSinOficio.length} planilla(s) sin oficio (no incluidas en el PDF)`);
            messageEl.textContent = `⚠️ PDF combinado con advertencias: ${partes.join(', ')}. Revisa el detalle arriba.`;
            messageEl.className = 'warning';
        }

    } catch (error) {
        console.error(error);
        messageEl.textContent = '❌ Ocurrió un error al procesar los PDFs. Revisa la consola (F12).';
        messageEl.className = 'error';
    }
}

// ==========================================
// LIMPIAR
// ==========================================
function clearInputs() {
    document.getElementById('pdfFile1').value = '';
    document.getElementById('pdfFile2').value = '';
    document.getElementById('excelFile').value = '';
    const msg = document.getElementById('message');
    msg.textContent = '';
    msg.className = '';
    document.getElementById('validationReport').innerHTML = '';
    resetDropZone(document.getElementById('dropZone1'), 'Arrastra el PDF de los Oficios aquí', 'o haz clic para seleccionarlo');
    resetDropZone(document.getElementById('dropZone2'), 'Arrastra el PDF de los Reportes aquí', 'o haz clic para seleccionarlo');
    resetDropZone(document.getElementById('dropZone3'), 'Arrastra el Excel aquí', 'Con él se empareja cada oficio con su planilla sin errores');
}