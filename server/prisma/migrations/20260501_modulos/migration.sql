-- Catálogo de módulos comercializáveis
CREATE TABLE "modulos" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modulos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "modulos_codigo_key" ON "modulos"("codigo");

-- Habilitação por empresa (toggle)
CREATE TABLE "empresa_modulos" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "modulo_id" TEXT NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "habilitado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desabilitado_em" TIMESTAMP(3),
    "observacao" TEXT,

    CONSTRAINT "empresa_modulos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "empresa_modulos_empresa_id_modulo_id_key"
    ON "empresa_modulos"("empresa_id", "modulo_id");
CREATE INDEX "empresa_modulos_empresa_id_idx"
    ON "empresa_modulos"("empresa_id");

ALTER TABLE "empresa_modulos"
    ADD CONSTRAINT "empresa_modulos_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "empresa_modulos"
    ADD CONSTRAINT "empresa_modulos_modulo_id_fkey"
    FOREIGN KEY ("modulo_id") REFERENCES "modulos"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: 3 módulos canônicos do produto.
INSERT INTO "modulos" ("id", "codigo", "nome", "descricao", "ordem", "ativo", "created_at", "updated_at")
VALUES
    ('mod_auditoria_socios', 'auditoria_socios', 'Auditoria de Sócios',
     'Identifica retiradas de sócios em extratos bancários e alerta quando ultrapassam o limite de isenção de IR.',
     10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('mod_conciliacao_fiscal', 'conciliacao_fiscal', 'Conciliação Fiscal',
     'Cruza entradas bancárias + cartão + faturamento para detectar receita não declarada.',
     20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('mod_portal_cliente', 'portal_cliente', 'Portal do Cliente',
     'Dashboard de fluxo de caixa para o cliente final acompanhar suas finanças.',
     30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("codigo") DO NOTHING;
