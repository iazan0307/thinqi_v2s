import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'

export type Role = 'ADMIN' | 'CONTADOR' | 'CLIENTE'
export type PerfilCliente = 'SOCIO' | 'ADMINISTRATIVO'

export interface AuthUser {
  id: string
  nome: string
  email: string
  role: Role
  empresa_id: string | null
  perfil_cliente?: PerfilCliente
}

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  login: (email: string, senha: string) => Promise<AuthUser>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('thinqi_token')
    if (!token) { setIsLoading(false); return }

    api.get<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => {
        localStorage.removeItem('thinqi_token')
        localStorage.removeItem('thinqi_refresh')
      })
      .finally(() => setIsLoading(false))
  }, [])

  const login = useCallback(async (email: string, senha: string): Promise<AuthUser> => {
    const data = await api.post<{ accessToken: string; refreshToken: string; usuario: AuthUser }>(
      '/auth/login',
      { email, senha },
    )
    localStorage.setItem('thinqi_token', data.accessToken)
    localStorage.setItem('thinqi_refresh', data.refreshToken)
    setUser(data.usuario)
    return data.usuario
  }, [])

  const logout = useCallback(() => {
    api.post('/auth/logout').catch(() => {})
    localStorage.removeItem('thinqi_token')
    localStorage.removeItem('thinqi_refresh')
    setUser(null)
    window.location.href = '/'
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}
