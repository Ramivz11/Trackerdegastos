import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { fetchAccounts, fetchCategories, fetchCategoryRules } from '../lib/api'
import type { Account, Category, CategoryRule } from '../types'
import { useAuth } from './AuthContext'

interface DataContextValue {
  categories: Category[]
  categoriesById: Record<string, Category>
  loadingCategories: boolean
  reloadCategories: () => Promise<Category[]>
  accounts: Account[]
  accountsById: Record<string, Account>
  loadingAccounts: boolean
  reloadAccounts: () => Promise<void>
  rules: CategoryRule[]
  reloadRules: () => Promise<void>
}

const DataContext = createContext<DataContextValue | undefined>(undefined)

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [rules, setRules] = useState<CategoryRule[]>([])

  const reloadCategories = useCallback(async () => {
    if (!user) return []
    try {
      const next = await fetchCategories()
      setCategories(next)
      return next
    } finally {
      setLoadingCategories(false)
    }
  }, [user])

  const reloadAccounts = useCallback(async () => {
    if (!user) return
    try {
      setAccounts(await fetchAccounts())
    } finally {
      setLoadingAccounts(false)
    }
  }, [user])

  const reloadRules = useCallback(async () => {
    if (!user) return
    // Las reglas son opcionales: si la tabla todavía no existe, seguimos igual.
    try {
      setRules(await fetchCategoryRules())
    } catch {
      setRules([])
    }
  }, [user])

  useEffect(() => {
    if (user) {
      void reloadCategories()
      void reloadAccounts()
      void reloadRules()
    }
  }, [user, reloadCategories, reloadAccounts, reloadRules])

  const categoriesById = Object.fromEntries(categories.map((c) => [c.id, c]))
  const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]))

  return (
    <DataContext.Provider
      value={{
        categories,
        categoriesById,
        loadingCategories,
        reloadCategories,
        accounts,
        accountsById,
        loadingAccounts,
        reloadAccounts,
        rules,
        reloadRules,
      }}
    >
      {children}
    </DataContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData debe usarse dentro de DataProvider')
  return ctx
}
