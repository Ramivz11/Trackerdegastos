/**
 * scan-receipt — lee la foto de un ticket y devuelve monto, comercio y fecha.
 *
 * La app manda la imagen en base64 y esta función se la pasa a Claude, que
 * responde con un JSON validado contra el esquema de abajo. La API key vive
 * como secreto de la función, así que nunca sale al navegador.
 *
 * Desplegar:
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   supabase functions deploy scan-receipt
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.68.0'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type MediaType = (typeof MEDIA_TYPES)[number]

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    encontrado: {
      type: 'boolean',
      description: 'true si la imagen es un ticket o comprobante legible',
    },
    monto_total: {
      type: 'number',
      description: 'Importe total pagado. 0 si no se puede leer.',
    },
    moneda: {
      type: 'string',
      enum: ['ARS', 'USD', 'EUR', 'BRL', 'CLP', 'COP', 'MXN', 'UYU'],
      description: 'Moneda del ticket. Si no está clara, ARS.',
    },
    comercio: {
      type: 'string',
      description: 'Nombre del comercio, o cadena vacía si no se lee.',
    },
    fecha: {
      type: 'string',
      description:
        'Fecha del ticket en formato YYYY-MM-DD, o cadena vacía si no aparece.',
    },
    categoria_sugerida: {
      type: 'string',
      enum: [
        'Comida',
        'Supermercado',
        'Transporte',
        'Servicios',
        'Salud',
        'Ocio',
        'Hogar',
        'Otros',
      ],
      description: 'Categoría de gasto que mejor describe la compra.',
    },
    cuotas: {
      type: 'integer',
      description: 'Cantidad de cuotas si el ticket lo indica; 1 si no.',
    },
  },
  required: [
    'encontrado',
    'monto_total',
    'moneda',
    'comercio',
    'fecha',
    'categoria_sugerida',
    'cuotas',
  ],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `Extraés datos de tickets y comprobantes de compra argentinos.

Reglas:
- El monto total es el importe final pagado, no el subtotal ni el IVA.
- Los montos argentinos usan punto para miles y coma para decimales: "1.234,56" son mil doscientos treinta y cuatro con cincuenta y seis.
- Si la foto está borrosa, cortada o no es un ticket, devolvé encontrado=false y el resto en sus valores vacíos.
- No inventes datos que no estén en la imagen.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'Falta configurar ANTHROPIC_API_KEY' }, 500)
  }

  let payload: { image_base64?: string; media_type?: string }
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Cuerpo inválido' }, 400)
  }

  const { image_base64: image, media_type: mediaType } = payload
  if (!image) {
    return jsonResponse({ error: 'Falta image_base64' }, 400)
  }
  if (!MEDIA_TYPES.includes(mediaType as MediaType)) {
    return jsonResponse(
      { error: `media_type debe ser uno de: ${MEDIA_TYPES.join(', ')}` },
      400,
    )
  }

  const client = new Anthropic({ apiKey })

  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      // La extracción es simple: poco esfuerzo alcanza y sale más barato.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: RECEIPT_SCHEMA },
      },
      // Si un clasificador rechaza el pedido, la API reintenta sola en otro modelo.
      betas: ['server-side-fallback-2026-07-01'],
      // @ts-ignore: `fallbacks` es beta y puede no estar en los tipos del SDK.
      fallbacks: 'default',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as MediaType,
                data: image,
              },
            },
            {
              type: 'text',
              text: 'Extraé los datos de este ticket.',
            },
          ],
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      return jsonResponse(
        { error: 'La imagen no se pudo procesar. Cargá el gasto a mano.' },
        422,
      )
    }

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return jsonResponse({ error: 'Respuesta vacía del modelo' }, 502)
    }

    return jsonResponse(JSON.parse(textBlock.text))
  } catch (e) {
    console.error('scan-receipt falló:', e)
    return jsonResponse({ error: (e as Error).message }, 502)
  }
})
