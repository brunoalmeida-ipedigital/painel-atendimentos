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
  const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_WEBHOOK_URL');

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const nowMs = Date.now();
    const EIGHT_HOURS = 8 * 60 * 60 * 1000;
    const MAX_ATTEMPTS = 6;

    // Get all active cards that have primeira_tentativa_em set and are not finished
    const { data: cards, error } = await sb
      .from('atendimentos')
      .select('*')
      .eq('encerrado', false)
      .not('primeira_tentativa_em', 'is', null);

    if (error) throw error;

    const results: string[] = [];

    for (const card of (cards || [])) {
      const firstAttempt = new Date(card.primeira_tentativa_em).getTime();
      const currentAttempt = card.tentativa_atual || 1;
      
      if (currentAttempt >= MAX_ATTEMPTS) continue;

      // Calculate expected next attempt time
      const nextAttemptTime = firstAttempt + (currentAttempt * EIGHT_HOURS);
      
      if (nowMs >= nextAttemptTime) {
        const newAttempt = currentAttempt + 1;
        
        // Update tentativas array
        const tentativas = card.tentativas || [false,false,false,false,false,false,false,false];
        if (newAttempt - 1 < tentativas.length) {
          tentativas[newAttempt - 1] = true;
        }

        // Update the card
        await sb.from('atendimentos').update({
          tentativa_atual: newAttempt,
          tentativas,
          ultima_notificacao_retry: new Date().toISOString(),
        }).eq('id', card.id);

        // Slack notifications for retry attempts disabled per user request
        results.push(`Card ${card.lic}: ${newAttempt}ª tentativa registrada (sem notificação Slack)`);
      }
    }

    // === Check agendamentos (3 min before) ===
    const THREE_MIN = 3 * 60 * 1000;
    const { data: agendamentos, error: agErr } = await sb
      .from('agendamentos')
      .select('*')
      .eq('notificado', false);

    if (agErr) throw agErr;

    for (const ag of (agendamentos || [])) {
      const agTime = new Date(ag.data_hora).getTime();
      const diff = agTime - nowMs;

      if (diff <= THREE_MIN && diff > -THREE_MIN) {
        // Mark as notified
        await sb.from('agendamentos').update({ notificado: true }).eq('id', ag.id);

        // Send Slack
        if (SLACK_WEBHOOK_URL) {
          const horaFormatada = new Date(ag.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const text = `📅 *AGENDAMENTO EM 3 MINUTOS*\n👤 Nome: ${ag.nome}\n🔑 Licença: ${ag.licenca}\n🕐 Horário: ${horaFormatada}\n⏰ Seu agendamento está prestes a iniciar!`;
          
          await fetch(SLACK_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
        }

        results.push(`Agendamento ${ag.nome}: notificação enviada`);
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Check retries error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
