
CREATE TABLE public.atendimentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipefy_card_id TEXT UNIQUE,
  lic TEXT NOT NULL DEFAULT '',
  cli TEXT NOT NULL DEFAULT '',
  cel TEXT DEFAULT '',
  clas TEXT DEFAULT 'NFe',
  dem TEXT DEFAULT 'Média',
  stat TEXT DEFAULT '',
  etapa TEXT DEFAULT 'Caixa de entrada',
  analista TEXT DEFAULT '',
  comentario TEXT DEFAULT '',
  hora_contato TEXT DEFAULT '',
  tentativas BOOLEAN[] DEFAULT ARRAY[false,false,false,false,false,false,false,false],
  aberto_em BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  encerrado BOOLEAN DEFAULT false,
  encerrado_em BIGINT,
  agendado_em TEXT,
  a20 BOOLEAN DEFAULT false,
  a10 BOOLEAN DEFAULT false,
  a4h BOOLEAN DEFAULT false,
  a_agd BOOLEAN DEFAULT false,
  a05 BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.atendimentos ENABLE ROW LEVEL SECURITY;

-- Public access policies (no auth required)
CREATE POLICY "Anyone can read atendimentos" ON public.atendimentos FOR SELECT USING (true);
CREATE POLICY "Anyone can insert atendimentos" ON public.atendimentos FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update atendimentos" ON public.atendimentos FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete atendimentos" ON public.atendimentos FOR DELETE USING (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_atendimentos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_atendimentos_updated_at
BEFORE UPDATE ON public.atendimentos
FOR EACH ROW
EXECUTE FUNCTION public.update_atendimentos_updated_at();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.atendimentos;
