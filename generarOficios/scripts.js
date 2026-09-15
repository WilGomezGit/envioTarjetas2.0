// ==========================================
// CONFIGURACIÓN POR DEFECTO (Arial 11, justificado, tamaño CARTA)
// ==========================================
const DEFAULT_CONFIG = {
    fontSize: 11,
    lineSpacing: 1.15,
    textAlign: 'justify',
    marginTop: 90,
    marginBottom: 50,
    marginLeft: 60,
    marginRight: 60
};

// ==========================================
// HELPERS
// ==========================================
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
    return `${meses[d.getMonth()]} ${d.getDate()} de ${d.getFullYear()}`;
}

function sanitizeFilename(str) {
    if (!str) return 'EMPRESA';
    return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 80);
}

function wrapText(text, font, size, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let current = '';
    for (const word of words) {
        const test = current ? current + ' ' + word : word;
        if (font.widthOfTextAtSize(test, size) <= maxWidth) {
            current = test;
        } else {
            if (current) lines.push(current);
            current = word;
        }
    }
    if (current) lines.push(current);
    return lines;
}

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

function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsArrayBuffer(file);
    });
}

// ==========================================
// DRAG & DROP
// ==========================================
function setupDropZone(dropZoneId, inputId, isSignature) {
    const dropZone = document.getElementById(dropZoneId);
    const fileInput = document.getElementById(inputId);
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            if (isSignature) updateSignatureUI(e.dataTransfer.files[0]);
            else updateDropZoneUI(e.dataTransfer.files[0].name);
        }
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
            if (isSignature) updateSignatureUI(fileInput.files[0]);
            else updateDropZoneUI(fileInput.files[0].name);
        }
    });
}

function updateDropZoneUI(fileName) {
    const dz = document.getElementById('dropZone');
    dz.querySelector('.drop-text').textContent = '✅ Archivo cargado';
    dz.querySelector('.drop-subtext').textContent = fileName;
}

function updateSignatureUI(file) {
    const dz = document.getElementById('signatureDropZone');
    dz.querySelector('.drop-text').textContent = '✅ Firma cargada';
    dz.querySelector('.drop-subtext').textContent = file.name;
    const preview = document.getElementById('signaturePreview');
    const reader = new FileReader();
    reader.onload = (e) => {
        preview.innerHTML = `<img src="${e.target.result}" alt="Firma">`;
    };
    reader.readAsDataURL(file);
}

function resetDropZoneUI() {
    const dz = document.getElementById('dropZone');
    dz.querySelector('.drop-text').textContent = 'Arrastra el Excel aquí';
    dz.querySelector('.drop-subtext').textContent = 'Debe contener la hoja de direcciones';
}

function resetSignatureUI() {
    const dz = document.getElementById('signatureDropZone');
    dz.querySelector('.drop-text').textContent = 'Arrastra la firma aquí';
    dz.querySelector('.drop-subtext').textContent = 'PNG con fondo transparente recomendado';
    document.getElementById('signaturePreview').innerHTML = '';
}

// ==========================================
// SELECTOR
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
    setupDropZone('dropZone', 'fileInput', false);
    setupDropZone('signatureDropZone', 'signatureInput', true);
    setupOutputSelector();
});

// ==========================================
// DIBUJAR LÍNEA JUSTIFICADA (como Word)
// ==========================================
function drawJustifiedLine(page, line, font, size, x, y, maxWidth, color) {
    const words = line.split(/\s+/).filter(w => w);
    if (words.length <= 1) {
        page.drawText(line, { x, y, size, font, color });
        return;
    }

    const wordsWidth = words.reduce((sum, w) => sum + font.widthOfTextAtSize(w, size), 0);
    const totalSpaces = words.length - 1;
    const spaceWidth = (maxWidth - wordsWidth) / totalSpaces;

    let curX = x;
    for (let i = 0; i < words.length; i++) {
        page.drawText(words[i], { x: curX, y, size, font, color });
        const wordW = font.widthOfTextAtSize(words[i], size);
        curX += wordW + spaceWidth;
    }
}

// ==========================================
// DIBUJAR UN OFICIO EN UN PDF  ← CAMBIADO A CARTA
// ==========================================
async function dibujarOficio(pdfDoc, font, fontBold, emp, fecha, firmante, cargo, elaboradoPor, firmaImage, cfg) {
    const W = 612;      // ← CARTA (antes 595.28 = A4)
    const H = 792;      // ← CARTA (antes 841.89 = A4)
    const ML = cfg.marginLeft;
    const MR = cfg.marginRight;
    const MT = cfg.marginTop;
    const MB = cfg.marginBottom;
    const fontSize = cfg.fontSize;
    const maxWidth = W - ML - MR;
    const black = PDFLib.rgb(0, 0, 0);

    let page = pdfDoc.addPage([W, H]);
    let y = H - MT;

    const newPageIfNeeded = (needed) => {
        if (y - needed < MB) {
            page = pdfDoc.addPage([W, H]);
            y = H - MT;
        }
    };

    const drawParagraph = (text, opts = {}) => {
        const f = opts.bold ? fontBold : font;
        const s = opts.size || fontSize;
        const lh = s * cfg.lineSpacing;
        const lines = wrapText(text, f, s, maxWidth);

        for (let i = 0; i < lines.length; i++) {
            newPageIfNeeded(lh);
            const isLastLine = (i === lines.length - 1);
            if (cfg.textAlign === 'justify' && !isLastLine) {
                drawJustifiedLine(page, lines[i], f, s, ML, y, maxWidth, black);
            } else {
                page.drawText(lines[i], { x: ML, y, size: s, font: f, color: black });
            }
            y -= lh;
        }
    };

    const gap = (n = 8) => {
        newPageIfNeeded(n);
        y -= n;
    };

    // --- Encabezado ---
    drawParagraph(`Popayán, ${fecha}`);
    gap(8);

    // --- Destinatario ---
    drawParagraph('Señores');
    drawParagraph(emp.empresa, { bold: true });
    drawParagraph(emp.direccion);
    drawParagraph(`Teléfono: ${emp.telefono}`);
    drawParagraph(emp.ciudad);
    gap(8);

    // --- Asunto ---
    drawParagraph('Asunto: Entrega Tarjetas Corporativas Pago Subsidio Familiar e Identificación ante la Caja.', { bold: true });
    gap(8);

    // --- Cuerpo ---
    drawParagraph(`Remito a usted listado, ${emp.cant} Tarjeta (s) Corporativa (s), para que por favor sea (n) entregada (s) al (los) colaborador (es).`);
    gap(8);

    drawParagraph('La tarjeta corporativa es el medio de identificación ante la Caja para poder disfrutar de los diferentes servicios que prestamos y además como uno de los medios de pago del subsidio familiar.');
    gap(8);

    drawParagraph('Es indispensable que sus funcionarios afilien a su grupo familiar ante Comfacauca y si tienen derecho al subsidio monetario, al recibir la Tarjeta, deben tramitar la activación de la misma, la cual se realiza haciendo el cambio de la "clave genérica" asignada a cada Tarjeta "1234" en almacenes Éxito a nivel nacional o en los establecimientos de comercio con los cuales se tiene convenio y que puede consultar por el link www.comfacauca.com/medios-de-pago. La clave genérica no permite la realizarla ninguna transacción.');
    gap(8);

    drawParagraph('La Tarjeta Corporativa COMFACAUCA no tiene costo de manejo, si cambia de empresa y esta se encuentra afiliada a la Caja de Compensación, puede seguir usando la misma Tarjeta Corporativa Comfacauca, se sugiere no acumular el subsidio, teniendo en cuenta que el mismo vence después de 3 años de recibir dicha prestación. (Artículo 6 Ley 21 de 1982). Por ello, le invitamos a inscribir su cuenta bancaria ingresando a nuestra página www.comfacauca.com, por lo menos una vez al año, en el link: Comfacauca en Línea. opción del Menú Principal > Inscripción Cuenta Bancaria, o contactándose al (2) 8231668 ext. 128 y 129 para más información.');
    gap(8);

    drawParagraph('La consulta personalizada de cuotas pagadas, movimientos y saldo de su tarjeta la puede realizar a través de www.comfacauca.com, ingresando por Comfacauca en línea (ubicado en la parte superior derecha de su pantalla) allí puede crear su usuario consultando el manual de trabajadores para poder hacer uso de este servicio, indispensable tener correo electrónico.');
    gap(8);

    drawParagraph('Favor hacer extensiva esta información a sus empleados.');
    gap(10);

    drawParagraph('Atentamente,');
    gap(15);

    // --- Firma imagen ---
    if (firmaImage) {
        try {
            let embeddedImg;
            if (firmaImage.type === 'image/png') {
                embeddedImg = await pdfDoc.embedPng(firmaImage.bytes);
            } else {
                embeddedImg = await pdfDoc.embedJpg(firmaImage.bytes);
            }
            const maxH = 55;
            const maxW = 180;
            const dims = embeddedImg.scale(1);
            let scale = 1;
            if (dims.height > maxH) scale = maxH / dims.height;
            if (dims.width * scale > maxW) scale = maxW / dims.width;
            const imgW = dims.width * scale;
            const imgH = dims.height * scale;

            newPageIfNeeded(imgH + 10);
            page.drawImage(embeddedImg, {
                x: ML,
                y: y - imgH,
                width: imgW,
                height: imgH
            });
            y -= (imgH + 6);
        } catch (e) {
            console.warn('No se pudo insertar la firma:', e);
        }
    } else {
        gap(30);
    }

    drawParagraph(firmante, { bold: true });
    if (cargo) drawParagraph(cargo);
    gap(15);

    drawParagraph('Nota: El listado de tarjetas de cada empresa se guarda de forma electrónica en Tesorería junto con este oficio y la relación de destinatarios, debidamente radicados.');
    gap(8);

    drawParagraph('Adjunto: Relación empresas pago (1 hoja).');
    gap(10);

    if (elaboradoPor) {
        drawParagraph(`Transcriptor: ${elaboradoPor}`);
    }

    return page;
}

// ==========================================
// GENERAR OFICIOS
// ==========================================
async function generarOficios() {
    const file = document.getElementById('fileInput').files[0];
    const sheetName = (document.getElementById('sheetName').value || '').trim() || 'Direcciones';
    const firmante = (document.getElementById('firmanteNombre').value || '').trim() || 'Harold Yela Figuero';
    const cargo = (document.getElementById('firmanteCargo').value || '').trim();
    const elaboradoPor = (document.getElementById('elaboradoPor').value || '').trim();
    const outputType = getSelectedOutputType();
    const signatureFile = document.getElementById('signatureInput').files[0];
    const cfg = DEFAULT_CONFIG;

    if (!file) {
        alert('Por favor, carga el Excel.');
        return;
    }

    const messageEl = document.getElementById('message');
    messageEl.textContent = '⏳ Procesando...';
    messageEl.className = 'loading';

    try {
        const workbook = await readExcelWorkbook(file);
        const sheet = workbook.Sheets[sheetName];

        if (!sheet) {
            alert(`La hoja "${sheetName}" no existe en el Excel.`);
            messageEl.textContent = '';
            messageEl.className = '';
            return;
        }

        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        data.shift();

        const empresas = [];
        data.forEach(row => {
            if (row && row.length >= 7 && row[2]) {
                empresas.push({
                    no: row[0],
                    nit: String(row[1] || '').trim(),
                    empresa: String(row[2] || '').trim(),
                    cant: parseInt(row[3]) || 0,
                    direccion: String(row[4] || '').trim(),
                    ciudad: String(row[5] || '').trim(),
                    telefono: String(row[6] || '').trim()
                });
            }
        });

        console.log(`Total empresas: ${empresas.length}`);

        if (empresas.length === 0) {
            alert('No se encontraron filas válidas.');
            messageEl.textContent = '';
            messageEl.className = '';
            return;
        }

        let firmaImage = null;
        if (signatureFile) {
            const bytes = new Uint8Array(await readFileAsArrayBuffer(signatureFile));
            firmaImage = { bytes, type: signatureFile.type };
        }

        const fecha = getFechaEspanol();
        const zip = new JSZip();
        let masterPdf = null, masterFont = null, masterFontBold = null;

        if (outputType === 'single') {
            masterPdf = await PDFLib.PDFDocument.create();
            masterFont = await masterPdf.embedFont(PDFLib.StandardFonts.Helvetica);
            masterFontBold = await masterPdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
        }

        for (let i = 0; i < empresas.length; i++) {
            const emp = empresas[i];
            messageEl.textContent = `⏳ Generando oficio ${i + 1} de ${empresas.length}: ${emp.empresa.substring(0, 40)}`;

            try {
                if (outputType === 'single') {
                    await dibujarOficio(masterPdf, masterFont, masterFontBold, emp, fecha, firmante, cargo, elaboradoPor, firmaImage, cfg);
                } else {
                    const pdfDoc = await PDFLib.PDFDocument.create();
                    const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
                    const fontBold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
                    await dibujarOficio(pdfDoc, font, fontBold, emp, fecha, firmante, cargo, elaboradoPor, firmaImage, cfg);
                    const pdfBytes = await pdfDoc.save();
                    const nombreLimpio = sanitizeFilename(emp.empresa);
                    zip.file(`${i + 1}. ${nombreLimpio}.pdf`, pdfBytes);
                }
            } catch (errEmp) {
                console.error(`Error con empresa "${emp.empresa}":`, errEmp);
            }
        }

        if (outputType === 'single') {
            messageEl.textContent = '⏳ Guardando PDF único...';
            const bytes = await masterPdf.save();
            const blob = new Blob([bytes], { type: 'application/pdf' });
            downloadBlob(blob, 'Oficios_Todos.pdf');
            messageEl.textContent = `✅ Se generó 1 PDF con ${empresas.length} oficios.`;
        } else {
            messageEl.textContent = '⏳ Comprimiendo ZIP...';
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(zipBlob, 'Oficios.zip');
            messageEl.textContent = `✅ Se generaron ${empresas.length} oficios en ZIP.`;
        }
        messageEl.className = 'success';

    } catch (error) {
        console.error(error);
        messageEl.textContent = '❌ Ocurrió un error al generar los oficios. Revisa la consola (F12).';
        messageEl.className = 'error';
        alert('Ocurrió un error al generar los oficios.');
    }
}

// ==========================================
// LIMPIAR
// ==========================================
function limpiar() {
    document.getElementById('fileInput').value = '';
    document.getElementById('signatureInput').value = '';
    document.getElementById('elaboradoPor').value = '';
    document.getElementById('sheetName').value = 'Direcciones';
    document.getElementById('firmanteNombre').value = 'Harold Yela Figuero';
    document.getElementById('firmanteCargo').value = 'Auxiliar de Tesorería';
    resetDropZoneUI();
    resetSignatureUI();
    const msg = document.getElementById('message');
    msg.textContent = '';
    msg.className = '';
}