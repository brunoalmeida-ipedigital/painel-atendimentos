import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Agendamento {
  id: string;
  nome: string;
  licenca: string;
  data_hora: string;
  notificado: boolean;
  created_at: string;
}

export default function AgendamentosPanel() {
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [form, setForm] = useState({ nome: "", licenca: "", data_hora: "" });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("agendamentos")
      .select("*")
      .order("data_hora", { ascending: true });
    setAgendamentos((data as Agendamento[]) || []);
  };

  useEffect(() => { load(); }, []);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("agendamentos_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "agendamentos" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const add = async () => {
    if (!form.nome || !form.licenca || !form.data_hora) return;
    setLoading(true);
    await supabase.from("agendamentos").insert({
      nome: form.nome,
      licenca: form.licenca,
      data_hora: new Date(form.data_hora).toISOString(),
    });
    setForm({ nome: "", licenca: "", data_hora: "" });
    setLoading(false);
    load();
  };

  const remove = async (id: string) => {
    await supabase.from("agendamentos").delete().eq("id", id);
    load();
  };

  const now = new Date();

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">📅</span>
        <h2 className="text-base font-bold text-foreground">Agendamentos Independentes</h2>
        <span className="text-xs bg-accent/20 text-accent font-bold px-2 py-0.5 rounded-full">{agendamentos.length}</span>
      </div>

      {/* Form */}
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
          <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Nome</label>
          <input
            type="text"
            placeholder="Nome do cliente"
            value={form.nome}
            onChange={e => setForm({ ...form, nome: e.target.value })}
            className="text-sm bg-muted border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Licença</label>
          <input
            type="text"
            placeholder="12345"
            value={form.licenca}
            onChange={e => setForm({ ...form, licenca: e.target.value })}
            className="text-sm bg-muted border border-border rounded-lg px-3 py-2 w-28 text-foreground outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Data e Hora</label>
          <input
            type="datetime-local"
            value={form.data_hora}
            onChange={e => setForm({ ...form, data_hora: e.target.value })}
            className="text-sm bg-muted border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:border-primary"
          />
        </div>
        <button
          onClick={add}
          disabled={loading}
          className="bg-primary text-primary-foreground text-sm font-bold rounded-lg px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? "..." : "➕ Agendar"}
        </button>
      </div>

      {/* List */}
      {agendamentos.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Nenhum agendamento independente.</p>
      ) : (
        <div className="space-y-1.5">
          {agendamentos.map(ag => {
            const dt = new Date(ag.data_hora);
            const isPast = dt < now;
            const diffMs = dt.getTime() - now.getTime();
            const isClose = diffMs > 0 && diffMs <= 5 * 60000;
            return (
              <div
                key={ag.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all ${
                  isPast
                    ? "bg-muted/50 border-border/50 opacity-60"
                    : isClose
                    ? "bg-destructive/10 border-destructive/30"
                    : "bg-card border-border"
                }`}
              >
                <span className="text-lg">{ag.notificado ? "✅" : isClose ? "⏰" : "📅"}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-sm text-foreground truncate block">{ag.nome}</span>
                  <span className="text-xs text-muted-foreground">Lic: {ag.licenca}</span>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs font-bold text-foreground">
                    {dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} {dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  {!isPast && (
                    <div className={`text-[0.6rem] font-semibold ${isClose ? "text-destructive" : "text-muted-foreground"}`}>
                      {isClose ? "⚠ Em breve!" : `em ${Math.floor(diffMs / 60000)}min`}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => remove(ag.id)}
                  className="text-xs text-destructive hover:bg-destructive/10 rounded px-2 py-1 transition-colors"
                  title="Remover"
                >🗑</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
