import PDFDocument from "pdfkit";

/** Construye un PDF en memoria. */
export function crearPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    doc.end();
  });
}

export const encabezado = (doc: PDFKit.PDFDocument, titulo: string) => {
  doc.fontSize(10).fillColor("#0369a1").text("SIGO-Dental", { align: "left" });
  doc.moveDown(0.3).fontSize(18).fillColor("#111827").text(titulo);
  doc.moveDown(0.5).strokeColor("#cbd5e1").moveTo(56, doc.y).lineTo(539, doc.y).stroke().moveDown();
  doc.fontSize(11).fillColor("#111827");
};
