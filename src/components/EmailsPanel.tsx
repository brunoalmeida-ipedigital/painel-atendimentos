import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface EmailRecebido {
  id: string;
  message_id: string | null;
  remetente: string;
  assunto: string;
  corpo: string;
  resumo_ia: string | null;
  data_email: string;
  notificado_slack: boolean;
  created_at: string;
}

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
    setEmails((data as EmailRecebido[]) || []);
  };

  useEffect(() => { load(); }, []);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("emails_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "emails_recebidos" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const pollGmail = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("gmail-poll");
      if (error) throw error;
      load();
    } catch (e: any) {
      console.warn("Gmail poll error:", e.message);
    }
    setLoading(false);
  };

  // Poll every 2 minutes
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
          <p className="text-xs text-muted-foreground">Configure as credenciais do Gmail para começar a capturar emails.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {emails.map(email => {
            const dt = new Date(email.data_email);
            const isExpanded = expanded === email.id;
            return (
              <div
                key={email.id}
                className="border border-border rounded-lg overflow-hidden transition-all"
              >
                <div
                  className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : email.id)}
                >
                  <span className="text-lg flex-shrink-0">{email.notificado_slack ? "✅" : "📩"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">{email.assunto || "(Sem assunto)"}</div>
                    <div className="text-xs text-muted-foreground truncate">De: {email.remetente}</div>
                  </div>
                  {email.resumo_ia && (
                    <span className="text-[0.6rem] bg-accent/10 text-accent font-semibold px-1.5 py-0.5 rounded flex-shrink-0">🤖 IA</span>
                  )}
                  <div className="text-xs text-muted-foreground flex-shrink-0">
                    {dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} {dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 pb-3 border-t border-border/50 space-y-2">
                    {email.resumo_ia && (
                      <div className="bg-accent/5 border border-accent/20 rounded-lg p-3 mt-2">
                        <div className="text-[0.65rem] uppercase font-bold text-accent mb-1">🤖 Resumo IA</div>
                        <p className="text-sm text-foreground">{email.resumo_ia}</p>
                      </div>
                    )}
                    <div className="mt-2">
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
