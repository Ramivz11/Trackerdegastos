# 💸 Tracker de Gastos

App personal para llevar tus gastos desde el celular: registrar gastos rápido,
recordar pagos, organizar por categorías con presupuesto y ver reportes.
Es una **PWA** (se instala como app) con **Supabase** (base de datos real, gratis)
y se despliega en **Netlify**.

## Funciones

- 🔢 **Gasto rápido**: botón flotante que muestra tus categorías más usadas; elegís
  una y solo ingresás el monto (dos toques).
- 🏷️ **Categorías** con color, ícono y **presupuesto mensual**.
- 🎯 **Presupuesto con arrastre**: techo de gasto global del mes y, por categoría,
  lo que sobra se suma al límite del mes siguiente.
- 🔔 **Pagos y recurrentes**: recordatorios de vencimiento y gastos fijos que se
  cargan solos al vencer (desde el servidor, aunque no abras la app). Cada uno
  tiene su moneda: una suscripción en dólares en la tarjeta en pesos entra al
  subtotal en US$ del resumen.
- 📲 **Notificaciones push** de vencimientos con la app cerrada.
- 📷 **Foto del ticket**: sacás la foto y se precargan monto, comercio y fecha.
- 🪄 **Reglas de auto-categorización**: “si la nota dice Uber → Transporte”.
- 💳 **Tarjetas de crédito**: resúmenes por ciclo de cierre, compras en cuotas y
  subtotales separados en pesos y en dólares. El pago del resumen se puede
  repartir entre varias cuentas y monedas (una parte en $, otra en US$) y queda
  como movimiento en el historial sin contarse dos veces como gasto.
- 💵 **Cotizaciones automáticas** (dolarapi.com: blue, oficial, MEP, cripto…) y
  moneda de visualización que convierte los totales de verdad.
- 💱 **Compra de divisas**: registra cuánto gastaste, cuánto se te acreditó y a
  qué tipo de cambio, y deja los dólares en una cuenta lista para usar.
- 📈 **Patrimonio en el tiempo**: la curva de tu patrimonio neto mes a mes.
- 🔍 **Búsqueda global** por rango de fechas, no solo dentro de un mes.
- 🤝 **Gastos compartidos**: pagás vos la cuenta de todos y anotás cuánto te
  deben. Los reportes cuentan solo tu parte, el saldo de la cuenta refleja lo
  que pagaste de verdad, y en “Te deben” seguís los cobros (totales o parciales).
- 👥 **Modo hogar**: compartís el tracker con otra persona, con marca de quién
  cargó cada gasto y balance de quién le debe a quién.
- ⬇️ **Exportar** a CSV (Excel) y backup completo en JSON.
- 📊 **Reportes**: torta por categoría, gasto mes a mes y presupuesto vs real.
- ⚠️ **Alertas** de presupuesto y aviso de posible gasto duplicado.
- ⚙️ **Ajustes sincronizados** entre todos tus dispositivos.
- 📱 Instalable en el celular y diseño mobile-first.

---

## Puesta en marcha

### 1. Crear el proyecto en Supabase

1. Entrá a [supabase.com](https://supabase.com) y creá una cuenta (gratis).
2. **New project** → elegí nombre y una contraseña para la base (guardala).
3. Cuando termine de crearse, andá a **SQL Editor** → **New query**.
4. Copiá y pegá TODO el contenido de [`supabase/schema.sql`](supabase/schema.sql)
   y tocá **Run**. Esto crea las tablas, la seguridad (RLS) y las categorías iniciales.

### 2. Obtener las credenciales

En Supabase: **Project Settings → API**. Copiá:

- **Project URL** → va en `VITE_SUPABASE_URL`
- **anon public** key → va en `VITE_SUPABASE_ANON_KEY`

### 3. Correr localmente

```bash
npm install
cp .env.example .env   # en Windows: copy .env.example .env
# editá .env y pegá tu URL y tu anon key
npm run dev
```

Abrí la URL que muestra la consola (normalmente http://localhost:5173).
Tocá **Registrate**, creá tu cuenta con tu email y contraseña, e ingresá.

> Tip: si querés entrar sin confirmar el email, en Supabase andá a
> **Authentication → Providers → Email** y desactivá "Confirm email".

### 4. Desplegar en Netlify

1. Subí este proyecto a un repo de GitHub.
2. En [netlify.com](https://netlify.com): **Add new site → Import an existing project**
   y elegí el repo. El build ya está configurado en `netlify.toml`.
3. En **Site settings → Environment variables**, agregá:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. **Deploy**. Listo: vas a tener una URL pública.

> Alternativa sin GitHub: `npm i -g netlify-cli`, luego `netlify deploy --build --prod`.

### 5. Instalar en el celular

Abrí la URL de Netlify en el navegador del celular y usá
**"Agregar a pantalla de inicio"** (Chrome/Android) o **Compartir → Agregar a inicio**
(Safari/iOS). Queda como una app.

---

## Extras opcionales

La app anda completa sin nada de esto. Cada bloque activa una función más.

### A. Notificaciones push (avisos con la app cerrada)

1. Generá el par de claves VAPID:

   ```bash
   npx web-push generate-vapid-keys
   ```

2. La **pública** va como variable de entorno del sitio (`.env` y Netlify):

   ```
   VITE_VAPID_PUBLIC_KEY=BA...
   ```

3. La **privada** va como secreto de Supabase y desplegás la función:

   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=BA... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:vos@ejemplo.com
   supabase functions deploy send-due-notifications --no-verify-jwt
   ```

4. Programá el envío diario. En **SQL Editor**, reemplazando tu URL de proyecto y
   tu `service_role` key (Project Settings → API):

   ```sql
   create extension if not exists pg_net;
   select cron.schedule(
     'due-notifications',
     '0 12 * * *',
     $$
     select net.http_post(
       url     := 'https://TU-PROYECTO.supabase.co/functions/v1/send-due-notifications',
       headers := '{"Content-Type":"application/json","Authorization":"Bearer TU_SERVICE_ROLE_KEY"}'::jsonb,
       body    := '{}'::jsonb
     );
     $$
   );
   ```

5. En la app: **Ajustes → Avisos de vencimiento**. En iPhone hay que instalar la
   app en la pantalla de inicio antes de que el push funcione.

### B. Lectura automática de tickets

Usa la API de Claude desde una Edge Function, así la key nunca llega al navegador.

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy scan-receipt
```

Y activá el botón en el entorno del sitio:

```
VITE_RECEIPT_SCAN=true
```

Sin esto, el botón de foto sigue existiendo pero solo adjunta la imagen al gasto
(la foto se guarda igual en Storage, en el bucket privado `receipts`).

### C. Auto-posteo de recurrentes en el servidor

Ya queda listo al correr `schema.sql`: crea la tarea `post-due-recurring` en
`pg_cron`, que cada noche genera los gastos fijos vencidos. La app también los
pone al día al abrirse, y un índice único evita que se dupliquen.

Si tu proyecto no tiene `pg_cron`, el script no falla: simplemente queda todo a
cargo de la app.

---

## Notas

- Tus datos viven en Supabase y están protegidos por RLS: solo vos (y, si armás
  un hogar, los miembros de tu hogar) los ven.
- **Modo hogar**: al invitar a alguien por email, esa persona tiene que tener
  cuenta en la app con ese mismo email. La invitación se acepta sola la próxima
  vez que inicie sesión.
- **Monedas**: ARS es la moneda base. La opción “Mostrar los totales en” convierte
  usando las cotizaciones guardadas; cada movimiento conserva la cotización del
  día en que lo cargaste. Los pesos mexicano y colombiano no están en dolarapi y
  quedan siempre en carga manual.
- Los íconos de la PWA (`public/pwa-*.png`) son un placeholder con un "$"; podés
  reemplazarlos por los tuyos manteniendo los nombres y tamaños.
- Si ya tenías la app andando, volvé a correr **todo** `supabase/schema.sql`: es
  idempotente y agrega lo nuevo sin tocar tus datos.

## Stack

React + TypeScript + Vite · Tailwind CSS · React Router · Recharts ·
Supabase (Postgres + Auth + Storage + Edge Functions + pg_cron) ·
Web Push (VAPID) · API de Claude (lectura de tickets) ·
vite-plugin-pwa · Netlify

