// ==========================================
// ESTADO
// ==========================================
// Resultado del último "Procesar"; el Excel se genera a partir de esto.
let resultado = null;

const ZONAS = {
    cb: { zoneId: 'dropZoneCB', inputId: 'fileInput',   texto: 'Arrastra el archivo CB aquí' },
    a0: { zoneId: 'dropZoneA0', inputId: 'fileInputA0', texto: 'Arrastra el archivo A0 aquí' }
};

// ==========================================
// DRAG & DROP
// ==========================================
function setupDropZone({ zoneId, inputId }) {
    const dropZone = document.getElementById(zoneId);
    const fileInput = document.getElementById(inputId);
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            updateDropZoneText(zoneId, e.dataTransfer.files[0].name);
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
            updateDropZoneText(zoneId, fileInput.files[0].name);
        }
    });
}

function updateDropZoneText(zoneId, fileName) {
    const dropZone = document.getElementById(zoneId);
    const textEl = dropZone.querySelector('.drop-text');
    const subEl  = dropZone.querySelector('.drop-subtext');
    if (textEl) textEl.textContent = '✅ Archivo cargado';
    if (subEl)  subEl.textContent  = fileName;
    dropZone.classList.add('loaded');
}

function resetDropZone({ zoneId, inputId, texto }) {
    const dropZone = document.getElementById(zoneId);
    const textEl = dropZone.querySelector('.drop-text');
    const subEl  = dropZone.querySelector('.drop-subtext');
    if (textEl) textEl.textContent = texto;
    if (subEl)  subEl.textContent  = 'o haz clic para seleccionarlo';
    dropZone.classList.remove('loaded');
    document.getElementById(inputId).value = '';
}

document.addEventListener('DOMContentLoaded', () => {
    Object.values(ZONAS).forEach(setupDropZone);
});

// ==========================================
// MENSAJES
// ==========================================
function showMessage(html, type) {
    const el = document.getElementById('message');
    el.innerHTML = html;
    el.className = type || '';
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ==========================================
// LECTURA Y PARSEO DE LOS ARCHIVOS PLANOS
// ==========================================
// Los archivos planos vienen en ISO-8859-1 (Ñ, Ó...); si se leen como UTF-8 salen como �.
function readFileLatin1(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, 'ISO-8859-1');
    });
}

function splitLines(text) {
    return text.split(/\r?\n/).filter(line => line.trim());
}

function sinCerosIzquierda(str) {
    return str.trim().replace(/^0+/, '');
}

// CB: tarjeta [56,72), cédula [42,54), empresa [72,113)
function parseCB(lines) {
    return lines.map(line => ({
        tarjeta: line.substring(56, 72).trim(),
        cedula: sinCerosIzquierda(line.substring(42, 54)),
        empresa: line.substring(72, 113).trim()
    }));
}

// A0: tarjeta [16,32), documento [37,52) (el [36] es el tipo de documento),
// apellido1 [52,67), apellido2 [67,82), nombre1 [82,97), nombre2 [97,112).
// Se indexa por tarjeta; el registro final de control del archivo no coincide con
// ninguna tarjeta del CB, por lo que queda ignorado al cruzar.
function parseA0(lines) {
    const porTarjeta = new Map();
    lines.forEach(line => {
        const tarjeta = line.substring(16, 32).trim();
        if (!tarjeta) return;
        const nombre = [
            line.substring(52, 67),
            line.substring(67, 82),
            line.substring(82, 97),
            line.substring(97, 112)
        ].map(p => p.trim()).filter(Boolean).join(' ');
        porTarjeta.set(tarjeta, {
            documento: sinCerosIzquierda(line.substring(37, 52)),
            nombre
        });
    });
    return porTarjeta;
}

// El CB manda (orden, tarjeta, empresa); el A0 aporta documento y apellidos y nombres.
function combinar(cbRows, a0PorTarjeta) {
    const totalPorEmpresa = {};
    cbRows.forEach(r => { totalPorEmpresa[r.empresa] = (totalPorEmpresa[r.empresa] || 0) + 1; });

    const corrido = {};
    const sinA0 = [];
    const usadas = new Set();

    const filas = cbRows.map((r, i) => {
        const a0 = a0PorTarjeta.get(r.tarjeta);
        if (a0) usadas.add(r.tarjeta); else sinA0.push(r.tarjeta);
        corrido[r.empresa] = (corrido[r.empresa] || 0) + 1;
        return {
            no: i + 1,
            documento: a0 && a0.documento ? a0.documento : r.cedula,
            tarjeta: r.tarjeta,
            nombre: a0 ? a0.nombre : '',
            empresa: r.empresa,
            cant: corrido[r.empresa],
            total: totalPorEmpresa[r.empresa]
        };
    });

    // SinDuplicados: una fila por empresa (primera aparición), con consecutivo propio.
    const vistas = new Set();
    const empresas = [];
    filas.forEach(f => {
        if (vistas.has(f.empresa)) return;
        vistas.add(f.empresa);
        empresas.push({ no: empresas.length + 1, documento: f.documento, tarjeta: f.tarjeta, empresa: f.empresa, cant: f.total });
    });

    return { filas, empresas, sinA0, a0Sobrantes: a0PorTarjeta.size - usadas.size };
}

// ==========================================
// PROCESAR
// ==========================================
async function processFile() {
    const cbFile = document.getElementById('fileInput').files[0];
    const a0File = document.getElementById('fileInputA0').files[0];

    if (!cbFile || !a0File) {
        const faltan = [!cbFile && 'CB', !a0File && 'A0'].filter(Boolean).join(' y ');
        alert(`Por favor selecciona el archivo ${faltan}.`);
        return;
    }
    if (!cbFile.name.toUpperCase().startsWith('CB636876')) {
        alert('*** ¡Error! *** Por favor, cargue el archivo CB correcto (debe comenzar con "CB636876").');
        return;
    }
    if (!a0File.name.toUpperCase().startsWith('A0')) {
        alert('*** ¡Error! *** Por favor, cargue el archivo A0 correcto (debe comenzar con "A0").');
        return;
    }

    try {
        const [cbText, a0Text] = await Promise.all([readFileLatin1(cbFile), readFileLatin1(a0File)]);
        resultado = combinar(parseCB(splitLines(cbText)), parseA0(splitLines(a0Text)));
    } catch (err) {
        console.error(err);
        resultado = null;
        showMessage('❌ No se pudieron leer los archivos. Revisa la consola (F12).', 'error');
        return;
    }

    renderTabla(resultado.filas);

    const { filas, empresas, sinA0, a0Sobrantes } = resultado;
    document.getElementById('topActions').style.display = 'flex';
    document.getElementById('resultsCount').textContent = `${filas.length} registros cargados · ${empresas.length} empresas`;

    if (sinA0.length) {
        console.warn('Tarjetas del CB sin registro en el A0:', sinA0);
        showMessage(
            `⚠️ ${sinA0.length} tarjeta(s) del CB no se encontraron en el A0 (quedan sin apellidos y nombres). ` +
            `Verifica que ambos archivos sean del mismo envío.<br>Ej.: ${sinA0.slice(0, 5).map(escapeHtml).join(', ')}` +
            (sinA0.length > 5 ? ' …' : ''),
            'warning'
        );
    } else {
        const nota = a0Sobrantes > 0 ? ` (${a0Sobrantes} registro(s) del A0 sin tarjeta en el CB, ignorados)` : '';
        showMessage(`✅ ${filas.length} registros cruzados correctamente entre CB y A0${nota}.`, 'success');
    }
}

function renderTabla(filas) {
    const tableBody = document.getElementById('dataBody');
    tableBody.innerHTML = '';
    const frag = document.createDocumentFragment();
    filas.forEach(f => {
        const row = document.createElement('tr');
        [f.no, f.documento, f.tarjeta, f.nombre, f.empresa, f.total].forEach(valor => {
            const td = document.createElement('td');
            td.textContent = valor;
            row.appendChild(td);
        });
        frag.appendChild(row);
    });
    tableBody.appendChild(frag);
}

function clearTable() {
    resultado = null;
    document.getElementById('dataBody').innerHTML = '';
    document.getElementById('topActions').style.display = 'none';
    document.getElementById('resultsCount').textContent = '0 registros';
    showMessage('', '');
    Object.values(ZONAS).forEach(resetDropZone);
}

// ==========================================
// EXPORTAR A EXCEL
// ==========================================
document.getElementById('exportButton').addEventListener('click', function () {
    exportToExcel('Archivo_CB_Separado.xlsx');
});

function exportToExcel(filename = 'Archivo_CB_Separado.xlsx') {
    if (!resultado) {
        alert('Primero carga los archivos CB y A0 y presiona "Procesar".');
        return;
    }

    const original = [
        ['No', 'DOCUMENTO', 'TARJETA', 'APELLIDOS Y NOMBRES', 'EMPRESA', 'CANT'],
        ...resultado.filas.map(f => [f.no, f.documento, f.tarjeta, f.nombre, f.empresa, f.cant])
    ];
    const sinDuplicados = [
        ['No', 'CEDULA', 'TARJETA', 'EMPRESA', 'CANT'],
        ...resultado.empresas.map(e => [e.no, e.documento, e.tarjeta, e.empresa, e.cant])
    ];

    const wsOriginal = XLSX.utils.aoa_to_sheet(original);
    const wsUnique = XLSX.utils.aoa_to_sheet(sinDuplicados);
    wsOriginal['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 20 }, { wch: 42 }, { wch: 45 }, { wch: 7 }];
    wsUnique['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 20 }, { wch: 45 }, { wch: 7 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsOriginal, 'Original');
    XLSX.utils.book_append_sheet(wb, wsUnique, 'SinDuplicados');
    XLSX.writeFile(wb, filename);
}
