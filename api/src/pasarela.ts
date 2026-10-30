import { randomUUID } from "node:crypto";

// §7.1: pasarela de pagos. La integración real (Stripe, dLocal, banco) queda detrás de esta interfaz.
// Nunca se reciben números de tarjeta: el cliente envía un `token` que emite el proveedor.
export interface Pasarela {
  cobrar(p: { monto: number; token: string; referencia: string }): Promise<{ aprobado: boolean; transaccionId: string; motivo?: string }>;
  reversar(transaccionId: string): Promise<void>;
}

// Simulación: tokens de prueba al estilo de los de un proveedor real.
//   tok_visa, tok_mastercard → aprobado · tok_declined → rechazado · tok_sinfondos → fondos insuficientes
export class PasarelaSimulada implements Pasarela {
  async cobrar({ token }: { monto: number; token: string; referencia: string }) {
    const transaccionId = `sim_${randomUUID()}`;
    if (token === "tok_declined") return { aprobado: false, transaccionId, motivo: "Tarjeta rechazada" };
    if (token === "tok_sinfondos") return { aprobado: false, transaccionId, motivo: "Fondos insuficientes" };
    if (!token.startsWith("tok_")) return { aprobado: false, transaccionId, motivo: "Token de pago inválido" };
    return { aprobado: true, transaccionId };
  }

  async reversar() {
    /* nada que revertir en la simulación */
  }
}

export const pasarela: Pasarela = new PasarelaSimulada();
