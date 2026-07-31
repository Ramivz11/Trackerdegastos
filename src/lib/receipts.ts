import { supabase } from './supabase'
import type { Currency } from '../types'

/**
 * Fotos de tickets: se comprimen en el celular, se guardan en el bucket
 * `receipts` de Storage y se mandan a la Edge Function `scan-receipt`, que las
 * lee con Claude y devuelve monto, comercio y fecha.
 */

const BUCKET = 'receipts'
const MAX_SIDE = 1600
const QUALITY = 0.82

/** true si la lectura automática está habilitada en el entorno. */
export function receiptScanEnabled(): boolean {
  return import.meta.env.VITE_RECEIPT_SCAN === 'true'
}

export interface ReceiptScan {
  encontrado: boolean
  monto_total: number
  moneda: Currency
  comercio: string
  fecha: string
  categoria_sugerida: string
  cuotas: number
}

/**
 * Reduce la foto antes de subirla: las cámaras de celular sacan imágenes de
 * varios MB y con el lado largo en 1600px alcanza de sobra para leer un ticket.
 */
export function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)

      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('No se pudo procesar la imagen'))
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen')),
        'image/jpeg',
        QUALITY,
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('El archivo no es una imagen válida'))
    }
    img.src = url
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Sacamos el prefijo "data:image/jpeg;base64,".
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'))
    reader.readAsDataURL(blob)
  })
}

/** Sube la foto y devuelve su ruta dentro del bucket. */
export async function uploadReceipt(blob: Blob, userId: string): Promise<string> {
  const path = `${userId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  return path
}

/** URL temporal (1 hora) para mostrar un ticket ya guardado. */
export async function receiptUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600)
  if (error) return null
  return data.signedUrl
}

export async function deleteReceipt(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path])
}

/** Manda la foto a Claude y devuelve los datos leídos. */
export async function scanReceipt(blob: Blob): Promise<ReceiptScan> {
  const image_base64 = await blobToBase64(blob)
  const { data, error } = await supabase.functions.invoke('scan-receipt', {
    body: { image_base64, media_type: 'image/jpeg' },
  })
  if (error) throw new Error(`No se pudo leer el ticket: ${error.message}`)
  if ((data as { error?: string })?.error) {
    throw new Error((data as { error: string }).error)
  }
  return data as ReceiptScan
}

/**
 * Flujo completo desde el `<input type="file">`: comprime, sube y lee.
 * La lectura puede fallar sin que eso invalide la foto, así que el scan es
 * opcional y el path siempre vuelve.
 */
export async function processReceipt(
  file: File,
  userId: string,
): Promise<{ path: string; scan: ReceiptScan | null; scanError: string | null }> {
  const blob = await compressImage(file)
  const path = await uploadReceipt(blob, userId)

  if (!receiptScanEnabled()) {
    return { path, scan: null, scanError: null }
  }

  try {
    return { path, scan: await scanReceipt(blob), scanError: null }
  } catch (e) {
    return { path, scan: null, scanError: (e as Error).message }
  }
}
