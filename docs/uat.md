# Guion de pruebas de aceptación (UAT) — SIGO-Dental

Contraseña de todos los usuarios: `Demo1234!`. Los roles con MFA piden un código TOTP: agrega el secreto `JBSWY3DPEHPK3PXP` en Google Authenticator (o similar). El administrador entra sin MFA.

Marca cada paso como ✅ / ❌ y anota observaciones.

## Recepcionista — `recepcion@sigo.test`

| # | Paso | Resultado esperado | ✅/❌ |
|---|---|---|---|
| R1 | Iniciar sesión (contraseña + TOTP) | Menú: Pacientes, Agenda, Caja, Presupuestos. No ve Expediente clínico. | |
| R2 | Pacientes → buscar "Andrade" | Aparece María Andrade con el badge rojo **Alergia: Penicilina**. | |
| R3 | Nuevo paciente menor de edad sin tutor | Se rechaza: "Los menores de edad requieren tutor legal". | |
| R4 | Nuevo paciente adulto con anamnesis | Se guarda; aparece en la búsqueda. | |
| R5 | Agenda → Nueva cita en Sillón 1, 09:00–09:30 | Se agenda en estado Programado. | |
| R6 | Otra cita en Sillón 1, 09:15–09:45 (otro paciente) | Se rechaza: "El sillón ya está ocupado". | |
| R7 | Cambiar la cita a Confirmado → En sala de espera | Solo se ofrecen las transiciones válidas. | |
| R8 | Agenda → Enviar recordatorios | Muestra cuántos se enviaron (canal simulado). | |
| R9 | Caja → Abrir turno con fondo $50 | Turno abierto; **no** se muestra ningún total acumulado. | |
| R10 | Cobro de 2 procedimientos: parte en efectivo, parte por pasarela (Visa de prueba) | Comprobante CI-… y factura simulada autorizada; se descarga el XML. | |
| R11 | Cobro por pasarela con "Tarjeta rechazada" | Error "Pago rechazado"; no se crea cobro. | |
| R12 | Cerrar turno ingresando el conteo de efectivo | Solo **después** del conteo se muestra el teórico y la diferencia. | |
| R13 | Presupuestos → aprobar parcialmente un presupuesto presentado y agendar un ítem | Ítem pasa a Agendado y la cita aparece en la agenda. | |

## Odontólogo — `odontologo@sigo.test`

| # | Paso | Resultado esperado | ✅/❌ |
|---|---|---|---|
| O1 | Expediente clínico → María Andrade | Cabecera con el badge de alergia visible en todas las pestañas. | |
| O2 | Odontograma: caries oclusal en 16, restauración mesial en 16, exodoncia requerida en 38 | Colores rojo/azul y X en el 38. Cambiar a Universal muestra 3 / 17. | |
| O3 | Dentición temporal (20) | Muestra 55–85. | |
| O4 | Marcar realizado un hallazgo requerido eligiendo "Restauración con resina" y Consultorio 1 | Pasa a Realizado; en Inventario baja resina (2), anestesia (1) y guantes (1). | |
| O5 | Intentar borrar el hallazgo realizado | No hay opción de borrar; solo **Adenda** (pide contraseña). | |
| O6 | Periodontograma: diente 16, profundidad 4 y recesión 2 en los 6 sitios | NIC = 6 en cada sitio; el examen queda como no editable. | |
| O7 | Notas SOEP: crear y firmar con contraseña | Queda Firmada; ya no se puede editar; solo admite adenda. | |
| O8 | Recetas: recetar "Penicilina V" a María Andrade | Aviso de alergia; solo con "Recetar de todos modos" se emite el PDF. | |
| O9 | Consentimientos: generar por OTP para Sofía Cevallos (menor) y firmar | Firmado por el tutor legal; PDF descargable. | |
| O10 | Presupuestos: crear con 2 fases, laboratorio y descuento; presentarlo | Totales por fase y total con descuento correctos. | |

## Asistente dental — `asistente@sigo.test`

| # | Paso | Resultado esperado | ✅/❌ |
|---|---|---|---|
| A1 | Iniciar sesión | Menú: Pacientes, Agenda (solo lectura), Expediente clínico, Inventario. | |
| A2 | Agenda | Ve las citas pero no puede crear ni cambiar estados. | |
| A3 | Crear una nota SOEP | Se guarda, pero no aparece el botón Firmar. | |
| A4 | Inventario → registrar entrada de lote | El stock sube y deja de estar "bajo el mínimo" si corresponde. | |

## Auditor / Contador — `auditor@sigo.test`

| # | Paso | Resultado esperado | ✅/❌ |
|---|---|---|---|
| U1 | Reportes → Corte de caja (hoy) | Turno cerrado con efectivo teórico, contado y diferencia. Exportar CSV funciona. | |
| U2 | Reportes → Inventario y Ausentismo | Valorizado, alertas de mínimo y tasa de no-show. | |
| U3 | Honorarios → previsualizar y liquidar el periodo del odontólogo | Comisión del 40 % (regla demo); volver a liquidar no paga dos veces. | |
| U4 | Auditoría | Lista de accesos con fecha ISO-8601 e IP; "Cadena íntegra". | |
| U5 | Intentar abrir Pacientes | No aparece en el menú (y el API responde 403). | |

## Administrador — `admin@sigo.test`

| # | Paso | Resultado esperado | ✅/❌ |
|---|---|---|---|
| D1 | Iniciar sesión (sin MFA) | Menú: Inventario, Honorarios, Reportes, Usuarios, Auditoría. | |
| D2 | Inventario → nuevo insumo y receta de consumo de un procedimiento | Se guardan; se usan en el siguiente descargo. | |
| D3 | Honorarios → regla de monto fijo para un procedimiento | Reemplaza a la general para ese procedimiento. | |

## Transversales

| # | Paso | Resultado esperado | ✅/❌ |
|---|---|---|---|
| T1 | Dejar la sesión 15 min sin actividad | Se cierra sola: "Tu sesión se cerró por inactividad". | |
| T2 | 21 intentos de login fallidos seguidos | "Demasiados intentos"; se bloquea 15 min por IP. | |
| T3 | Abrir la app en un celular / tablet | El menú se pliega; el odontograma se desplaza horizontalmente. | |
| T4 | `/api/docs` | Documentación Swagger de todos los endpoints. | |

---

## Acta de aceptación

| | |
|---|---|
| Proyecto | SIGO-Dental — Sistema Integral de Gestión Odontológica |
| Versión / URL evaluada | |
| Fecha | |
| Casos ejecutados / aprobados | ___ / ___ |
| Observaciones | |

Resultado: ☐ Aceptado  ☐ Aceptado con observaciones  ☐ No aceptado

| Rol | Nombre | Firma |
|---|---|---|
| Responsable del proyecto | | |
| Evaluador (Ing.) | | |
