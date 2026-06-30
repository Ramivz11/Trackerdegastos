import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { fetchCategories } from '../lib/api'
import type { Category } from '../types'
import { useAuth } from './AuthContext'

interface DataContextValue {
  categories: Category[]
  categoriesById: Record<string, Category>
  loadingCategories: boolean
  reloadCategories: () => Promise<void>
}

const DataContext = createContext<DataContextValue | undefined>(undefined)

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])
  const [loadingCategories, setLoading] = useState(true)

  const reloadCategories = useCallback(async () => {
    if (!user) return
    try {
      setCategories(await fetchCategories())
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user) void reloadCategories()
  }, [user, reloadCategories])

  const categoriesById = Object.fromEntries(categories.map((c) => [c.id, c]))

  return (
    <DataContext.Provider
      value={{ categories, categoriesById, loadingCategories, reloadCategories }}
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
