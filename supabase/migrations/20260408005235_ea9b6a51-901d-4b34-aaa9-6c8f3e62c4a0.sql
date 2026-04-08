
-- Add first attempt timestamp to atendimentos
ALTER TABLE public.atendimentos 
ADD COLUMN IF NOT EXISTS primeira_tentativa_em TIMESTAMPTZ DEFAULT NULL;

-- Add retry count tracker
ALTER TABLE public.atendimentos 
ADD COLUMN IF NOT EXISTS tentativa_atual INTEGER DEFAULT 0;

-- Add last retry notification timestamp
ALTER TABLE public.atendimentos 
ADD COLUMN IF NOT EXISTS ultima_notificacao_retry TIMESTAMPTZ DEFAULT NULL;

-- Create independent agendamentos table
CREATE TABLE public.agendamentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  licenca TEXT NOT NULL,
  data_hora TIMESTAMPTZ NOT NULL,
  notificado BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;

-- Public access policies (no auth)
CREATE POLICY "Anyone can view agendamentos" ON public.agendamentos FOR SELECT USING (true);
CREATE POLICY "Anyone can create agendamentos" ON public.agendamentos FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update agendamentos" ON public.agendamentos FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete agendamentos" ON public.agendamentos FOR DELETE USING (true);
