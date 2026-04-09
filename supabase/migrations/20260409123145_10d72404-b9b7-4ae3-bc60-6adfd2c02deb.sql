-- Add mensagem field to agendamentos
ALTER TABLE public.agendamentos ADD COLUMN mensagem text;

-- Create emails_recebidos table
CREATE TABLE public.emails_recebidos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id text UNIQUE,
  remetente text NOT NULL,
  assunto text NOT NULL DEFAULT '',
  corpo text DEFAULT '',
  resumo_ia text,
  data_email timestamp with time zone NOT NULL DEFAULT now(),
  notificado_slack boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.emails_recebidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view emails" ON public.emails_recebidos FOR SELECT USING (true);
CREATE POLICY "Anyone can insert emails" ON public.emails_recebidos FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update emails" ON public.emails_recebidos FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete emails" ON public.emails_recebidos FOR DELETE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.emails_recebidos;