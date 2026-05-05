-- Soft delete + dados completos do parser para EstimativaImpostoPDF.
-- Soft delete preserva histórico contábil mesmo após admin "remover".

ALTER TABLE "estimativas_imposto_pdf"
    ADD COLUMN "extracted_data" JSONB,
    ADD COLUMN "deleted_at" TIMESTAMP(3),
    ADD COLUMN "deleted_by" TEXT;

CREATE INDEX "estimativas_imposto_pdf_empresa_id_deleted_at_idx"
    ON "estimativas_imposto_pdf"("empresa_id", "deleted_at");
