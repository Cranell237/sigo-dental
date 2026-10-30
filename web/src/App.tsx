import { useEffect, useState } from "react";

export default function App() {
  const [api, setApi] = useState<"cargando" | "ok" | "error">("cargando");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setApi(d.status === "ok" ? "ok" : "error"))
      .catch(() => setApi("error"));
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow p-8 text-center max-w-md w-full">
        <h1 className="text-2xl font-semibold text-sky-700">SIGO-Dental</h1>
        <p className="mt-2 text-slate-600">Sistema Integral de Gestión Odontológica</p>
        <p className="mt-6 text-sm">
          API: <span className={api === "ok" ? "text-green-600" : "text-slate-500"}>{api}</span>
        </p>
      </div>
    </main>
  );
}
