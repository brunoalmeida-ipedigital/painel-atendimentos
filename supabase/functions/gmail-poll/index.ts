import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyEmail } from "../_shared/openrouter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const decodeBase64Url = (value: string) => atob(value.replace(/-/g, "+").replace(/_/g, "/"));

const extractTextFromPayload = (part: any): string => {
  if (part?.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part?.mimeType === "text/html" && part.body?.data) {
    const html = decodeBase64Url(part.body.data);
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (part?.parts) {
    for (const child of part.parts) {
      const text = extractTextFromPayload(child);
      if (text) return text;
    }
  }
  return "";
};

const extractHeader = (headers: any[], name: string) =>
  headers.find((header: any) => header.name === name)?.value || "";

const extractEmailAddress = (value: string) => {
  const match = value.match(/<([^>]+)>/);
  return match?.[1]?.trim() || value.trim();
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const GOOGLE_REFRESH_TOKEN = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL");
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "google/gemini-2.5-flash-lite";

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return new Response(JSON.stringify({ error: "Google credentials not configured" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("Google token response:", JSON.stringify(tokenData));
      throw new Error(`Failed to get Gmail access token: ${tokenData.error || "unknown"} - ${tokenData.error_description || ""}`);
    }
    const accessToken = tokenData.access_token;

    const listRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=is:inbox newer_than:1d",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const listData = await listRes.json();
    const messageIds = (listData.messages || []).map((message: any) => message.id);

    if (messageIds.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existing } = await sb
      .from("emails_recebidos")
      .select("message_id")
      .in("message_id", messageIds);
    const existingIds = new Set((existing || []).map((item) => item.message_id));
    const newIds = messageIds.filter((id: string) => !existingIds.has(id));
    const results: string[] = [];

    const buildThreadHistory = async (threadId: string, currentMessageId: string) => {
      if (!threadId) return "N/A";
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) return "N/A";

      const thread = await response.json();
      const messages = (thread.messages || [])
        .filter((message: any) => message.id !== currentMessageId)
        .slice(-5)
        .map((message: any, index: number) => {
          const headers = message.payload?.headers || [];
          const sender = extractHeader(headers, "From") || "N/A";
          const subject = extractHeader(headers, "Subject") || "N/A";
          const body = extractTextFromPayload(message.payload || {}) || message.snippet || "N/A";
          return `Mensagem ${index + 1}\nDe: ${sender}\nAssunto: ${subject}\nConteúdo: ${body.slice(0, 1200)}`;
        });

      return messages.length > 0 ? messages.join("\n\n---\n\n") : "N/A";
    };

    for (const msgId of newIds) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const msgData = await msgRes.json();
      const headers = msgData.payload?.headers || [];
      const from = extractHeader(headers, "From");
      const subject = extractHeader(headers, "Subject");
      const dateStr = extractHeader(headers, "Date");
      const threadId = msgData.threadId || null;
      const body = extractTextFromPayload(msgData.payload || {}) || msgData.snippet || "";
      const threadHistory = threadId ? await buildThreadHistory(threadId, msgId) : "N/A";

      let resumo = null;
      let classificacao = null;

      if (OPENROUTER_API_KEY && body) {
        try {
          classificacao = await classifyEmail({
            apiKey: OPENROUTER_API_KEY,
            model: OPENROUTER_MODEL,
            subject: subject || "N/A",
            body: body.slice(0, 8000),
            threadHistory: threadHistory.slice(0, 8000),
            senderEmail: extractEmailAddress(from),
          });
          resumo = classificacao.contexto.resumo_problema;
        } catch (error) {
          console.warn("AI triage failed:", error);
        }
      }

      const emailDate = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
      await sb.from("emails_recebidos").insert({
        message_id: msgId,
        thread_id: threadId,
        remetente: from,
        assunto: subject,
        corpo: body.slice(0, 10000),
        resumo_ia: resumo,
        classificacao_ia: classificacao,
        data_email: emailDate,
        notificado_slack: false,
      });

      if (SLACK_WEBHOOK_URL) {
        const triagem = classificacao
          ? `\n🧠 *Thread:* ${classificacao.analise_thread.tipo}\n🏷️ *Sistema:* ${classificacao.contexto.categoria_sistema}\n🚦 *Prioridade:* ${classificacao.triagem.prioridade_sugerida}\n🙂 *Sentimento:* ${classificacao.triagem.sentimento_cliente}\n👉 *Ação:* ${classificacao.triagem.acao_recomendada}`
          : "";
        const slackText = `📧 *NOVO EMAIL RECEBIDO*\n📬 De: ${from}\n📋 Assunto: ${subject}${resumo ? `\n🤖 *Resumo IA:* ${resumo}` : ""}${triagem}\n⏰ ${new Date(emailDate).toLocaleString("pt-BR")}`;

        await fetch(SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: slackText }),
        });

        await sb.from("emails_recebidos").update({ notificado_slack: true }).eq("message_id", msgId);
      }

      results.push(`Email: ${subject}`);
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, details: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Gmail poll error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
