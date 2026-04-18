CREATE TYPE "PerfilCliente" AS ENUM ('SOCIO', 'ADMINISTRATIVO');

ALTER TABLE "usuarios"
    ADD COLUMN "perfil_cliente" "PerfilCliente" NOT NULL DEFAULT 'SOCIO';
