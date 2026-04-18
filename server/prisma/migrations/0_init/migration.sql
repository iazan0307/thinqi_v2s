-- CreateEnum
CREATE TYPE "RegimeTributario" AS ENUM ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL');

-- CreateEnum
CREATE TYPE "TipoArquivo" AS ENUM ('OFX', 'CSV', 'PLANILHA');

-- CreateEnum
CREATE TYPE "StatusArquivo" AS ENUM ('PENDENTE', 'PROCESSANDO', 'PROCESSADO', 'CONFIRMADO', 'ERRO');

-- CreateEnum
CREATE TYPE "TipoTransacao" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CONTADOR', 'CLIENTE');

-- CreateEnum
CREATE TYPE "StatusRelatorio" AS ENUM ('OK', 'AVISO', 'ALERTA');

-- CreateTable
CREATE TABLE "empresas" (
    "id" TEXT NOT NULL,
    "razao_social" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "regime_tributario" "RegimeTributario" NOT NULL DEFAULT 'SIMPLES_NACIONAL',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "socios" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf_hash" TEXT NOT NULL,
    "cpf_prefixo" TEXT NOT NULL,
    "cpf_sufixo" TEXT NOT NULL,
    "cpf_mascara" TEXT NOT NULL,
    "percentual_societario" DECIMAL(5,2) NOT NULL,
    "limite_isencao" DECIMAL(12,2) NOT NULL DEFAULT 7640.80,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "socios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arquivos_upload" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tipo" "TipoArquivo" NOT NULL,
    "nome_original" TEXT NOT NULL,
    "nome_storage" TEXT NOT NULL,
    "tamanho_bytes" INTEGER NOT NULL,
    "status" "StatusArquivo" NOT NULL DEFAULT 'PENDENTE',
    "mensagem_erro" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processado_at" TIMESTAMP(3),
    "confirmado_at" TIMESTAMP(3),

    CONSTRAINT "arquivos_upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transacoes_bancarias" (
    "id" TEXT NOT NULL,
    "arquivo_id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "tipo" "TipoTransacao" NOT NULL,
    "cpf_detectado" TEXT,
    "nome_contraparte" TEXT,
    "confianca" DECIMAL(5,2),
    "sinal_deteccao" TEXT,
    "socio_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transacoes_bancarias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transacoes_cartao" (
    "id" TEXT NOT NULL,
    "arquivo_id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "bandeira" TEXT NOT NULL,
    "adquirente" TEXT NOT NULL,
    "valor_bruto" DECIMAL(12,2) NOT NULL,
    "taxa" DECIMAL(5,4) NOT NULL,
    "valor_liquido" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transacoes_cartao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faturamentos" (
    "id" TEXT NOT NULL,
    "arquivo_id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "mes_ref" DATE NOT NULL,
    "valor_total_nf" DECIMAL(12,2) NOT NULL,
    "valor_liquido_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_retencoes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "qtd_notas" INTEGER NOT NULL,
    "qtd_canceladas" INTEGER NOT NULL DEFAULT 0,
    "cnpj_emitente" TEXT,
    "nome_emitente" TEXT,
    "furos_sequencia" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faturamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retiradas_socios" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "mes_ref" DATE NOT NULL,
    "valor_total" DECIMAL(12,2) NOT NULL,
    "qtd_transferencias" INTEGER NOT NULL,
    "alerta_limite" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retiradas_socios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relatorios_desconforto" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "mes_ref" DATE NOT NULL,
    "total_entradas" DECIMAL(12,2) NOT NULL,
    "total_faturado" DECIMAL(12,2) NOT NULL,
    "total_cartao" DECIMAL(12,2) NOT NULL,
    "diferenca" DECIMAL(12,2) NOT NULL,
    "percentual_inconsistencia" DECIMAL(5,2) NOT NULL,
    "status" "StatusRelatorio" NOT NULL,
    "pdf_path" TEXT,
    "enviado_em" TIMESTAMP(3),
    "liberado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relatorios_desconforto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CLIENTE',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "refresh_token_hash" TEXT,
    "ultimo_login" TIMESTAMP(3),
    "reset_token_hash" TEXT,
    "reset_token_expires" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresas_cnpj_key" ON "empresas"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "faturamentos_empresa_id_mes_ref_key" ON "faturamentos"("empresa_id", "mes_ref");

-- CreateIndex
CREATE UNIQUE INDEX "retiradas_socios_empresa_id_socio_id_mes_ref_key" ON "retiradas_socios"("empresa_id", "socio_id", "mes_ref");

-- CreateIndex
CREATE UNIQUE INDEX "relatorios_desconforto_empresa_id_mes_ref_key" ON "relatorios_desconforto"("empresa_id", "mes_ref");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- AddForeignKey
ALTER TABLE "socios" ADD CONSTRAINT "socios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arquivos_upload" ADD CONSTRAINT "arquivos_upload_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arquivos_upload" ADD CONSTRAINT "arquivos_upload_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacoes_bancarias" ADD CONSTRAINT "transacoes_bancarias_arquivo_id_fkey" FOREIGN KEY ("arquivo_id") REFERENCES "arquivos_upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacoes_bancarias" ADD CONSTRAINT "transacoes_bancarias_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacoes_bancarias" ADD CONSTRAINT "transacoes_bancarias_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacoes_cartao" ADD CONSTRAINT "transacoes_cartao_arquivo_id_fkey" FOREIGN KEY ("arquivo_id") REFERENCES "arquivos_upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacoes_cartao" ADD CONSTRAINT "transacoes_cartao_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faturamentos" ADD CONSTRAINT "faturamentos_arquivo_id_fkey" FOREIGN KEY ("arquivo_id") REFERENCES "arquivos_upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faturamentos" ADD CONSTRAINT "faturamentos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retiradas_socios" ADD CONSTRAINT "retiradas_socios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retiradas_socios" ADD CONSTRAINT "retiradas_socios_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relatorios_desconforto" ADD CONSTRAINT "relatorios_desconforto_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 7.6.0                       │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
