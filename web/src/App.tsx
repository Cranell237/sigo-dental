import { useState, type ComponentType } from "react";
import { AuthProvider, useAuth } from "./auth";
import Agenda from "./pages/Agenda";
import Auditoria from "./pages/Auditoria";
import Caja from "./pages/Caja";
import Catalogos from "./pages/Catalogos";
import Expediente from "./pages/Expediente";
import Honorarios from "./pages/Honorarios";
import Inventario from "./pages/Inventario";
import Login from "./pages/Login";
import MfaEnroll from "./pages/MfaEnroll";
import Pacientes from "./pages/Pacientes";
import Presupuestos from "./pages/Presupuestos";
import Reportes from "./pages/Reportes";
import Usuarios from "./pages/Usuarios";

// Navegación por rol: cada sección exige un permiso del API (RNF-05, RNF-08).
const SECTIONS: { id: string; label: string; perm: string; Page: ComponentType }[] = [
  { id: "pacientes", label: "Pacientes", perm: "pacientes:leer", Page: Pacientes },
  { id: "agenda", label: "Agenda", perm: "agenda:leer", Page: Agenda },
  { id: "caja", label: "Caja", perm: "caja:gestionar", Page: Caja },
  { id: "clinico", label: "Expediente clínico", perm: "clinico:leer", Page: Expediente },
  { id: "presupuestos", label: "Presupuestos", perm: "presupuestos:leer", Page: Presupuestos },
  { id: "inventario", label: "Inventario", perm: "inventario:leer", Page: Inventario },
  { id: "honorarios", label: "Honorarios", perm: "honorarios:leer", Page: Honorarios },
  { id: "reportes", label: "Reportes", perm: "reportes:leer", Page: Reportes },
  { id: "catalogos", label: "Catálogos", perm: "catalogos:gestionar", Page: Catalogos },
  { id: "usuarios", label: "Usuarios", perm: "usuarios:gestionar", Page: Usuarios },
  { id: "auditoria", label: "Auditoría", perm: "auditoria:leer", Page: Auditoria },
];

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  ODONTOLOGO: "Odontólogo",
  RECEPCIONISTA: "Recepcionista / Cajero",
  ASISTENTE: "Asistente dental",
  AUDITOR: "Auditor / Contador",
};

function Shell() {
  const { me, logout } = useAuth();
  const [active, setActive] = useState<string>("");
  const [menu, setMenu] = useState(false);
  if (!me) return null;

  const allowed = SECTIONS.filter((s) => me.permissions.includes(s.perm));
  const current = allowed.find((s) => s.id === active) ?? allowed[0];

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <header className="flex items-center justify-between bg-sky-800 px-4 py-3 text-white md:hidden">
        <span className="font-semibold">SIGO-Dental</span>
        <button aria-label="Menú" onClick={() => setMenu(!menu)} className="px-2 text-xl">☰</button>
      </header>
      <aside className={`${menu ? "block" : "hidden"} md:block md:w-60 md:min-h-screen bg-sky-900 text-white p-4`}>
        <div className="hidden md:block mb-6 text-xl font-semibold">SIGO-Dental</div>
        <nav className="space-y-1">
          {allowed.map((s) => (
            <button
              key={s.id}
              onClick={() => { setActive(s.id); setMenu(false); }}
              className={`block w-full rounded-lg px-3 py-2 text-left ${current?.id === s.id ? "bg-sky-700" : "hover:bg-sky-800"}`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="mt-8 border-t border-sky-700 pt-4 text-sm">
          <div className="font-medium">{me.name}</div>
          <div className="text-sky-200">{ROLE_LABEL[me.role] ?? me.role}</div>
          <button onClick={logout} className="mt-3 rounded-lg border border-sky-400 px-3 py-1 hover:bg-sky-800">Cerrar sesión</button>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-8">{current && <current.Page key={current.id} />}</main>
    </div>
  );
}

function Gate() {
  const { me, loading, enrollRequired } = useAuth();
  if (loading) return <p className="p-8 text-slate-500">Cargando…</p>;
  if (!me) return <Login />;
  if (enrollRequired) return <MfaEnroll />;
  return <Shell />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
