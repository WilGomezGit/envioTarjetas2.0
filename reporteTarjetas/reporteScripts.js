// ==========================================
// HELPERS
// ==========================================
function normalizeKey(str, fillReplacement) {
    if (!str) return '';
    let s = String(str);
    if (fillReplacement) {
        s = s.replace(/\uFFFD/g, 'N');
    } else {
        s = s.replace(/\uFFFD/g, '');
    }
    return s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

// Mapa de bytes Windows-1252 (0x80-0x9F) mal decodificados como puntos de c\u00F3digo
// Unicode crudos (t\u00EDpico de comillas/guiones "inteligentes" de Excel/Word mal le\u00EDdos).
// Se traducen a su car\u00E1cter real, que s\u00ED es codificable en WinAnsi (pdf-lib).
const CP1252_MOJIBAKE_MAP = {
    0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E',
    0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6',
    0x89: '\u2030', 0x8A: '\u0160', 0x8B: '\u2039', 0x8C: '\u0152',
    0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C',
    0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
    0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A',
    0x9C: '\u0153', 0x9E: '\u017E', 0x9F: '\u0178'
};
// Caracteres WinAnsi codificables fuera de ASCII/Latin-1, tras el mapeo anterior.
const WINANSI_EXTRA_SAFE = new Set(Object.values(CP1252_MOJIBAKE_MAP));

function sanitizeForPDF(str) {
    if (!str) return '';
    return String(str)
        .replace(/\uFFFD/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .replace(/[\u0080-\u009F]/g, ch => CP1252_MOJIBAKE_MAP[ch.charCodeAt(0)] || '')
        .replace(/\u00A0/g, ' ')
        // \u00DAltimo filtro de seguridad: elimina cualquier car\u00E1cter que WinAnsi no pueda
        // codificar (fuera de ASCII imprimible, Latin-1 y los s\u00EDmbolos ya traducidos).
        .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, ch => WINANSI_EXTRA_SAFE.has(ch) ? ch : '');
}

function sanitizeForFilename(str) {
    if (!str) return 'EMPRESA';
    return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 80);
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

function getFechaEspanol() {
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const d = new Date();
    return `Elaborado el ${d.getDate()} de ${meses[d.getMonth()]} del ${d.getFullYear()}`;
}

function drawCenteredText(page, text, y, size, font, color, pageWidth) {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (pageWidth - w) / 2, y, size, font, color });
}

function drawCenteredInCell(page, text, cellX, cellW, y, size, font, color) {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: cellX + (cellW - w) / 2, y, size, font, color });
}

// ==========================================
// DRAG & DROP
// ==========================================
function setupDropZone() {
    const dropZone = document.getElementById('dropZoneExcel');
    const fileInput = document.getElementById('fileInputExcel');
    if (!dropZone || !fileInput) return;
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            updateDropZoneUI(e.dataTransfer.files[0].name);
        }
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) updateDropZoneUI(fileInput.files[0].name);
    });
}

function updateDropZoneUI(fileName) {
    const dz = document.getElementById('dropZoneExcel');
    dz.querySelector('.drop-text').textContent = '✅ Archivo cargado';
    dz.querySelector('.drop-subtext').textContent = fileName;
}

function resetDropZoneUI() {
    const dz = document.getElementById('dropZoneExcel');
    dz.querySelector('.drop-text').textContent = 'Arrastra el Excel aquí';
    dz.querySelector('.drop-subtext').textContent = "El Excel exportado por Separar Archivos (hoja 'Original')";
}

// ==========================================
// SELECTOR DE TIPO DE DESCARGA
// ==========================================
function setupOutputSelector() {
    const btns = document.querySelectorAll('.selector-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

function getSelectedOutputType() {
    const activeBtn = document.querySelector('.selector-btn.active');
    return activeBtn ? activeBtn.dataset.value : 'single';
}

document.addEventListener('DOMContentLoaded', () => {
    setupDropZone();
    setupOutputSelector();
});

// ==========================================
// LIMPIAR
// ==========================================
function limpiarReporte() {
    document.getElementById('fileInputExcel').value = '';
    resetDropZoneUI();
    const msg = document.getElementById('message');
    msg.textContent = '';
    msg.className = '';
}

// ==========================================
// DETECTAR COLUMNAS DINÁMICAMENTE
// ==========================================
function detectarColumnas(headersRow, mapaBuscado) {
    const indices = {};
    headersRow.forEach((h, i) => {
        const key = normalizeKey(h, true);
        for (const [campo, alias] of Object.entries(mapaBuscado)) {
            if (indices[campo] !== undefined) continue;
            for (const a of alias) {
                const aliasNorm = normalizeKey(a, true);
                if (key === aliasNorm || (aliasNorm.length > 2 && key.includes(aliasNorm))) {
                    indices[campo] = i;
                    break;
                }
            }
        }
    });
    return indices;
}

// ==========================================
// DIBUJAR UNA PLANILLA EN UN PDF
// ==========================================
function dibujarPlanilla(pdfDoc, helvetica, helveticaBold, empresaData, trabajadores, empresaIdx) {
    const { nit, nombre, cant, persona } = empresaData;
    const W = 792, H = 612, rowH = 12, bottomReserve = 60;
    const black = PDFLib.rgb(0, 0, 0);
    const gray = PDFLib.rgb(0.5, 0.5, 0.5);

    const cols = [
        { x: 30,  w: 25,  label: 'No.' },
        { x: 55,  w: 110, label: 'CEDULA TRABAJADOR' },
        { x: 165, w: 230, label: 'NOMBRE TRABAJADOR' },
        { x: 395, w: 110, label: 'CEDULA CONYUGUE' },
        { x: 505, w: 115, label: 'NOMBRE CONYUGUE' },
        { x: 620, w: 140, label: 'No TARJETA' }
    ];
    const colNoTarjeta = cols[5], colNo = cols[0], colCedula = cols[1], colNombre = cols[2];

    const startY1 = H - 187, startYOther = H - 140;
    const firstPageCap = Math.floor((startY1 - bottomReserve) / rowH);
    const otherPageCap = Math.floor((startYOther - bottomReserve) / rowH);

    let totalPages;
    if (trabajadores.length <= firstPageCap) totalPages = 1;
    else totalPages = 1 + Math.ceil((trabajadores.length - firstPageCap) / otherPageCap);

    const drawSmallHeader = (p, pNum, pTotal) => {
        p.drawLine({ start: { x: 30, y: H - 12 }, end: { x: W - 30, y: H - 12 }, thickness: 0.5, color: gray });
        p.drawText(getFechaEspanol(), { x: 30, y: H - 22, size: 7, font: helvetica, color: gray });
        const pageStr = `${pNum}/${pTotal}`;
        const pw = helvetica.widthOfTextAtSize(pageStr, 7);
        p.drawText(pageStr, { x: W - 30 - pw, y: H - 22, size: 7, font: helvetica, color: gray });
    };

    const drawMainTitle = (p) => {
        drawCenteredText(p, 'CAJA DE COMPENSACION FAMILIAR DEL CAUCA 891500182', H - 55, 10, helveticaBold, black, W);
        drawCenteredText(p, 'CONTROL DE TARJETAS EN EL ESTADO V', H - 70, 10, helveticaBold, black, W);
    };

    const drawTableHeader = (p) => {
        const headerH = 15, topY = H - 100;
        cols.forEach(col => {
            p.drawRectangle({
                x: col.x, y: topY - headerH, width: col.w, height: headerH,
                borderColor: black, borderWidth: 0.5
            });
            const tw = helveticaBold.widthOfTextAtSize(col.label, 7);
            p.drawText(col.label, {
                x: col.x + (col.w - tw) / 2, y: topY - headerH + 4,
                size: 7, font: helveticaBold, color: black
            });
        });
        return topY - headerH - 25;
    };

    let page = pdfDoc.addPage([W, H]);
    let currentPage = 1;
    drawSmallHeader(page, currentPage, totalPages);
    drawMainTitle(page);
    let y = drawTableHeader(page);

    page.drawText(`Total Tarjetas de la Empresa: ${cant}`, { x: 40, y, size: 9, font: helvetica, color: black });
    y -= 22;
    if (nit) {
        page.drawText(persona ? 'C.C:' : 'Nit:', { x: 40, y, size: 9, font: helveticaBold, color: black });
        page.drawText(nit, { x: 70, y, size: 9, font: helvetica, color: black });
    }
    const empresaX = nit ? 165 : 40;
    page.drawText(persona ? 'Nombre:' : 'Empresa:', { x: empresaX, y, size: 9, font: helveticaBold, color: black });
    page.drawText(nombre, { x: empresaX + 65, y, size: 9, font: helvetica, color: black });
    y -= 25;

    const cap1 = Math.min(firstPageCap, trabajadores.length);
    for (let i = 0; i < cap1; i++) {
        const t = trabajadores[i];
        drawCenteredInCell(page, `${i + 1}`, colNo.x, colNo.w, y, 8, helvetica, black);
        page.drawText(t.cedula, { x: colCedula.x + 3, y, size: 8, font: helvetica, color: black });
        page.drawText((t.nombre || '').substring(0, 45), { x: colNombre.x + 3, y, size: 8, font: helvetica, color: black });
        drawCenteredInCell(page, t.tarjeta, colNoTarjeta.x, colNoTarjeta.w, y, 8, helvetica, black);
        y -= rowH;
    }
    let workerIdx = cap1;

    while (workerIdx < trabajadores.length) {
        currentPage++;
        page = pdfDoc.addPage([W, H]);
        drawSmallHeader(page, currentPage, totalPages);
        y = drawTableHeader(page);
        const cap = Math.min(otherPageCap, trabajadores.length - workerIdx);
        for (let i = 0; i < cap; i++) {
            const t = trabajadores[workerIdx];
            drawCenteredInCell(page, `${workerIdx + 1}`, colNo.x, colNo.w, y, 8, helvetica, black);
            page.drawText(t.cedula, { x: colCedula.x + 3, y, size: 8, font: helvetica, color: black });
            page.drawText((t.nombre || '').substring(0, 45), { x: colNombre.x + 3, y, size: 8, font: helvetica, color: black });
            drawCenteredInCell(page, t.tarjeta, colNoTarjeta.x, colNoTarjeta.w, y, 8, helvetica, black);
            y -= rowH;
            workerIdx++;
        }
    }

    y -= 15;
    page.drawText(`Total Tarjetas de la Empresa: ${cant}`, { x: 40, y, size: 9, font: helvetica, color: black });

    return totalPages;
}

// ==========================================
// LEER EXCEL
// ==========================================
function readExcelWorkbook(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                resolve(workbook);
            } catch (error) { reject(error); }
        };
        reader.onerror = () => reject(Object.assign(new Error('No se pudo leer el archivo. Cierra el Excel si lo tienes abierto, quita el archivo y vuelve a cargarlo (o cópialo a una carpeta de tu equipo, fuera de OneDrive o de una carpeta de red) y reintenta.'), { noLegible: true }));
        reader.readAsArrayBuffer(file);
    });
}

// ==========================================
// VINCULAR EMPRESAS DE "ORIGINAL" CON LA HOJA DE EMPRESAS
// ==========================================
// El CB corta el nombre de la empresa a 40 caracteres, así que en "Original" puede venir
// truncado ("ASOCIACION DE AUTORIDADES ANCESTRALES TE") y en la hoja de empresas completo
// ("... TERRITORIALES NASA CXHACXHA"). Nunca se adivina por posición:
//   1) nombre idéntico (sin importar tildes/mayúsculas/signos), o
//   2) el nombre truncado es el comienzo del completo, y la CANT de la hoja (si la trae)
//      coincide con los trabajadores; solo se acepta si la pareja es única en ambos lados.
// Lo que no se pueda vincular con certeza queda sin vincular para que se revise.
function vincularEmpresas(grupos, filas) {
    const norm = s => normalizeKey(s, true);
    const gk = grupos.map(g => norm(g.nombre));
    const fk = filas.map(f => norm(f.nombre));
    const vinculo = new Array(grupos.length).fill(-1);
    const filaUsada = new Array(filas.length).fill(false);
    const porPrefijo = new Set();
    const cantOk = (g, f) => !(f.cant > 0) || f.cant === g.cant;

    // 1) Nombre idéntico
    grupos.forEach((g, i) => {
        const cands = filas.map((f, j) => j).filter(j => !filaUsada[j] && fk[j] === gk[i]);
        const j = cands.find(j => cantOk(g, filas[j])) ?? cands[0];
        if (j !== undefined) { vinculo[i] = j; filaUsada[j] = true; }
    });

    // 2) Nombre truncado (prefijo) + cantidad, solo si la pareja es única
    const MIN_PREFIJO = 12;
    const pares = [];
    grupos.forEach((g, i) => {
        if (vinculo[i] >= 0) return;
        filas.forEach((f, j) => {
            if (filaUsada[j] || !cantOk(g, f)) return;
            const corto = gk[i].length < fk[j].length ? gk[i] : fk[j];
            const largo = gk[i].length < fk[j].length ? fk[j] : gk[i];
            if (corto.length >= MIN_PREFIJO && largo.startsWith(corto)) pares.push([i, j]);
        });
    });
    pares.forEach(([i, j]) => {
        const grado = pares.filter(([a, b]) => a === i || b === j).length;
        if (grado === 1) { vinculo[i] = j; filaUsada[j] = true; porPrefijo.add(i); }
    });

    return { vinculo, filaUsada, porPrefijo };
}

// ==========================================
// GENERAR REPORTES (ZIP o PDF ÚNICO)
// ==========================================
async function generarReportesPDF() {
    const excelFile = document.getElementById('fileInputExcel').files[0];
    if (!excelFile) {
        alert("Por favor, carga el archivo Excel.");
        return;
    }

    const isSingle = (getSelectedOutputType() === 'single');
    const messageEl = document.getElementById('message');
    messageEl.textContent = '⏳ Procesando... Por favor espera.';
    messageEl.className = 'loading';

    try {
        const workbook = await readExcelWorkbook(excelFile);
        const nombresHojas = workbook.SheetNames;
        console.log('📚 Hojas encontradas en el Excel:', nombresHojas);

        // ============ HOJA ORIGINAL (TRABAJADORES) ============
        // La que exporta "Separar Archivos": No | DOCUMENTO | TARJETA | APELLIDOS Y NOMBRES | EMPRESA | CANT
        const nombreHojaOriginal = nombresHojas.includes('Original') ? 'Original' : nombresHojas[0];
        console.log(`📋 Hoja de trabajadores: ${nombreHojaOriginal}`);
        const dataOriginal = XLSX.utils.sheet_to_json(workbook.Sheets[nombreHojaOriginal], { header: 1 });

        const colsOriginal = detectarColumnas(dataOriginal[0] || [], {
            cedula:  ['DOCUMENTO', 'CEDULA', 'CEDULA TRABAJADOR'],
            nombre:  ['APELLIDOS Y NOMBRES', 'NOMBRE TRABAJADOR', 'NOMBRE', 'APELLIDOS'],
            tarjeta: ['TARJETA', 'NO TARJETA', 'NUMERO TARJETA'],
            empresa: ['EMPRESA', 'RAZON SOCIAL', 'RAZÓN SOCIAL']
        });
        console.log('📋 Columnas detectadas:', colsOriginal);

        const erroresColumnas = [];
        if (colsOriginal.cedula === undefined)  erroresColumnas.push("• Falta la columna <b>DOCUMENTO</b>");
        if (colsOriginal.tarjeta === undefined) erroresColumnas.push("• Falta la columna <b>TARJETA</b>");
        if (colsOriginal.nombre === undefined)  erroresColumnas.push("• Falta la columna <b>APELLIDOS Y NOMBRES</b>");
        if (colsOriginal.empresa === undefined) erroresColumnas.push("• Falta la columna <b>EMPRESA</b>");

        if (erroresColumnas.length > 0) {
            messageEl.innerHTML = `❌ El archivo Excel no tiene el formato correcto.<br><br>` +
                `<strong>Columnas faltantes en la hoja "${nombreHojaOriginal}":</strong><br>` +
                erroresColumnas.join('<br>') +
                `<br><br><em>Usa el Excel que exporta <b>Separar Archivos</b>.</em>`;
            messageEl.className = 'error';
            alert('❌ El archivo Excel no tiene el formato correcto. Revisa el mensaje en pantalla.');
            return;
        }

        // ============ TRABAJADORES AGRUPADOS POR EMPRESA ============
        // Cada empresa es una planilla; el total de tarjetas es la cantidad de trabajadores agrupados.
        const trabajadoresPorEmpresa = new Map();
        let filasSinEmpresa = 0;
        dataOriginal.slice(1).forEach(row => {
            if (!row || row.length < 3) return;
            const empresa = sanitizeForPDF(row[colsOriginal.empresa]).trim();
            if (!empresa) { filasSinEmpresa++; return; }
            if (!trabajadoresPorEmpresa.has(empresa)) trabajadoresPorEmpresa.set(empresa, []);
            trabajadoresPorEmpresa.get(empresa).push({
                cedula: sanitizeForPDF(row[colsOriginal.cedula]),
                nombre: sanitizeForPDF(row[colsOriginal.nombre]),
                tarjeta: sanitizeForPDF(row[colsOriginal.tarjeta])
            });
        });

        // ============ HOJA DE EMPRESAS (NIT y nombre completo) ============
        // Opcional. Aporta el NIT y el nombre completo de la empresa (el mismo que usan los oficios).
        const nombreHojaEmpresas = (document.getElementById('sheetEmpresas').value || '').trim() || 'SinDuplicados';
        const filasEmpresas = [];
        let hayColumnaNit = false;
        let hojaEmpresasNoExiste = false;
        const sheetEmpresas = nombreHojaEmpresas !== nombreHojaOriginal ? workbook.Sheets[nombreHojaEmpresas] : null;
        if (!sheetEmpresas) {
            hojaEmpresasNoExiste = true;
        } else {
            const dataEmp = XLSX.utils.sheet_to_json(sheetEmpresas, { header: 1 });
            const colsEmp = detectarColumnas(dataEmp[0] || [], {
                nit:     ['NIT'],
                cedula:  ['CEDULA', 'CÉDULA', 'CC', 'C.C', 'C.C.'],
                empresa: ['EMPRESA', 'RAZON SOCIAL', 'RAZÓN SOCIAL'],
                nombre:  ['NOMBRE', 'NOMBRES', 'NOMBRE COMPLETO'],
                cant:    ['CANT', 'CANTIDAD']
            });
            if (colsEmp.empresa === undefined && colsEmp.nombre === undefined) {
                hojaEmpresasNoExiste = true;
            } else {
                hayColumnaNit = colsEmp.nit !== undefined || colsEmp.cedula !== undefined;
                dataEmp.slice(1).forEach(row => {
                    if (!row) return;
                    const cel = (c) => (c !== undefined ? sanitizeForPDF(row[c]).trim() : '');
                    const persona = !cel(colsEmp.nit) && Boolean(cel(colsEmp.cedula));   // CEDULA sin NIT: persona
                    const nombre = persona ? (cel(colsEmp.nombre) || cel(colsEmp.empresa)) : (cel(colsEmp.empresa) || cel(colsEmp.nombre));
                    if (!nombre) return;
                    filasEmpresas.push({
                        nombre,
                        persona,
                        nit: cel(colsEmp.nit) || cel(colsEmp.cedula),
                        cant: colsEmp.cant !== undefined ? (parseInt(row[colsEmp.cant]) || 0) : 0
                    });
                });
            }
        }
        console.log(hojaEmpresasNoExiste
            ? `📋 Sin hoja de empresas ("${nombreHojaEmpresas}"): las planillas salen con el nombre de "Original" y sin NIT`
            : `📋 Empresas (NIT y nombre completo) tomadas de la hoja "${nombreHojaEmpresas}": ${filasEmpresas.length}`);

        // Vincula cada empresa de "Original" (nombre posiblemente truncado por el CB) con su fila
        const grupos = Array.from(trabajadoresPorEmpresa, ([nombre, t]) => ({ nombre, cant: t.length }));
        const { vinculo, filaUsada, porPrefijo } = vincularEmpresas(grupos, filasEmpresas);
        const empresasInfo = grupos.map((g, i) => {
            const f = vinculo[i] >= 0 ? filasEmpresas[vinculo[i]] : null;
            return {
                nit: f ? f.nit : '',
                persona: f ? Boolean(f.persona) : false,
                nombre: f ? f.nombre : g.nombre,
                nombreOriginal: g.nombre,
                cant: g.cant,
                cantHoja: f ? f.cant : 0,
                vinculada: Boolean(f)
            };
        });
        if (porPrefijo.size) {
            console.log(`🔗 ${porPrefijo.size} empresa(s) vinculadas por nombre truncado + cantidad:`);
            porPrefijo.forEach(i => console.log(`   "${grupos[i].nombre}" → "${empresasInfo[i].nombre}"`));
        }

        // ============ GENERACIÓN DE PDFs ============
        const totalEmpresas = empresasInfo.length;
        if (totalEmpresas === 0) {
            messageEl.textContent = '❌ No se encontraron trabajadores con empresa en la hoja "' + nombreHojaOriginal + '".';
            messageEl.className = 'error';
            return;
        }

        const empresasSinNit = empresasInfo.filter(e => !e.nit).map(e => e.nombre);
        const hayHojaEmpresas = !hojaEmpresasNoExiste;
        const sinVincular = hayHojaEmpresas ? empresasInfo.filter(e => !e.vinculada) : [];
        const cantDistinta = empresasInfo.filter(e => e.vinculada && e.cantHoja > 0 && e.cantHoja !== e.cant);
        const filasSinTrabajadores = hayHojaEmpresas ? filasEmpresas.filter((f, j) => !filaUsada[j]) : [];
        const empresasFallidas = [];
        const zip = new JSZip();

        let masterPdf = null;
        let masterHelvetica = null;
        let masterHelveticaBold = null;
        let totalPaginasMaster = 0;

        if (isSingle) {
            masterPdf = await PDFLib.PDFDocument.create();
            masterHelvetica = await masterPdf.embedFont(PDFLib.StandardFonts.Helvetica);
            masterHelveticaBold = await masterPdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
        }

        let consecutivoArchivo = 1;

        for (const empresaData of empresasInfo) {
            const { nombre } = empresaData;
            const trabajadores = trabajadoresPorEmpresa.get(empresaData.nombreOriginal);

            messageEl.textContent = `⏳ Generando planilla ${consecutivoArchivo} de ${totalEmpresas}: ${nombre.substring(0, 40)}`;

            try {
                if (isSingle) {
                    const pages = dibujarPlanilla(masterPdf, masterHelvetica, masterHelveticaBold, empresaData, trabajadores, consecutivoArchivo);
                    totalPaginasMaster += pages;
                } else {
                    const pdfDoc = await PDFLib.PDFDocument.create();
                    const helvetica = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
                    const helveticaBold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
                    dibujarPlanilla(pdfDoc, helvetica, helveticaBold, empresaData, trabajadores, consecutivoArchivo);

                    const pdfBytes = await pdfDoc.save();
                    const nombreLimpio = sanitizeForFilename(nombre);
                    zip.file(`${consecutivoArchivo}. ${nombreLimpio}.pdf`, pdfBytes);
                }
            } catch (errEmpresa) {
                console.error(`❌ Error procesando empresa "${nombre}":`, errEmpresa);
                empresasFallidas.push(nombre);
            }

            consecutivoArchivo++;
        }

        // ============ DESCARGA ============
        const generadas = totalEmpresas - empresasFallidas.length;
        if (isSingle) {
            messageEl.textContent = '⏳ Guardando PDF único...';
            const mergedBytes = await masterPdf.save();
            const blob = new Blob([mergedBytes], { type: 'application/pdf' });
            downloadBlob(blob, 'Reportes_Planillas_Tarjetas_Completo.pdf');
            messageEl.textContent = `✅ Se generó 1 PDF con ${generadas} planillas (${totalPaginasMaster} páginas) exitosamente.`;
        } else {
            messageEl.textContent = '⏳ Comprimiendo archivos...';
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(zipBlob, 'Reportes_Planillas_Tarjetas.zip');
            messageEl.textContent = `✅ Se generaron ${generadas} planillas (ZIP) exitosamente.`;
        }
        messageEl.className = 'success';

        console.log('═══════════════════════════════════════════');
        console.log(`✅ Planillas generadas: ${generadas} de ${totalEmpresas}`);
        if (empresasFallidas.length) console.log('❌ Fallidas:', empresasFallidas);
        if (empresasSinNit.length) console.log(`⚠️ Empresas sin NIT: ${empresasSinNit.length}`);
        if (sinVincular.length) console.log(`⚠️ Empresas sin vincular: ${sinVincular.length}`);
        if (filasSinEmpresa) console.log(`⚠️ Filas sin empresa (omitidas): ${filasSinEmpresa}`);
        console.log('═══════════════════════════════════════════');

        // ============ AVISOS ============
        const avisos = [];
        if (empresasFallidas.length) {
            messageEl.className = 'error';
            messageEl.textContent += ` ❌ ${empresasFallidas.length} planilla(s) fallaron (ver consola F12).`;
            avisos.push(`❌ ${empresasFallidas.length} planilla(s) NO se pudieron generar:\n` +
                empresasFallidas.slice(0, 5).map(n => `• ${n}`).join('\n') +
                (empresasFallidas.length > 5 ? `\n... y ${empresasFallidas.length - 5} más` : ''));
        }
        const lista = (items, fmt) =>
            items.slice(0, 5).map(i => `• ${fmt(i)}`).join('\n') +
            (items.length > 5 ? `\n... y ${items.length - 5} más (ver consola F12)` : '');
        if (hojaEmpresasNoExiste) {
            avisos.push(`⚠️ No encontré la hoja de empresas "${nombreHojaEmpresas}" con columna EMPRESA ` +
                `(hojas del Excel: ${nombresHojas.join(', ')}). Las planillas se generaron con el nombre de "Original" y sin NIT.`);
        } else {
            if (sinVincular.length) {
                console.warn('Empresas de Original sin vincular con la hoja de empresas:', sinVincular);
                avisos.push(`⚠️ ${sinVincular.length} empresa(s) de "Original" NO se pudieron vincular con la hoja "${nombreHojaEmpresas}" ` +
                    `(salen con el nombre del CB y sin NIT; revisa que el nombre empiece igual y la CANT coincida):\n` +
                    lista(sinVincular, e => `${e.nombre} (${e.cant} tarjeta/s)`));
            }
            if (filasSinTrabajadores.length) {
                console.warn('Filas de la hoja de empresas sin trabajadores en Original:', filasSinTrabajadores);
                avisos.push(`⚠️ ${filasSinTrabajadores.length} fila(s) de "${nombreHojaEmpresas}" no tienen trabajadores en "Original" (no generan planilla):\n` +
                    lista(filasSinTrabajadores, f => f.nombre));
            }
            if (cantDistinta.length) {
                avisos.push(`⚠️ ${cantDistinta.length} empresa(s) con CANT distinta entre la hoja "${nombreHojaEmpresas}" y "Original" (la planilla usa los trabajadores de Original):\n` +
                    lista(cantDistinta, e => `${e.nombre}: hoja ${e.cantHoja} vs Original ${e.cant}`));
            }
            if (!hayColumnaNit) {
                avisos.push(`⚠️ La hoja "${nombreHojaEmpresas}" no tiene columna NIT: las planillas se generaron sin NIT.`);
            } else {
                const sinNitVinculadas = empresasInfo.filter(e => e.vinculada && !e.nit);
                if (sinNitVinculadas.length) {
                    avisos.push(`⚠️ ${sinNitVinculadas.length} empresa(s) sin NIT en la hoja:\n` + lista(sinNitVinculadas, e => e.nombre));
                }
            }
        }
        if (filasSinEmpresa) {
            avisos.push(`⚠️ ${filasSinEmpresa} fila(s) sin empresa fueron omitidas.`);
        }

        alert(`¡Reportes generados! ${isSingle ? `PDF único con ${generadas} planillas` : `ZIP con ${generadas} planillas`}.` +
              (avisos.length ? '\n\n' + avisos.join('\n\n') : ''));

    } catch (error) {
        console.error(error);
        const legible = error && error.noLegible;
        messageEl.textContent = legible ? '❌ ' + error.message : '❌ Ocurrió un error al generar los reportes. Revisa la consola (F12) para más detalles.';
        messageEl.className = 'error';
        alert(legible ? error.message : "Ocurrió un error al generar los reportes. Revisa la consola para más detalles.");
    }
}
