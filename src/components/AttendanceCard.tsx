import { useState, useEffect } from "react";

// ── Config ──
const ETAPAS = [
  "Caixa de entrada", "Analista Selecionado", "Hora primeiro contato - TMR",
  "Cliente Agendado/Reagendado", "Parado", "Em Configuração",
  "FINALIZADO EM", "Arquivado", "Concluído"
];
const CCOR: Record<string, string> = {
  NFe: "badge-nfe", "NFe SC": "badge-nfesc", "Boleto Fácil": "badge-bol",
  "Boleto Tradicional": "badge-bolt", TEF: "badge-tef", Impressora: "badge-imp", Etiqueta: "badge-eti",
};
const CHEX: Record<string, string> = {
  "NFC/NFe": "#2563eb", "NFe": "#2563eb", "NFC-SC": "#7c3aed", "NFe SC": "#7c3aed",
  "SAT": "#16a34a", "MFe": "#0d9488",
  "Boleto Fácil": "#0891b2", "Boleto Tradicional": "#0369a1",
  "ECF": "#65a30d", "TEF": "#15803d",
  "Impressora Térmica": "#ea580c", "Impressora": "#ea580c",
  "Etiquetas": "#d97706", "Etiqueta": "#d97706",
  "Whatsapp": "#22c55e", "Equipamento POS": "#a855f7", "POS": "#a855f7",
  "Conciliadora": "#db2777", "Máquina recorte": "#7c2d12",
  "Ótica Zap Pro": "#9333ea", "Tablet": "#0ea5e9",
  "XML": "#475569", "Sistema ssOtica": "#1e40af", "ssOtica": "#1e40af",
  "Pjbank": "#be123c", "Outros": "#64748b",
};

const p2 = (n: number) => String(n).padStart(2, "0");
const fmt = (ms: number) => {
  if (ms < 0) return "00:00:00";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h >= 24) { const d = Math.floor(h / 24); return `${d}d ${p2(h % 24)}:${p2(m)}:${p2(s)}`; }
  return `${p2(h)}:${p2(m)}:${p2(s)}`;
};

const LIM = 4 * 3600000;
const AV20 = 20 * 60000;
const AV10 = 10 * 60000;

export interface Atendimento {
  id: string;
  lic: string;
  cli: string;
  cel: string;
  clas: string;
  dem: string;
  stat: string;
  etapa: string;
  tentativas: boolean[];
  abertoEm: number;
  encerrado: boolean;
  encerradoEm?: number | null;
  horaContato: string;
  analista: string;
  comentario: string;
  a20: boolean;
  a10: boolean;
  a4h: boolean;
  aAgd: boolean;
  a05: boolean;
  agendadoEm?: string;
  _original?: unknown;
}

interface Props {
  item: Atendimento;
  index: number;
  now: Date;
  onUpdateCard: (id: string, changes: Partial<Atendimento>) => void;
  onComment: (id: string, text: string) => void;
  onEdit: (item: Atendimento) => void;
  onCopyMsg: (item: Atendimento) => void;
  onToggleTent: (id: string, i: number) => void;
  fAnalista: string;
}

const parseDate = (val: string | null | undefined) => {
  if (!val) return null;
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d;
  return null;
};

export default function AttendanceCard({ item: a, now, onUpdateCard, onEdit, onCopyMsg, onToggleTent, fAnalista }: Props) {
  const nowTs = now.getTime();
  const ab = a.abertoEm || nowTs;
  const el = a.encerrado ? (a.encerradoEm || nowTs) - ab : nowTs - ab;
  const rest = LIM - el;

  const isVencido = rest < 0;
  const timeClass = a.encerrado
    ? "text-muted-foreground"
    : isVencido || rest <= AV10
      ? "text-destructive"
      : rest <= AV20
        ? "text-yellow-400"
        : "text-emerald-400";

  // Ensure 6 tentativas
  const tentativas = [...(a.tentativas || [])];
  while (tentativas.length < 6) tentativas.push(false);

  // 1º contato (índice 0) — comportamento preservado
  const isHoraContato = (a.etapa || "").toLowerCase().includes("hora primeiro contato");
  const ela = nowTs - (a.abertoEm || 0);

  // Parse existing notes/timestamp from comentario (format: "notes\n\n[salvo em: YYYY-MM-DD HH:mm]")
  const parseStored = (raw: string) => {
    const m = raw.match(/^([\s\S]*?)\n\n\[salvo em: (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\]\s*$/);
    if (m) return { text: m[1], date: m[2], time: m[3] };
    return { text: raw, date: "", time: "" };
  };

  // Local notes state with dirty flag
  const initial = parseStored(a.comentario || "");
  const [notes, setNotes] = useState(initial.text);
  const [savedDate, setSavedDate] = useState(initial.date);
  const [savedTime, setSavedTime] = useState(initial.time);
  const [showTimestamp, setShowTimestamp] = useState(!!initial.date);
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!dirty) {
      const p = parseStored(a.comentario || "");
      setNotes(p.text);
      setSavedDate(p.date);
      setSavedTime(p.time);
      setShowTimestamp(!!p.date);
    }
  }, [a.comentario, dirty]);

  const compose = (text: string, date: string, time: string) =>
    date && time ? `${text}\n\n[salvo em: ${date} ${time}]` : text;

  const handleSave = () => {
    const now = new Date();
    const d = savedDate || `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    const t = savedTime || `${p2(now.getHours())}:${p2(now.getMinutes())}`;
    setSavedDate(d);
    setSavedTime(t);
    setShowTimestamp(true);
    onUpdateCard(a.id, { comentario: compose(notes, d, t) });
    setDirty(false);
  };

  const handleTimestampChange = (d: string, t: string) => {
    setSavedDate(d);
    setSavedTime(t);
    onUpdateCard(a.id, { comentario: compose(notes, d, t) });
  };

  const isAgendado = (a.etapa || "").toLowerCase().includes("agendado");
  const agendadoDate = parseDate(a.agendadoEm || a.horaContato);

  return (
    <div
      className={`rounded-xl border-[3px] border-black bg-card p-3.5 flex flex-col gap-2.5 transition-all hover:border-primary/80 hover:shadow-lg ${
        a.encerrado ? "opacity-60" : ""
      } ${a.dem === "Alta" && !a.encerrado ? "ring-2 ring-destructive/50 shadow-destructive/20 shadow-md" : ""}`}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`w-2.5 h-2.5 rounded-full ${a.dem === "Alta" ? "bg-destructive" : "bg-yellow-400"}`} />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(a.lic || ""); }}
              title="Clique para copiar a licença"
              className="font-mono text-sm font-bold text-primary bg-primary/10 px-2 py-1 rounded-md hover:bg-primary/25 hover:text-primary transition-colors cursor-pointer border border-primary/20"
            >
              {a.lic}
            </button>
            <span
              className="text-xs font-bold px-2.5 py-1 rounded-md border"
              style={{
                background: `${CHEX[a.clas] || "#2563eb"}18`,
                color: CHEX[a.clas] || "#2563eb",
                borderColor: `${CHEX[a.clas] || "#2563eb"}40`,
              }}
            >
              {a.clas}
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(a.cli || "")}
            title="Clique para copiar o nome"
            className="font-bold text-base text-foreground truncate text-left w-full hover:text-primary transition-colors cursor-pointer leading-tight"
          >
            {a.cli || "—"}
          </button>
          {a.cel && (
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(a.cel || "")}
              title="Clique para copiar o telefone"
              className="text-sm text-muted-foreground hover:text-primary transition-colors cursor-pointer truncate text-left w-full font-medium"
            >
              📞 {a.cel}
            </button>
          )}
          {expanded && a.analista && (
            <div className="text-xs text-muted-foreground truncate font-medium mt-0.5">👤 {a.analista}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {expanded && (
            <span className={`font-mono text-sm font-bold ${timeClass}`}>{fmt(el)}</span>
          )}
          {expanded && isAgendado && agendadoDate && (
            <span className="text-xs font-bold px-2 py-1 rounded-md bg-yellow-400/20 text-yellow-500 border border-yellow-400/30">
              📅 {agendadoDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} {agendadoDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="text-muted-foreground text-sm hover:text-foreground px-1.5 py-0.5 rounded-md hover:bg-muted transition-all"
            title={expanded ? "Recolher" : "Expandir"}
          >
            {expanded ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {expanded && (<>

      {/* Etapa selector */}
      {!a.encerrado && (
        <select
          className="text-[0.7rem] bg-muted border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary w-full"
          value={a.etapa}
          onChange={(e) => {
            const newEtapa = e.target.value;
            const changes: Partial<Atendimento> = { etapa: newEtapa };
            if (newEtapa.toLowerCase().includes("hora primeiro contato")) {
              const nt = [...tentativas];
              nt[0] = true;
              changes.tentativas = nt;
            }
            onUpdateCard(a.id, changes);
          }}
        >
          {ETAPAS.map((e) => (<option key={e} value={e}>{e}</option>))}
          {!ETAPAS.includes(a.etapa) && <option value={a.etapa}>{a.etapa}</option>}
        </select>
      )}

      {/* Tentativas — 1º contato preservado + checkboxes simples 2 a 6 */}
      <div>
        <div className="text-[0.6rem] uppercase font-bold text-muted-foreground tracking-wider mb-1">
          Tentativas de contato
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {/* 1º contato — lógica original */}
          {(() => {
            const done = tentativas[0];
            let cls = "bg-muted border-border text-muted-foreground";
            let label: string = "1";
            if (isHoraContato) {
              cls = ela > 8 * 3600000
                ? "bg-destructive border-destructive text-destructive-foreground"
                : "bg-emerald-500 border-emerald-500 text-white";
              label = "✓";
            } else if (done) {
              cls = "bg-primary border-primary text-primary-foreground";
              label = "✓";
            }
            return (
              <button
                key={0}
                title="1º contato"
                className={`w-9 h-9 rounded-md text-[0.7rem] font-bold border flex items-center justify-center transition-all ${cls}`}
                onClick={() => { if (!isHoraContato) onToggleTent(a.id, 0); }}
                style={{ cursor: isHoraContato ? "not-allowed" : "pointer", opacity: isHoraContato ? 0.85 : 1 }}
              >
                {label}
              </button>
            );
          })()}

          {/* Tentativas 2 a 6 — apenas toggle simples */}
          {[1, 2, 3, 4, 5].map((i) => {
            const done = tentativas[i];
            return (
              <label
                key={i}
                className={`w-9 h-9 rounded-md text-[0.7rem] font-bold border flex items-center justify-center cursor-pointer transition-all select-none ${
                  done
                    ? "bg-primary border-primary text-primary-foreground"
                    : "bg-muted border-border text-muted-foreground hover:border-primary/50"
                }`}
                title={`Tentativa ${i + 1}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={!!done}
                  onChange={() => onToggleTent(a.id, i)}
                />
                {done ? "✓" : i + 1}
              </label>
            );
          })}
        </div>
      </div>

      {/* Anotações */}
      <div>
        <div className="text-[0.6rem] uppercase font-bold text-muted-foreground tracking-wider mb-1">
          Anotações
        </div>
        <textarea
          value={notes}
          onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
          placeholder="Escreva informações livres..."
          className="w-full min-h-[80px] text-xs bg-muted border border-border rounded-md px-2 py-1.5 text-foreground outline-none focus:border-primary resize-y"
        />
        {showTimestamp && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span className="text-[0.6rem] uppercase font-bold text-muted-foreground tracking-wider">Salvo em:</span>
            <input
              type="date"
              value={savedDate}
              onChange={(e) => handleTimestampChange(e.target.value, savedTime)}
              className="text-[0.7rem] bg-muted border border-border rounded px-1.5 py-0.5 text-foreground outline-none focus:border-primary"
            />
            <input
              type="time"
              value={savedTime}
              onChange={(e) => handleTimestampChange(savedDate, e.target.value)}
              className="text-[0.7rem] bg-muted border border-border rounded px-1.5 py-0.5 text-foreground outline-none focus:border-primary"
            />
          </div>
        )}
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
        <button
          onClick={handleSave}
          disabled={!dirty}
          className={`text-xs px-3 py-1.5 rounded-md font-semibold transition-all ${
            dirty
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          💾 Salvar
        </button>
        <button
          onClick={() => onEdit(a)}
          className="text-xs px-2 py-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Editar"
        >✏️</button>
        <button
          onClick={() => onCopyMsg(a)}
          className="text-xs px-2 py-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Copiar mensagem"
        >📋</button>
        <div className="flex-1" />
        {a.encerrado ? (
          <button
            className="text-[0.7rem] px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 font-semibold hover:bg-blue-500/20 transition-colors"
            onClick={() => onUpdateCard(a.id, { etapa: "Analista Selecionado", encerrado: false, encerradoEm: null })}
          >↩</button>
        ) : (
          <button
            className="text-[0.7rem] px-2 py-1 rounded-md bg-destructive/10 text-destructive font-semibold hover:bg-destructive/20 transition-colors"
            onClick={() => onUpdateCard(a.id, { etapa: "FINALIZADO EM", encerrado: true, encerradoEm: Date.now() })}
          >✕ Encerrar</button>
        )}
      </div>
      </>)}
    </div>
  );
}
