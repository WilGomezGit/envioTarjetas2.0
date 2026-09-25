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
// El formato es: "... Nit: XXX Empresa: NOMBRE_EMPRESA CEDULA_TRABAJADOR NOMBRE_TRABAJADOR..."
// (todo junto, sin saltos de línea). OJO: antes del label real "Empresa:" aparece
// la frase "Total Tarjetas de la Empresa: N", que también contiene "Empresa:" y
// hace que una búsqueda ingenua del primer "Empresa:" del texto tome ese valor
// en vez del nombre real. Por eso anclamos la búsqueda a la secuencia "Nit: X Empresa:".
// ==========================================
function extractReportCompany(text) {
    if (!text) return null;
    const anchor = text.match(/Nit\s*:\s*\S+\s+Empresa\s*:\s*/i);
    if (!anchor) return null;
    let after = text.substring(anchor.index + anchor[0].length).trim();

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
        if (m && m.index > 0 && m.index < cutIdx) {
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

        // 4. Emparejamiento con doble estrategia (nunca se adivina por posición)
        const matches = [];
        const usedReporte = new Set();

        for (let i = 0; i < oficiosTexts.length; i++) {
            let found = -1;

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
                if (bestIdx >= 0) found = bestIdx;
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
                if (bestIdx >= 0) found = bestIdx;
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

        // Oficios que no encontraron reporte, y reportes que ningún oficio reclamó
        const oficiosSinReporte = matches.filter(m => m.reporte < 0).map(m => m.oficio);
        const reportesSinOficio = [];
        for (let j = 0; j < reportesTexts.length; j++) {
            if (!usedReporte.has(j)) reportesSinOficio.push(j);
        }

        console.log('RESUMEN:');
        console.log(`  Oficios: ${totalOficios}, Reportes: ${totalReportes}`);
        console.log(`  Emparejados: ${totalOficios - oficiosSinReporte.length}`);
        if (oficiosSinReporte.length > 0) {
            console.log('  Oficios sin reporte:');
            oficiosSinReporte.forEach(p => console.log(`    Oficio ${p + 1}: "${oficioCompanies[p]}"`));
        }
        if (reportesSinOficio.length > 0) {
            console.log('  Reportes sin oficio:');
            reportesSinOficio.forEach(p => console.log(`    Reporte ${p + 1}: "${reportCompanies[p]}"`));
        }
        console.log('═══════════════════════════════════════════');

        // 6. Panel de resultado
        let html = '<div class="validation-box">';
        html += `<h3>📋 Resultado del análisis</h3>`;
        html += `<ul>`;
        html += `<li>📄 Oficios: <strong>${totalOficios}</strong> páginas</li>`;
        html += `<li>📄 Reportes: <strong>${totalReportes}</strong> páginas</li>`;
        html += `<li>🔗 Emparejados: <strong>${totalOficios - oficiosSinReporte.length}</strong></li>`;
        if (oficiosSinReporte.length > 0) {
            html += `<li>⚠️ Oficios sin reporte (no tienen reporte, se incluyen solos): <strong>${oficiosSinReporte.length}</strong><ul>`;
            oficiosSinReporte.slice(0, 15).forEach(p => {
                html += `<li>Oficio ${p + 1}: "${oficioCompanies[p] || '(sin nombre)'}"</li>`;
            });
            if (oficiosSinReporte.length > 15) html += `<li>... y ${oficiosSinReporte.length - 15} más</li>`;
            html += `</ul></li>`;
        }
        if (reportesSinOficio.length > 0) {
            html += `<li>⚠️ Reportes sin oficio (no hay oficio, se anexan al final): <strong>${reportesSinOficio.length}</strong><ul>`;
            reportesSinOficio.slice(0, 15).forEach(p => {
                html += `<li>Reporte ${p + 1}: "${reportCompanies[p] || '(sin nombre)'}"</li>`;
            });
            if (reportesSinOficio.length > 15) html += `<li>... y ${reportesSinOficio.length - 15} más</li>`;
            html += `</ul></li>`;
        }
        html += `</ul>`;
        html += '</div>';
        reportEl.innerHTML = html;

        // 7. Confirmar si hay pendientes (nunca se fuerza un match por posición)
        if (oficiosSinReporte.length > 0 || reportesSinOficio.length > 0) {
            let detalle = '';
            if (oficiosSinReporte.length > 0) {
                detalle += `\nOficios SIN reporte (no se hacen/combinan porque no tienen reporte) — ${oficiosSinReporte.length}:\n` +
                    oficiosSinReporte.slice(0, 10).map(p => `  • Oficio pág. ${p + 1}: "${oficioCompanies[p] || '(sin nombre)'}"`).join('\n');
                if (oficiosSinReporte.length > 10) detalle += `\n  ... y ${oficiosSinReporte.length - 10} más`;
            }
            if (reportesSinOficio.length > 0) {
                detalle += `\n\nReportes SIN oficio (no se emparejan porque no hay oficio) — ${reportesSinOficio.length}:\n` +
                    reportesSinOficio.slice(0, 10).map(p => `  • Reporte pág. ${p + 1}: "${reportCompanies[p] || '(sin nombre)'}"`).join('\n');
                if (reportesSinOficio.length > 10) detalle += `\n  ... y ${reportesSinOficio.length - 10} más`;
            }

            const proceed = confirm(
                `⚠️ ATENCIÓN:\n${detalle}\n\n` +
                `El resto de oficios y reportes que SÍ coinciden se combinarán normalmente.\n` +
                `Los oficios sin reporte se incluirán solos, y los reportes sin oficio se anexarán al final del PDF.\n\n` +
                `¿Deseas continuar?`
            );

            if (!proceed) {
                messageEl.textContent = '❌ Combinación cancelada. Revisa los PDFs.';
                messageEl.className = 'error';
                return;
            }
        }

        // 8. Intercalar: solo se combina lo que realmente coincide
        messageEl.textContent = '⏳ Combinando PDFs...';
        const pdfDocResult = await PDFLib.PDFDocument.create();

        for (let i = 0; i < totalOficios; i++) {
            const [oficioPage] = await pdfDocResult.copyPages(pdfDoc1, [i]);
            pdfDocResult.addPage(oficioPage);

            const reporteIdx = matches[i].reporte;
            if (reporteIdx >= 0) {
                const [reportePage] = await pdfDocResult.copyPages(pdfDoc2, [reporteIdx]);
                pdfDocResult.addPage(reportePage);
            }
        }

        // Los reportes sin oficio no se pierden: se anexan al final, sin pareja
        for (const j of reportesSinOficio) {
            const [reportePage] = await pdfDocResult.copyPages(pdfDoc2, [j]);
            pdfDocResult.addPage(reportePage);
        }

        // 9. Descargar
        const resultBytes = await pdfDocResult.save();
        const blob = new Blob([resultBytes], { type: 'application/pdf' });
        downloadBlob(blob, 'PDF_Combinado.pdf');

        if (oficiosSinReporte.length === 0 && reportesSinOficio.length === 0) {
            messageEl.textContent = `✅ ${totalOficios} oficios combinados con sus reportes correctamente.`;
            messageEl.className = 'success';
        } else {
            const partes = [];
            if (oficiosSinReporte.length > 0) partes.push(`${oficiosSinReporte.length} oficio(s) sin reporte`);
            if (reportesSinOficio.length > 0) partes.push(`${reportesSinOficio.length} reporte(s) sin oficio (anexados al final)`);
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
    const msg = document.getElementById('message');
    msg.textContent = '';
    msg.className = '';
    document.getElementById('validationReport').innerHTML = '';
    resetDropZone(document.getElementById('dropZone1'), 'Arrastra el PDF de los Oficios aquí', 'o haz clic para seleccionarlo');
    resetDropZone(document.getElementById('dropZone2'), 'Arrastra el PDF de los Reportes aquí', 'o haz clic para seleccionarlo');
}