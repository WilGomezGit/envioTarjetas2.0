// ==========================================
// DRAG & DROP
// ==========================================
function setupDropZone() {
    const dropZone = document.getElementById('dropZoneCB');
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
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            updateDropZoneText(e.dataTransfer.files[0].name);
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
            updateDropZoneText(fileInput.files[0].name);
        }
    });
}

function updateDropZoneText(fileName) {
    const dropZone = document.getElementById('dropZoneCB');
    const textEl = dropZone.querySelector('.drop-text');
    const subEl  = dropZone.querySelector('.drop-subtext');
    if (textEl) textEl.textContent = '✅ Archivo cargado';
    if (subEl)  subEl.textContent  = fileName;
}

function resetDropZone() {
    const dropZone = document.getElementById('dropZoneCB');
    const textEl = dropZone.querySelector('.drop-text');
    const subEl  = dropZone.querySelector('.drop-subtext');
    if (textEl) textEl.textContent = 'Arrastra el archivo CB aquí';
    if (subEl)  subEl.textContent  = 'o haz clic para seleccionarlo';
}

document.addEventListener('DOMContentLoaded', setupDropZone);

// ==========================================
// PROCESAR ARCHIVO CB
// ==========================================
function processFile() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];

    if (!file) {
        alert("Por favor selecciona un archivo");
        return;
    }

    // Validar que el nombre del archivo comience con "CB636876"
    if (!file.name.startsWith("CB636876")) {
        alert("*** ¡Error! *** Por favor, cargue el archivo CB correcto.");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const fileContent = event.target.result;
        const lines = fileContent.split('\n');
        const tableBody = document.getElementById('dataBody');
        tableBody.innerHTML = '';

        const empresaCounts = {};

        // Primera pasada: contar empresas
        lines.forEach((line) => {
            if (line.trim()) {
                const empresa = line.substring(72, 113).trim();
                if (empresa) {
                    empresaCounts[empresa] = (empresaCounts[empresa] || 0) + 1;
                }
            }
        });

        // Segunda pasada: crear filas
        let rowCount = 0;
        lines.forEach((line, index) => {
            if (line.trim()) {
                const cedula = line.substring(42, 54).trim().replace(/^0+/, '');
                const tarjeta = line.substring(56, 72).trim();
                const empresa = line.substring(72, 113).trim();
                const cant = empresaCounts[empresa] || 0;

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${cedula}</td>
                    <td>${tarjeta}</td>
                    <td>${empresa}</td>
                    <td>${cant}</td>
                `;
                tableBody.appendChild(row);
                rowCount++;
            }
        });

        // Mostrar barra superior con contador
        document.getElementById('topActions').style.display = 'flex';
        document.getElementById('resultsCount').textContent = `${rowCount} registros cargados`;
    };
    reader.readAsText(file);
}

function clearTable() {
    document.getElementById('dataBody').innerHTML = '';
    document.getElementById('fileInput').value = '';
    document.getElementById('topActions').style.display = 'none';
    document.getElementById('resultsCount').textContent = '0 registros';
    resetDropZone();
}

// ==========================================
// EXPORTAR A EXCEL
// ==========================================
document.getElementById('exportButton').addEventListener('click', function () {
    exportToExcel('Archivo_CB_Separado.xlsx');
});

function exportToExcel(filename = '') {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];

    if (!file) {
        alert("Por favor selecciona un archivo");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const fileContent = event.target.result;
        const lines = fileContent.split('\n');

        // Hoja Original
        const originalData = [];
        const empresaCounts = {};
        lines.forEach((line, index) => {
            if (line.trim()) {
                const cedula = line.substring(42, 54).trim().replace(/^0+/, '');
                const tarjeta = line.substring(56, 72).trim();
                const empresa = line.substring(72, 113).trim();
                empresaCounts[empresa] = (empresaCounts[empresa] || 0) + 1;

                originalData.push([index + 1, cedula, tarjeta, empresa, empresaCounts[empresa]]);
            }
        });

        // Hoja SinDuplicados
        const uniqueData = [];
        const seenEmpresas = new Set();
        lines.forEach((line, index) => {
            if (line.trim()) {
                const cedula = line.substring(42, 54).trim().replace(/^0+/, '');
                const tarjeta = line.substring(56, 72).trim();
                const empresa = line.substring(72, 113).trim();

                if (!seenEmpresas.has(empresa)) {
                    const cant = empresaCounts[empresa] || 0;
                    uniqueData.push([index + 1, cedula, tarjeta, empresa, cant]);
                    seenEmpresas.add(empresa);
                }
            }
        });

        const wb = XLSX.utils.book_new();
        const wsOriginal = XLSX.utils.aoa_to_sheet([['No', 'CEDULA', 'TARJETA', 'EMPRESA', 'CANT'], ...originalData]);
        const wsUnique = XLSX.utils.aoa_to_sheet([['No', 'CEDULA', 'TARJETA', 'EMPRESA', 'CANT'], ...uniqueData]);

        // Estilos de encabezado
        const centerAlign = { alignment: { horizontal: 'center' } };
        const headerRange = { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } };

        for (let i = headerRange.s.c; i <= headerRange.e.c; i++) {
            const cell = wsOriginal[XLSX.utils.encode_cell({ r: 0, c: i })];
            const uniqueCell = wsUnique[XLSX.utils.encode_cell({ r: 0, c: i })];
            if (cell) cell.s = { ...cell.s, ...centerAlign };
            if (uniqueCell) uniqueCell.s = { ...uniqueCell.s, ...centerAlign };
        }

        XLSX.utils.book_append_sheet(wb, wsOriginal, 'Original');
        XLSX.utils.book_append_sheet(wb, wsUnique, 'SinDuplicados');

        XLSX.writeFile(wb, filename);
    };
    reader.readAsText(file);
}