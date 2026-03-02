# Macro Dashboard V1

Independent macro data dashboard project with:
- Backend: Node.js + TypeScript + Express + Prisma + PostgreSQL
- Frontend: React + ECharts
- Data sources: FRED + National Bureau of Statistics (NBS easyquery)

## Structure

- `backend/`: API, adapters, sync scheduler, Prisma schema
- `frontend/`: React dashboard
- `docker-compose.yml`: Local PostgreSQL

## 1) Start PostgreSQL

```bash
cd /Users/ericdeng/Desktop/project/macro-dashboard
docker compose up -d
```

## 2) Backend setup

```bash
cd /Users/ericdeng/Desktop/project/macro-dashboard/backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

Backend default URL: `http://localhost:4000`

### Backend environment variables

- `PORT` (default `4000`)
- `DATABASE_URL`
- `FRED_API_KEY`
- `SYNC_CRON` (default `5 9 * * *`)
- `SYNC_TZ` (default `Asia/Shanghai`)
- `CORS_ORIGIN` (default `http://localhost:5173`)

## 3) Frontend setup

```bash
cd /Users/ericdeng/Desktop/project/macro-dashboard/frontend
npm install
npm run dev
```

Frontend default URL: `http://localhost:5173`

If backend is not on `http://localhost:4000`, set:

```bash
VITE_API_BASE=http://localhost:4000/api/v1
```

## API

- `GET /api/v1/health`
- `GET /api/v1/series`
- `GET /api/v1/series/:seriesKey?start=YYYY-MM-DD&end=YYYY-MM-DD&limit=`
- `GET /api/v1/dashboard?view=macro-core`
- `POST /api/v1/sync`
- `GET /api/v1/sync/runs?limit=`

## Default series (config-driven)

Defined in `backend/src/config/series.registry.ts`:
- `us_gdp_yoy` (`GDP`, lag 4)
- `us_cpi_yoy` (`CPIAUCSL`, lag 12)
- `us_ppi_yoy` (`PPIACO`, lag 12)
- `cn_gdp_yoy` (`A010101`, LAST18, lag 4)
- `cn_cpi_yoy` (`A01010J01 -> A01010G01 -> A01010101`, LAST36, index-100)
- `cn_ppi_yoy` (`A01080101`, LAST36, index-100)

## Add a new series

1. Add entry in `backend/src/config/series.registry.ts`
2. Add chart mapping in `frontend/src/config/dashboard.config.ts` if needed
3. Run sync (`POST /api/v1/sync`) and refresh UI

No frontend rendering logic changes are needed for new configured series.

## Tests

Backend:
```bash
cd /Users/ericdeng/Desktop/project/macro-dashboard/backend
npm test
```

Frontend:
```bash
cd /Users/ericdeng/Desktop/project/macro-dashboard/frontend
npm test
```
