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

function sanitizeForPDF(str) {
    if (!str) return '';
    return String(str)
        .replace(/\uFFFD/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .replace(/\u00A0/g, ' ');
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

function reordenarNombre(nombreCompleto) {
    if (!nombreCompleto) return '';
    const palabras = String(nombreCompleto).trim().split(/\s+/).filter(Boolean);
    if (palabras.length <= 2) return palabras.join(' ');
    const apellidos = palabras.slice(-2);
    const nombres = palabras.slice(0, -2);
    return [...apellidos, ...nombres].join(' ');
}

function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = [], curr = [];
    for (let j = 0; j <= a.length; j++) prev[j] = j;
    for (let i = 1; i <= b.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) curr[j] = prev[j - 1];
            else curr[j] = Math.min(prev[j - 1] + 1, curr[j - 1] + 1, prev[j] + 1);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[a.length];
}

function similarity(a, b) {
    if (!a || !b) return 0;
    return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function findMatchingWorkers(empresaNombre, mapaTrabajadores) {
    const keys = Object.keys(mapaTrabajadores);
    if (!keys.length) return [];
    const variants = [
        normalizeKey(empresaNombre, true),
        normalizeKey(empresaNombre, false)
    ].filter((v, i, a) => v && a.indexOf(v) === i);
    for (const v of variants) if (mapaTrabajadores[v]) return mapaTrabajadores[v];
    const MIN_LEN = 10;
    for (const v of variants) {
        for (const key of keys) {
            if (key.length < MIN_LEN) continue;
            if (v.startsWith(key) || key.startsWith(v)) return mapaTrabajadores[key];
        }
    }
    let bestKey = null, bestScore = 0;
    const MIN_SCORE = 0.80;
    for (const key of keys) {
        if (key.length < MIN_LEN) continue;
        for (const v of variants) {
            const lenDiff = Math.abs(v.length - key.length) / Math.max(v.length, key.length);
            if (lenDiff > 0.35) continue;
            const score = similarity(v, key);
            if (score > bestScore) { bestScore = score; bestKey = key; }
        }
    }
    if (bestKey && bestScore >= MIN_SCORE) return mapaTrabajadores[bestKey];
    return [];
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
    dz.querySelector('.drop-subtext').textContent = "Debe contener las hojas 'Original' y 'SinDuplicados'";
}

// ==========================================
// SELECTOR DE TIPO DE DESCARGA (2 BOTONES TOGGLE)
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
    return activeBtn ? activeBtn.dataset.value : 'single';  // ← fallback 'single'
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
// DIBUJAR UNA PLANILLA EN UN PDF (Helper)
// ==========================================
function dibujarPlanilla(pdfDoc, helvetica, helveticaBold, empresaData, trabajadores, empresaIdx) {
    const { nit, nombre, cant } = empresaData;
    const W = 792, H = 612, rowH = 12, bottomReserve = 60;   // ← CARTA horizontal
    const black = PDFLib.rgb(0, 0, 0);
    const gray = PDFLib.rgb(0.5, 0.5, 0.5);

    // Columnas reajustadas para ancho Carta (792 pt)
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

    // ----- PÁGINA 1 -----
    let page = pdfDoc.addPage([W, H]);
    let currentPage = 1;
    drawSmallHeader(page, currentPage, totalPages);
    drawMainTitle(page);
    let y = drawTableHeader(page);

    page.drawText(`Total Tarjetas de la Empresa: ${cant}`, { x: 40, y, size: 9, font: helvetica, color: black });
    y -= 22;
    page.drawText('Nit:', { x: 40, y, size: 9, font: helveticaBold, color: black });
    page.drawText(nit, { x: 70, y, size: 9, font: helvetica, color: black });
    page.drawText('Empresa:', { x: 165, y, size: 9, font: helveticaBold, color: black });
    page.drawText(nombre, { x: 230, y, size: 9, font: helvetica, color: black });
    y -= 25;

    const cap1 = Math.min(firstPageCap, trabajadores.length);
    for (let i = 0; i < cap1; i++) {
        const t = trabajadores[i];
        drawCenteredInCell(page, `${i + 1}`, colNo.x, colNo.w, y, 8, helvetica, black);
        page.drawText(t.cedula, { x: colCedula.x + 3, y, size: 8, font: helvetica, color: black });
        page.drawText(t.nombre.substring(0, 45), { x: colNombre.x + 3, y, size: 8, font: helvetica, color: black });
        drawCenteredInCell(page, t.tarjeta, colNoTarjeta.x, colNoTarjeta.w, y, 8, helvetica, black);
        y -= rowH;
    }
    let workerIdx = cap1;

    // ----- PÁGINAS SIGUIENTES -----
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
            page.drawText(t.nombre.substring(0, 45), { x: colNombre.x + 3, y, size: 8, font: helvetica, color: black });
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
// GENERAR REPORTES (ZIP o PDF ÚNICO)
// ==========================================
async function generarReportesPDF() {
    const excelFile = document.getElementById('fileInputExcel').files[0];
    if (!excelFile) {
        alert("Por favor, carga el archivo Excel que contiene las hojas 'Original' y 'SinDuplicados'.");
        return;
    }

    const outputType = getSelectedOutputType();
    const isSingle = (outputType === 'single');
    const messageEl = document.getElementById('message');
    messageEl.textContent = '⏳ Procesando... Por favor espera.';
    messageEl.className = 'loading';

    try {
        const workbook = await readExcelWorkbook(excelFile);
        const sheetOriginal = workbook.Sheets['Original'];
        const sheetSinDuplicados = workbook.Sheets['SinDuplicados'];

        if (!sheetOriginal || !sheetSinDuplicados) {
            alert("El archivo Excel debe contener las hojas 'Original' y 'SinDuplicados'.");
            messageEl.textContent = '';
            messageEl.className = '';
            return;
        }

        const dataOriginal = XLSX.utils.sheet_to_json(sheetOriginal, { header: 1 });
        const dataSinDuplicados = XLSX.utils.sheet_to_json(sheetSinDuplicados, { header: 1 });
        dataOriginal.shift();
        dataSinDuplicados.shift();

        const empresasInfo = [];
        dataSinDuplicados.forEach(row => {
            if (row.length >= 4) {
                empresasInfo.push({
                    nit: sanitizeForPDF(row[1]),
                    nombre: sanitizeForPDF(row[2]),
                    cant: parseInt(row[3]) || 0
                });
            }
        });

        const trabajadoresPorEmpresa = {};
        dataOriginal.forEach(row => {
            if (row.length >= 5) {
                const rawEmpresa = sanitizeForPDF(row[4]);
                const keys = [
                    normalizeKey(rawEmpresa, true),
                    normalizeKey(rawEmpresa, false)
                ].filter((v, i, a) => v && a.indexOf(v) === i);
                keys.forEach(key => {
                    if (!trabajadoresPorEmpresa[key]) trabajadoresPorEmpresa[key] = [];
                    trabajadoresPorEmpresa[key].push({
                        cedula: sanitizeForPDF(row[1]),
                        nombre: reordenarNombre(sanitizeForPDF(row[2])),
                        tarjeta: sanitizeForPDF(row[3])
                    });
                });
            }
        });

        const totalEmpresas = empresasInfo.length;
        const empresasSinMatch = [];
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
            const { nombre, cant } = empresaData;
            const trabajadores = findMatchingWorkers(nombre, trabajadoresPorEmpresa);
            if (trabajadores.length === 0) empresasSinMatch.push({ nombre, cant });

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
            }

            consecutivoArchivo++;
        }

        // ============ DESCARGA ============
        if (isSingle) {
            messageEl.textContent = '⏳ Guardando PDF único...';
            const mergedBytes = await masterPdf.save();
            const blob = new Blob([mergedBytes], { type: 'application/pdf' });
            downloadBlob(blob, 'Reportes_Planillas_Tarjetas_Completo.pdf');
            messageEl.textContent = `✅ Se generó 1 PDF con ${totalEmpresas} planillas (${totalPaginasMaster} páginas) exitosamente.`;
        } else {
            messageEl.textContent = '⏳ Comprimiendo archivos...';
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(zipBlob, 'Reportes_Planillas_Tarjetas.zip');
            messageEl.textContent = `✅ Se generaron ${totalEmpresas} planillas (ZIP) exitosamente.`;
        }

        messageEl.className = 'success';

        console.log('═══════════════════════════════════════════');
        console.log(`✅ Empresas generadas: ${totalEmpresas}`);
        console.log(`⚠️ Empresas SIN match: ${empresasSinMatch.length}`);
        if (empresasSinMatch.length > 0) {
            empresasSinMatch.forEach(e => console.log(`  • ${e.nombre} (esperados: ${e.cant})`));
        }
        console.log('═══════════════════════════════════════════');

        let alertMsg = `¡Reportes generados! ${isSingle ? `PDF único con ${totalEmpresas} planillas` : `ZIP con ${totalEmpresas} planillas`}.`;
        if (empresasSinMatch.length > 0) {
            alertMsg += `\n\n⚠️ ${empresasSinMatch.length} empresa(s) sin trabajadores encontrados (revisa la consola F12):\n` +
                        empresasSinMatch.slice(0, 5).map(e => `• ${e.nombre}`).join('\n') +
                        (empresasSinMatch.length > 5 ? `\n... y ${empresasSinMatch.length - 5} más` : '');
        }
        alert(alertMsg);

    } catch (error) {
        console.error(error);
        messageEl.textContent = '❌ Ocurrió un error al generar los reportes. Revisa la consola (F12) para más detalles.';
        messageEl.className = 'error';
        alert("Ocurrió un error al generar los reportes. Revisa la consola para más detalles.");
    }
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
        reader.onerror = (e) => reject(e);
        reader.readAsArrayBuffer(file);
    });
}