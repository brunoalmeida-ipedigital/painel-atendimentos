const EMAIL_CLASSIFICATION_PROMPT = `Você é um Analista de Triagem Nível Sênior de um NOC de atendimento de TI/Sistemas. Sua função é ler e-mails de clientes, extrair os dados vitais e formatá-los estritamente em um JSON estruturado.

DIRETRIZES:
Seja extremamente conciso. Não adicione saudações.
Se uma informação não estiver presente no e-mail, preencha o campo com "N/A" ou null. NÃO invente dados.
Para a "categoria_sistema", classifique apenas dentro destas opções: [PJBank, TEF, NFe, Boleto Fácil, Outros].
Analise o tom do cliente (Sentimento) para definir a urgência.

FORMATO DE SAÍDA OBRIGATÓRIO (Apenas JSON, sem markdown extra):
{"analise_thread": {"tipo": "novo" | "continuacao","motivo_classificacao": "Breve explicação do porquê definiu como novo ou continuação"},"dados_cliente": {"nome": "Nome identificado","email_origem": "Email do remente"},"contexto": {"categoria_sistema": "Sistema identificado","resumo_problema": "Resumo em até 2 linhas do que o cliente precisa","interacoes_anteriores": "Resumo das mensagens passadas (se houver histórico na thread)"},"triagem": {"sentimento_cliente": "Calmo" | "Dúvida" | "Urgente" | "Irritado","prioridade_sugerida": "Baixa" | "Média" | "Alta" | "Crítica","acao_recomendada": "O que o analista deve fazer primeiro"}}`;

const RESOLUTION_PROMPT = `Você é um assistente de documentação técnica. O usuário fornecerá o histórico de anotações de um chamado de suporte técnico finalizado.

Crie uma "Mensagem de Resolução" padronizada, profissional e direta (máximo de 2 frases), que será enviada ao cliente ou salva no histórico.

Padrão exigido: "[Ação Principal] realizada com sucesso. [Detalhe do que foi feito/configurado]."`;

export interface EmailClassification {
  analise_thread: {
    tipo: "novo" | "continuacao";
    motivo_classificacao: string;
  };
  dados_cliente: {
    nome: string;
    email_origem: string;
  };
  contexto: {
    categoria_sistema: "PJBank" | "TEF" | "NFe" | "Boleto Fácil" | "Outros";
    resumo_problema: string;
    interacoes_anteriores: string | null;
  };
  triagem: {
    sentimento_cliente: "Calmo" | "Dúvida" | "Urgente" | "Irritado";
    prioridade_sugerida: "Baixa" | "Média" | "Alta" | "Crítica";
    acao_recomendada: string;
  };
}

const ALLOWED_CATEGORIES = new Set(["PJBank", "TEF", "NFe", "Boleto Fácil", "Outros"]);
const ALLOWED_SENTIMENTS = new Set(["Calmo", "Dúvida", "Urgente", "Irritado"]);
const ALLOWED_PRIORITIES = new Set(["Baixa", "Média", "Alta", "Crítica"]);

const stripCodeFences = (value: string) =>
  value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

const extractJson = (value: string) => {
  const cleaned = stripCodeFences(value);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Resposta da IA não retornou JSON válido");
  }
  return cleaned.slice(start, end + 1);
};

const truncate = (value: string, max: number) => value.length > max ? `${value.slice(0, max)}...` : value;

const normalizeClassification = (payload: Partial<EmailClassification>, fallbackEmail: string): EmailClassification => {
  const category = ALLOWED_CATEGORIES.has(payload.contexto?.categoria_sistema || "")
    ? payload.contexto!.categoria_sistema
    : "Outros";
  const feeling = ALLOWED_SENTIMENTS.has(payload.triagem?.sentimento_cliente || "")
    ? payload.triagem!.sentimento_cliente
    : "Dúvida";
  const priority = ALLOWED_PRIORITIES.has(payload.triagem?.prioridade_sugerida || "")
    ? payload.triagem!.prioridade_sugerida
    : "Média";

  return {
    analise_thread: {
      tipo: payload.analise_thread?.tipo === "continuacao" ? "continuacao" : "novo",
      motivo_classificacao: truncate(payload.analise_thread?.motivo_classificacao || "Classificação inferida pela IA.", 220),
    },
    dados_cliente: {
      nome: truncate(payload.dados_cliente?.nome || "N/A", 160),
      email_origem: truncate(payload.dados_cliente?.email_origem || fallbackEmail || "N/A", 200),
    },
    contexto: {
      categoria_sistema: category,
      resumo_problema: truncate(payload.contexto?.resumo_problema || "N/A", 500),
      interacoes_anteriores: truncate(payload.contexto?.interacoes_anteriores || "N/A", 600),
    },
    triagem: {
      sentimento_cliente: feeling,
      prioridade_sugerida: priority,
      acao_recomendada: truncate(payload.triagem?.acao_recomendada || "N/A", 300),
    },
  };
};

const openRouterChat = async ({
  apiKey,
  model,
  messages,
}: {
  apiKey: string;
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
}) => {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/brunoalmeida-ipedigital/painel-atendimentos",
      "X-Title": "Painel Atendimentos",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter error [${response.status}]: ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenRouter retornou uma resposta vazia");
  }

  return content;
};

export const classifyEmail = async ({
  apiKey,
  model,
  subject,
  body,
  threadHistory,
  senderEmail,
}: {
  apiKey: string;
  model: string;
  subject: string;
  body: string;
  threadHistory: string;
  senderEmail: string;
}): Promise<EmailClassification> => {
  const content = await openRouterChat({
    apiKey,
    model,
    messages: [
      { role: "system", content: EMAIL_CLASSIFICATION_PROMPT },
      {
        role: "user",
        content: `<email_subject>${subject || "N/A"}</email_subject>\n<email_body>${body || "N/A"}</email_body>\n<thread_history>${threadHistory || "N/A"}</thread_history>`,
      },
    ],
  });

  const parsed = JSON.parse(extractJson(content)) as Partial<EmailClassification>;
  return normalizeClassification(parsed, senderEmail);
};

export const summarizeResolution = async ({
  apiKey,
  model,
  historicoChamado,
}: {
  apiKey: string;
  model: string;
  historicoChamado: string;
}) => {
  const content = await openRouterChat({
    apiKey,
    model,
    messages: [
      { role: "system", content: RESOLUTION_PROMPT },
      {
        role: "user",
        content: `<historico_chamado>${historicoChamado || "N/A"}</historico_chamado>`,
      },
    ],
  });

  return stripCodeFences(content).replace(/\s+/g, " ").trim();
};
