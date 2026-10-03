// ==========================================
// ESTADO
// ==========================================
// Resultado del último "Procesar"; el Excel se genera a partir de esto.
let resultado = null;

// Archivos planos cargados (se detectan por el nombre del archivo).
const archivos = { cb: null, a0: null };

const DROP_TEXTO = 'Arrastra aquí los archivos CB y A0';
const DROP_SUBTEXTO = 'o haz clic para seleccionarlos (puedes elegir los dos a la vez)';

function tipoDeArchivo(nombre) {
    const n = nombre.toUpperCase();
    if (n.startsWith('CB636876')) return 'cb';
    if (n.startsWith('A0')) return 'a0';
    return null;
}

// ==========================================
// DRAG & DROP
// ==========================================
function agregarArchivos(fileList) {
    const noReconocidos = [];
    Array.from(fileList).forEach(file => {
        const tipo = tipoDeArchivo(file.name);
        if (tipo) archivos[tipo] = file; else noReconocidos.push(file.name);
    });
    actualizarEstadoArchivos();

    if (noReconocidos.length) {
        showMessage(
            `⚠️ No reconocí: ${noReconocidos.map(escapeHtml).join(', ')}.<br>` +
            'El archivo CB debe comenzar con "CB636876" y el A0 con "A0".',
            'warning'
        );
    } else {
        showMessage('', '');
    }
}

function actualizarEstadoArchivos() {
    [['cb', 'statusCB', 'CB'], ['a0', 'statusA0', 'A0']].forEach(([tipo, id, etiqueta]) => {
        const chip = document.getElementById(id);
        const file = archivos[tipo];
        chip.textContent = file ? `✅ ${etiqueta}: ${file.name}` : `${etiqueta}: pendiente`;
        chip.classList.toggle('ok', Boolean(file));
    });

    const dropZone = document.getElementById('dropZone');
    const listos = archivos.cb && archivos.a0;
    dropZone.querySelector('.drop-text').textContent = listos ? '✅ Archivos cargados' : DROP_TEXTO;
    dropZone.querySelector('.drop-subtext').textContent = listos
        ? 'Presiona "Procesar" (o haz clic para reemplazarlos)'
        : DROP_SUBTEXTO;
}

function setupDropZone() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
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
        if (e.dataTransfer.files.length) agregarArchivos(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) agregarArchivos(fileInput.files);
        fileInput.value = '';
    });
}

document.addEventListener('DOMContentLoaded', setupDropZone);

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
// Las líneas de trabajador empiezan con "01"; la última línea del archivo es informativa
// (otro formato, empieza con el NIT) y se ignora. Se indexa por tarjeta.
function parseA0(lines) {
    const porTarjeta = new Map();
    lines.forEach(line => {
        if (!line.startsWith('01')) return;
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

    const filas = cbRows.map((r, i) => {
        const a0 = a0PorTarjeta.get(r.tarjeta);
        if (!a0) sinA0.push({ tarjeta: r.tarjeta, empresa: r.empresa });
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

    const tarjetasCB = new Set(cbRows.map(r => r.tarjeta));
    const a0SinCB = [];
    a0PorTarjeta.forEach((a0, tarjeta) => {
        if (!tarjetasCB.has(tarjeta)) a0SinCB.push({ tarjeta, documento: a0.documento, nombre: a0.nombre });
    });

    return { filas, empresas, sinA0, a0SinCB };
}

// ==========================================
// PROCESAR
// ==========================================
async function processFile() {
    const { cb: cbFile, a0: a0File } = archivos;

    if (!cbFile || !a0File) {
        const faltan = [!cbFile && 'CB', !a0File && 'A0'].filter(Boolean).join(' y ');
        alert(`Falta cargar el archivo ${faltan}.`);
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

    const { filas, empresas, sinA0, a0SinCB } = resultado;
    document.getElementById('topActions').style.display = 'flex';
    document.getElementById('resultsCount').textContent = `${filas.length} registros cargados · ${empresas.length} empresas`;

    if (sinA0.length || a0SinCB.length) {
        console.warn('Tarjetas del CB sin registro en el A0:', sinA0);
        console.warn('Registros del A0 sin tarjeta en el CB:', a0SinCB);
        showMessage(mensajeDescuadre(sinA0, a0SinCB), 'warning');
    } else {
        showMessage(`✅ ${filas.length} registros cruzados correctamente entre CB y A0.`, 'success');
    }
}

// Alerta cuando los dos archivos no cuadran entre sí (en cualquiera de los dos sentidos).
function mensajeDescuadre(sinA0, a0SinCB) {
    const MAX = 10;
    const lista = (items, fmt) =>
        '<ul>' + items.slice(0, MAX).map(i => `<li>${fmt(i)}</li>`).join('') + '</ul>' +
        (items.length > MAX ? `<div>… y ${items.length - MAX} más (ver consola F12).</div>` : '');

    let html = '⚠️ Los archivos CB y A0 no cuadran. Revisa que sean del mismo envío:';
    if (sinA0.length) {
        html += `<br><br>${sinA0.length} tarjeta(s) del CB <u>no están en el A0</u> (quedan sin apellidos y nombres):` +
            lista(sinA0, i => `${escapeHtml(i.tarjeta)} · ${escapeHtml(i.empresa)}`);
    }
    if (a0SinCB.length) {
        html += `<br>${a0SinCB.length} registro(s) del A0 <u>no están en el CB</u> (no se incluyen en el Excel):` +
            lista(a0SinCB, i => `${escapeHtml(i.tarjeta)} · ${escapeHtml(i.nombre)} (doc. ${escapeHtml(i.documento)})`);
    }
    return html;
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
    archivos.cb = null;
    archivos.a0 = null;
    actualizarEstadoArchivos();
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
