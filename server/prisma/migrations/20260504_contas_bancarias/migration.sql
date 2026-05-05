-- Cadastro de contas bancárias por empresa, populado via upload de OFX.
-- Chave de roteamento do upload em lote: (bank_id, acct_id) → empresa_id.

CREATE TABLE "contas_bancarias" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "bank_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "agencia" TEXT,
    "acct_id" TEXT NOT NULL,
    "acct_id_display" TEXT,
    "account_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_bancarias_pkey" PRIMARY KEY ("id")
);

-- Mesma (banco, conta) NUNCA pode estar em duas empresas — bloqueia roteamento ambíguo.
CREATE UNIQUE INDEX "contas_bancarias_bank_id_acct_id_key"
    ON "contas_bancarias"("bank_id", "acct_id");

CREATE INDEX "contas_bancarias_empresa_id_idx"
    ON "contas_bancarias"("empresa_id");

ALTER TABLE "contas_bancarias"
    ADD CONSTRAINT "contas_bancarias_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
