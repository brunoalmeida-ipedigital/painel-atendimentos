import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface EmailClassification {
  analise_thread?: {
    tipo?: "novo" | "continuacao";
    motivo_classificacao?: string;
  };
  dados_cliente?: {
    nome?: string;
    email_origem?: string;
  };
  contexto?: {
    categoria_sistema?: string;
    resumo_problema?: string;
    interacoes_anteriores?: string | null;
  };
  triagem?: {
    sentimento_cliente?: string;
    prioridade_sugerida?: string;
    acao_recomendada?: string;
  };
}

interface EmailRecebido {
  id: string;
  message_id: string | null;
  thread_id?: string | null;
  remetente: string;
  assunto: string;
  corpo: string;
  resumo_ia: string | null;
  classificacao_ia?: EmailClassification | null;
  data_email: string;
  notificado_slack: boolean;
  created_at: string;
}

const priorityClasses: Record<string, string> = {
  Baixa: "bg-muted text-muted-foreground border-border",
  Média: "bg-vintage-yellow/20 text-foreground border-vintage-yellow/50",
  Alta: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/40",
  Crítica: "bg-destructive/15 text-destructive border-destructive/50",
};

const feelingClasses: Record<string, string> = {
  Calmo: "bg-muted text-muted-foreground border-border",
  "Dúvida": "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  Urgente: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/40",
  Irritado: "bg-destructive/15 text-destructive border-destructive/50",
};

export default function EmailsPanel() {
  const [emails, setEmails] = useState<EmailRecebido[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("emails_recebidos")
      .select("*")
      .order("data_email", { ascending: false })
      .limit(50);
    setEmails(((data as unknown) as EmailRecebido[]) || []);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("emails_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "emails_recebidos" }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const pollGmail = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke("gmail-poll");
      if (error) throw error;
      await load();
    } catch (error: any) {
      console.warn("Gmail poll error:", error.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    const interval = setInterval(pollGmail, 120000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">📧</span>
        <h2 className="text-base font-bold text-foreground">Emails — brunoalmeida@ipe.digital</h2>
        <span className="text-xs bg-accent/20 text-accent font-bold px-2 py-0.5 rounded-full">{emails.length}</span>
        <div className="flex-1" />
        <button
          onClick={pollGmail}
          disabled={loading}
          className="text-xs bg-primary text-primary-foreground font-bold rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? "⏳ Buscando..." : "↻ Verificar emails"}
        </button>
      </div>

      {emails.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground mb-2">Nenhum email capturado ainda.</p>
          <p className="text-xs text-muted-foreground">Configure Gmail e OpenRouter para iniciar a triagem automática.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {emails.map((email) => {
            const dt = new Date(email.data_email);
            const isExpanded = expanded === email.id;
            const classification = email.classificacao_ia;
            const priority = classification?.triagem?.prioridade_sugerida || "N/A";
            const feeling = classification?.triagem?.sentimento_cliente || "N/A";
            const category = classification?.contexto?.categoria_sistema || "N/A";
            const threadType = classification?.analise_thread?.tipo || "N/A";

            return (
              <div key={email.id} className="border border-border rounded-lg overflow-hidden transition-all">
                <div
                  className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : email.id)}
                >
                  <span className="text-lg flex-shrink-0">{email.notificado_slack ? "✅" : "📩"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">{email.assunto || "(Sem assunto)"}</div>
                    <div className="text-xs text-muted-foreground truncate">De: {email.remetente}</div>
                    {classification && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        <span className="text-[0.65rem] px-2 py-0.5 rounded-full border bg-accent/10 text-accent border-accent/20">
                          {threadType === "continuacao" ? "Continuação" : "Novo"}
                        </span>
                        <span className="text-[0.65rem] px-2 py-0.5 rounded-full border bg-muted text-foreground border-border">
                          {category}
                        </span>
                        <span className={`text-[0.65rem] px-2 py-0.5 rounded-full border ${priorityClasses[priority] || "bg-muted text-foreground border-border"}`}>
                          {priority}
                        </span>
                        <span className={`text-[0.65rem] px-2 py-0.5 rounded-full border ${feelingClasses[feeling] || "bg-muted text-foreground border-border"}`}>
                          {feeling}
                        </span>
                      </div>
                    )}
                  </div>
                  {email.resumo_ia && (
                    <span className="text-[0.6rem] bg-accent/10 text-accent font-semibold px-1.5 py-0.5 rounded flex-shrink-0">IA</span>
                  )}
                  <div className="text-xs text-muted-foreground flex-shrink-0">
                    {dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}{" "}
                    {dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-3 border-t border-border/50 space-y-3">
                    {classification && (
                      <div className="grid gap-3 md:grid-cols-2 mt-3">
                        <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
                          <div className="text-[0.65rem] uppercase font-bold text-accent mb-1">Triagem</div>
                          <div className="text-sm text-foreground"><b>Resumo:</b> {classification.contexto?.resumo_problema || "N/A"}</div>
                          <div className="text-sm text-foreground mt-1"><b>Ação:</b> {classification.triagem?.acao_recomendada || "N/A"}</div>
                        </div>
                        <div className="bg-muted/40 border border-border rounded-lg p-3">
                          <div className="text-[0.65rem] uppercase font-bold text-muted-foreground mb-1">Cliente</div>
                          <div className="text-sm text-foreground"><b>Nome:</b> {classification.dados_cliente?.nome || "N/A"}</div>
                          <div className="text-sm text-foreground mt-1"><b>Email:</b> {classification.dados_cliente?.email_origem || "N/A"}</div>
                        </div>
                        <div className="bg-muted/40 border border-border rounded-lg p-3 md:col-span-2">
                          <div className="text-[0.65rem] uppercase font-bold text-muted-foreground mb-1">Contexto da Thread</div>
                          <div className="text-sm text-foreground"><b>Motivo:</b> {classification.analise_thread?.motivo_classificacao || "N/A"}</div>
                          <div className="text-sm text-foreground mt-1"><b>Histórico:</b> {classification.contexto?.interacoes_anteriores || "N/A"}</div>
                        </div>
                      </div>
                    )}

                    {email.resumo_ia && !classification && (
                      <div className="bg-accent/5 border border-accent/20 rounded-lg p-3 mt-2">
                        <div className="text-[0.65rem] uppercase font-bold text-accent mb-1">Resumo IA</div>
                        <p className="text-sm text-foreground">{email.resumo_ia}</p>
                      </div>
                    )}

                    <div>
                      <div className="text-[0.65rem] uppercase font-bold text-muted-foreground mb-1">Conteúdo</div>
                      <p className="text-sm text-muted-foreground whitespace-pre-line max-h-48 overflow-y-auto">
                        {email.corpo || "(Sem conteúdo)"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
