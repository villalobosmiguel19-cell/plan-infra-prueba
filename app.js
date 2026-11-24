/* PLAN INFRA – PRUEBA MÓVIL · Lógica del formulario.
 *
 * Funciona en dos lugares con el mismo código:
 *   A) Servido por Google Apps Script  → envía con google.script.run.
 *   B) PWA en alojamiento HTTPS         → envía con fetch() a la URL de config.js.
 *
 * Regla: nunca se muestra "guardado" sin la respuesta ok del servidor.
 * Un envío fallido queda PENDIENTE con su mismo ID; al reintentar, el servidor
 * reconoce el ID y no crea una fila duplicada.
 */
(function () {
  'use strict';

  var CLAVE_PENDIENTE = 'pi_prueba_pendiente';
  var CLAVE_OPERADOR = 'pi_prueba_operador';
  var CLAVE_CODIGO = 'pi_prueba_codigo';
  var TIEMPO_MAX_MS = 25000;

  var $ = function (id) { return document.getElementById(id); };
  var campos = ['operador', 'fecha', 'tipo', 'valor', 'observaciones', 'codigo'];
  var enviando = false;

  // ── Almacenamiento local seguro (puede fallar en modo privado o iframes) ──
  function leer(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function escribir(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
  function borrar(k) { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } }

  function nuevoId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function ahoraLocal() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  // ── Estado visual ──
  function mostrar(tipo, titulo, detalle) {
    var el = $('estado');
    el.className = 'estado visible ' + tipo;
    el.innerHTML = '';
    el.appendChild(document.createTextNode(titulo));
    if (detalle) {
      var s = document.createElement('span');
      s.className = 'detalle';
      s.textContent = detalle;
      el.appendChild(s);
    }
    el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  }
  function ocultarEstado() { $('estado').className = 'estado'; }

  function bloquearFormulario(bloquear) {
    campos.forEach(function (c) { if (c !== 'codigo') $(c).disabled = bloquear; });
  }

  function pendiente() {
    var p = leer(CLAVE_PENDIENTE);
    if (!p) return null;
    try { return JSON.parse(p); } catch (e) { borrar(CLAVE_PENDIENTE); return null; }
  }

  function actualizarBotones() {
    var p = pendiente();
    $('btnEnviar').disabled = enviando;
    $('btnEnviar').textContent = enviando ? 'ENVIANDO…' : (p ? 'REINTENTAR ENVÍO' : 'ENVIAR REGISTRO');
    $('btnDescartar').classList.toggle('oculto', !p || enviando);
    bloquearFormulario(!!p || enviando);
  }

  // ── Transporte ──
  function enviarAlServidor(payload) {
    if (window.google && google.script && google.script.run) {
      return new Promise(function (ok, falla) {
        google.script.run
          .withSuccessHandler(ok)
          .withFailureHandler(function (e) { falla(new Error((e && e.message) || String(e))); })
          .guardarRegistro(payload);
      });
    }
    var url = (window.PI_CONFIG || {}).API_URL || '';
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) {
      return Promise.reject(new Error('Falta configurar la URL del servidor en config.js.'));
    }
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIEMPO_MAX_MS);
    // Sin cabeceras personalizadas: el cuerpo viaja como text/plain y se evita
    // la consulta previa CORS que Apps Script no responde.
    return fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) {
      if (!r.ok) throw new Error('El servidor respondió HTTP ' + r.status + '.');
      return r.json();
    }).finally(function () { clearTimeout(t); });
  }

  function enviar(p) {
    enviando = true;
    actualizarBotones();
    mostrar('enviando', 'Enviando…', 'Esperando confirmación del servidor. No cierres la aplicación.');

    var datos = Object.assign({}, p, { codigo: $('codigo').value.trim() });
    enviarAlServidor(datos).then(function (r) {
      if (!r || r.ok !== true) throw new Error((r && r.error) || 'Respuesta inesperada del servidor.');
      borrar(CLAVE_PENDIENTE);
      if ($('recordar').checked) escribir(CLAVE_CODIGO, datos.codigo); else borrar(CLAVE_CODIGO);
      escribir(CLAVE_OPERADOR, p.operador);
      mostrar('ok', 'Registro guardado correctamente',
        (r.duplicado ? 'Ya estaba guardado: el reintento no creó otra fila. ' : '') +
        'Fila ' + r.fila + ' · recibido ' + r.recibido + ' · ID ' + r.id.slice(0, 8));
      $('valor').value = '';
      $('observaciones').value = '';
      $('fecha').value = ahoraLocal();
    }).catch(function (e) {
      var msg = e && e.name === 'AbortError' ? 'El servidor no respondió a tiempo.' : (e && e.message) || 'Error desconocido.';
      if (!navigator.onLine) msg = 'Sin conexión a Internet.';
      mostrar('error', 'Error al guardar',
        msg + ' El registro NO está confirmado: queda pendiente en este teléfono. Pulsa «Reintentar envío».');
    }).finally(function () {
      enviando = false;
      actualizarBotones();
    });
  }

  function validar() {
    var err = [];
    if (!$('operador').value.trim()) err.push('nombre del operador');
    if (!$('fecha').value) err.push('fecha y hora');
    if (!$('tipo').value) err.push('tipo de registro');
    var v = $('valor').value.trim().replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(v)) err.push('valor numérico');
    if (!$('codigo').value.trim()) err.push('código de acceso');
    return err;
  }

  function alEnviar(ev) {
    ev.preventDefault();
    if (enviando) return;
    var p = pendiente();
    if (!p) {
      var faltan = validar();
      if (faltan.length) { mostrar('error', 'Revisa el formulario', 'Falta o es inválido: ' + faltan.join(', ') + '.'); return; }
      p = {
        id: nuevoId(),
        operador: $('operador').value.trim(),
        fechaRegistro: $('fecha').value,
        tipo: $('tipo').value,
        valor: $('valor').value.trim().replace(',', '.'),
        observaciones: $('observaciones').value.trim(),
      };
      escribir(CLAVE_PENDIENTE, JSON.stringify(p));
    } else if (!$('codigo').value.trim()) {
      mostrar('error', 'Revisa el formulario', 'Falta el código de acceso.'); return;
    }
    enviar(p);
  }

  function alDescartar() {
    if (!confirm('¿Descartar el registro pendiente? Si el servidor alcanzó a recibirlo, seguirá en la hoja.')) return;
    borrar(CLAVE_PENDIENTE);
    ocultarEstado();
    actualizarBotones();
  }

  function indicadorConexion() {
    var el = $('conexion');
    if (!el) return;
    el.textContent = navigator.onLine ? 'EN LÍNEA' : 'SIN CONEXIÓN';
    el.classList.toggle('off', !navigator.onLine);
  }

  function iniciar() {
    var p = pendiente();
    if (p) {
      $('operador').value = p.operador; $('fecha').value = p.fechaRegistro; $('tipo').value = p.tipo;
      $('valor').value = p.valor; $('observaciones').value = p.observaciones;
      mostrar('error', 'Registro pendiente de envío', 'Hay un registro sin confirmación del servidor. Pulsa «Reintentar envío».');
    } else {
      $('operador').value = leer(CLAVE_OPERADOR) || '';
      $('fecha').value = ahoraLocal();
    }
    var cod = leer(CLAVE_CODIGO);
    if (cod) { $('codigo').value = cod; $('recordar').checked = true; }
    $('formulario').addEventListener('submit', alEnviar);
    $('btnDescartar').addEventListener('click', alDescartar);
    window.addEventListener('online', indicadorConexion);
    window.addEventListener('offline', indicadorConexion);
    indicadorConexion();
    actualizarBotones();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
