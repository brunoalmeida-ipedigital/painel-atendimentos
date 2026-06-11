import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import AttendanceCard, { type Atendimento } from "@/components/AttendanceCard";
import Dashboard from "@/components/Dashboard";
import AgendamentosPanel from "@/components/AgendamentosPanel";
import EmailsPanel from "@/components/EmailsPanel";
import NotesPanel from "@/components/NotesPanel";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { businessElapsed } from "@/lib/businessTime";

// ── Config ────────────────────────────────────────────────────────
const ETAPAS = [
  "Caixa de entrada", "Analista Selecionado", "Hora primeiro contato - TMR",
  "Cliente Agendado/Reagendado", "Parado", "Em Configuração",
  "FINALIZADO EM", "Arquivado", "Concluído"
];

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

const LIM = 4 * 3600000;
const AV20 = 20 * 60000;
const AV05 = 5 * 60000;

// ── Slack via Edge Function ──
const slackNotify = async (payload: Record<string, unknown>) => {
  try {
    const analista = String(payload.analista || "").toUpperCase();
    if (analista !== "BRUNO") return;
    await supabase.functions.invoke("slack-notify", { body: payload });
  } catch (e) {
    console.warn("Slack notify failed:", e);
  }
};

// ── DB helpers ──
const rowFromAt = (a: Atendimento) => ({
  pipefy_card_id: a.id,
  lic: a.lic || "",
  cli: a.cli || "",
  cel: a.cel || "",
  clas: a.clas || "NFe",
  dem: a.dem || "Média",
  stat: a.stat || "",
  etapa: a.etapa || "Caixa de entrada",
  analista: a.analista || "",
  comentario: a.comentario || "",
  hora_contato: a.horaContato || "",
  tentativas: a.tentativas || [false, false, false, false, false, false, false, false],
  aberto_em: a.abertoEm || Date.now(),
  encerrado: a.encerrado || false,
  encerrado_em: a.encerradoEm || null,
  agendado_em: a.agendadoEm || "",
  a20: a.a20 || false,
  a10: a.a10 || false,
  a4h: a.a4h || false,
  a_agd: a.aAgd || false,
  a05: a.a05 || false,
});

const upsertAtendimento = async (a: Atendimento) => {
  const { error } = await supabase.from("atendimentos").upsert(rowFromAt(a), { onConflict: "pipefy_card_id" });
  if (error) console.warn("DB upsert error:", error.message);
};

const upsertMany = async (items: Atendimento[]) => {
  if (!items.length) return;
  const { error } = await supabase.from("atendimentos").upsert(items.map(rowFromAt), { onConflict: "pipefy_card_id" });
  if (error) console.warn("DB bulk upsert error:", error.message);
};

const deleteAtendimento = async (id: string) => {
  const { error } = await supabase.from("atendimentos").delete().eq("pipefy_card_id", id);
  if (error) console.warn("DB delete error:", error.message);
};

const dbRowToAtendimento = (r: any): Atendimento => ({
  id: r.pipefy_card_id || r.id,
  lic: r.lic || "",
  cli: r.cli || "",
  cel: r.cel || "",
  clas: r.clas || "NFe",
  dem: r.dem || "Média",
  stat: r.stat || "",
  etapa: r.etapa || "Caixa de entrada",
  analista: r.analista || "",
  comentario: r.comentario || "",
  horaContato: r.hora_contato || "",
  tentativas: r.tentativas || [false, false, false, false, false, false, false, false],
  abertoEm: r.aberto_em || Date.now(),
  encerrado: r.encerrado || false,
  encerradoEm: r.encerrado_em || null,
  agendadoEm: r.agendado_em || "",
  a20: r.a20 || false,
  a10: r.a10 || false,
  a4h: r.a4h || false,
  aAgd: r.a_agd || false,
  a05: r.a05 || false,
});

const loadFromDB = async (): Promise<Atendimento[]> => {
  const { data, error } = await supabase.from("atendimentos").select("*").order("aberto_em", { ascending: true });
  if (error) { console.warn("DB load error:", error.message); return []; }
  return (data || []).map(dbRowToAtendimento);
};

const parseDate = (val: string | null | undefined) => {
  if (!val) return null;
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
  }
  if (typeof val === "string" && val.includes("/")) {
    const [datePart, timePart] = val.split(" ");
    const parts = datePart.split("/");
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const fullYear = year.length === 2 ? `20${year}` : year;
      const iso = `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${timePart || "00:00:00"}`;
      const d2 = new Date(iso);
      if (!isNaN(d2.getTime())) return d2;
    }
  }
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    const localVal = val.includes("T") ? val : val + "T00:00:00";
    const d = new Date(localVal);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d;
  return null;
};

// Parse date from spreadsheet cell (string, number serial, or Date)
const parseSheetDate = (val: unknown): number => {
  if (val == null || val === "") return Date.now();
  if (val instanceof Date) return val.getTime();
  if (typeof val === "number") {
    // Excel serial date (days since 1899-12-30)
    const ms = Math.round((val - 25569) * 86400 * 1000);
    return ms;
  }
  const d = parseDate(String(val));
  return d ? d.getTime() : Date.now();
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
const fmtM = (ms: number) => {
  if (!ms || isNaN(ms)) return "—";
  if (ms <= 0) return "Vencido!";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) { const d = Math.floor(h / 24); return `${d}d ${h % 24}h`; }
  return h > 0 ? `${h}h ${p2(m)}m` : `${m}m`;
};

// Normalize a header for matching (lowercase, no accents, no spaces)
const normKey = (s: string) =>
  s.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

const HEADER_ALIASES: Record<string, string[]> = {
  dem: ["prioridade", "demanda"],
  clas: ["classificacao", "classificao", "categoria", "clas"],
  lic: ["licenca", "licen", "lic"],
  cli: ["cliente", "nome", "cli"],
  cel: ["telefone", "celular", "tel", "fone"],
  etapa: ["etapa", "fase", "status"],
  abertoEm: ["abertoem", "dataabertura", "abertura", "aberto"],
  comentario: ["observacao", "obs", "observacoes", "comentario", "nota"],
};

const mapHeaders = (headers: string[]): Record<string, number> => {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const k = normKey(h);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(k)) { map[field] = i; break; }
    }
  });
  return map;
};

export default function Index() {
  const [data, setData] = useState<Atendimento[]>([]);
  const [now, setNow] = useState(new Date());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const slackSent = useRef(new Set<string>());
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("cat_dark");
    return saved === null ? true : saved === "true";
  });

  const [activeTab, setActiveTab] = useState<"list" | "dashboard" | "agendamentos" | "emails">("list");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Contato de hoje — armazenado por id+data, reseta a cada dia
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  };
  const [contatadoHoje, setContatadoHoje] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem("cat_contatado_hoje");
      if (!raw) return {};
      const obj = JSON.parse(raw) as Record<string, string>;
      const today = todayKey();
      const cleaned: Record<string, string> = {};
      Object.entries(obj).forEach(([k, v]) => { if (v === today) cleaned[k] = v; });
      return cleaned;
    } catch { return {}; }
  });
  const toggleContatadoHoje = (id: string) => {
    setContatadoHoje(prev => {
      const today = todayKey();
      const n = { ...prev };
      if (n[id] === today) delete n[id]; else n[id] = today;
      localStorage.setItem("cat_contatado_hoje", JSON.stringify(n));
      return n;
    });
  };

  const [busca, setBusca] = useState("");
  const [fClas, setFClas] = useState("");
  const [fDem, setFDem] = useState("");
  const [fAnalista, setFAnalista] = useState(() => localStorage.getItem("cat_fAnalista") || "BRUNO");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("cat_dark", String(darkMode));
  }, [darkMode]);

  const [alerta, setAlerta] = useState<{ tipo: string; titulo: string; cli: string; msg: string } | null>(null);
  const [modEdit, setModEdit] = useState<Atendimento | null>(null);
  const [coment, setComent] = useState<{ id: string; text: string } | null>(null);

  const [novo, setNovo] = useState({ lic: "", cli: "", cel: "", horaContato: "", clas: "NFe", dem: "Alta", stat: "Normal" });
  const fLicRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") Notification.requestPermission();
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const toast = (msg: string, time = 3000) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), time); };

  const audioCtxRef = useRef<AudioContext | null>(null);
  const beep = (freq: number, dur: number) => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.3, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch {}
  };

  // ── Load from DB on mount ──
  useEffect(() => {
    loadFromDB().then(rows => setData(rows));
  }, []);

  // Check retries & agendamento alerts every 60s
  useEffect(() => {
    const checkRetries = async () => {
      try { await supabase.functions.invoke("check-retries"); } catch (e) { console.warn("check-retries error:", e); }
    };
    checkRetries();
    const interval = setInterval(checkRetries, 60000);
    return () => clearInterval(interval);
  }, []);

  // Alert worker + Slack SLA alerts
  useEffect(() => {
    let alertToSet: any = null;
    setData(prev => {
      if (!Array.isArray(prev)) return [];
      let changed = false;
      const n = [...prev];
      const nowTs = now.getTime();
      n.filter(a => a && !a.encerrado).forEach(a => {
        const el = businessElapsed(a.abertoEm || 0, nowTs);
        const rest = LIM - el;
        const isMe = !fAnalista || a.analista === fAnalista;
        const isAnSel = (a.etapa || "").toLowerCase().includes("analista selecionado");
        if (isAnSel) {
          if (rest <= AV20 && rest > AV05 && !a.a20) {
            a.a20 = true; changed = true;
            const key = `20_${a.id}`;
            if (!slackSent.current.has(key)) {
              slackSent.current.add(key);
              slackNotify({ type: "alerta_20min", analista: a.analista, cliente: a.cli, licenca: a.lic, minutos: Math.ceil(rest / 60000) });
            }
            if (isMe) alertToSet = { tipo: "urgente", titulo: "ATENÇÃO — PRAZO!", cli: a.cli.toUpperCase(), msg: `FALTAM ${Math.ceil(rest / 60000)} MINUTOS PARA O PRAZO DE 4H.` };
          }
          if (rest <= AV05 && rest > 0 && !a.a05) {
            a.a05 = true; changed = true;
            const key = `05_${a.id}`;
            if (!slackSent.current.has(key)) {
              slackSent.current.add(key);
              slackNotify({ type: "alerta_5min", analista: a.analista, cliente: a.cli, licenca: a.lic, minutos: Math.ceil(rest / 60000) });
            }
            if (isMe) alertToSet = { tipo: "urgente", titulo: "PRAZO CRÍTICO!", cli: a.cli.toUpperCase(), msg: `APENAS ${Math.ceil(rest / 60000)} MINUTOS RESTANTES!` };
          }
          if (rest <= 0 && !a.a4h) {
            a.a4h = true; changed = true;
            const key = `4h_${a.id}`;
            if (!slackSent.current.has(key)) {
              slackSent.current.add(key);
              slackNotify({ type: "prazo_vencido", analista: a.analista, cliente: a.cli, licenca: a.lic });
            }
            if (isMe) alertToSet = { tipo: "urgente", titulo: "PRAZO VENCIDO!", cli: a.cli.toUpperCase(), msg: "PRAZO DE 4H VENCIDO! RESOLVA IMEDIATAMENTE." };
          }
        }

        const isAgendado = (a.etapa || "").toLowerCase().includes("agendado");
        if (isAgendado && a.horaContato && !a.aAgd) {
          const agd = parseDate(a.horaContato);
          if (agd) {
            const diff = agd.getTime() - nowTs;
            if (diff <= 5 * 60000 && diff > 0) {
              a.aAgd = true; changed = true;
              const key = `agd_${a.id}`;
              if (!slackSent.current.has(key)) {
                slackSent.current.add(key);
                slackNotify({ type: "agendado_5min", analista: a.analista, cliente: a.cli, licenca: a.lic, horaAgendada: agd.toLocaleTimeString("pt-BR") });
              }
              if (isMe) alertToSet = { tipo: "urgente", titulo: "📅 AGENDAMENTO EM 5 MIN!", cli: a.cli.toUpperCase(), msg: `Horário agendado: ${agd.toLocaleTimeString("pt-BR")}` };
            }
          }
        }
      });
      if (changed) {
        const changedItems = n.filter(a => a && !a.encerrado);
        upsertMany(changedItems);
      }
      return changed ? n : prev;
    });
    if (alertToSet) { setAlerta(alertToSet); beep(700, 0.8); }
  }, [now, fAnalista]);

  // ── Realtime subscription ──
  useEffect(() => {
    const channel = supabase
      .channel("atendimentos_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "atendimentos" }, (payload) => {
        if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
          const row = payload.new;
          const updated = dbRowToAtendimento(row);
          setData(prev => {
            const idx = prev.findIndex(a => a.id === updated.id);
            if (idx >= 0) {
              const n = [...prev];
              n[idx] = { ...n[idx], ...updated };
              return n;
            }
            return [updated, ...prev];
          });
        }
        if (payload.eventType === "DELETE") {
          const row = payload.old as any;
          setData(prev => prev.filter(a => a.id !== (row.pipefy_card_id || row.id)));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Contact message modal state ──
  const buildResolutionHistory = useCallback((a: Atendimento) => {
    const tentativasFeitas = (a.tentativas || [])
      .map((done, index) => done ? `Tentativa ${index + 1}: realizada` : null)
      .filter(Boolean)
      .join(" | ");

    return [
      `Cliente: ${a.cli || "N/A"}`,
      `Licença: ${a.lic || "N/A"}`,
      `Telefone: ${a.cel || "N/A"}`,
      `Categoria: ${a.clas || "N/A"}`,
      `Demanda: ${a.dem || "N/A"}`,
      `Status: ${a.stat || "N/A"}`,
      `Etapa atual: ${a.etapa || "N/A"}`,
      `Analista: ${a.analista || fAnalista || "N/A"}`,
      `Hora de contato: ${a.horaContato || "N/A"}`,
      `Agendado em: ${a.agendadoEm || "N/A"}`,
      `Comentário do atendimento: ${a.comentario || "N/A"}`,
      `Histórico de tentativas: ${tentativasFeitas || "N/A"}`,
    ].join("\n");
  }, [fAnalista]);

  const generateResolutionMessage = useCallback(async (a: Atendimento) => {
    const { data: aiData, error } = await supabase.functions.invoke("openrouter-agent", {
      body: { task: "resolution_summary", payload: { historico_chamado: buildResolutionHistory(a) } },
    });
    if (error) throw error;
    return aiData?.data?.mensagem_resolucao as string | undefined;
  }, [buildResolutionHistory]);

  // ── Actions ──
  const updateCard = async (id: string, changes: Partial<Atendimento>) => {
    const prev = data.find(c => c.id === id);
    setData(p => {
      const n = p.map(c => c.id === id ? { ...c, ...changes } : c);
      const updated = n.find(c => c.id === id);
      if (updated) upsertAtendimento(updated);
      return n;
    });

    // Auto first-contact handling
    if (changes.etapa && changes.etapa.toLowerCase().includes("hora primeiro contato") && prev) {
      const updated = { ...prev, ...changes };
      const horaAgora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const autoMsg = `Primeira tentativa de contato\n\nNome do cliente: ${updated.cli || "—"}\nCelular: ${updated.cel || "—"}\nHora: ${horaAgora}\nAnalista: ${(updated.analista || fAnalista || "—").toUpperCase()}`;
      setData(p => p.map(c => c.id === id ? { ...c, comentario: autoMsg } : c));
      navigator.clipboard.writeText(autoMsg).then(() => toast("📋 Mensagem copiada!")).catch(() => {});
      const nt = [...(updated.tentativas || [false,false,false,false,false,false,false,false])];
      nt[0] = true;
      setData(p => p.map(c => c.id === id ? { ...c, tentativas: nt } : c));
      await supabase.from("atendimentos").update({
        primeira_tentativa_em: new Date().toISOString(),
        tentativa_atual: 1,
      }).eq("pipefy_card_id", id);
    }

    // Auto-resolution message on finalize/conclude
    if (changes.etapa && (changes.etapa.toUpperCase().includes("FINALIZADO") || changes.etapa.toUpperCase().includes("CONCLU"))) {
      try {
        const atendimentoBase = prev ? ({ ...prev, ...changes } as Atendimento) : data.find(c => c.id === id);
        if (atendimentoBase) {
          const mensagemResolucao = await generateResolutionMessage(atendimentoBase);
          if (mensagemResolucao) {
            setData(p => p.map(c => c.id === id ? { ...c, comentario: mensagemResolucao } : c));
            toast("✅ Mensagem de resolução gerada!");
          }
        }
      } catch (e: any) {
        console.warn("Erro IA resolução:", e.message);
      }
    }
  };

  const tent = (id: string, i: number) => {
    const a = data.find(x => x.id === id);
    if (!a || a.encerrado) return;
    const nt = [...a.tentativas];
    nt[i] = !nt[i];
    updateCard(id, { tentativas: nt });
  };

  const saveComment = async (id: string, text: string) => {
    updateCard(id, { comentario: text });
    toast("✅ Comentário salvo!");
  };

  const copyContactMsg = (a: Atendimento) => {
    const text = `Primeira tentativa de contato\n\nNome do cliente: ${a.cli}\nCelular: ${a.cel}\nHora: ${now.toLocaleTimeString()}\nAnalista: ${a.analista || fAnalista}`;
    navigator.clipboard.writeText(text);
    toast("📋 Mensagem copiada!");
  };

  const addAt = async () => {
    if (!novo.lic || !novo.cli) { toast("⚠ Preencha Licença e Cliente"); return; }
    const id = (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newItem: Atendimento = {
      id, ...novo, etapa: ETAPAS[0], tentativas: [false, false, false, false, false, false, false, false],
      abertoEm: Date.now(), encerrado: false, encerradoEm: null, horaContato: novo.horaContato,
      analista: fAnalista || "", comentario: "", a20: false, a10: false, a4h: false, aAgd: false, a05: false, agendadoEm: ""
    };
    setData(p => [newItem, ...p]);
    await upsertAtendimento(newItem);
    setNovo({ lic: "", cli: "", cel: "", horaContato: "", clas: "NFe", dem: "Alta", stat: "Normal" });
    toast("✅ Atendimento criado!");
  };

  const removeOne = async (id: string) => {
    if (!confirm("Excluir este atendimento permanentemente?")) return;
    setData(p => p.filter(c => c.id !== id));
    await deleteAtendimento(id);
    toast("🗑 Atendimento excluído");
  };

  const clearEncerrados = async () => {
    const encerrados = data.filter(x => x.encerrado);
    for (const e of encerrados) await deleteAtendimento(e.id);
    setData(p => p.filter(x => !x.encerrado));
    toast("🗑 Encerrados removidos");
  };

  // ── Derived ──
  const analistasList = useMemo(() => {
    const s = new Set(data.map(a => a?.analista).filter(Boolean));
    return Array.from(s).sort();
  }, [data]);

  const filtered = useMemo(() => {
    const b = busca.toLowerCase();
    return data.filter(a => {
      if (!a) return false;
      const isAgendado = (a.etapa || "").toLowerCase().includes("agendado");
      const mb = !b || a.cli.toLowerCase().includes(b) || a.lic.toLowerCase().includes(b);
      const mc = !fClas || a.clas === fClas;
      const md = !fDem || a.dem === fDem;
      const ma = !fAnalista || a.analista === fAnalista;
      return mb && mc && md && ma && !a.encerrado && !isAgendado;
    }).sort((a, b) => (a.abertoEm || 0) - (b.abertoEm || 0));
  }, [data, busca, fClas, fDem, fAnalista]);

  const agendados = useMemo(() => {
    return data.filter(a => {
      if (!a || a.encerrado) return false;
      const isAgendado = (a.etapa || "").toLowerCase().includes("agendado");
      const ma = !fAnalista || a.analista === fAnalista;
      return isAgendado && ma;
    }).sort((a, b) => {
      const da = parseDate(a.horaContato)?.getTime() || 0;
      const db = parseDate(b.horaContato)?.getTime() || 0;
      return da - db;
    });
  }, [data, fAnalista]);

  const memData = useMemo(() => fAnalista ? data.filter(a => a?.analista === fAnalista) : data, [data, fAnalista]);
  const abrt = memData.filter(a => a && !a.encerrado).length;
  const alta = memData.filter(a => a && !a.encerrado && a.dem === "Alta").length;
  const finalizadosCount = memData.filter(a => {
    if (!a) return false;
    const et = (a.etapa || "").toLowerCase();
    return a.encerrado || et.includes("finaliz") || et.includes("conclu") || et.includes("arquiv");
  }).length;
  const aVencer = memData.filter(a => a && !a.encerrado && (a.etapa || "").toLowerCase().includes("analista selecionado")).sort((a, b) => (a.abertoEm || 0) - (b.abertoEm || 0)).slice(0, 5);

  // ── Exportar planilha (XLSX) — 8 colunas oficiais ──
  const exportXLSX = (rows: Atendimento[]) => {
    const aoa: any[][] = [
      ["Prioridade", "Classificação", "Licença", "Cliente", "Telefone", "Etapa", "Aberto em", "Observação"],
    ];
    rows.forEach(a => {
      const aberto = a.abertoEm ? new Date(a.abertoEm) : null;
      const obs = (a.comentario || "").replace(/\n\n\[salvo em:[^\]]+\]\s*$/, "").trim();
      aoa.push([
        a.dem || "Média",
        a.clas || "",
        a.lic || "",
        a.cli || "",
        a.cel || "",
        a.etapa || "",
        aberto || "",
        obs,
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    ws["!cols"] = [
      { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 26 }, { wch: 20 }, { wch: 50 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Atendimentos");
    const fileBase = `atendimentos_${new Date().toISOString().slice(0, 10)}`;
    XLSX.writeFile(wb, `${fileBase}.xlsx`);
    toast("📊 Planilha exportada!");
  };

  // ── Importar planilha (XLSX / CSV) ──
  const handleImportFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
      if (!rows.length) { toast("⚠ Planilha vazia"); return; }
      const headers = (rows[0] as any[]).map(h => String(h ?? ""));
      const map = mapHeaders(headers);
      if (map.lic === undefined && map.cli === undefined) {
        toast("⚠ Cabeçalhos não reconhecidos. Use as 8 colunas oficiais.");
        return;
      }
      let ok = 0, skip = 0;
      const novos: Atendimento[] = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] as any[];
        const get = (k: string) => (map[k] !== undefined ? r[map[k]] : "");
        const lic = String(get("lic") ?? "").trim();
        const cli = String(get("cli") ?? "").trim();
        if (!lic && !cli) { skip++; continue; }
        const demRaw = String(get("dem") ?? "").toLowerCase();
        const dem = demRaw.includes("alta") ? "Alta" : "Média";
        const clasRaw = String(get("clas") ?? "").trim();
        const clas = Object.keys(CHEX).find(k => clasRaw && k.toLowerCase() === clasRaw.toLowerCase()) || clasRaw || "NFe";
        const etapa = String(get("etapa") ?? "").trim() || "Caixa de entrada";
        const cel = String(get("cel") ?? "").trim();
        const obs = String(get("comentario") ?? "").trim();
        const abertoEm = parseSheetDate(get("abertoEm"));
        const id = (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
        novos.push({
          id, lic, cli, cel, clas, dem, stat: "Normal", etapa,
          tentativas: [false, false, false, false, false, false, false, false],
          abertoEm, encerrado: false, encerradoEm: null,
          horaContato: "", analista: fAnalista || "",
          comentario: obs, a20: false, a10: false, a4h: false, aAgd: false, a05: false, agendadoEm: "",
        });
        ok++;
      }
      if (novos.length) {
        setData(p => [...novos, ...p]);
        await upsertMany(novos);
      }
      toast(`✅ Importado: ${ok} • Ignorado: ${skip}`, 5000);
    } catch (e: any) {
      console.error(e);
      toast(`⚠ Erro ao importar: ${e.message}`);
    }
  };

  // ── Exportar PDF / TXT (mantidos como atalhos) ──
  const exportList = (open: Atendimento[], agnd: Atendimento[], format: "txt" | "pdf") => {
    const todos = [...open, ...agnd];
    const today = new Date();
    const dateStr = today.toLocaleDateString("pt-BR");
    const timeStr = today.toLocaleTimeString("pt-BR");
    const fileBase = `atendimentos_${today.toISOString().slice(0, 10)}`;

    const grupos: Record<string, Record<string, Atendimento[]>> = { Alta: {}, "Média": {} };
    todos.forEach(a => {
      const pr = (a.dem || "Média") === "Alta" ? "Alta" : "Média";
      const cl = a.clas || "Outros";
      (grupos[pr][cl] ||= []).push(a);
    });

    if (format === "txt") {
      let txt = `CENTRAL DE ATENDIMENTOS — ${dateStr} ${timeStr}\n`;
      txt += `Analista: ${fAnalista || "Todos"}\nTotal: ${todos.length}\n`;
      txt += "=".repeat(60) + "\n\n";
      (["Alta", "Média"] as const).forEach(pr => {
        const classes = Object.keys(grupos[pr]);
        if (!classes.length) return;
        txt += `### ${pr.toUpperCase()} PRIORIDADE ###\n\n`;
        classes.sort().forEach(cl => {
          txt += `-- ${cl} (${grupos[pr][cl].length}) --\n`;
          grupos[pr][cl].forEach(a => {
            txt += `  • [${a.lic}] ${a.cli}\n`;
            if (a.cel) txt += `    Tel: ${a.cel}\n`;
            txt += `    Etapa: ${a.etapa}\n`;
            if (a.comentario) txt += `    Obs: ${a.comentario.replace(/\n/g, " ")}\n`;
            txt += `\n`;
          });
        });
        txt += "\n";
      });
      const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${fileBase}.txt`;
      link.click();
      URL.revokeObjectURL(url);
      toast("📝 TXT exportado!");
      return;
    }

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    let y = 40;
    const ensure = (h: number) => { if (y + h > pageH - 40) { doc.addPage(); y = 40; } };

    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text("Central de Atendimentos", 40, y); y += 20;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`${dateStr} ${timeStr}  •  Analista: ${fAnalista || "Todos"}  •  Total: ${todos.length}`, 40, y); y += 18;
    doc.setDrawColor(180); doc.line(40, y, pageW - 40, y); y += 14;

    (["Alta", "Média"] as const).forEach(pr => {
      const classes = Object.keys(grupos[pr]);
      if (!classes.length) return;
      ensure(28);
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.setTextColor(pr === "Alta" ? "#c0392b" : "#b7950b");
      doc.text(`${pr === "Alta" ? "● ALTA" : "● MÉDIA"} PRIORIDADE`, 40, y); y += 16;
      doc.setTextColor(20);

      classes.sort().forEach(cl => {
        ensure(20);
        doc.setFont("helvetica", "bold"); doc.setFontSize(11);
        const hex = CHEX[cl] || "#555555";
        doc.setTextColor(hex);
        doc.text(`${cl}  (${grupos[pr][cl].length})`, 50, y); y += 14;
        doc.setTextColor(20);
        doc.setFont("helvetica", "normal"); doc.setFontSize(10);

        grupos[pr][cl].forEach(a => {
          const line1 = `• [${a.lic}] ${a.cli}${a.cel ? "  —  " + a.cel : ""}`;
          const wrapped = doc.splitTextToSize(line1, pageW - 100);
          ensure(wrapped.length * 12 + 6);
          doc.text(wrapped, 60, y); y += wrapped.length * 12;
          if (a.etapa) {
            doc.setTextColor(110);
            doc.text(`Etapa: ${a.etapa}`, 72, y); y += 11;
            doc.setTextColor(20);
          }
          if (a.comentario) {
            doc.setTextColor(110);
            const obs = doc.splitTextToSize(`Obs: ${a.comentario.replace(/\n/g, " ")}`, pageW - 120);
            ensure(obs.length * 11 + 4);
            doc.text(obs, 72, y); y += obs.length * 11;
            doc.setTextColor(20);
          }
          y += 4;
        });
        y += 4;
      });
      y += 6;
    });

    doc.save(`${fileBase}.pdf`);
    toast("📄 PDF exportado!");
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 max-w-[1800px] mx-auto">
      {/* Topbar */}
      <header className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg">🎯</div>
          <div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">Central de Atendimentos</h1>
            <p className="text-xs text-muted-foreground">Gestão de chamados em tempo real • Slack + Planilha</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={fAnalista}
            onChange={e => { setFAnalista(e.target.value); localStorage.setItem("cat_fAnalista", e.target.value); }}
            className="text-sm bg-card border border-border rounded-lg px-3 py-1.5 text-foreground outline-none focus:border-primary"
          >
            <option value="">👤 Todos</option>
            {analistasList.map(an => <option key={an} value={an}>{an}</option>)}
          </select>
          <button onClick={() => setDarkMode(!darkMode)} className="text-sm border border-border rounded-lg px-3 py-1.5 text-foreground hover:bg-muted transition-colors" title="Alternar tema">
            {darkMode ? "☀️" : "🌙"}
          </button>
          <div className="font-mono text-sm font-semibold text-primary bg-card border border-border rounded-lg px-3 py-1.5 flex items-center gap-2">
            {now.toLocaleTimeString("pt-BR")}
            <div className="w-2 h-2 rounded-full bg-vintage-green animate-pulse" />
          </div>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
        <div className="rounded-2xl p-5 bg-card border-2 border-yellow-500/50 shadow-lg">
          <div className="text-sm uppercase font-extrabold text-yellow-400 tracking-wide">Aguardando</div>
          <div className="text-5xl font-black mt-1 text-yellow-300 drop-shadow">{abrt}</div>
          <div className="text-sm text-muted-foreground font-semibold mt-1">Chamados abertos</div>
        </div>
        <div className="rounded-2xl p-5 bg-card border-2 border-purple-500/50 shadow-lg">
          <div className="text-sm uppercase font-extrabold text-purple-300 tracking-wide">Alta Demanda</div>
          <div className="text-5xl font-black mt-1 text-purple-300 drop-shadow">{alta}</div>
          <div className="text-sm text-muted-foreground font-semibold mt-1">Prioridade máxima</div>
        </div>
        <div className="rounded-2xl p-5 bg-card border-2 border-sky-500/50 shadow-lg">
          <div className="text-sm uppercase font-extrabold text-sky-300 tracking-wide">Agendados</div>
          <div className="text-5xl font-black mt-1 text-sky-300 drop-shadow">{agendados.length}</div>
          <div className="text-sm text-muted-foreground font-semibold mt-1">Clientes agendados</div>
        </div>
        <div className="rounded-2xl p-5 bg-card border-2 border-emerald-500/50 shadow-lg">
          <div className="text-sm uppercase font-extrabold text-emerald-300 tracking-wide">Finalizados</div>
          <div className="text-5xl font-black mt-1 text-emerald-300 drop-shadow">{finalizadosCount}</div>
          <div className="text-sm text-muted-foreground font-semibold mt-1">Etapa "Finalizado em"</div>
        </div>
        <div className="rounded-2xl p-5 bg-card border-2 border-rose-500/50 shadow-lg">
          <div className="text-sm uppercase font-extrabold text-rose-300 tracking-wide mb-1">Próximos a Vencer ⌛</div>
          {aVencer.slice(0, 3).map(t => {
            const rest = LIM - businessElapsed(t.abertoEm || 0, now.getTime());
            return (
              <div key={t.id} className="flex justify-between text-sm py-0.5">
                <span className="truncate max-w-[110px] font-bold text-foreground">{t.lic} | {t.cli.slice(0, 8)}</span>
                <span className={`font-mono font-black ${rest < 0 ? "text-destructive" : "text-rose-300"}`}>{fmtM(rest)}</span>
              </div>
            );
          })}
          {aVencer.length === 0 && <div className="text-sm text-muted-foreground mt-1">Nenhum no prazo.</div>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-muted rounded-lg p-1 w-fit flex-wrap">
        <button onClick={() => setActiveTab("list")} className={`text-sm font-semibold px-4 py-1.5 rounded-md transition-colors ${activeTab === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>📋 Atendimentos</button>
        <button onClick={() => setActiveTab("dashboard")} className={`text-sm font-semibold px-4 py-1.5 rounded-md transition-colors ${activeTab === "dashboard" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>📊 Dashboard</button>
        <button onClick={() => setActiveTab("agendamentos")} className={`text-sm font-semibold px-4 py-1.5 rounded-md transition-colors ${activeTab === "agendamentos" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>📞 Chamar Cliente</button>
        <button onClick={() => setActiveTab("emails")} className={`text-sm font-semibold px-4 py-1.5 rounded-md transition-colors ${activeTab === "emails" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>📧 Emails</button>
      </div>

      {activeTab === "dashboard" ? (
        <Dashboard data={data} now={now} />
      ) : activeTab === "agendamentos" ? (
        <AgendamentosPanel />
      ) : activeTab === "emails" ? (
        <EmailsPanel />
      ) : (
      <>
      {/* Filters + actions */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          type="text"
          placeholder="🔍 Buscar licença ou cliente..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          className="text-sm bg-card border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:border-primary min-w-[200px] flex-1 md:flex-none"
        />
        <select value={fClas} onChange={e => setFClas(e.target.value)} className="text-sm bg-card border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:border-primary">
          <option value="">Todas class.</option>
          {Object.keys(CHEX).map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={fDem} onChange={e => setFDem(e.target.value)} className="text-sm bg-card border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:border-primary">
          <option value="">Toda demanda</option>
          <option value="Alta">🔴 Alta</option>
          <option value="Média">🟡 Média</option>
        </select>
        <button onClick={clearEncerrados} className="text-sm text-destructive bg-destructive/10 border border-transparent rounded-lg px-3 py-2 font-semibold hover:bg-destructive/20 transition-colors">🗑 Limpar enc.</button>
        <input
          ref={importInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ""; }}
        />
        <button
          onClick={() => importInputRef.current?.click()}
          className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 font-semibold hover:bg-emerald-500/20 transition-colors"
          title="Importar planilha .xlsx ou .csv"
        >📥 Importar planilha</button>
        <button
          onClick={() => exportXLSX([...filtered, ...agendados])}
          className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 font-semibold hover:bg-emerald-500/20 transition-colors"
          title="Exportar planilha .xlsx"
        >📊 Exportar planilha</button>
        <button
          onClick={() => exportList(filtered, agendados, "pdf")}
          className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 font-semibold hover:bg-rose-500/20 transition-colors"
          title="Exportar para PDF"
        >📄 PDF</button>
        <button
          onClick={() => exportList(filtered, agendados, "txt")}
          className="text-sm text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 font-semibold hover:bg-blue-500/20 transition-colors"
          title="Exportar para bloco de notas"
        >📝 TXT</button>
        <div className="ml-auto text-sm text-muted-foreground font-medium">
          📋 <span className="text-foreground font-bold">{filtered.length}</span> registro(s)
        </div>
      </div>

      {/* Lista em formato de tabela */}
      {(() => {
        const finalizados = data.filter(a => {
          if (!a || !a.encerrado) return false;
          const ma = !fAnalista || a.analista === fAnalista;
          return ma;
        });
        const todos = [...filtered, ...agendados, ...finalizados];

        const ordem: Record<string, number> = { Alta: 0, "Média": 1 };
        const linhas = [...todos].sort((a, b) => {
          const da = ordem[a.dem || "Média"] ?? 9;
          const db = ordem[b.dem || "Média"] ?? 9;
          if (da !== db) return da - db;
          return (a.abertoEm || 0) - (b.abertoEm || 0);
        });

        const fmtAberto = (ts?: number) => {
          if (!ts) return "—";
          const d = new Date(ts);
          return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}, ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
        };
        const obsResumo = (raw: string) => {
          if (!raw) return "";
          const txt = raw.replace(/\n\n\[salvo em:[^\]]+\]\s*$/, "").trim();
          return txt.length > 60 ? txt.slice(0, 60) + "…" : txt;
        };

        return (
          <div className="mb-8 rounded-xl border-2 border-border bg-card/40 overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-gradient-to-r from-[#0a0a0a] via-[#141414] to-[#0a0a0a] text-[#c8c8c8] uppercase tracking-wider text-xs">
                  <tr>
                    <th className="text-center px-2 py-2.5 font-bold border-b-2 border-primary/40">✓ Hoje</th>
                    <th className="text-left px-3 py-2.5 font-bold border-b-2 border-primary/40">Prioridade</th>
                    <th className="text-left px-3 py-2.5 font-bold border-b-2 border-primary/40">Classificação</th>
                    <th className="text-left px-3 py-2.5 font-bold border-b-2 border-primary/40">Licença</th>
                    <th className="text-left px-3 py-2.5 font-bold border-b-2 border-primary/40">Cliente</th>
                    <th className="text-left px-3 py-2.5 font-bold border-b-2 border-primary/40">Telefone</th>
                    <th className="text-left px-3 py-2.5 font-bold border-b-2 border-primary/40">Etapa</th>
                    <th className="text-left px-3 py-2.5 font-bold border-b-2 border-primary/40">Aberto em</th>
                    <th className="text-left px-3 py-2.5 font-bold border-b-2 border-primary/40">Obs</th>
                    <th className="px-2 py-2.5 border-b-2 border-primary/40"></th>
                    <th className="px-2 py-2.5 border-b-2 border-primary/40"></th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((a, i) => {
                    const isExp = expandedRow === a.id;
                    const today = todayKey();
                    const isContatado = contatadoHoje[a.id] === today;
                    const isAlta = a.dem === "Alta";
                    const prioBadge = isAlta
                      ? "bg-red-500/15 text-red-300 border border-red-500/40"
                      : "bg-yellow-500/15 text-yellow-300 border border-yellow-500/40";
                    const clasHex = CHEX[a.clas] || "#64748b";
                    const el = a.encerrado ? businessElapsed(a.abertoEm || 0, a.encerradoEm || now.getTime()) : businessElapsed(a.abertoEm || 0, now.getTime());
                    const rest = LIM - el;
                    const tCls = a.encerrado ? "text-muted-foreground" : rest < 0 ? "text-destructive" : rest <= AV20 ? "text-yellow-400" : "text-emerald-400";
                    const rowBg = a.encerrado
                      ? "bg-muted/10"
                      : isContatado
                        ? "bg-emerald-500/10 hover:bg-emerald-500/15"
                        : isAlta
                          ? "bg-red-500/5 hover:bg-red-500/10"
                          : i % 2 === 0 ? "bg-card/30 hover:bg-muted/40" : "hover:bg-muted/40";
                    const leftBar = isAlta ? "border-l-4 border-l-red-500" : "border-l-4 border-l-yellow-500/60";
                    return (
                      <Fragment key={a.id}>
                        <tr
                          onClick={() => setExpandedRow(isExp ? null : a.id)}
                          className={`border-b border-border/40 cursor-pointer transition-colors ${rowBg} ${leftBar} ${a.encerrado ? "opacity-60" : ""}`}
                        >
                          <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <label className="inline-flex items-center justify-center cursor-pointer select-none" title={isContatado ? "Contato feito hoje" : "Marcar contato de hoje"}>
                              <input
                                type="checkbox"
                                checked={isContatado}
                                onChange={() => toggleContatadoHoje(a.id)}
                                className="sr-only peer"
                              />
                              <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center text-xs font-black transition-all ${isContatado ? "bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-500/40" : "bg-background border-border hover:border-emerald-400"}`}>
                                {isContatado ? "✓" : ""}
                              </span>
                            </label>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-xs font-extrabold px-2 py-1 rounded-md ${prioBadge}`}>
                              {isAlta ? "🔴 Alta" : "🟡 Média"}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className="text-xs font-bold px-2 py-1 rounded-md border"
                              style={{ background: `${clasHex}22`, color: clasHex, borderColor: `${clasHex}66` }}
                            >
                              {a.clas}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono font-bold text-[#dcdcdc] bg-[#0e0e0e]/40">{a.lic}</td>
                          <td className="px-3 py-2 text-foreground font-semibold truncate max-w-[220px]">{a.cli || "—"}</td>
                          <td className="px-3 py-2 text-sky-300 whitespace-nowrap font-medium">{a.cel || "—"}</td>
                          <td className="px-3 py-2 text-foreground">{a.etapa}</td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                            <div className="text-xs">{fmtAberto(a.abertoEm)}</div>
                            <div className={`font-mono text-sm font-black ${tCls}`}>{fmt(el)}</div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground truncate max-w-[200px]">{obsResumo(a.comentario || "")}</td>
                          <td className="px-1 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => removeOne(a.id)}
                              className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/15 rounded-md px-2 py-1 text-sm transition-colors"
                              title="Excluir atendimento"
                            >🗑</button>
                          </td>
                          <td className="px-2 py-2 text-muted-foreground text-xs">{isExp ? "▲" : "▼"}</td>
                        </tr>
                        {isExp && (
                          <tr className="bg-background/60">
                            <td colSpan={11} className="p-3">
                              <AttendanceCard
                                item={a}
                                index={i}
                                now={now}
                                onUpdateCard={updateCard}
                                onComment={(id, text) => setComent({ id, text })}
                                onEdit={item => setModEdit({ ...item })}
                                onCopyMsg={copyContactMsg}
                                onToggleTent={tent}
                                fAnalista={fAnalista}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {linhas.length === 0 && (
                    <tr><td colSpan={11} className="text-center py-12 text-muted-foreground font-semibold">Nenhum atendimento no momento.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* New attendance form */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <div className="text-sm font-bold text-accent mb-3">➕ Novo Atendimento</div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Licença</label>
            <input ref={fLicRef} type="text" placeholder="12345" value={novo.lic} onChange={e => setNovo({ ...novo, lic: e.target.value })} className="text-sm bg-muted border border-border rounded-lg px-3 py-2 w-24 text-foreground outline-none focus:border-primary" />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
            <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Cliente</label>
            <input type="text" placeholder="Nome" value={novo.cli} onChange={e => setNovo({ ...novo, cli: e.target.value })} className="text-sm bg-muted border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:border-primary" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Celular</label>
            <input type="text" placeholder="(99) 99999-9999" value={novo.cel} onChange={e => setNovo({ ...novo, cel: e.target.value })} className="text-sm bg-muted border border-border rounded-lg px-3 py-2 w-36 text-foreground outline-none focus:border-primary" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Class.</label>
            <select value={novo.clas} onChange={e => setNovo({ ...novo, clas: e.target.value })} className="text-sm bg-muted border border-border rounded-lg px-2 py-2 text-foreground outline-none focus:border-primary">
              {Object.keys(CHEX).map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Demanda</label>
            <select value={novo.dem} onChange={e => setNovo({ ...novo, dem: e.target.value })} className="text-sm bg-muted border border-border rounded-lg px-2 py-2 text-foreground outline-none focus:border-primary">
              <option value="Alta">🔴 Alta</option>
              <option value="Média">🟡 Média</option>
            </select>
          </div>
          <button onClick={addAt} className="bg-primary text-primary-foreground text-sm font-bold rounded-lg px-4 py-2 hover:opacity-90 transition-opacity">Adicionar ＋</button>
        </div>
      </div>

      {/* Painel de anotações livre */}
      <NotesPanel />
      </>
      )}

      {/* Toast */}
      <div id="toast-custom" className={toastMsg ? "show" : ""}>{toastMsg}</div>

      {/* Alert Modal */}
      {alerta && (
        <div className="modal-overlay" onClick={() => setAlerta(null)}>
          <div className="bg-card rounded-2xl p-8 max-w-md w-[90%] text-center border border-border shadow-medium animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="text-4xl mb-3">{alerta.tipo === "urgente" ? "🚨" : "⏰"}</div>
            <div className="text-lg font-extrabold text-foreground mb-1">{alerta.titulo}</div>
            <div className="text-sm font-semibold text-accent mb-2">👤 {alerta.cli}</div>
            <div className="text-sm text-muted-foreground mb-6 whitespace-pre-line">{alerta.msg}</div>
            <button onClick={() => setAlerta(null)} className="bg-primary text-primary-foreground w-full py-2.5 rounded-lg font-bold text-sm hover:opacity-90 transition-opacity">Entendido ✓</button>
          </div>
        </div>
      )}

      {/* Comment Modal */}
      {coment && (
        <div className="modal-overlay" onClick={() => setComent(null)}>
          <div className="bg-card rounded-2xl p-6 max-w-md w-[90%] border border-border shadow-medium animate-fade-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-accent mb-3">💬 Comentário</h3>
            <textarea
              value={coment.text}
              onChange={e => setComent({ ...coment, text: e.target.value })}
              className="w-full h-28 p-3 rounded-lg border border-border bg-muted text-foreground text-sm outline-none focus:border-primary resize-none"
              placeholder="Escreva algo..."
            />
            <div className="flex gap-2 justify-end mt-3">
              <button onClick={() => setComent(null)} className="text-sm px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors">Cancelar</button>
              <button onClick={() => { saveComment(coment.id, coment.text); setComent(null); }} className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground font-bold hover:opacity-90 transition-opacity">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {modEdit && (
        <div className="modal-overlay" onClick={() => setModEdit(null)}>
          <div className="bg-card rounded-2xl p-6 max-w-lg w-[90%] border border-border shadow-medium animate-fade-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-accent mb-4">✏️ Editar Atendimento</h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="flex flex-col gap-1">
                <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Licença</label>
                <input value={modEdit.lic} onChange={e => setModEdit({ ...modEdit, lic: e.target.value })} className="text-sm bg-muted border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:border-primary" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Cliente</label>
                <input value={modEdit.cli} onChange={e => setModEdit({ ...modEdit, cli: e.target.value })} className="text-sm bg-muted border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:border-primary" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Celular</label>
                <input value={modEdit.cel} onChange={e => setModEdit({ ...modEdit, cel: e.target.value })} className="text-sm bg-muted border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:border-primary" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Classificação</label>
                <select value={modEdit.clas} onChange={e => setModEdit({ ...modEdit, clas: e.target.value })} className="text-sm bg-muted border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:border-primary">
                  {Object.keys(CHEX).map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Demanda</label>
                <select value={modEdit.dem} onChange={e => setModEdit({ ...modEdit, dem: e.target.value })} className="text-sm bg-muted border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:border-primary">
                  <option value="Alta">Alta</option>
                  <option value="Média">Média</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.65rem] uppercase font-bold text-muted-foreground">Analista</label>
                <input value={modEdit.analista} onChange={e => setModEdit({ ...modEdit, analista: e.target.value })} className="text-sm bg-muted border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:border-primary" />
              </div>
            </div>
            <div className="flex gap-2 justify-end border-t border-border pt-3">
              <button onClick={() => setModEdit(null)} className="text-sm px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors">Cancelar</button>
              <button onClick={() => { updateCard(modEdit.id, { ...modEdit }); setModEdit(null); toast("✅ Atualizado!"); }} className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground font-bold hover:opacity-90 transition-opacity">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
