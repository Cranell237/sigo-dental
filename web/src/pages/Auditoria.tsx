import { useEffect, useState } from "react";
import { api } from "../api";

interface Row {
  id: number;
  timestamp: string;
  userId: string | null;
  action: string;
  resource: string;
  ip: string | null;
}

export default function Auditoria() {
  const [rows, setRows] = useState<Row[]>([]);
  const [chain, setChain] = useState<{ ok: boolean; total: number } | null>(null);

  useEffect(() => {
    api<Row[]>("/auditoria?limit=50").then(setRows);
    api("/auditoria/verificar").then(setChain);
  }, []);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Registro de auditoría</h2>
        {chain && (
          <span className={`rounded-full px-3 py-1 text-sm ${chain.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
            {chain.ok ? `Cadena íntegra (${chain.total} registros)` : "Cadena alterada"}
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              {["#", "Fecha (ISO)", "Usuario", "Acción", "Recurso", "IP"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{r.id}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.timestamp}</td>
                <td className="px-3 py-2">{r.userId?.slice(0, 8) ?? "—"}</td>
                <td className="px-3 py-2">{r.action}</td>
                <td className="px-3 py-2">{r.resource}</td>
                <td className="px-3 py-2">{r.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
