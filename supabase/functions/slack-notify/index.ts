const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_WEBHOOK_URL');
  if (!SLACK_WEBHOOK_URL) {
    return new Response(JSON.stringify({ error: 'SLACK_WEBHOOK_URL not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { type, analista, cliente, licenca, minutos, horaAgendada } = body;

    if (!type || typeof type !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing notification type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let text = '';

    switch (type) {
      case 'novo_atendimento':
        text = `🎯 *NOVO ATENDIMENTO*\n👤 Analista: ${analista}\n🏢 Cliente: ${cliente}\n🔑 Licença: ${licenca}\n⏱️ SLA de 4h iniciado!`;
        break;
      case 'alerta_20min':
        text = `⚠️ *ALERTA DE PRAZO — 20 MINUTOS*\n👤 Analista: ${analista}\n🏢 Cliente: ${cliente}\n🔑 Licença: ${licenca}\n⏳ Faltam ~${minutos || 20} minutos para o prazo de 4h!`;
        break;
      case 'alerta_5min':
        text = `🚨 *PRAZO CRÍTICO — 5 MINUTOS*\n👤 Analista: ${analista}\n🏢 Cliente: ${cliente}\n🔑 Licença: ${licenca}\n⏳ Faltam ~${minutos || 5} minutos! Ação imediata necessária!`;
        break;
      case 'prazo_vencido':
        text = `🔴 *PRAZO VENCIDO!*\n👤 Analista: ${analista}\n🏢 Cliente: ${cliente}\n🔑 Licença: ${licenca}\n❌ O prazo de 4h foi excedido!`;
        break;
      case 'agendado_5min':
        text = `📅 *AGENDAMENTO EM 5 MINUTOS*\n👤 Analista: ${analista}\n🏢 Cliente: ${cliente}\n🔑 Licença: ${licenca}\n🕐 Horário agendado: ${horaAgendada}`;
        break;
      default:
        text = `📢 *Notificação*\n${JSON.stringify(body)}`;
    }

    const slackRes = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!slackRes.ok) {
      const errText = await slackRes.text();
      throw new Error(`Slack webhook failed [${slackRes.status}]: ${errText}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Slack notify error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
