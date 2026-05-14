import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "cat_notes_panel";
const p2 = (n: number) => String(n).padStart(2, "0");

interface NoteEntry {
  id: string;
  text: string;
  date: string;
  time: string;
  notified5?: boolean;
}

export default function NotesPanel() {
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [entries, setEntries] = useState<NoteEntry[]>([]);
  const entriesRef = useRef<NoteEntry[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setEntries(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => { entriesRef.current = entries; }, [entries]);

  const persist = (list: NoteEntry[]) => {
    setEntries(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  };

  // Verifica a cada 30s se algum agendamento está a ~5 min e dispara Slack
  useEffect(() => {
    const check = async () => {
      const list = entriesRef.current;
      const now = Date.now();
      let changed = false;
      const updated = await Promise.all(list.map(async (e) => {
        if (e.notified5 || !e.date || !e.time) return e;
        const target = new Date(`${e.date}T${e.time}:00`).getTime();
        if (isNaN(target)) return e;
        const diff = target - now;
        if (diff > 0 && diff <= 5 * 60 * 1000) {
          try {
            await supabase.functions.invoke("slack-notify", {
              body: {
                type: "agendado_5min",
                analista: "Bruno",
                cliente: e.text.slice(0, 80),
                licenca: "—",
                horaAgendada: `${e.date} ${e.time}`,
              },
            });
          } catch (err) {
            console.error("Slack notify falhou:", err);
          }
          changed = true;
          return { ...e, notified5: true };
        }
        return e;
      }));
      if (changed) persist(updated);
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  const handleSave = () => {
    if (!notes.trim()) return;
    const now = new Date();
    const date = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    const time = `${p2(now.getHours())}:${p2(now.getMinutes())}`;
    const entry: NoteEntry = { id: crypto.randomUUID(), text: notes.trim(), date, time };
    persist([entry, ...entries]);
    setNotes("");
    setDirty(false);
  };

  const updateEntry = (id: string, changes: Partial<NoteEntry>) => {
    // Ao alterar data/hora, reativa o aviso
    persist(entries.map(e => (e.id === id ? { ...e, ...changes, notified5: false } : e)));
  };

  const deleteEntry = (id: string) => {
    persist(entries.filter(e => e.id !== id));
  };

  return (
    <div className="bg-card border-[3px] border-black rounded-xl p-5 mb-6" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="text-base font-extrabold text-accent mb-4 flex items-center gap-2">
        <span className="text-lg">📝</span> Painel de Anotações
      </div>

      <textarea
        value={notes}
        onChange={e => { setNotes(e.target.value); setDirty(true); }}
        placeholder="Escreva suas anotações aqui..."
        className="w-full min-h-[140px] text-sm bg-muted border-2 border-border rounded-lg px-4 py-3 text-foreground outline-none focus:border-primary resize-y transition-colors"
      />

      <div className="flex justify-end mt-3">
        <button
          onClick={handleSave}
          disabled={!dirty || !notes.trim()}
          className={`text-sm px-5 py-2.5 rounded-lg font-bold transition-all shadow-sm ${
            dirty && notes.trim()
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          💾 Salvar
        </button>
      </div>

      {entries.length > 0 && (
        <div className="mt-5 space-y-3">
          <div className="text-xs uppercase font-bold text-muted-foreground tracking-wider border-b-2 border-border/60 pb-2">
            📌 Anotações salvas ({entries.length})
          </div>
          {entries.map(entry => (
            <div
              key={entry.id}
              className="bg-muted/50 border-2 border-border/80 rounded-lg p-4 flex flex-col gap-2.5 hover:border-border transition-colors"
            >
              <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{entry.text}</div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-xs uppercase font-bold text-muted-foreground tracking-wider">
                  Agendado para:
                </span>
                <input
                  type="date"
                  value={entry.date}
                  onChange={e => updateEntry(entry.id, { date: e.target.value })}
                  className="text-xs bg-background border-2 border-border rounded-lg px-2.5 py-1 text-foreground outline-none focus:border-primary"
                />
                <input
                  type="time"
                  value={entry.time}
                  onChange={e => updateEntry(entry.id, { time: e.target.value })}
                  className="text-xs bg-background border-2 border-border rounded-lg px-2.5 py-1 text-foreground outline-none focus:border-primary"
                />
                {entry.notified5 && (
                  <span className="text-xs px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-500 font-bold border border-emerald-500/30">
                    ✓ Slack avisado
                  </span>
                )}
                <div className="flex-1" />
                <button
                  onClick={() => deleteEntry(entry.id)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-destructive/10 text-destructive font-bold hover:bg-destructive/20 transition-colors border border-destructive/20"
                  title="Excluir"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
