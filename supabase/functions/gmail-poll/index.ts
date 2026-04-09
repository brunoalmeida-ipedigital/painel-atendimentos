import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
  const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const GOOGLE_REFRESH_TOKEN = Deno.env.get('GOOGLE_REFRESH_TOKEN');
  const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_WEBHOOK_URL');
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return new Response(JSON.stringify({ error: 'Google credentials not configured' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Get access token from refresh token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Failed to get Gmail access token');
    const accessToken = tokenData.access_token;

    // 2. Fetch recent messages (last 20, unread)
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=is:inbox newer_than:1d`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const listData = await listRes.json();
    const messageIds = (listData.messages || []).map((m: any) => m.id);

    if (messageIds.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Check which messages we already have
    const { data: existing } = await sb
      .from('emails_recebidos')
      .select('message_id')
      .in('message_id', messageIds);
    const existingIds = new Set((existing || []).map(e => e.message_id));

    const newIds = messageIds.filter((id: string) => !existingIds.has(id));
    const results: string[] = [];

    for (const msgId of newIds) {
      // Fetch full message
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const msgData = await msgRes.json();
      const headers = msgData.payload?.headers || [];
      const from = headers.find((h: any) => h.name === 'From')?.value || '';
      const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
      const dateStr = headers.find((h: any) => h.name === 'Date')?.value || '';

      // Extract body
      let body = '';
      const extractText = (part: any): string => {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
        }
        if (part.parts) {
          for (const p of part.parts) {
            const t = extractText(p);
            if (t) return t;
          }
        }
        return '';
      };
      body = extractText(msgData.payload || {});
      if (!body && msgData.snippet) body = msgData.snippet;

      // 4. Generate AI summary
      let resumo = null;
      if (LOVABLE_API_KEY && body) {
        try {
          const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash-lite',
              messages: [
                { role: 'system', content: 'Você é um assistente que resume emails de forma concisa em português. Máximo 2-3 frases. Destaque o ponto principal e ação necessária.' },
                { role: 'user', content: `Resuma este email:\n\nDe: ${from}\nAssunto: ${subject}\n\n${body.slice(0, 3000)}` },
              ],
            }),
          });
          if (aiRes.ok) {
            const aiData = await aiRes.json();
            resumo = aiData.choices?.[0]?.message?.content || null;
          }
        } catch (e) {
          console.warn('AI summary failed:', e);
        }
      }

      // 5. Save to DB
      const emailDate = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
      await sb.from('emails_recebidos').insert({
        message_id: msgId,
        remetente: from,
        assunto: subject,
        corpo: body.slice(0, 10000),
        resumo_ia: resumo,
        data_email: emailDate,
        notificado_slack: false,
      });

      // 6. Send to Slack (PJ BANK channel via same webhook)
      if (SLACK_WEBHOOK_URL) {
        const slackText = `📧 *NOVO EMAIL RECEBIDO*\n📬 De: ${from}\n📋 Assunto: ${subject}\n${resumo ? `\n🤖 *Resumo IA:* ${resumo}` : ''}\n⏰ ${new Date(emailDate).toLocaleString('pt-BR')}`;
        
        await fetch(SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: slackText }),
        });

        // Mark as notified
        await sb.from('emails_recebidos').update({ notificado_slack: true }).eq('message_id', msgId);
      }

      results.push(`Email: ${subject}`);
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, details: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Gmail poll error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
