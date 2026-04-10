import { classifyEmail, summarizeResolution } from "../_shared/openrouter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "google/gemini-2.5-flash-lite";

    if (!OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY não configurada");
    }

    const { task, payload } = await req.json();

    if (task === "email_triage") {
      const classification = await classifyEmail({
        apiKey: OPENROUTER_API_KEY,
        model: OPENROUTER_MODEL,
        subject: payload?.assunto_email || "",
        body: payload?.corpo_do_email || "",
        threadHistory: payload?.historico_da_thread_se_houver || "",
        senderEmail: payload?.email_origem || "",
      });

      return new Response(JSON.stringify({ success: true, data: classification }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (task === "resolution_summary") {
      const resolution = await summarizeResolution({
        apiKey: OPENROUTER_API_KEY,
        model: OPENROUTER_MODEL,
        historicoChamado: payload?.historico_chamado || "",
      });

      return new Response(JSON.stringify({ success: true, data: { mensagem_resolucao: resolution } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Task inválida" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
