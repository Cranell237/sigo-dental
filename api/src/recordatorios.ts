import cron from "node-cron";
import { prisma } from "./db.js";

// RF-11: recordatorios 48 h y 24 h antes de la cita. Cada canal sale por un adaptador;
// aquí son simulados (no envían nada). Para uso real basta otra implementación de `Canal`.
export interface Canal {
  nombre: "EMAIL" | "WHATSAPP" | "SMS";
  enviar(destino: string, mensaje: string): Promise<void>;
}

const simulado = (nombre: Canal["nombre"]): Canal => ({
  nombre,
  async enviar(destino, mensaje) {
    console.log(`[recordatorio:${nombre}] → ${destino}: ${mensaje}`);
  },
});

export const canales = { EMAIL: simulado("EMAIL"), WHATSAPP: simulado("WHATSAPP"), SMS: simulado("SMS") };

const HORA = 3600e3;

/** Correo si el paciente lo tiene; si no, WhatsApp simulado al teléfono. */
const elegirCanal = (p: { email: string | null; telefono: string }) =>
  p.email ? { canal: canales.EMAIL, destino: p.email } : { canal: canales.WHATSAPP, destino: p.telefono };

/**
 * Envía los recordatorios pendientes. Es idempotente: la restricción única (cita, tipo)
 * evita duplicados aunque el cron se ejecute varias veces o se dispare a mano.
 */
export async function enviarRecordatorios(ahora = new Date()) {
  const citas = await prisma.appointment.findMany({
    where: { estado: { in: ["PROGRAMADO", "CONFIRMADO"] }, inicio: { gt: ahora, lte: new Date(ahora.getTime() + 48 * HORA) } },
    include: { patient: true },
  });
  let enviados = 0;
  for (const c of citas) {
    const faltan = c.inicio.getTime() - ahora.getTime();
    // Más de 24 h: toca el de 48 h; a menos de 24 h, el de 24 h.
    const tipo = faltan <= 24 * HORA ? "24H" : "48H";
    if (await prisma.recordatorio.findUnique({ where: { appointmentId_tipo: { appointmentId: c.id, tipo } } })) continue;
    const { canal, destino } = elegirCanal(c.patient);
    const mensaje = `Hola ${c.patient.nombres}, te recordamos tu cita en SIGO-Dental el ${c.inicio.toLocaleString("es-EC")} (${tipo === "48H" ? "en 48 horas" : "mañana"}).`;
    await canal.enviar(destino, mensaje);
    await prisma.recordatorio.create({ data: { appointmentId: c.id, tipo, canal: canal.nombre, destino, mensaje } });
    enviados++;
  }
  return { revisadas: citas.length, enviados };
}

/** Revisa cada hora las citas de las próximas 48 h. En tests no se arranca. */
export function iniciarCronRecordatorios() {
  return cron.schedule("0 * * * *", () => {
    enviarRecordatorios().catch((e) => console.error("Fallo en recordatorios", e));
  });
}
