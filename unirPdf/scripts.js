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
// EXTRAER DATOS DE LA PLANILLA (REPORTE)
// La primera página de cada planilla dice (todo junto, sin saltos de línea):
//   "Total Tarjetas de la Empresa: N  [Nit: X]  Empresa: NOMBRE  1 CEDULA NOMBRE_TRABAJADOR ..."
// El "Nit: X" es opcional (hay planillas sin NIT). Se ancla en "Total Tarjetas de la Empresa: N"
// para no confundir su "Empresa:" con el label real, y el nombre se corta antes del número de
// fila + documento del primer trabajador (si no, el "1" de la fila quedaría pegado al nombre).
// Las páginas siguientes de una planilla larga no repiten este encabezado.
// ==========================================
const REPORT_HEADER_RE = /Total\s+Tarjetas\s+de\s+la\s+Empresa\s*:\s*(\d+)\s+(?:Nit\s*:\s*[\d.\-\s]*?)?Empresa\s*:\s*/i;

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

// Cantidad que declara el oficio: "Remito a usted listado, 4 Tarjeta (s) Corporativa (s)..."
function extractOficioCantidad(text) {
    const m = text && text.match(/listado,?\s*(\d+)\s*Tarjeta/i);
    return m ? parseInt(m[1], 10) : null;
}

// Una planilla puede ocupar varias páginas: la primera trae el encabezado con la empresa y las
// siguientes no. Se agrupan para tratarlas (y copiarlas al PDF final) como una sola unidad.
function agruparPaginasReporte(textos) {
    const unidades = [];
    textos.forEach((texto, i) => {
        if (unidades.length === 0 || REPORT_HEADER_RE.test(texto)) {
            unidades.push({ nombre: extractReportCompany(texto), cant: extractReportCantidad(texto), paginas: [i], texto });
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

        // 3. Datos de cada oficio y de cada planilla (una planilla puede ocupar varias páginas)
        const unidades = agruparPaginasReporte(reportesTexts);
        const oficioCompanies = oficiosTexts.map(t => extractOficioCompany(t));
        const oficioCants = oficiosTexts.map(t => extractOficioCantidad(t));
        const oficiosN = oficiosTexts.map((t, i) => ({ nombre: normalizeText(oficioCompanies[i]), cant: oficioCants[i], texto: normalizeText(t) }));
        const reportesN = unidades.map(u => ({ nombre: normalizeText(u.nombre), cant: u.cant, texto: normalizeText(u.texto) }));
        const nombreReporte = j => unidades[j].nombre || '(sin nombre)';
        const nombreOficio = i => oficioCompanies[i] || '(sin nombre)';

        // ============= DIAGNÓSTICO =============
        console.log('═══════════════════════════════════════════');
        console.log('EMPRESAS EN OFICIOS (primeras 15):');
        oficioCompanies.forEach((c, i) => { if (i < 15) console.log(`  Oficio ${i+1}: "${c}" (${oficioCants[i]} tarjetas)`); });
        console.log('EMPRESAS EN PLANILLAS (primeras 15):');
        unidades.forEach((u, j) => { if (j < 15) console.log(`  Planilla ${j+1} (pág. ${u.paginas[0] + 1}): "${u.nombre}" (${u.cant} tarjetas)`); });
        console.log('═══════════════════════════════════════════');

        // 4. Emparejamiento (nunca se adivina por posición)
        const { resultado: matches, usado: usedReporte, sugerencias } = emparejar(oficiosN, reportesN);

        const oficiosSinReporte = [];
        matches.forEach((m, i) => { if (m.reporte < 0) oficiosSinReporte.push(i); });
        const reportesSinOficio = [];
        usedReporte.forEach((u, j) => { if (!u) reportesSinOficio.push(j); });
        const porTruncado = matches.map((m, i) => ({ i, m })).filter(x => x.m.tipo === 'truncado');
        const cantDistinta = matches.map((m, i) => ({ i, m })).filter(x =>
            x.m.reporte >= 0 && oficioCants[x.i] != null && unidades[x.m.reporte].cant != null && oficioCants[x.i] !== unidades[x.m.reporte].cant);
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

        let html = '<div class="validation-box">';
        html += `<h3>📋 Resultado del análisis</h3><ul>`;
        html += `<li>📄 Oficios: <strong>${totalOficios}</strong> páginas</li>`;
        html += `<li>📄 Planillas: <strong>${unidades.length}</strong> (${totalReportes} páginas)</li>`;
        html += `<li>🔗 Emparejados: <strong>${emparejados}</strong></li>`;
        if (porTruncado.length > 0) {
            html += `<li>ℹ️ Emparejados por nombre truncado + misma cantidad (el CB corta el nombre; revisa que estén bien): <strong>${porTruncado.length}</strong>` +
                ul(porTruncado, x => `Oficio ${x.i + 1} "${esc(nombreOficio(x.i))}" ↔ Planilla "${esc(nombreReporte(x.m.reporte))}" (${oficioCants[x.i]} tarjetas)`) + `</li>`;
        }
        if (cantDistinta.length > 0) {
            html += `<li>⚠️ Emparejados pero con cantidad distinta (revísalos): <strong>${cantDistinta.length}</strong>` +
                ul(cantDistinta, x => `"${esc(nombreOficio(x.i))}": oficio ${oficioCants[x.i]} vs planilla ${unidades[x.m.reporte].cant}`) + `</li>`;
        }
        if (oficiosSinReporte.length > 0) {
            html += `<li>⚠️ Oficios sin planilla (se incluyen solos): <strong>${oficiosSinReporte.length}</strong>` +
                ul(oficiosSinReporte, p => `Oficio ${p + 1}: "${esc(nombreOficio(p))}" (${oficioCants[p] ?? '?'} tarjetas)${sugerido(p)}`) + `</li>`;
        }
        if (reportesSinOficio.length > 0) {
            html += `<li>⚠️ Planillas sin oficio (se anexan al final): <strong>${reportesSinOficio.length}</strong>` +
                ul(reportesSinOficio, p => `Planilla pág. ${unidades[p].paginas[0] + 1}: "${esc(nombreReporte(p))}" (${unidades[p].cant ?? '?'} tarjetas)`) + `</li>`;
        }
        html += `</ul></div>`;
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
                detalle += `\n\nPlanillas SIN oficio (se anexan al final) — ${reportesSinOficio.length}:\n` +
                    reportesSinOficio.slice(0, 10).map(p => `  • Planilla pág. ${unidades[p].paginas[0] + 1}: "${nombreReporte(p)}" (${unidades[p].cant ?? '?'})`).join('\n');
                if (reportesSinOficio.length > 10) detalle += `\n  ... y ${reportesSinOficio.length - 10} más`;
            }

            const proceed = confirm(
                `⚠️ ATENCIÓN:\n${detalle}\n\n` +
                `El resto de oficios y planillas que SÍ coinciden se combinarán normalmente.\n\n` +
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

        // Las planillas sin oficio no se pierden: se anexan al final, sin pareja
        for (const j of reportesSinOficio) {
            const paginas = await pdfDocResult.copyPages(pdfDoc2, unidades[j].paginas);
            paginas.forEach(p => pdfDocResult.addPage(p));
        }

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
            if (reportesSinOficio.length > 0) partes.push(`${reportesSinOficio.length} planilla(s) sin oficio (anexadas al final)`);
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