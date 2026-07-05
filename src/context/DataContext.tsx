import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { fetchAccounts, fetchCategories } from '../lib/api'
import type { Account, Category } from '../types'
import { useAuth } from './AuthContext'

interface DataContextValue {
  categories: Category[]
  categoriesById: Record<string, Category>
  loadingCategories: boolean
  reloadCategories: () => Promise<void>
  accounts: Account[]
  accountsById: Record<string, Account>
  loadingAccounts: boolean
  reloadAccounts: () => Promise<void>
}

const DataContext = createContext<DataContextValue | undefined>(undefined)

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)

  const reloadCategories = useCallback(async () => {
    if (!user) return
    try {
      setCategories(await fetchCategories())
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

  useEffect(() => {
    if (user) {
      void reloadCategories()
      void reloadAccounts()
    }
  }, [user, reloadCategories, reloadAccounts])

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
