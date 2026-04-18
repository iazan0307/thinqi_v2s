/**
 * "Ver como cliente" — permite que ADMIN/CONTADOR navegue no portal
 * do cliente impersonando uma empresa específica.
 * Persistido em localStorage para sobreviver a refreshes durante a sessão.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from "react"

interface ViewAsState {
  empresaId: string
  razaoSocial: string
}

interface ViewAsContextType {
  viewAs: ViewAsState | null
  enterViewAs: (empresaId: string, razaoSocial: string) => void
  exitViewAs: () => void
}

const STORAGE_KEY = "thinqi_view_as_empresa"

const ViewAsContext = createContext<ViewAsContextType | null>(null)

export function ViewAsProvider({ children }: { children: React.ReactNode }) {
  const [viewAs, setViewAs] = useState<ViewAsState | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as ViewAsState) : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (viewAs) localStorage.setItem(STORAGE_KEY, JSON.stringify(viewAs))
    else localStorage.removeItem(STORAGE_KEY)
  }, [viewAs])

  const enterViewAs = useCallback((empresaId: string, razaoSocial: string) => {
    setViewAs({ empresaId, razaoSocial })
  }, [])

  const exitViewAs = useCallback(() => {
    setViewAs(null)
  }, [])

  return (
    <ViewAsContext.Provider value={{ viewAs, enterViewAs, exitViewAs }}>
      {children}
    </ViewAsContext.Provider>
  )
}

export function useViewAs() {
  const ctx = useContext(ViewAsContext)
  if (!ctx) throw new Error("useViewAs fora do ViewAsProvider")
  return ctx
}

/**
 * Resolve o empresa_id a usar nas chamadas do portal do cliente.
 * - CLIENTE: null (backend usa user.empresa_id)
 * - ADMIN/CONTADOR em view-as: empresaId impersonado
 * - ADMIN/CONTADOR sem view-as: null (backend rejeita com 400 — pedir para selecionar empresa)
 */
export function resolvePortalEmpresaId(
  role: string | undefined,
  viewAs: ViewAsState | null,
  fallback?: string | null,
): string | null {
  if (!role) return null
  if (role === "CLIENTE") return null
  if (viewAs) return viewAs.empresaId
  return fallback ?? null
}
