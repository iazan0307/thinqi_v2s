-- Histórico de estimativas: remove unique(empresa_id, mes_ref) e cria índice simples.
DROP INDEX IF EXISTS "estimativas_imposto_pdf_empresa_id_mes_ref_key";

CREATE INDEX IF NOT EXISTS "estimativas_imposto_pdf_empresa_id_mes_ref_idx"
  ON "estimativas_imposto_pdf"("empresa_id", "mes_ref");

-- valor_total: TOTAL geral extraído do PDF (zero quando o parser não identifica).
ALTER TABLE "estimativas_imposto_pdf"
  ADD COLUMN IF NOT EXISTS "valor_total" DECIMAL(14,2) NOT NULL DEFAULT 0;
