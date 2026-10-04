/* ==========================================================================
   Capa de diseño (Dirección B). NO contiene lógica de negocio: se apoya en los
   inputs y en las funciones globales de cada página, sin modificarlos.
   - Muestra el archivo cargado (nombre, tamaño, "Quitar") en lugar de la zona.
   - Deshabilita el botón principal hasta que estén los archivos requeridos.
   - Muestra "Procesando…" mientras corre la función del botón principal.
   Cargar DESPUÉS del script de cada página.
   ========================================================================== */
(function () {
    'use strict';

    var page = document.body.getAttribute('data-page');
    var primary = document.querySelector('.btn-primary[data-action]');
    var secondary = document.querySelector('.btn-secondary[data-action]');
    var busy = false;

    function fmtSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1).replace('.', ',') + ' KB';
        return (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB';
    }

    // ---------- Zonas de arrastre ----------
    var zones = Array.prototype.map.call(document.querySelectorAll('.drop-zone'), function (zone) {
        var rows = document.createElement('div');
        rows.className = 'file-rows';
        zone.parentNode.insertBefore(rows, zone.nextSibling);
        var text = zone.querySelector('.drop-text');
        var sub = zone.querySelector('.drop-subtext');
        return {
            zone: zone,
            input: zone.querySelector('input[type="file"]'),
            rows: rows,
            text: text, textHTML: text ? text.innerHTML : '',
            sub: sub, subHTML: sub ? sub.innerHTML : '',
            key: null
        };
    });

    // Archivos cargados en una zona. "Separar archivos" guarda los suyos en `archivos`
    // (CB y A0 en la misma zona); el resto usa el input de la zona.
    function itemsFor(z) {
        if (page === 'cb' && typeof archivos !== 'undefined') {
            return [['cb', 'CB'], ['a0', 'A0']].filter(function (p) { return archivos[p[0]]; }).map(function (p) {
                return {
                    badge: p[1],
                    file: archivos[p[0]],
                    remove: function () {
                        archivos[p[0]] = null;
                        if (typeof actualizarEstadoArchivos === 'function') actualizarEstadoArchivos();
                        refresh();
                    }
                };
            });
        }
        var f = z.input && z.input.files && z.input.files[0];
        if (!f) return [];
        return [{
            badge: z.zone.getAttribute('data-badge') || 'ARCHIVO',
            file: f,
            remove: function () {
                z.input.value = '';
                if (z.zone.id === 'signatureDropZone' && typeof resetSignatureUI === 'function') resetSignatureUI();
                refresh();
            }
        }];
    }

    function buildRow(item) {
        var row = document.createElement('div');
        row.className = 'file-row';

        var badge = document.createElement('span');
        badge.className = 'dz-badge solid';
        badge.textContent = item.badge;

        var meta = document.createElement('div');
        meta.className = 'file-meta';
        var name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = item.file.name;
        name.title = item.file.name;
        var size = document.createElement('span');
        size.className = 'file-size';
        size.textContent = fmtSize(item.file.size) + ' · Cargado';
        meta.appendChild(name);
        meta.appendChild(size);

        var quit = document.createElement('button');
        quit.type = 'button';
        quit.className = 'btn-quit';
        quit.textContent = 'Quitar';
        quit.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            item.remove();
        });

        row.appendChild(badge);
        row.appendChild(meta);
        row.appendChild(quit);
        return row;
    }

    function isReady() {
        if (page === 'cb') return typeof archivos !== 'undefined' && !!archivos.cb && !!archivos.a0;
        if (!primary) return true;
        return (primary.getAttribute('data-requires') || '').split(',').filter(Boolean).every(function (id) {
            var el = document.getElementById(id);
            return el && el.files && el.files.length > 0;
        });
    }

    function refresh() {
        zones.forEach(function (z) {
            var items = itemsFor(z);
            var complete = page === 'cb' ? items.length === 2 : items.length > 0;
            z.zone.classList.toggle('has-file', complete);

            // Zona visible: el texto original (los scripts lo reescriben al cargar)
            if (!complete) {
                if (z.text && z.text.innerHTML !== z.textHTML) z.text.innerHTML = z.textHTML;
                if (z.sub && z.sub.innerHTML !== z.subHTML) z.sub.innerHTML = z.subHTML;
            }

            var key = items.map(function (i) { return i.badge + '|' + i.file.name + '|' + i.file.size; }).join(';');
            if (key !== z.key) {
                z.key = key;
                z.rows.textContent = '';
                items.forEach(function (i) { z.rows.appendChild(buildRow(i)); });
            }
        });
        if (primary) primary.disabled = busy || !isReady();
    }

    // ---------- Botón principal: "Procesando…" ----------
    if (primary) {
        var action = primary.getAttribute('data-action');
        var original = window[action];
        if (typeof original === 'function') {
            window[action] = async function () {
                var label = primary.textContent;
                busy = true;
                primary.disabled = true;
                primary.textContent = 'Procesando…';
                try {
                    return await original.apply(this, arguments);
                } finally {
                    busy = false;
                    primary.textContent = label;
                    refresh();
                }
            };
        }
    }

    // ---------- Botón "Limpiar": misma función de siempre, luego se actualiza la vista ----------
    if (secondary) {
        var clearName = secondary.getAttribute('data-action');
        var clearOriginal = window[clearName];
        if (typeof clearOriginal === 'function') {
            window[clearName] = function () {
                var r = clearOriginal.apply(this, arguments);
                refresh();
                return r;
            };
        }
    }

    // "Separar archivos" actualiza su estado con esta función: se refresca la vista tras cada cambio
    if (page === 'cb' && typeof actualizarEstadoArchivos === 'function') {
        var estadoOriginal = actualizarEstadoArchivos;
        window.actualizarEstadoArchivos = function () {
            var r = estadoOriginal.apply(this, arguments);
            refresh();
            return r;
        };
    }

    document.addEventListener('change', function (e) {
        if (e.target && e.target.type === 'file') setTimeout(refresh, 0);
    });
    zones.forEach(function (z) {
        z.zone.addEventListener('drop', function () { setTimeout(refresh, 0); });
    });

    refresh();
    // Red de seguridad: si algún script cambia los archivos sin disparar eventos
    setInterval(refresh, 500);
})();
