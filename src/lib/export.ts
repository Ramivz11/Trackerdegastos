import { netAmount, netArs, reimbursable } from './amounts'
import { toArs } from './format'
import type { Account, Category, TransactionWithCategory } from '../types'

/**
 * Escapa un valor para CSV.
 *
 * Además de las comillas y el separador, neutraliza las celdas que arrancan con
 * `= + - @` o un tabulador: Excel las interpreta como fórmula, así que una nota
 * como `=HYPERLINK(...)` se ejecutaría al abrir el archivo. Con la comilla
 * simple adelante se muestran como texto (Excel no la imprime).
 */
function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[";\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Genera el CSV de una lista de movimientos.
 *
 * Usa `;` como separador y coma decimal, que es lo que espera Excel en
 * configuración regional española; así se abre bien con doble clic.
 */
export function transactionsToCsv(
  txs: TransactionWithCategory[],
  categoriesById: Record<string, Category>,
  accountsById: Record<string, Account>,
): string {
  const header = [
    'Fecha',
    'Tipo',
    'Categoría',
    'Cuenta',
    'Descripción',
    'Monto pagado',
    'Me deben',
    'Monto propio',
    'Moneda',
    'Cotización',
    'Equivalente ARS',
    'Cuota',
    'Compartido con',
  ]

  const num = (n: number) => n.toFixed(2).replace('.', ',')

  const lines = txs.map((t) => {
    const cat = t.category_id ? categoriesById[t.category_id] : null
    const acc = t.account_id ? accountsById[t.account_id] : null
    const cuota =
      t.installment_n && t.installment_total
        ? `${t.installment_n}/${t.installment_total}`
        : ''
    const esGasto = t.type === 'expense'
    return [
      t.transaction_date,
      esGasto ? 'Gasto' : 'Ingreso',
      cat?.name ?? '',
      acc?.name ?? '',
      t.description ?? '',
      num(Number(t.amount)),
      num(reimbursable(t)),
      num(netAmount(t)),
      t.currency,
      num(Number(t.ars_rate)),
      // El equivalente en pesos es el neto para gastos (lo que te costó a vos)
      // y el total para ingresos.
      num(esGasto ? netArs(t) : toArs(Number(t.amount), t.currency, t.ars_rate)),
      cuota,
      t.reimbursable_note ?? '',
    ]
      .map(csvCell)
      .join(';')
  })

  return [header.join(';'), ...lines].join('\r\n')
}

/** Dispara la descarga de un archivo generado en el navegador. */
export function downloadFile(
  filename: string,
  content: string,
  mime = 'text/plain;charset=utf-8',
) {
  // El BOM hace que Excel reconozca el UTF-8 y no rompa los acentos.
  const bom = mime.startsWith('text/csv') ? '﻿' : ''
  const blob = new Blob([bom + content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadCsv(filename: string, csv: string) {
  downloadFile(filename, csv, 'text/csv;charset=utf-8')
}

export function downloadJson(filename: string, data: unknown) {
  downloadFile(
    filename,
    JSON.stringify(data, null, 2),
    'application/json;charset=utf-8',
  )
}
