-- SHA-256 do conteúdo do arquivo para deduplicação por (empresa_id, hash_sha256).
-- Coluna nullable: registros antigos não têm hash, mas novos uploads sempre vão calcular.

ALTER TABLE "arquivos_upload"
    ADD COLUMN "hash_sha256" TEXT;

CREATE INDEX "arquivos_upload_empresa_id_hash_sha256_idx"
    ON "arquivos_upload"("empresa_id", "hash_sha256");
