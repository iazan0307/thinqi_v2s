-- Renomeia o valor do enum PerfilCliente: ADMINISTRATIVO → SECRETARIA.
-- Postgres aceita ALTER TYPE ... RENAME VALUE diretamente — não precisa
-- recriar o tipo nem migrar dados existentes.

ALTER TYPE "PerfilCliente" RENAME VALUE 'ADMINISTRATIVO' TO 'SECRETARIA';
