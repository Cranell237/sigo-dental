// Dentición y catálogo visual de hallazgos (RF-03). Debe coincidir con api/src/dental.ts.

// Orden de izquierda a derecha como se ve el odontograma (derecha del paciente a la izquierda de la pantalla).
export const FILAS = {
  permanente: {
    superior: ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"],
    inferior: ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"],
  },
  temporal: {
    superior: ["55", "54", "53", "52", "51", "61", "62", "63", "64", "65"],
    inferior: ["85", "84", "83", "82", "81", "71", "72", "73", "74", "75"],
  },
} as const;

export function fdiAUniversal(fdi: string): string {
  const cuad = Number(fdi[0]);
  const n = Number(fdi[1]);
  switch (cuad) {
    case 1: return String(9 - n);
    case 2: return String(8 + n);
    case 3: return String(25 - n);
    case 4: return String(24 + n);
    case 5: return String.fromCharCode(64 + (6 - n));
    case 6: return String.fromCharCode(69 + n);
    case 7: return String.fromCharCode(75 + (5 - n));
    default: return String.fromCharCode(79 + n);
  }
}

export const SUPERFICIES = [
  { id: "M", nombre: "Mesial" },
  { id: "D", nombre: "Distal" },
  { id: "O", nombre: "Oclusal / incisal" },
  { id: "V", nombre: "Vestibular" },
  { id: "L", nombre: "Lingual / palatino" },
] as const;

export const TIPOS: Record<string, { nombre: string; color: string; porSuperficie: boolean; marca: string }> = {
  CARIES: { nombre: "Caries", color: "#dc2626", porSuperficie: true, marca: "" },
  RESTAURACION: { nombre: "Restauración", color: "#2563eb", porSuperficie: true, marca: "" },
  SELLANTE: { nombre: "Sellante", color: "#16a34a", porSuperficie: true, marca: "" },
  ENDODONCIA: { nombre: "Endodoncia", color: "#7c3aed", porSuperficie: false, marca: "EN" },
  IMPLANTE: { nombre: "Implante", color: "#0f766e", porSuperficie: false, marca: "IM" },
  PROTESIS_FIJA: { nombre: "Prótesis fija", color: "#b45309", porSuperficie: false, marca: "PF" },
  PROTESIS_REMOVIBLE: { nombre: "Prótesis removible", color: "#a16207", porSuperficie: false, marca: "PR" },
  EXODONCIA: { nombre: "Exodoncia", color: "#111827", porSuperficie: false, marca: "✕" },
  AUSENTE: { nombre: "Ausente", color: "#6b7280", porSuperficie: false, marca: "—" },
};

export const ESTADO_LABEL: Record<string, string> = { EXISTENTE: "Existente", REQUERIDO: "Requerido", REALIZADO: "Realizado" };
export const PUNTOS_PERIO = ["DV", "V", "MV", "DL", "L", "ML"] as const;
