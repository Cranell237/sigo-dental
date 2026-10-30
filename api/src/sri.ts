// Facturación electrónica (RF-12, §7.1). La integración real con el SRI queda detrás de la interfaz
// `SriAdapter`; para la entrega académica se usa `MockSriAdapter`, que "autoriza" localmente.

export interface FacturaData {
  secuencial: number;
  fecha: Date;
  comprador: { cedula: string; nombre: string };
  detalles: { descripcion: string; cantidad: number; precioUnitario: number }[]; // centavos
  pagos: { metodo: string; monto: number }[]; // centavos
  total: number;
}

export interface Autorizacion {
  estado: "AUTORIZADO";
  numeroAutorizacion: string;
  fecha: Date;
}

export interface SriAdapter {
  autorizar(claveAcceso: string, xml: string): Promise<Autorizacion>;
}

export const EMISOR = { ruc: "1790000000001", razonSocial: "SIGO-Dental (demo)", establecimiento: "001", puntoEmision: "001" };
const AMBIENTE_PRUEBAS = "1";

const FORMA_PAGO_SRI: Record<string, string> = {
  EFECTIVO: "01",
  TARJETA_DEBITO: "16",
  TARJETA_CREDITO: "19",
  TRANSFERENCIA: "20",
  SEGURO: "20",
};

/** Dígito verificador módulo 11 de la clave de acceso. */
function modulo11(digits: string) {
  let factor = 2;
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 11 ? 0 : dv === 10 ? 1 : dv;
}

const pad = (n: number | string, len: number) => String(n).padStart(len, "0");

/** Clave de acceso de 49 dígitos (fecha, tipo, RUC, ambiente, serie, secuencial, código, emisión, DV). */
export function claveAcceso(fecha: Date, secuencial: number) {
  const f = `${pad(fecha.getDate(), 2)}${pad(fecha.getMonth() + 1, 2)}${fecha.getFullYear()}`;
  const base = `${f}01${EMISOR.ruc}${AMBIENTE_PRUEBAS}${EMISOR.establecimiento}${EMISOR.puntoEmision}${pad(secuencial, 9)}${pad(secuencial % 1e8, 8)}1`;
  return base + modulo11(base);
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
const money = (c: number) => (c / 100).toFixed(2);

export function buildFacturaXml(d: FacturaData, clave: string) {
  const fecha = `${pad(d.fecha.getDate(), 2)}/${pad(d.fecha.getMonth() + 1, 2)}/${d.fecha.getFullYear()}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="1.1.0">
  <infoTributaria>
    <ambiente>${AMBIENTE_PRUEBAS}</ambiente>
    <tipoEmision>1</tipoEmision>
    <razonSocial>${esc(EMISOR.razonSocial)}</razonSocial>
    <ruc>${EMISOR.ruc}</ruc>
    <claveAcceso>${clave}</claveAcceso>
    <codDoc>01</codDoc>
    <estab>${EMISOR.establecimiento}</estab>
    <ptoEmi>${EMISOR.puntoEmision}</ptoEmi>
    <secuencial>${pad(d.secuencial, 9)}</secuencial>
  </infoTributaria>
  <infoFactura>
    <fechaEmision>${fecha}</fechaEmision>
    <tipoIdentificacionComprador>05</tipoIdentificacionComprador>
    <razonSocialComprador>${esc(d.comprador.nombre)}</razonSocialComprador>
    <identificacionComprador>${esc(d.comprador.cedula)}</identificacionComprador>
    <totalSinImpuestos>${money(d.total)}</totalSinImpuestos>
    <importeTotal>${money(d.total)}</importeTotal>
    <moneda>DOLAR</moneda>
    <pagos>
${d.pagos.map((p) => `      <pago><formaPago>${FORMA_PAGO_SRI[p.metodo] ?? "20"}</formaPago><total>${money(p.monto)}</total></pago>`).join("\n")}
    </pagos>
  </infoFactura>
  <detalles>
${d.detalles
  .map(
    (l) =>
      `    <detalle><descripcion>${esc(l.descripcion)}</descripcion><cantidad>${l.cantidad}</cantidad><precioUnitario>${money(l.precioUnitario)}</precioUnitario><precioTotalSinImpuesto>${money(l.cantidad * l.precioUnitario)}</precioTotalSinImpuesto></detalle>`,
  )
  .join("\n")}
  </detalles>
</factura>
`;
}

/** Autorización simulada: siempre aprueba y devuelve un número derivado de la clave. */
export class MockSriAdapter implements SriAdapter {
  async autorizar(claveAcceso: string): Promise<Autorizacion> {
    return { estado: "AUTORIZADO", numeroAutorizacion: claveAcceso, fecha: new Date() };
  }
}

export const sri: SriAdapter = new MockSriAdapter();
