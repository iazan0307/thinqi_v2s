CREATE TABLE "estimativas_imposto_pdf" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "mes_ref" DATE NOT NULL,
    "pdf_path" TEXT NOT NULL,
    "nome_original" TEXT NOT NULL,
    "tamanho_bytes" INTEGER NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimativas_imposto_pdf_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "estimativas_imposto_pdf_empresa_id_mes_ref_key"
    ON "estimativas_imposto_pdf"("empresa_id", "mes_ref");

ALTER TABLE "estimativas_imposto_pdf"
    ADD CONSTRAINT "estimativas_imposto_pdf_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
