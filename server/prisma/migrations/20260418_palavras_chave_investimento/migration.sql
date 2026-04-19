CREATE TABLE "palavras_chave_investimento" (
    "id" TEXT NOT NULL,
    "palavra" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "palavras_chave_investimento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "palavras_chave_investimento_palavra_key" ON "palavras_chave_investimento"("palavra");
