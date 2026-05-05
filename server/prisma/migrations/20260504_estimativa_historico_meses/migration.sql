-- Janela configurável do histórico de estimativas exposto ao cliente no portal.
-- null = todos | 1 = apenas o mais recente | N = últimos N meses

ALTER TABLE "empresas"
    ADD COLUMN "estimativa_historico_meses" INTEGER;
