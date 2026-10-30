// Dentición y catálogo de hallazgos (RF-03). Numeración FDI como identificador interno.

const rango = (decena: number, desde: number, hasta: number) => Array.from({ length: hasta - desde + 1 }, (_, i) => String(decena * 10 + desde + i));

export const PERMANENTES = [1, 2, 3, 4].flatMap((c) => rango(c, 1, 8));
export const TEMPORALES = [5, 6, 7, 8].flatMap((c) => rango(c, 1, 5));
export const DIENTES = new Set([...PERMANENTES, ...TEMPORALES]);

/** FDI → Universal americana (1–32 permanentes, A–T temporales). */
export function fdiAUniversal(fdi: string): string {
  const cuad = Number(fdi[0]);
  const n = Number(fdi[1]);
  switch (cuad) {
    case 1: return String(9 - n);
    case 2: return String(8 + n);
    case 3: return String(25 - n);
    case 4: return String(24 + n);
    case 5: return String.fromCharCode(64 + (6 - n)); // 55→A … 51→E
    case 6: return String.fromCharCode(69 + n); // 61→F … 65→J
    case 7: return String.fromCharCode(75 + (5 - n)); // 75→K … 71→O
    default: return String.fromCharCode(79 + n); // 81→P … 85→T
  }
}

export const SUPERFICIES = ["M", "D", "O", "V", "L"] as const; // mesial, distal, oclusal/incisal, vestibular, lingual/palatino

export const TIPOS_HALLAZGO = ["CARIES", "RESTAURACION", "ENDODONCIA", "IMPLANTE", "PROTESIS_FIJA", "PROTESIS_REMOVIBLE", "EXODONCIA", "SELLANTE", "AUSENTE"] as const;
export type TipoHallazgo = (typeof TIPOS_HALLAZGO)[number];

// Hallazgos que se marcan por superficie; el resto afecta al diente completo.
export const POR_SUPERFICIE: TipoHallazgo[] = ["CARIES", "RESTAURACION", "SELLANTE"];

export const ESTADOS_HALLAZGO = ["EXISTENTE", "REQUERIDO", "REALIZADO"] as const;

export const PUNTOS_PERIO = ["DV", "V", "MV", "DL", "L", "ML"] as const; // 6 sitios por diente
