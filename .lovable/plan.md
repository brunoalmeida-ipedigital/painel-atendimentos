## Objetivo

Eliminar toda a integração com Pipefy. O painel passa a ser **100% alimentado pelo banco do Lovable Cloud** (que já existe — tabela `atendimentos`), com:

- **CRUD manual** pelo próprio painel (criar, editar, mudar etapa, excluir).
- **Tempo real** via Realtime do Lovable Cloud — alterações feitas em outro navegador/aba aparecem na hora, sem reload.
- **Importar planilha** (.xlsx / .csv) para carga em massa.
- **Exportar planilha** (.xlsx) com as 8 colunas oficiais, a qualquer momento.
- **Migração única** dos atendimentos atuais (vindos do Pipefy) que já estão salvos no banco — eles continuam disponíveis.

## As 8 colunas oficiais da planilha

| Coluna     | Campo no banco |
|------------|----------------|
| Prioridade | `dem`          |
| Classificação | `clas`      |
| Licença    | `lic`          |
| Cliente    | `cli`          |
| Telefone   | `cel`          |
| Etapa      | `etapa`        |
| Aberto em  | `aberto_em`    |
| Observação | `comentario`   |

Campos extras (`analista`, `tentativas`, `encerrado`, `agendado_em`, `hora_contato`, flags de alerta) **permanecem no app e no banco**, mas **não entram** na planilha — conforme sua escolha.

## Mudanças

### 1. Remoção do Pipefy
- Apagar `supabase/functions/pipefy-proxy/` (e qualquer referência).
- Pedir para remover o secret `PIPEFY_TOKEN` (não usado mais).
- Em `src/pages/Index.tsx`: remover `PIPE_ID`, `PIPE_QUERY`, `pipefyQuery`, `fetchData`, o polling de 60s, `fieldVal`, `getAnalista`, `phaseIds`, `seenCards`, botão/lógica de "sincronizar Pipefy".

### 2. Realtime (Lovable Cloud)
- Migração: habilitar `REPLICA IDENTITY FULL` e publicar a tabela `atendimentos` em `supabase_realtime`.
- No `Index.tsx`: assinar `postgres_changes` (INSERT/UPDATE/DELETE) e atualizar o estado local — substitui o polling.

### 3. CRUD no painel
- **Criar**: o modal "Novo atendimento" já existe; passa a inserir direto no banco gerando `id` via `crypto.randomUUID()`.
- **Editar / mudar etapa / marcar contato**: já usam `upsertAtendimento` — mantidos, só sem o id do Pipefy.
- **Excluir**: novo botão na linha da tabela (ícone 🗑) com confirmação, faz `delete` no banco.

### 4. Importar planilha
- Botão "📥 Importar planilha" na barra superior.
- Aceita `.xlsx` (via `xlsx` / SheetJS) e `.csv`.
- Espera cabeçalhos: `Prioridade, Classificação, Licença, Cliente, Telefone, Etapa, Aberto em, Observação` (case-insensitive, com tolerância a acentos).
- Cada linha vira um registro novo (id gerado), `aberto_em` parseado de data BR ou ISO, demais campos com defaults sensatos.
- Mostra resumo: "X importados, Y ignorados (motivo)".

### 5. Exportar planilha
- Botão "📤 Exportar planilha" gera um `.xlsx` com **somente as 8 colunas** dos registros visíveis (respeitando filtros).
- Substitui o atual export para PDF/LibreOffice como opção padrão (PDF pode ficar como botão secundário se você quiser — me avise).

### 6. Schema
- O campo `pipefy_card_id` vira opcional / passa a guardar UUID local. Não precisa renomear agora — fica como chave única do registro. Posso renomear depois para `id` se preferir.

## Detalhes técnicos

- Dependência nova: `xlsx` (SheetJS) para ler/escrever .xlsx.
- Migração SQL:
  ```sql
  ALTER TABLE public.atendimentos REPLICA IDENTITY FULL;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.atendimentos;
  ```
- Assinatura Realtime em `useEffect` com cleanup (`supabase.removeChannel`).
- Parser de data aceita: `DD/MM/AAAA HH:mm`, `DD/MM/AAAA`, ISO `YYYY-MM-DDTHH:mm` e número serial Excel.
- Validação leve no import: linha sem `Licença` **e** sem `Cliente` é ignorada.

## Fora de escopo (confirmar se quer também)

- Sincronização **automática e contínua** com Google Sheets (requer conectar conta Google e tem limites de taxa). Pelo que você escolheu, fica de fora — você exporta/importa quando precisar.
- Renomear `pipefy_card_id` → `id` no schema.
- Remover de vez a coluna "Analista" da interface (hoje é filtro fixo BRUNO).

Se confirmar, sigo implementando.
