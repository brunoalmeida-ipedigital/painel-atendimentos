ALTER TABLE public.emails_recebidos
ADD COLUMN IF NOT EXISTS thread_id text,
ADD COLUMN IF NOT EXISTS classificacao_ia jsonb;
