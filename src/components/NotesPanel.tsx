import { useState, useEffect } from "react";

const STORAGE_KEY = "cat_notes_panel";
const p2 = (n: number) => String(n).padStart(2, "0");

interface NoteEntry {
  id: string;
  text: string;
  date: string;
  time: string;
}

export default function NotesPanel() {
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [entries, setEntries] = useState<NoteEntry[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setEntries(JSON.parse(raw));
    } catch {}
  }, []);

  const persist = (list: NoteEntry[]) => {
    setEntries(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  };

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
    persist(entries.map(e => (e.id === id ? { ...e, ...changes } : e)));
  };

  const deleteEntry = (id: string) => {
    persist(entries.filter(e => e.id !== id));
  };

  return (
    <div className="bg-card border-2 border-black rounded-xl p-5 mb-6" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="text-sm font-bold text-accent mb-3">📝 Painel de Anotações</div>

      <textarea
        value={notes}
        onChange={e => { setNotes(e.target.value); setDirty(true); }}
        placeholder="Escreva suas anotações aqui..."
        className="w-full min-h-[120px] text-sm bg-muted border border-border rounded-md px-3 py-2 text-foreground outline-none focus:border-primary resize-y"
      />

      <div className="flex justify-end mt-2">
        <button
          onClick={handleSave}
          disabled={!dirty || !notes.trim()}
          className={`text-xs px-4 py-2 rounded-md font-semibold transition-all ${
            dirty && notes.trim()
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          💾 Salvar
        </button>
      </div>

      {entries.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-[0.65rem] uppercase font-bold text-muted-foreground tracking-wider">
            Anotações salvas
          </div>
          {entries.map(entry => (
            <div
              key={entry.id}
              className="bg-muted/50 border border-border rounded-md p-3 flex flex-col gap-2"
            >
              <div className="text-sm text-foreground whitespace-pre-wrap">{entry.text}</div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[0.6rem] uppercase font-bold text-muted-foreground tracking-wider">
                  Salvo em:
                </span>
                <input
                  type="date"
                  value={entry.date}
                  onChange={e => updateEntry(entry.id, { date: e.target.value })}
                  className="text-[0.7rem] bg-background border border-border rounded px-1.5 py-0.5 text-foreground outline-none focus:border-primary"
                />
                <input
                  type="time"
                  value={entry.time}
                  onChange={e => updateEntry(entry.id, { time: e.target.value })}
                  className="text-[0.7rem] bg-background border border-border rounded px-1.5 py-0.5 text-foreground outline-none focus:border-primary"
                />
                <div className="flex-1" />
                <button
                  onClick={() => deleteEntry(entry.id)}
                  className="text-[0.7rem] px-2 py-1 rounded-md bg-destructive/10 text-destructive font-semibold hover:bg-destructive/20 transition-colors"
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
