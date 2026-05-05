-- Tabela de auditoria estruturada para operações sensíveis.
-- Registros são imutáveis (apenas inserts).

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidade_id" TEXT,
    "usuario_id" TEXT,
    "empresa_id" TEXT,
    "detalhes" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_acao_idx" ON "audit_logs"("acao");
CREATE INDEX "audit_logs_entidade_entidade_id_idx" ON "audit_logs"("entidade", "entidade_id");
CREATE INDEX "audit_logs_usuario_id_idx" ON "audit_logs"("usuario_id");
CREATE INDEX "audit_logs_empresa_id_idx" ON "audit_logs"("empresa_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- ON DELETE SET NULL: se o usuário for removido, o log é preservado mas com FK null.
ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_usuario_id_fkey"
    FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
