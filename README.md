# 💸 Tracker de Gastos

App personal para llevar tus gastos desde el celular: registrar gastos rápido,
recordar pagos, organizar por categorías con presupuesto y ver reportes.
Es una **PWA** (se instala como app) con **Supabase** (base de datos real, gratis)
y se despliega en **Netlify**.

## Funciones

- 🔢 **Gasto rápido**: botón flotante que muestra tus categorías más usadas; elegís
  una y solo ingresás el monto (dos toques).
- 🏷️ **Categorías** con color, ícono y **presupuesto mensual**.
- 🔔 **Pagos y recurrentes**: recordatorios de vencimiento y gastos fijos que se
  cargan solos al vencer.
- 📊 **Reportes**: torta por categoría, gasto mes a mes y presupuesto vs real.
- ⚠️ **Alertas** cuando te acercás o superás el presupuesto de una categoría.
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

## Notas

- Tus datos viven en Supabase y están protegidos por RLS: solo tu usuario los ve.
- **Notificaciones de pago**: aparecen dentro de la app (panel "Próximos pagos" y
  alertas). El push en segundo plano (cuando la app está cerrada) no está incluido
  en esta versión; se puede agregar más adelante.
- Los íconos de la PWA (`public/pwa-*.png`) son un placeholder con un "$"; podés
  reemplazarlos por los tuyos manteniendo los nombres y tamaños.

## Stack

React + TypeScript + Vite · Tailwind CSS · React Router · Recharts ·
Supabase (Postgres + Auth) · vite-plugin-pwa · Netlify
