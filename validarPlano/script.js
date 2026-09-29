'use strict';

// =====================================================================
// VALIDADOR DE ARCHIVO PLANO DE PAGOS BANCOLOMBIA (formato PAB, 264 posiciones)
// ---------------------------------------------------------------------
// El archivo se analiza BYTE A BYTE, porque así lo lee el banco:
// 1 byte = 1 posición. Una "Ñ" guardada en UTF-8 ocupa 2 bytes
// (el banco la ve como "Ã‘") y eso corre o invalida la línea.
// =====================================================================

// ===== VARIABLES GLOBALES =====
let fileBytes = null;   // contenido original del archivo (Uint8Array)
let fileName = '';
let lastResult = null;  // último resultado de validación

// =====================================================================
// 1. ESTRUCTURA DEL ARCHIVO
// =====================================================================
const LINE_LENGTH = 264;        // longitud fija de TODAS las líneas
const EXPECTED_EOL = 'CRLF';    // salto de línea Windows (\r\n)
const MAX_SHIFT = 15;           // desplazamiento máximo que se intenta detectar
const MAX_ISSUES_PER_LINE = 25; // evita inundar el reporte si la línea está muy dañada
const MAX_ROWS_RENDERED = 3000; // filas máximas en la tabla (el CSV trae todas)

// Caracteres permitidos (solo ASCII). Sin tildes, sin eñes, sin símbolos.
const CH_DIGIT = /^[0-9]$/;
const CH_DIGIT_SPACE = /^[0-9 ]$/;
const CH_SPACE = /^ $/;
const CH_TEXT = /^[A-Za-z0-9 \-\/\\:]$/;       // nombres y referencias
const CH_EMAIL = /^[A-Za-z0-9@._\- ]$/;
const CH_UPPER_ALNUM_SPACE = /^[A-Z0-9 ]$/;
const TEXT_CHARS_DESC = 'letras A-Z sin tilde, números, espacio y - / \\ :';

function isValidDate(v) {
    if (!/^\d{8}$/.test(v)) return false;
    const y = +v.slice(0, 4), m = +v.slice(4, 6), d = +v.slice(6, 8);
    if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1) return false;
    return d <= new Date(y, m, 0).getDate();
}

// Tipos de campo: caracteres permitidos + regla de formato
const KINDS = {
    const: {
        chars: /^[\s\S]$/, charsDesc: 'valor fijo',
        check: (v, f) => v === f.value ? null : { expected: `"${f.value}"`, message: `El campo debe contener exactamente "${f.value}".` }
    },
    digits: {
        chars: CH_DIGIT, charsDesc: 'solo números',
        check: (v, f) => /^\d+$/.test(v) ? null : { expected: `${f.length} dígitos, rellenos con ceros a la izquierda`, message: 'El campo numérico debe tener solo dígitos, completado con ceros a la izquierda.' }
    },
    digitsLeft: {
        chars: CH_DIGIT_SPACE, charsDesc: 'solo números y espacios de relleno a la derecha',
        check: (v, f) => {
            if (/^ *$/.test(v)) return { expected: `número alineado a la izquierda (${f.length} posiciones)`, message: 'Campo obligatorio vacío.' };
            if (v[0] === ' ') return { expected: 'el número debe iniciar en la primera posición del campo', message: 'El número tiene espacios al inicio: debe ir alineado a la izquierda y completado con espacios a la derecha.' };
            if (!/^\d+ *$/.test(v)) return { expected: 'dígitos seguidos, sin espacios intermedios', message: 'Hay espacios en medio del número.' };
            return null;
        }
    },
    digitsLeftOpt: {
        chars: CH_DIGIT_SPACE, charsDesc: 'números alineados a la izquierda o espacios', blankOk: true,
        check: (v) => /^(\d+ *| *)$/.test(v) ? null : { expected: 'vacío (espacios) o número alineado a la izquierda', message: 'El número debe iniciar en la primera posición del campo, sin espacios intermedios.' }
    },
    blank: {
        chars: CH_SPACE, charsDesc: 'solo espacios', blankOk: true,
        check: (v, f) => /^ *$/.test(v) ? null : { expected: `${f.length} espacios en blanco`, message: 'Este campo es de relleno y debe estar en blanco.' }
    },
    date: {
        chars: CH_DIGIT, charsDesc: 'fecha AAAAMMDD',
        check: (v) => isValidDate(v) ? null : { expected: 'fecha válida AAAAMMDD', message: 'La fecha no es válida (formato AAAAMMDD).' }
    },
    bank: {
        chars: CH_DIGIT, charsDesc: 'solo números',
        check: (v) => /^0{5}\d{4}$/.test(v) ? null : { expected: '9 dígitos: 5 ceros + código de banco de 4 dígitos (ej. 000001007)', message: 'El código de banco no tiene el formato esperado.' }
    },
    name: {
        chars: CH_TEXT, charsDesc: TEXT_CHARS_DESC,
        check: (v) => {
            if (/^ *$/.test(v)) return { expected: 'nombre del beneficiario', message: 'Campo obligatorio vacío.' };
            if (v[0] === ' ') return { expected: 'texto alineado a la izquierda', message: 'El texto tiene espacios al inicio del campo.' };
            return null;
        }
    },
    text: {
        chars: CH_TEXT, charsDesc: TEXT_CHARS_DESC, blankOk: true,
        check: (v) => (/^ *$/.test(v) || v[0] !== ' ') ? null : { expected: 'texto alineado a la izquierda', message: 'El texto tiene espacios al inicio del campo.' }
    },
    email: {
        chars: CH_EMAIL, charsDesc: 'letras sin tilde, números y @ . _ -', blankOk: true,
        check: (v) => (/^ *$/.test(v) || /^[^ ]+@[^ ]+\.[^ ]+ *$/.test(v)) ? null : { expected: 'vacío o un correo válido alineado a la izquierda', message: 'El correo no tiene un formato válido.' }
    },
    oneOf: {
        chars: /^[\s\S]$/, charsDesc: 'valor de una lista',
        check: (v, f) => f.values.includes(v) ? null : { expected: f.values.map(x => `"${x}"`).join(' o '), message: `Valor no permitido. ${f.valuesDesc || ''}`.trim() }
    },
    pattern: {
        chars: /^[\s\S]$/, charsDesc: '',
        check: (v, f) => f.re.test(v) ? null : { expected: f.expectedDesc, message: f.patternMsg }
    }
};

function F(key, name, start, length, kind, opts = {}) {
    const k = KINDS[kind];
    return Object.assign({ key, name, start, length, end: start + length - 1, kind }, k, opts);
}

// Estructura deducida del archivo de ejemplo (coincide con el formato PAB de Bancolombia)
const LAYOUT = {
    '1': {
        name: 'ENCABEZADO',
        fields: [
            F('tipo', 'TIPO DE REGISTRO', 1, 1, 'const', { value: '1' }),
            F('nitPagador', 'NIT PAGADOR', 2, 15, 'digits'),
            F('aplicacion', 'TIPO DE APLICACIÓN', 17, 1, 'oneOf', { values: ['I', 'M', 'N'], valuesDesc: 'I = inmediata, M = medio día, N = noche.' }),
            F('filler1', 'RELLENO', 18, 15, 'blank'),
            F('clase', 'CLASE DE TRANSACCIÓN', 33, 3, 'digits'),
            F('descripcion', 'DESCRIPCIÓN / PROPÓSITO', 36, 10, 'text'),
            F('fechaTransmision', 'FECHA DE TRANSMISIÓN', 46, 8, 'date'),
            F('secuencia', 'SECUENCIA DE ENVÍO', 54, 2, 'pattern', { re: /^[A-Z0-9][A-Z0-9 ]$/, expectedDesc: 'letra o número (ej. "A ")', patternMsg: 'La secuencia debe ser una letra mayúscula o número.', chars: CH_UPPER_ALNUM_SPACE }),
            F('fechaAplicacion', 'FECHA DE APLICACIÓN', 56, 8, 'date'),
            F('numRegistros', 'NÚMERO DE REGISTROS', 64, 6, 'digits'),
            F('totalDebitos', 'SUMATORIA DE DÉBITOS', 70, 17, 'digits'),
            F('totalCreditos', 'SUMATORIA DE CRÉDITOS', 87, 17, 'digits'),
            F('cuentaDebitar', 'CUENTA A DEBITAR', 104, 11, 'digits'),
            F('tipoCuenta', 'TIPO DE CUENTA A DEBITAR', 115, 1, 'oneOf', { values: ['S', 'D'], valuesDesc: 'S = ahorros, D = corriente.' }),
            F('filler2', 'RELLENO', 116, 149, 'blank')
        ]
    },
    '6': {
        name: 'DETALLE',
        fields: [
            F('tipo', 'TIPO DE REGISTRO', 1, 1, 'const', { value: '6' }),
            F('nit', 'IDENTIFICACIÓN BENEFICIARIO', 2, 15, 'digitsLeft'),
            F('nombre', 'NOMBRE DEL BENEFICIARIO', 17, 30, 'name'),
            F('banco', 'CÓDIGO BANCO DESTINO', 47, 9, 'bank'),
            F('cuenta', 'NÚMERO DE CUENTA', 56, 17, 'digitsLeft'),
            F('lugarPago', 'INDICADOR LUGAR DE PAGO', 73, 1, 'pattern', { re: /^[ A-Z0-9]$/, expectedDesc: 'espacio, letra o número', patternMsg: 'Valor no permitido.', chars: CH_UPPER_ALNUM_SPACE }),
            F('tipoTransaccion', 'TIPO DE TRANSACCIÓN', 74, 2, 'digits'),
            F('valor', 'VALOR (2 decimales implícitos)', 76, 17, 'digits'),
            F('fechaAplicacion', 'FECHA DE APLICACIÓN', 93, 8, 'date'),
            F('referencia', 'REFERENCIA', 101, 21, 'text'),
            F('tipoDocumento', 'TIPO DE DOCUMENTO', 122, 1, 'pattern', { re: /^[0-9 ]$/, expectedDesc: 'un dígito (ej. 1 = cédula)', patternMsg: 'Debe ser un dígito.', chars: CH_DIGIT_SPACE }),
            F('oficina', 'OFICINA DE ENTREGA', 123, 5, 'digitsLeftOpt'),
            F('fax', 'NÚMERO DE FAX', 128, 15, 'digitsLeftOpt'),
            F('email', 'CORREO ELECTRÓNICO', 143, 80, 'email'),
            F('idAutorizado', 'IDENTIFICACIÓN AUTORIZADO', 223, 15, 'digitsLeftOpt'),
            F('filler', 'RELLENO', 238, 27, 'blank')
        ]
    }
};

// =====================================================================
// 2. UTILIDADES DE CARACTERES Y CODIFICACIÓN
// =====================================================================
const DEC_UTF8_FATAL = new TextDecoder('utf-8', { fatal: true });
const DEC_UTF8 = new TextDecoder('utf-8');
const DEC_1252 = new TextDecoder('windows-1252');

const CHAR_NAMES = {
    0x00: 'carácter nulo', 0x09: 'tabulación', 0x0A: 'salto de línea (LF) suelto', 0x0D: 'retorno de carro (CR) suelto',
    0x1A: 'fin de archivo (Ctrl+Z)', 0x7F: 'carácter de control DEL', 0xA0: 'espacio de no separación (invisible, parece un espacio)',
    0xAD: 'guion suave (invisible)', 0x200B: 'espacio de ancho cero (invisible)', 0x200C: 'carácter invisible de ancho cero',
    0x200D: 'carácter invisible de ancho cero', 0x2060: 'carácter invisible de ancho cero', 0xFEFF: 'marca BOM / espacio invisible',
    0x2013: 'guion medio tipográfico', 0x2014: 'guion largo tipográfico', 0x2018: 'comilla tipográfica', 0x2019: 'apóstrofo tipográfico',
    0x201C: 'comilla doble tipográfica', 0x201D: 'comilla doble tipográfica', 0x2026: 'puntos suspensivos', 0xFFFD: 'carácter dañado (byte inválido)',
    0x00B4: 'tilde suelta', 0x00A8: 'diéresis suelta', 0x00B0: 'símbolo de grado', 0x00BA: 'ordinal º', 0x00AA: 'ordinal ª'
};

const REPLACEMENTS = {
    0x09: ' ', 0xA0: ' ', 0x2013: '-', 0x2014: '-', 0x2018: '', 0x2019: '', 0x201C: '', 0x201D: '', 0x00B4: '', 0x00A8: '',
    0xAD: '', 0x200B: '', 0x200C: '', 0x200D: '', 0x2060: '', 0xFEFF: '', 0x00BA: '', 0x00AA: '', 0x00B0: ''
};

function hex(b) { return b.toString(16).toUpperCase().padStart(2, '0'); }

function codePointLabel(ch) {
    const cp = ch.codePointAt(0);
    return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}

function describeChar(ch) {
    const cp = ch.codePointAt(0);
    if (CHAR_NAMES[cp]) return CHAR_NAMES[cp];
    if (cp < 0x20) return 'carácter de control invisible';
    if (/[À-ſ]/.test(ch)) {
        if (/[ñÑ]/.test(ch)) return 'eñe';
        return 'letra con tilde o acento';
    }
    return 'símbolo o carácter especial';
}

function suggestReplacement(ch) {
    const cp = ch.codePointAt(0);
    if (cp in REPLACEMENTS) return REPLACEMENTS[cp];
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/^[A-Za-z0-9]$/.test(base)) return base;
    return null;
}

// Posición visible en un editor (Bloc de notas / Notepad++) para la posición en bytes
function editorColumn(bytes, bytePos, isUtf8) {
    if (!isUtf8) return bytePos + 1;
    let col = 1;
    for (let i = 0; i < bytePos; i++) if ((bytes[i] & 0xC0) !== 0x80) col++;
    return col;
}

function utf8SeqLength(b) {
    if (b >= 0xF0) return 4;
    if (b >= 0xE0) return 3;
    if (b >= 0xC0) return 2;
    return 1;
}

function bytesToBankString(bytes) {
    // Cada byte -> un carácter (vista del banco: 1 byte = 1 posición)
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

// =====================================================================
// 3. MOTOR DE VALIDACIÓN (no depende de la página, se puede probar aparte)
// =====================================================================
function validatePlano(input) {
    let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const issues = [];
    const lines = [];
    const stats = { encoding: 'ASCII', eol: '-', totalLines: 0, headerCount: 0, detailCount: 0, sumDetail: 0n, bom: false };

    const add = (o) => issues.push(Object.assign({ severity: 'error', line: null, pos: null, endPos: null, col: null, field: '', category: '', found: '', expected: '', message: '', fix: '' }, o));

    if (bytes.length === 0) {
        add({ category: 'Archivo', message: 'El archivo está vacío.' });
        return { issues, lines, stats, header: null };
    }

    // --- BOM ---
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        stats.bom = true;
        add({
            line: 1, pos: 1, endPos: 3, col: 1, category: 'Codificación', field: 'INICIO DEL ARCHIVO',
            found: 'BOM UTF-8 (bytes EF BB BF, invisible)', expected: 'el archivo debe iniciar directamente con "1"',
            message: 'El archivo tiene una marca invisible (BOM) al inicio. El banco la lee como 3 caracteres extra y corre toda la primera línea.',
            fix: 'Guarde el archivo como "ANSI" o "UTF-8 sin BOM" (en Notepad++: Codificación > Codificar en ANSI).'
        });
        bytes = bytes.subarray(3);
    }

    // --- Codificación ---
    let hasNonAscii = false;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) { hasNonAscii = true; break; }
    let isUtf8 = false;
    if (hasNonAscii) {
        try { DEC_UTF8_FATAL.decode(bytes); isUtf8 = true; stats.encoding = 'UTF-8'; }
        catch (e) { stats.encoding = 'ANSI (Windows-1252)'; }
    }

    // --- División en líneas (por bytes) ---
    const raw = [];
    let lfCount = 0, crCount = 0;
    for (let i = 0; i < bytes.length; i++) { if (bytes[i] === 0x0A) lfCount++; else if (bytes[i] === 0x0D) crCount++; }
    if (lfCount === 0 && crCount > 0) {
        // saltos tipo Mac antiguo (solo CR)
        let start = 0;
        for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0D) { raw.push({ bytes: bytes.subarray(start, i), eol: 'CR' }); start = i + 1; }
        if (start < bytes.length) raw.push({ bytes: bytes.subarray(start), eol: 'NONE' });
    } else {
        let start = 0;
        for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] === 0x0A) {
                let end = i, eol = 'LF';
                if (end > start && bytes[end - 1] === 0x0D) { end--; eol = 'CRLF'; }
                raw.push({ bytes: bytes.subarray(start, end), eol });
                start = i + 1;
            }
        }
        if (start < bytes.length) raw.push({ bytes: bytes.subarray(start), eol: 'NONE' });
    }

    // Líneas vacías al final
    let lastContent = raw.length - 1;
    while (lastContent >= 0 && raw[lastContent].bytes.length === 0) lastContent--;
    const trailingEmpty = raw.length - 1 - lastContent;
    if (trailingEmpty > 0) {
        add({
            line: lastContent + 2, category: 'Líneas vacías', field: 'FINAL DEL ARCHIVO',
            found: `${trailingEmpty} línea(s) vacía(s) al final`, expected: 'el archivo termina justo después del salto de línea del último registro',
            message: 'Hay líneas vacías (Enter de más) al final del archivo. El banco puede interpretarlas como registros inválidos.',
            fix: 'Borre las líneas vacías después del último registro.'
        });
    }

    const eolCount = { CRLF: 0, LF: 0, CR: 0 };
    raw.slice(0, lastContent + 1).forEach(r => { if (r.eol in eolCount) eolCount[r.eol]++; });
    stats.eol = Object.entries(eolCount).filter(([, n]) => n > 0).map(([k, n]) => `${k} (${n})`).join(', ') || 'sin saltos';

    let headerData = null;
    const details = [];

    for (let idx = 0; idx <= lastContent; idx++) {
        const r = raw[idx];
        const lineNo = idx + 1;
        const lb = r.bytes;
        const s = bytesToBankString(lb);
        const lineInfo = { lineNo, bytes: lb, type: s[0] || '', shift: 0, shiftFrom: -1, hasError: false, isUtf8 };
        lines.push(lineInfo);
        stats.totalLines++;
        let count = 0;
        const addLine = (o) => {
            if (o.severity !== 'warning') lineInfo.hasError = true;
            if (count === MAX_ISSUES_PER_LINE) {
                add({ line: lineNo, category: 'Resumen', message: `La línea tiene demasiados errores; se muestran los primeros ${MAX_ISSUES_PER_LINE}. Revise la línea completa.` });
            }
            count++;
            if (count > MAX_ISSUES_PER_LINE) return;
            if (o.pos && !o.col) o.col = editorColumn(lb, o.pos - 1, isUtf8);
            add(Object.assign({ line: lineNo }, o));
        };

        // --- Salto de línea ---
        if (r.eol !== EXPECTED_EOL) {
            if (r.eol === 'NONE') {
                addLine({
                    severity: 'warning', pos: lb.length + 1, category: 'Salto de línea', field: 'FIN DE LÍNEA',
                    found: 'sin salto de línea', expected: 'CRLF (Enter de Windows)',
                    message: 'La última línea no termina con salto de línea. El archivo original del banco sí lo trae.',
                    fix: 'Presione Enter al final del último registro (una sola vez).'
                });
            } else {
                addLine({
                    pos: lb.length + 1, category: 'Salto de línea', field: 'FIN DE LÍNEA',
                    found: r.eol === 'LF' ? 'LF (formato Unix/Linux)' : 'CR (formato Mac antiguo)', expected: 'CRLF (formato Windows)',
                    message: 'La línea usa un tipo de salto de línea diferente al resto del formato bancario.',
                    fix: 'En Notepad++: Editar > Conversión fin de línea > Windows (CR LF).'
                });
            }
        }

        // --- Línea vacía o solo espacios ---
        if (lb.length === 0 || /^ +$/.test(s)) {
            addLine({
                category: 'Línea vacía', field: 'LÍNEA COMPLETA', found: lb.length === 0 ? 'línea vacía' : `${lb.length} espacios`,
                expected: `registro de ${LINE_LENGTH} posiciones`, message: 'Hay una línea sin información en medio del archivo.',
                fix: 'Elimine la línea vacía.'
            });
            continue;
        }

        // --- Caracteres no permitidos (no ASCII, de control, invisibles) ---
        const bad = new Set();
        for (let p = 0; p < lb.length; p++) {
            const b = lb[p];
            if (b >= 0x20 && b <= 0x7E) continue;
            let len = 1, ch, bytesHex, bankSees;
            if (b >= 0x80) {
                if (isUtf8) {
                    len = Math.min(utf8SeqLength(b), lb.length - p);
                    ch = DEC_UTF8.decode(lb.subarray(p, p + len));
                } else {
                    ch = DEC_1252.decode(lb.subarray(p, p + 1));
                }
                bankSees = DEC_1252.decode(lb.subarray(p, p + len));
            } else {
                ch = String.fromCharCode(b);
            }
            bytesHex = Array.from(lb.subarray(p, p + len), hex).join(' ');
            for (let q = p; q < p + len; q++) bad.add(q);
            const f = fieldAt(s[0], p + 1);
            const repl = suggestReplacement(ch);
            const printable = (b >= 0x80 && !/[​-‍⁠﻿ ­]/.test(ch)) ? ch : '';
            let msg = `Se encontró ${printable ? `el carácter "${printable}"` : 'un carácter'} (${describeChar(ch)}, ${codePointLabel(ch)}, bytes ${bytesHex}). El archivo bancario solo permite caracteres ASCII básicos.`;
            if (bankSees && len > 1) msg += ` El banco lo lee como "${bankSees}" (${len} posiciones en vez de 1).`;
            let fix = repl === null ? 'Elimine este carácter o reemplácelo por uno permitido.' :
                repl === '' ? 'Elimine este carácter.' :
                    repl === ' ' ? 'Reemplácelo por un espacio normal.' : `Reemplácelo por "${repl}".`;
            if (len > 1) {
                const diff = len - (repl === '' ? 0 : 1);
                if (diff > 0) fix += ` Como en UTF-8 ocupa ${len} bytes, al corregirlo la línea quedará con ${pl(diff, 'posición', 'posiciones')} menos: agregue ${pl(diff, 'espacio', 'espacios')} al final del campo ${f ? f.name : ''} para conservar su longitud; si no, la línea quedará corrida.`;
            }
            addLine({
                pos: p + 1, endPos: p + len, category: b < 0x80 ? 'Carácter invisible / control' : 'Carácter no permitido',
                field: f ? `${f.name} (${f.start}-${f.end})` : '', found: printable ? `"${printable}"` : describeChar(ch),
                expected: f ? f.charsDesc : 'caracteres ASCII', message: msg, fix
            });
            p += len - 1;
        }

        // --- Tipo de registro ---
        const type = s[0];
        const rec = LAYOUT[type];
        if (!rec) {
            addLine({
                pos: 1, category: 'Tipo de registro', field: 'TIPO DE REGISTRO (1)', found: `"${type}"`,
                expected: lineNo === 1 ? '"1" (encabezado)' : '"6" (detalle)',
                message: 'La línea no inicia con un tipo de registro válido; no se puede identificar su estructura. Puede ser una línea corrida o partida en dos.',
                fix: 'Verifique que la línea inicie con 1 (encabezado) o 6 (detalle).'
            });
            checkLength(s, lb, addLine, null);
            continue;
        }
        if (type === '1') {
            stats.headerCount++;
            if (lineNo !== 1) {
                addLine({
                    pos: 1, category: 'Tipo de registro', field: 'TIPO DE REGISTRO (1)', found: '"1" (encabezado)', expected: '"6" (detalle)',
                    message: 'Solo puede haber un encabezado y debe estar en la línea 1.', fix: 'Elimine o corrija el encabezado duplicado.'
                });
            }
        } else if (lineNo === 1) {
            addLine({
                pos: 1, category: 'Tipo de registro', field: 'TIPO DE REGISTRO (1)', found: `"${type}"`, expected: '"1" (encabezado)',
                message: 'La primera línea debe ser el registro de encabezado (tipo 1).', fix: 'Agregue o mueva el encabezado a la primera línea.'
            });
        }

        // --- Validación de campos y detección de líneas corridas ---
        const fields = rec.fields;
        const evals = fields.map(f => evalField(f, s, 0, bad));
        let firstFail = evals.findIndex(e => !e.ok);
        const offsets = fields.map(() => 0);
        let structureHandled = false;

        if (firstFail !== -1 || s.length !== LINE_LENGTH) {
            // Caso A: faltan espacios de relleno al final (editor que borró espacios finales)
            if (s.length < LINE_LENGTH && trailingPaddingMissing(fields, evals, s)) {
                const missing = LINE_LENGTH - s.length;
                addLine({
                    pos: s.length + 1, endPos: LINE_LENGTH, category: 'Longitud de línea', field: fieldAt(type, s.length + 1)?.name || '',
                    found: `${s.length} caracteres`, expected: `${LINE_LENGTH} caracteres`,
                    message: `Línea incompleta: se esperaban ${LINE_LENGTH} caracteres, pero la línea contiene ${s.length}. Faltan ${missing} espacios de relleno al final (los datos están bien ubicados).`,
                    fix: `Agregue ${missing} espacios al final de la línea. Suele ocurrir cuando un editor o Excel elimina los espacios finales.`
                });
                structureHandled = true;
            } else if (firstFail > 0) {
                // Caso B: línea corrida
                const k = findShift(fields, s, bad, firstFail);
                if (k !== null) {
                    const prev = fields[firstFail - 1];
                    const cur = fields[firstFail];
                    const foundLen = prev.length + k;
                    const foundVal = s.substr(prev.start - 1, foundLen);
                    lineInfo.shift = k; lineInfo.shiftFrom = firstFail;
                    for (let j = firstFail; j < fields.length; j++) offsets[j] = k;
                    const dir = k < 0 ? 'izquierda' : 'derecha';
                    addLine({
                        pos: cur.start, category: 'Línea corrida', field: `${prev.name} (${prev.start}-${prev.end})`,
                        found: `${foundLen} caracteres: "${visibleSpaces(foundVal)}"`, expected: `${prev.length} caracteres`,
                        message: `Estructura incorrecta. El desplazamiento comienza en la posición ${cur.start}: el campo ${cur.name} debería iniciar en la posición ${cur.start} pero inicia en la ${cur.start + k}. ` +
                            `Todos los campos siguientes quedan corridos ${pl(Math.abs(k), 'posición', 'posiciones')} a la ${dir}. Campo afectado: ${prev.name} — longitud esperada ${prev.length}, longitud encontrada ${foundLen}.`,
                        fix: k < 0
                            ? `Al campo ${prev.name} le ${-k === 1 ? 'falta' : 'faltan'} ${pl(-k, 'carácter', 'caracteres')}. Complételo con ${prev.kind === 'digits' ? 'ceros a la izquierda' : 'espacios a la derecha'} hasta ${prev.length} posiciones.`
                            : `El campo ${prev.name} tiene ${pl(k, 'carácter', 'caracteres')} de más. Recórtelo a ${prev.length} posiciones.`
                    });
                    // errores de los campos anteriores al desplazamiento (si los hay) se reportan abajo
                    structureHandled = true;
                }
            }
        }

        // Reporte campo por campo (con el desplazamiento aplicado si se detectó)
        fields.forEach((f, j) => {
            const e = offsets[j] === 0 ? evals[j] : evalField(f, s, offsets[j], bad);
            if (e.ok) return;
            if (structureHandled && e.incomplete) return; // ya explicado por la línea corrida / relleno
            if (e.incomplete && f.start > s.length) return; // campo inexistente: lo explica el error de longitud
            e.charIssues.forEach(ci => {
                addLine({
                    pos: ci.pos + 1, category: 'Carácter no permitido', field: `${f.name} (${f.start}-${f.end})`,
                    found: `"${visibleSpaces(ci.ch)}"`, expected: f.charsDesc,
                    message: `Se encontró el carácter "${visibleSpaces(ci.ch)}" en el campo ${f.name}, que solo admite: ${f.charsDesc}.`,
                    fix: CH_TEXT.test(ci.ch) || ci.ch === ' ' ? 'Corrija el valor del campo; puede ser un síntoma de línea corrida.' : 'Elimine o reemplace el carácter.'
                });
            });
            if (e.incomplete) {
                addLine({
                    pos: f.start + offsets[j], endPos: f.end + offsets[j], category: 'Longitud de línea', field: `${f.name} (${f.start}-${f.end})`,
                    found: `"${visibleSpaces(e.raw)}" (${e.raw.length} caracteres)`, expected: `${f.length} caracteres`,
                    message: `El campo ${f.name} está incompleto porque la línea termina antes de tiempo.`,
                    fix: 'Complete la línea hasta 264 posiciones.'
                });
            } else if (e.fmt) {
                addLine({
                    pos: f.start + offsets[j], endPos: f.end + offsets[j], category: 'Formato de campo', field: `${f.name} (${f.start}-${f.end})`,
                    found: `"${visibleSpaces(e.raw)}"`, expected: e.fmt.expected, message: e.fmt.message,
                    fix: firstFail === j && !structureHandled ? 'Corrija el valor respetando la longitud del campo. Si el valor parece "partido", revise el campo anterior (posible línea corrida).' : 'Corrija el valor respetando la longitud del campo.'
                });
            }
        });

        // Longitud total
        if (!structureHandled || lineInfo.shift !== 0) checkLength(s, lb, addLine, lineInfo);

        // --- Datos para validaciones cruzadas ---
        const val = (key) => {
            const j = fields.findIndex(f => f.key === key);
            const f = fields[j];
            return s.substr(f.start - 1 + offsets[j], f.length);
        };
        if (type === '1' && lineNo === 1) {
            headerData = {
                nitPagador: val('nitPagador'), aplicacion: val('aplicacion'), clase: val('clase'),
                fechaTransmision: val('fechaTransmision'), fechaAplicacion: val('fechaAplicacion'),
                numRegistros: val('numRegistros'), totalDebitos: val('totalDebitos'), totalCreditos: val('totalCreditos'),
                cuentaDebitar: val('cuentaDebitar'), tipoCuenta: val('tipoCuenta')
            };
            if (isValidDate(headerData.fechaTransmision) && isValidDate(headerData.fechaAplicacion) && headerData.fechaAplicacion < headerData.fechaTransmision) {
                addLine({
                    severity: 'warning', pos: 56, endPos: 63, category: 'Consistencia', field: 'FECHA DE APLICACIÓN (56-63)',
                    found: headerData.fechaAplicacion, expected: `igual o posterior a ${headerData.fechaTransmision}`,
                    message: 'La fecha de aplicación es anterior a la fecha de transmisión.', fix: 'Verifique las fechas del encabezado.'
                });
            }
        } else if (type === '6') {
            stats.detailCount++;
            const d = { lineNo, nit: val('nit').trim(), cuenta: val('cuenta').trim(), valor: val('valor'), fecha: val('fechaAplicacion'), trans: val('tipoTransaccion'), nombre: val('nombre') };
            details.push(d);
            if (/^\d{17}$/.test(d.valor)) {
                stats.sumDetail += BigInt(d.valor);
                if (BigInt(d.valor) === 0n) {
                    addLine({ pos: 76, endPos: 92, category: 'Formato de campo', field: 'VALOR (76-92)', found: d.valor, expected: 'valor mayor a cero', message: 'El pago tiene valor cero.', fix: 'Corrija el valor o elimine el registro.' });
                }
            }
            if (/^\d{2}$/.test(d.trans) && !['27', '37'].includes(d.trans)) {
                addLine({
                    severity: 'warning', pos: 74, endPos: 75, category: 'Consistencia', field: 'TIPO DE TRANSACCIÓN (74-75)', found: `"${d.trans}"`,
                    expected: '"37" (abono a cuenta de ahorros) o "27" (abono a cuenta corriente)', message: 'Tipo de transacción poco común. Verifique que sea correcto.', fix: ''
                });
            }
            const dbl = lineInfo.shift === 0 ? / {2,}(?=\S)/.exec(d.nombre) : null;
            if (dbl) {
                addLine({
                    severity: 'warning', pos: 17 + dbl.index, endPos: 16 + dbl.index + dbl[0].length, category: 'Espacios', field: 'NOMBRE DEL BENEFICIARIO (17-46)', found: `"${visibleSpaces(d.nombre.trimEnd())}"`,
                    expected: 'un solo espacio entre palabras', message: 'El nombre tiene espacios dobles entre palabras (no corre la línea, pero conviene revisarlo).', fix: 'Deje un solo espacio y complete con espacios al final del campo.'
                });
            }
        }
    }

    // =================== VALIDACIONES CRUZADAS ===================
    stats.headerData = headerData;
    if (stats.headerCount === 0) {
        add({ category: 'Encabezado', message: 'El archivo no tiene registro de encabezado (línea tipo 1).', expected: 'línea 1 con tipo de registro "1"', fix: 'Agregue el encabezado generado por el sistema.' });
    }
    if (headerData) {
        const hc = headerData;
        if (/^\d{6}$/.test(hc.numRegistros) && +hc.numRegistros !== stats.detailCount) {
            add({
                line: 1, pos: 64, endPos: 69, col: 64, category: 'Totales', field: 'NÚMERO DE REGISTROS (64-69)', found: hc.numRegistros,
                expected: String(stats.detailCount).padStart(6, '0'),
                message: `El encabezado indica ${+hc.numRegistros} registros, pero el archivo tiene ${stats.detailCount} líneas de detalle.`,
                fix: 'Verifique que no falten ni sobren líneas, o corrija el encabezado.'
            });
        }
        if (/^\d{17}$/.test(hc.totalCreditos) && BigInt(hc.totalCreditos) !== stats.sumDetail) {
            add({
                line: 1, pos: 87, endPos: 103, col: 87, category: 'Totales', field: 'SUMATORIA DE CRÉDITOS (87-103)', found: `${hc.totalCreditos} (${formatMoney(BigInt(hc.totalCreditos))})`,
                expected: `${stats.sumDetail.toString().padStart(17, '0')} (${formatMoney(stats.sumDetail)})`,
                message: 'La suma de los valores de las líneas de detalle no coincide con el total del encabezado.',
                fix: 'Revise si hay líneas corridas (valor mal leído), registros faltantes o duplicados.'
            });
        }
        details.forEach(d => {
            if (isValidDate(d.fecha) && d.fecha !== hc.fechaAplicacion) {
                add({
                    severity: 'warning', line: d.lineNo, pos: 93, endPos: 100, col: 93, category: 'Consistencia', field: 'FECHA DE APLICACIÓN (93-100)',
                    found: d.fecha, expected: hc.fechaAplicacion, message: 'La fecha de aplicación del registro es diferente a la del encabezado.', fix: 'Verifique la fecha.'
                });
            }
        });
    }
    const seen = new Map();
    details.forEach(d => {
        if (!d.nit || !d.cuenta) return;
        const key = d.nit + '|' + d.cuenta;
        if (seen.has(key)) {
            add({
                severity: 'warning', line: d.lineNo, pos: 2, col: 2, category: 'Posible duplicado', field: 'IDENTIFICACIÓN + CUENTA',
                found: `${d.nit} / cuenta ${d.cuenta}`, expected: 'un pago por beneficiario y cuenta',
                message: `Este beneficiario y cuenta ya aparecen en la línea ${seen.get(key)}. Puede ser un pago duplicado.`, fix: 'Confirme que el pago doble es intencional.'
            });
        } else seen.set(key, d.lineNo);
    });

    issues.sort((a, b) => (a.line || 0) - (b.line || 0) || (a.pos || 0) - (b.pos || 0));
    return { issues, lines, stats, header: headerData };
}

// Evalúa un campo leyendo la línea con un desplazamiento (offset)
function evalField(f, s, offset, bad) {
    const st = f.start - 1 + offset;
    const raw = st >= 0 ? s.substr(st, f.length) : '';
    const charIssues = [];
    let masked = '';
    const filler = ['A', '0', ' '].find(c => f.chars.test(c)) || 'A';
    for (let i = 0; i < raw.length; i++) {
        const p = st + i, ch = raw[i];
        if (bad.has(p)) { masked += filler; continue; } // ya reportado como carácter no permitido
        if (!f.chars.test(ch)) charIssues.push({ pos: p, ch });
        masked += ch;
    }
    if (raw.length < f.length) return { ok: false, raw, masked, charIssues, incomplete: true };
    const fmt = charIssues.length ? null : f.check(masked, f);
    return { ok: !charIssues.length && !fmt, raw, masked, charIssues, fmt };
}

// Busca un desplazamiento k que haga que todos los campos desde "from" queden bien ubicados
function findShift(fields, s, bad, from) {
    const prev = fields[from - 1];
    const diff = s.length - LINE_LENGTH;
    const candidates = [];
    if (diff !== 0 && Math.abs(diff) <= MAX_SHIFT) candidates.push(diff);
    for (let d = 1; d <= MAX_SHIFT; d++) candidates.push(-d, d);
    const tried = new Set();
    for (const k of candidates) {
        if (tried.has(k)) continue;
        tried.add(k);
        if (prev.length + k < 1) continue;
        let ok = true;
        for (let j = from; j < fields.length && ok; j++) {
            const f = fields[j];
            if (j === fields.length - 1 && f.kind === 'blank') {
                const st = f.start - 1 + k;
                ok = st <= s.length && /^ *$/.test(s.substring(st));
            } else {
                ok = evalField(f, s, k, bad).ok;
            }
        }
        if (ok) return k;
    }
    return null;
}

// ¿La línea es más corta solo porque le faltan espacios de relleno al final?
function trailingPaddingMissing(fields, evals, s) {
    for (let j = 0; j < fields.length; j++) {
        const f = fields[j];
        if (f.end <= s.length) { if (!evals[j].ok) return false; continue; }
        if (!f.blankOk) return false;
        if (!/^ *$/.test(s.substring(f.start - 1))) return false;
    }
    return true;
}

function checkLength(s, lb, addLine, lineInfo) {
    if (s.length === LINE_LENGTH) return;
    const n = s.length;
    const shifted = lineInfo && lineInfo.shift !== 0;
    if (n > LINE_LENGTH) {
        const extra = s.substring(LINE_LENGTH);
        const onlySpaces = /^ +$/.test(extra);
        addLine({
            pos: LINE_LENGTH + 1, endPos: n, category: 'Longitud de línea', field: 'FIN DE LÍNEA',
            found: `${n} caracteres${onlySpaces ? '' : `; sobra: "${visibleSpaces(extra.slice(0, 40))}"`}`, expected: `${LINE_LENGTH} caracteres`,
            message: `Error de estructura: se esperaban ${LINE_LENGTH} caracteres, pero la línea contiene ${n} (${n - LINE_LENGTH} de más).` +
                (shifted ? ' Es consecuencia del desplazamiento detectado.' : onlySpaces ? ' Sobran espacios al final.' : ' Hay información adicional después de la posición 264.'),
            fix: shifted ? 'Corrija el campo que causa el desplazamiento.' : onlySpaces ? `Elimine ${n - LINE_LENGTH} espacio(s) del final.` : 'Revise si dos registros quedaron unidos o si se agregó información de más.'
        });
    } else {
        addLine({
            pos: n + 1, category: 'Longitud de línea', field: 'FIN DE LÍNEA',
            found: `${n} caracteres`, expected: `${LINE_LENGTH} caracteres`,
            message: `Error de estructura: se esperaban ${LINE_LENGTH} caracteres, pero la línea contiene ${n} (faltan ${LINE_LENGTH - n}).` +
                (shifted ? ' Es consecuencia del desplazamiento detectado.' : ' La línea está incompleta.'),
            fix: shifted ? 'Corrija el campo que causa el desplazamiento.' : 'Revise si la línea quedó partida en dos o si faltan campos.'
        });
    }
}

function fieldAt(type, pos) {
    const rec = LAYOUT[type];
    if (!rec) return null;
    return rec.fields.find(f => pos >= f.start && pos <= f.end) || null;
}

function pl(n, sing, plur) {
    return `${n} ${n === 1 ? sing : plur}`;
}

function visibleSpaces(str) {
    return String(str).replace(/ /g, '·').replace(/\t/g, '→');
}

function formatMoney(cents) {
    const neg = cents < 0n;
    if (neg) cents = -cents;
    const ent = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const dec = (cents % 100n).toString().padStart(2, '0');
    return `${neg ? '-' : ''}$${ent},${dec}`;
}

function formatDate(v) {
    return isValidDate(v) ? `${v.slice(6, 8)}/${v.slice(4, 6)}/${v.slice(0, 4)}` : v;
}

// =====================================================================
// 4. INTERFAZ (carga de archivo, drag & drop, botones, resultados)
// =====================================================================
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function initUI() {
    const fileInput = document.getElementById('fileInput');
    const fileContainer = document.querySelector('.file-container');

    // Carga tradicional (input file)
    fileInput.addEventListener('change', function (event) {
        const file = event.target.files[0];
        if (!file) return;
        if (!isTxt(file)) {
            alert('Por favor, selecciona un archivo de texto (.txt).');
            fileInput.value = '';
            return;
        }
        handleSelectedFile(file);
    });

    // Drag & drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        fileContainer.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); });
        document.body.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); });
    });
    ['dragenter', 'dragover'].forEach(n => fileContainer.addEventListener(n, () => fileContainer.classList.add('dragover')));
    ['dragleave', 'drop'].forEach(n => fileContainer.addEventListener(n, () => fileContainer.classList.remove('dragover')));
    fileContainer.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (!isTxt(file)) {
                alert('Solo se permiten archivos de texto (.txt)');
                return;
            }
            handleSelectedFile(file);
        }
    });

    // Botón Aceptar
    document.getElementById('processButton').addEventListener('click', function () {
        if (!fileBytes) {
            alert('Por favor cargue un archivo.');
            return;
        }
        lastResult = validatePlano(fileBytes);
        renderResult(lastResult);
    });

    // Botón Cancelar
    document.getElementById('clearButton').addEventListener('click', function () {
        fileInput.value = '';
        document.getElementById('output').innerHTML = '';
        document.getElementById('summary').innerHTML = '';
        document.getElementById('resultsToolbar').hidden = true;
        document.getElementById('lineInspector').innerHTML = '';
        document.getElementById('fileName').textContent = 'No hay archivos seleccionados';
        setMessage('', '');
        fileBytes = null;
        fileName = '';
        lastResult = null;
        document.getElementById('processButton').disabled = true;
        fileContainer.classList.remove('dragover');
    });

    document.getElementById('filterSelect').addEventListener('change', () => lastResult && renderTable(lastResult));
    document.getElementById('downloadButton').addEventListener('click', downloadReport);

    // Clic en el número de línea -> inspector de campos
    document.getElementById('output').addEventListener('click', (e) => {
        const a = e.target.closest('[data-line]');
        if (!a || !lastResult) return;
        e.preventDefault();
        renderInspector(+a.dataset.line);
    });

    renderLayoutDoc();
}

function isTxt(file) {
    return file.name.toLowerCase().endsWith('.txt') || file.type === 'text/plain';
}

function handleSelectedFile(file) {
    fileName = file.name;
    const reader = new FileReader();
    reader.onload = function (e) {
        fileBytes = new Uint8Array(e.target.result); // se leen los BYTES reales, sin convertir
        document.getElementById('processButton').disabled = false;
    };
    reader.readAsArrayBuffer(file);
    document.getElementById('fileName').textContent = `Archivo cargado: ${fileName}`;
}

function setMessage(text, cls) {
    const el = document.getElementById('validationMessage');
    el.textContent = text;
    el.className = cls;
}

function renderResult(res) {
    const errors = res.issues.filter(i => i.severity === 'error');
    const warnings = res.issues.filter(i => i.severity === 'warning');
    const linesWithErrors = new Set(errors.filter(i => i.line).map(i => i.line)).size;

    if (errors.length) {
        setMessage(`⚠️ El archivo NO está listo: ${pl(errors.length, 'error', 'errores')} en ${pl(linesWithErrors, 'línea', 'líneas')}. Corríjalos antes de cargarlo al banco.`, 'error-message');
    } else if (warnings.length) {
        setMessage(`✅ Sin errores de estructura ni caracteres. Revise ${pl(warnings.length, 'advertencia', 'advertencias')} antes de cargar a BANCOLOMBIA.`, 'success-message');
    } else {
        setMessage('✅ Archivo correcto. ¡Listo para cargar en BANCOLOMBIA!', 'success-message');
    }

    const h = res.header;
    const card = (label, value, cls = '') => `<div class="card ${cls}"><span class="card-label">${label}</span><span class="card-value">${escapeHtml(value)}</span></div>`;
    document.getElementById('summary').innerHTML =
        card('Líneas', res.stats.totalLines) +
        card('Registros detalle', res.stats.detailCount) +
        card('Total pagos (detalle)', formatMoney(res.stats.sumDetail)) +
        (h ? card('Total encabezado', /^\d{17}$/.test(h.totalCreditos) ? formatMoney(BigInt(h.totalCreditos)) : h.totalCreditos) : '') +
        (h ? card('Fecha aplicación', formatDate(h.fechaAplicacion)) : '') +
        card('Codificación', res.stats.encoding + (res.stats.bom ? ' + BOM' : ''), res.stats.encoding === 'ASCII' && !res.stats.bom ? '' : 'card-warn') +
        card('Saltos de línea', res.stats.eol) +
        card('Errores', errors.length, errors.length ? 'card-error' : 'card-ok') +
        card('Advertencias', warnings.length, warnings.length ? 'card-warn' : 'card-ok');

    document.getElementById('resultsToolbar').hidden = false;
    document.getElementById('lineInspector').innerHTML = '';
    renderTable(res);
}

function renderTable(res) {
    const filter = document.getElementById('filterSelect').value;
    const list = res.issues.filter(i => filter === 'all' || i.severity === filter);
    const out = document.getElementById('output');
    if (!list.length) {
        out.innerHTML = `<p class="no-issues">✅ ${res.issues.length ? 'No hay elementos con este filtro.' : 'No se encontraron errores. Todas las líneas tienen 264 posiciones y los campos están en su lugar.'}</p>`;
        return;
    }
    const rows = list.slice(0, MAX_ROWS_RENDERED).map((i, n) => {
        const line = i.line ? res.lines[i.line - 1] : null;
        const pos = i.pos ? (i.col && i.col !== i.pos ? `${i.pos}<br><small>col. editor ${i.col}</small>` : i.pos) : '-';
        return `<tr class="sev-${i.severity}">
            <td>${n + 1}</td>
            <td>${i.line ? `<a href="#" data-line="${i.line}" title="Ver la línea campo por campo">${i.line}</a>` : '-'}</td>
            <td>${pos}</td>
            <td>${escapeHtml(i.field || '-')}</td>
            <td><span class="badge badge-${i.severity}">${i.severity === 'error' ? 'Error' : 'Advertencia'}</span><br>${escapeHtml(i.category)}</td>
            <td class="mono">${escapeHtml(i.found || '-')}</td>
            <td>${escapeHtml(i.expected || '-')}</td>
            <td>${escapeHtml(i.message)}${i.fix ? `<div class="fix">💡 ${escapeHtml(i.fix)}</div>` : ''}${line && i.pos ? snippetHtml(line, i.pos, i.endPos || i.pos) : ''}</td>
        </tr>`;
    }).join('');
    out.innerHTML = `
        ${list.length > MAX_ROWS_RENDERED ? `<p class="note">Se muestran ${MAX_ROWS_RENDERED} de ${list.length}. Descargue el reporte para verlos todos.</p>` : ''}
        <div class="table-wrap"><table class="issues">
            <thead><tr><th>#</th><th>Línea</th><th>Posición</th><th>Campo</th><th>Tipo</th><th>Valor encontrado</th><th>Esperado</th><th>Explicación</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
}

// Fragmento de la línea alrededor del error, con el carácter resaltado
function snippetHtml(line, pos, endPos) {
    const b = line.bytes;
    const from = Math.max(0, pos - 1 - 12);
    const to = Math.min(b.length, endPos + 12);
    let html = '';
    for (let p = from; p < to; p++) {
        const byte = b[p];
        let ch, len = 1;
        if (byte >= 0x80) {
            len = line.isUtf8 ? Math.min(utf8SeqLength(byte), b.length - p) : 1;
            ch = line.isUtf8 ? DEC_UTF8.decode(b.subarray(p, p + len)) : DEC_1252.decode(b.subarray(p, p + 1));
        } else if (byte < 0x20 || byte === 0x7F) ch = '¤';
        else ch = String.fromCharCode(byte);
        const inRange = p + 1 >= pos && p + 1 <= endPos;
        const txt = ch === ' ' ? '<span class="sp">·</span>' : escapeHtml(ch);
        html += inRange ? `<mark>${txt}</mark>` : txt;
        p += len - 1;
    }
    if (pos > b.length) html += '<mark class="eol">⏎</mark>';
    return `<div class="snippet" title="Posiciones ${from + 1} a ${to}">${from > 0 ? '…' : ''}${html}${to < b.length ? '…' : ''}</div>`;
}

// Inspector: muestra la línea separada por campos, tal como la lee el banco
function renderInspector(lineNo) {
    const res = lastResult;
    const line = res.lines[lineNo - 1];
    const box = document.getElementById('lineInspector');
    if (!line) { box.innerHTML = ''; return; }
    const s = bytesToBankString(line.bytes);
    const rec = LAYOUT[s[0]];
    let body;
    if (!rec) {
        body = `<p>No se reconoce el tipo de registro "${escapeHtml(s[0] || '')}".</p>`;
    } else {
        const bad = new Set();
        line.bytes.forEach((b, p) => { if (b < 0x20 || b > 0x7E) bad.add(p); });
        body = `<table class="issues inspector"><thead><tr><th>Campo</th><th>Posición esperada</th><th>Long.</th><th>Valor leído por el banco</th><th>Estado</th></tr></thead><tbody>` +
            rec.fields.map((f, j) => {
                const k = line.shiftFrom !== -1 && j >= line.shiftFrom ? line.shift : 0;
                const e = evalField(f, s, k, bad);
                const hasBad = [...Array(f.length).keys()].some(i => bad.has(f.start - 1 + k + i));
                const ok = e.ok && !hasBad;
                const state = ok ? '✅' : hasBad ? '❌ carácter no permitido' : e.incomplete ? '❌ incompleto' : '❌ ' + escapeHtml((e.fmt && e.fmt.message) || 'caracteres no válidos');
                return `<tr class="${ok ? '' : 'sev-error'}"><td>${escapeHtml(f.name)}</td><td>${f.start}-${f.end}${k ? `<br><small>leído en ${f.start + k}-${f.end + k}</small>` : ''}</td><td>${f.length}</td>
                    <td class="mono">${escapeHtml(visibleSpaces(DEC_1252.decode(line.bytes.subarray(Math.max(0, f.start - 1 + k), f.start - 1 + k + f.length))))}</td><td>${state}</td></tr>`;
            }).join('') + '</tbody></table>';
    }
    box.innerHTML = `<div class="inspector-head"><h3>Línea ${lineNo} — ${rec ? rec.name : 'desconocida'} (${line.bytes.length} posiciones)</h3>
        <button type="button" class="btn-small" onclick="document.getElementById('lineInspector').innerHTML=''">Cerrar</button></div>
        <p class="note">Los espacios se muestran como "·". Si la línea está corrida, se indica dónde se leyó realmente cada campo.</p>${body}`;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderLayoutDoc() {
    const el = document.getElementById('layoutDoc');
    if (!el) return;
    el.innerHTML = Object.entries(LAYOUT).map(([t, rec]) =>
        `<h4>Registro tipo ${t}: ${rec.name} (${LINE_LENGTH} posiciones)</h4>
        <table class="issues layout"><thead><tr><th>Campo</th><th>Desde</th><th>Hasta</th><th>Long.</th><th>Contenido permitido</th></tr></thead><tbody>` +
        rec.fields.map(f => `<tr><td>${escapeHtml(f.name)}</td><td>${f.start}</td><td>${f.end}</td><td>${f.length}</td><td>${escapeHtml(f.kind === 'const' ? `"${f.value}"` : f.kind === 'oneOf' ? f.values.join(' / ') : f.charsDesc || f.expectedDesc || '')}</td></tr>`).join('') +
        '</tbody></table>').join('');
}

function downloadReport() {
    if (!lastResult) return;
    const cols = ['Severidad', 'Línea', 'Posición', 'Columna editor', 'Campo', 'Tipo de error', 'Valor encontrado', 'Esperado', 'Explicación', 'Cómo corregir'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = lastResult.issues.map(i => [i.severity === 'error' ? 'Error' : 'Advertencia', i.line, i.pos, i.col, i.field, i.category, i.found, i.expected, i.message, i.fix].map(q).join(';'));
    const csv = '﻿' + [cols.map(q).join(';'), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `validacion_${fileName.replace(/\.txt$/i, '') || 'archivo'}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

// Botón página de inicio
function goToHome() {
    window.location.href = "../index.html";
}

if (typeof document !== 'undefined') initUI();
if (typeof module !== 'undefined') module.exports = { validatePlano, LAYOUT, LINE_LENGTH };
