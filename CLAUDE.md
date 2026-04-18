# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é o ThinQi V2

Plataforma de **auditoria financeira automatizada** para o escritório de contabilidade ThinQi. Três funcionalidades principais:
1. **Auditoria de Sócios** — Identifica retiradas de sócios em extratos OFX/CSV via regex parcial de CPF, consolida por mês e alerta quando ultrapassam o limite de isenção de IR
2. **Conciliação Fiscal** — Cruza entradas bancárias + liquidações de cartão + faturamento (NFs do Robô IAZAN) para detectar receita não declarada
3. **Portal do Cliente** — Dashboard de fluxo de caixa para os clientes finais da contabilidade

Dois ambientes com autenticação e rotas separadas:
- **ADMIN/CONTADOR** → `/admin/*`
- **CLIENTE** → `/dashboard/*`

---

## Comandos

### Frontend (raiz)
```bash
npm run dev        # Vite na porta 8080, proxy /api → localhost:3001
npm run build
npm run lint
npm run test       # Vitest (jsdom), arquivos em src/**/*.{test,spec}.{ts,tsx}
npm run test:watch
```

### Backend (`server/`)
```bash
npm run dev        # tsx watch src/index.ts — porta 3001
npm run build      # prisma generate + migrate deploy + tsc
npm run typecheck  # tsc --noEmit
npm run db:migrate # prisma migrate dev (cria migration nova)
npm run db:studio  # Prisma Studio UI
npm run db:seed    # Popula banco com dados de teste (prisma/seed.ts)
```

### Variáveis de ambiente necessárias (`server/.env`)
```
DATABASE_URL=postgresql://...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
FRONTEND_URL=http://localhost:8080
```

---

## Arquitetura

### Frontend
- React 18 + TypeScript + Vite, alias `@` → `src/`
- `src/lib/api.ts` — cliente HTTP centralizado com refresh silencioso de JWT (fila de retentativas durante refresh)
- `src/contexts/AuthContext.tsx` — estado de autenticação global; valida token via `GET /api/auth/me` na montagem
- `src/layouts/` — `AdminLayout.tsx` e `DashboardLayout.tsx` envolvem as páginas com sidebar+header
- `App.tsx` — `<RequireAuth roles={[...]}>` protege cada grupo de rotas por role

### Backend (`server/src/`)
Express + TypeScript organizado em camadas:
```
routes/       → Apenas definição de rotas + middlewares de auth
controllers/  → Recebe req/res, chama services, devolve JSON
services/     → Regras de negócio puras
  parser/     → ofx.ts, csv.ts, iazan.ts (planilha Robô IAZAN), cartao.ts
  engine/     → cpfEngine.ts (identificação de retiradas), conciliacao.ts
  report/     → Geração de PDF com pdfkit
  email/      → Envio via Nodemailer/Resend
middleware/   → auth.ts (authenticate + requireRole), errorHandler.ts, notFound.ts
utils/        → jwt.ts e utilitários
```

Banco PostgreSQL via Prisma (`server/prisma/schema.prisma`). Entidades principais:
`Empresa` → `Socio` (com CPF hasheado + prefixo/sufixo para regex)
`ArquivoUpload` → `TransacaoBancaria` | `TransacaoCartao` | `Faturamento`
`RetiradaSocio`, `RelatorioDesconforto`, `Usuario`

### Fluxo de autenticação
Login retorna `accessToken` (15min) + `refreshToken` (7d), armazenados no `localStorage` com chaves `thinqi_token` / `thinqi_refresh`. O `api.ts` intercepta 401 e faz refresh automático antes de rejeitar a chamada.

### Roles
`ADMIN` e `CONTADOR` acessam `/admin/*`; `CLIENTE` acessa `/dashboard/*`. O middleware `requireRole()` no backend e `RequireAuth` no frontend garantem isolamento. Usuários CLIENTE só leem dados da própria `empresa_id`.

---

## Regras de Negócio Críticas

### CPF (LGPD obrigatório)
- CPF **nunca** é armazenado em texto claro — apenas `cpf_hash` (bcrypt), `cpf_prefixo` (3 primeiros dígitos) e `cpf_sufixo` (2 últimos)
- Exibição sempre mascarada: `123.***.***-45`
- Matching em descrições de transação: regex `^123.*45$` com ≥ 70% de confiança → alerta; match completo → vincula ao sócio

### Motor de Conciliação
Tolerância de inconsistência: < 2% = OK (verde), 2–5% = aviso (amarelo), > 5% = alerta (vermelho)

---

## Padrões

- Validação com **Zod** em todas as rotas da API
- **React Query** (`useQuery`/`useMutation`) para data fetching — não usar `fetch`/`axios` diretamente nas páginas, usar `src/lib/api.ts`
- Componentes de UI: sempre **shadcn/ui** (`src/components/ui/`) — não criar do zero
- Nomes de entidades de negócio em **português**; código técnico em inglês
- Erros do backend propagados via `AppError(statusCode, message)` e capturados pelo `errorHandler` middleware central
