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
function setupDropZone(dropZoneId, inputId) {
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
            if (e.dataTransfer.files[0].type !== 'application/pdf') {
                alert('Por favor, asegúrate de que el archivo sea un PDF.');
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
    const idx = text.search(/Se[ñn]ores\s+/i);
    if (idx < 0) return null;
    let after = text.substring(idx).replace(/^Se[ñn]ores\s*/i, '').trim();

    let cutIdx = after.length;

    // 1) Cortar en salto de línea
    const nlIdx = after.search(/[\r\n]/);
    if (nlIdx > 0 && nlIdx < cutIdx) cutIdx = nlIdx;

    // 2) Cortar en marcadores de dirección, ciudad, teléfono, etc.
    const cutPatterns = [
        /\s+C[LR][A-Z]{0,3}\s*\d/i,       // CR 8, CL15, CRA 11, CLL 5
        /\s+AV[A-Z]*\s*\d/i,               // AV 6N, AVENIDA 3
        /\s+TV\s*\d/i,                     // TV 9
        /\s+KM\s*\d/i,                     // KM 1
        /\s+CONJ\b/i,
        /\s+SIN\s+DIREC/i,
        /\s+Tel[eé]fono/i,
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
// EXTRAER NOMBRE DE EMPRESA DEL REPORTE
// El formato es: "Nit: XXX Empresa: NOMBRE_EMPRESA CEDULA_TRABAJADOR NOMBRE_TRABAJADOR..."
// (todo junto, sin saltos de línea)
// ==========================================
function extractReportCompany(text) {
    if (!text) return null;
    const idx = text.search(/Empresa\s*:/i);
    if (idx < 0) return null;
    let after = text.substring(idx).replace(/^Empresa\s*:\s*/i, '').trim();

    let cutIdx = after.length;

    // 1) Cortar en salto de línea (por si existe)
    const nlIdx = after.search(/[\r\n]/);
    if (nlIdx > 0 && nlIdx < cutIdx) cutIdx = nlIdx;

    // 2) Cortar en marcadores clave
    const cutPatterns = [
        /\s+\d{6,}/,                        // ← CLAVE: cédula del primer trabajador (6+ dígitos)
        /\s+No\./i,
        /\s+CEDULA\b/i,
        /\s+NOMBRE\s+TRABAJADOR/i,
        /\s+No\s+TARJETA/i,
        /\s+Nit\s*:/i,
        /\s+Total\s+Tarjetas/i
    ];

    for (const p of cutPatterns) {
        const m = after.match(p);
        if (m && m.index > 3 && m.index < cutIdx) {
            cutIdx = m.index;
        }
    }

    let name = after.substring(0, cutIdx).trim();
    name = name.replace(/[\s.,;:\-]+$/, '').trim();
    if (name.length > 100) name = name.substring(0, 100).trim();
    return name || null;
}

// ==========================================
// COMBINAR PDFs
// ==========================================
async function combinarPDFs() {
    const pdfFile1 = document.getElementById('pdfFile1').files[0];
    const pdfFile2 = document.getElementById('pdfFile2').files[0];

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

        // 3. Extraer nombres de empresa
        const oficioCompanies = oficiosTexts.map(t => extractOficioCompany(t));
        const reportCompanies = reportesTexts.map(t => extractReportCompany(t));
        const normOficioCompanies = oficioCompanies.map(c => normalizeText(c));
        const normReportCompanies = reportCompanies.map(c => normalizeText(c));

        // ============= DIAGNÓSTICO =============
        console.log('═══════════════════════════════════════════');
        console.log('EMPRESAS EN OFICIOS (primeras 15):');
        oficioCompanies.forEach((c, i) => { if (i < 15) console.log(`  Oficio ${i+1}: "${c}"`); });
        console.log('EMPRESAS EN REPORTES (primeras 15):');
        reportCompanies.forEach((c, i) => { if (i < 15) console.log(`  Reporte ${i+1}: "${c}"`); });
        console.log('═══════════════════════════════════════════');

        // 4. Emparejamiento con doble estrategia
        const matches = [];
        const usedReporte = new Set();

        for (let i = 0; i < oficiosTexts.length; i++) {
            let found = -1;
            let strategy = '';

            // Estrategia A: buscar el nombre del OFICIO en cada REPORTE
            if (normOficioCompanies[i] && normOficioCompanies[i].length >= 5) {
                let bestLen = 0, bestIdx = -1;
                for (let j = 0; j < reportesTexts.length; j++) {
                    if (usedReporte.has(j)) continue;
                    const normRep = normalizeText(reportesTexts[j]);
                    if (normRep.includes(normOficioCompanies[i]) && normOficioCompanies[i].length > bestLen) {
                        bestLen = normOficioCompanies[i].length;
                        bestIdx = j;
                    }
                }
                if (bestIdx >= 0) { found = bestIdx; strategy = 'A'; }
            }

            // Estrategia B: buscar el nombre del REPORTE en el OFICIO
            if (found < 0) {
                const normOficio = normalizeText(oficiosTexts[i]);
                let bestLen = 0, bestIdx = -1;
                for (let j = 0; j < reportesTexts.length; j++) {
                    if (usedReporte.has(j)) continue;
                    const normR = normReportCompanies[j];
                    if (!normR || normR.length < 5) continue;
                    if (normOficio.includes(normR) && normR.length > bestLen) {
                        bestLen = normR.length;
                        bestIdx = j;
                    }
                }
                if (bestIdx >= 0) { found = bestIdx; strategy = 'B'; }
            }

            matches.push({ oficio: i, reporte: found });
            if (found >= 0) usedReporte.add(found);
        }

        // 5. Diagnóstico de matches
        console.log('MATCHES (primeros 20):');
        matches.slice(0, 20).forEach(m => {
            const o = oficioCompanies[m.oficio] || '?';
            const r = m.reporte >= 0 ? reportCompanies[m.reporte] : 'NO MATCH';
            console.log(`  Oficio ${m.oficio+1} "${o}" → Reporte ${m.reporte+1} "${r}"`);
        });

        const unmatched = matches.filter(m => m.reporte < 0).map(m => m.oficio + 1);
        const allMatched = unmatched.length === 0;
        const pagesEqual = totalOficios === totalReportes;

        console.log('RESUMEN:');
        console.log(`  Oficios: ${totalOficios}, Reportes: ${totalReportes}`);
        console.log(`  Emparejados: ${totalOficios - unmatched.length}/${totalOficios}`);
        if (unmatched.length > 0) {
            console.log('  Sin emparejar:');
            unmatched.slice(0, 10).forEach(p => {
                console.log(`    Oficio ${p}: "${oficioCompanies[p-1]}"`);
            });
        }
        console.log('═══════════════════════════════════════════');

        // 6. Panel de resultado
        let html = '<div class="validation-box">';
        html += `<h3>📋 Resultado del análisis</h3>`;
        html += `<ul>`;
        html += `<li>📄 Oficios: <strong>${totalOficios}</strong> páginas</li>`;
        html += `<li>📄 Reportes: <strong>${totalReportes}</strong> páginas</li>`;
        html += `<li>🔗 Emparejados: <strong>${totalOficios - unmatched.length}</strong>/${totalOficios}</li>`;
        if (unmatched.length > 0) {
            html += `<li>⚠️ Sin emparejar: <strong>${unmatched.length}</strong> (páginas: ${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? '...' : ''})</li>`;
        }
        if (!pagesEqual) {
            html += `<li>❗ El número de páginas no coincide.</li>`;
        }
        html += `</ul>`;
        html += '</div>';
        reportEl.innerHTML = html;

        // 7. Confirmar si hay sin emparejar
        if (!allMatched && unmatched.length > 0) {
            const detalle = matches
                .filter(m => m.reporte < 0)
                .slice(0, 10)
                .map(m => `  • Oficio pág. ${m.oficio + 1}: "${oficioCompanies[m.oficio] || '(sin nombre)'}"`)
                .join('\n');

            const proceed = confirm(
                `⚠️ ATENCIÓN:\n\n` +
                `No se pudieron emparejar automáticamente ${unmatched.length} oficio(s):\n` +
                `${detalle}\n\n` +
                `Si continúas, esos oficios se combinarán con el reporte en su misma posición.\n\n` +
                `¿Deseas continuar?`
            );

            if (!proceed) {
                messageEl.textContent = '❌ Combinación cancelada. Revisa los PDFs.';
                messageEl.className = 'error';
                return;
            }
        }

        // 8. Intercalar
        messageEl.textContent = '⏳ Combinando PDFs...';
        const pdfDocResult = await PDFLib.PDFDocument.create();

        for (let i = 0; i < totalOficios; i++) {
            const [oficioPage] = await pdfDocResult.copyPages(pdfDoc1, [i]);
            pdfDocResult.addPage(oficioPage);

            const m = matches[i];
            let reporteIdx = m.reporte;
            if (reporteIdx < 0 && i < totalReportes) reporteIdx = i;
            if (reporteIdx >= 0 && reporteIdx < totalReportes) {
                const [reportePage] = await pdfDocResult.copyPages(pdfDoc2, [reporteIdx]);
                pdfDocResult.addPage(reportePage);
            }
        }

        // 9. Descargar
        const resultBytes = await pdfDocResult.save();
        const blob = new Blob([resultBytes], { type: 'application/pdf' });
        downloadBlob(blob, 'PDF_Combinado.pdf');

        if (allMatched && pagesEqual) {
            messageEl.textContent = `✅ ${totalOficios} oficios combinados con sus reportes correctamente.`;
            messageEl.className = 'success';
        } else if (allMatched) {
            messageEl.textContent = `✅ ${totalOficios} oficios combinados con sus reportes (el número de páginas difería).`;
            messageEl.className = 'success';
        } else {
            messageEl.textContent = `⚠️ PDF combinado con advertencias. ${unmatched.length} oficio(s) se combinaron en posición.`;
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
    const msg = document.getElementById('message');
    msg.textContent = '';
    msg.className = '';
    document.getElementById('validationReport').innerHTML = '';
    resetDropZone(document.getElementById('dropZone1'), 'Arrastra el PDF de los Oficios aquí', 'o haz clic para seleccionarlo');
    resetDropZone(document.getElementById('dropZone2'), 'Arrastra el PDF de los Reportes aquí', 'o haz clic para seleccionarlo');
}