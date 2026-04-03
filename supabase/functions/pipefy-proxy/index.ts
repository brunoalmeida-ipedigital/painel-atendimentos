import { corsHeaders } from '@supabase/supabase-js/cors';

const PIPEFY_URL = "https://api.pipefy.com/graphql";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const PIPEFY_TOKEN = Deno.env.get('PIPEFY_TOKEN');
  if (!PIPEFY_TOKEN) {
    return new Response(JSON.stringify({ error: 'PIPEFY_TOKEN not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { query, variables } = body;

    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid query' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const response = await fetch(PIPEFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PIPEFY_TOKEN}`,
      },
      body: JSON.stringify({ query, variables: variables || {} }),
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.ok ? 200 : response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Pipefy proxy error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
