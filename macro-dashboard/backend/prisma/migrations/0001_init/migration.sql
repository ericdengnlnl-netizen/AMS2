CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "SeriesSource" AS ENUM ('FRED', 'NBS');
CREATE TYPE "SeriesFrequency" AS ENUM ('M', 'Q');
CREATE TYPE "TransformType" AS ENUM ('YOY_LAG', 'INDEX_MINUS_100');
CREATE TYPE "TriggerType" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

CREATE TABLE "macro_series" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "series_key" TEXT NOT NULL UNIQUE,
  "display_name" TEXT NOT NULL,
  "source" "SeriesSource" NOT NULL,
  "frequency" "SeriesFrequency" NOT NULL,
  "unit" TEXT NOT NULL,
  "transform_type" "TransformType" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "meta" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "macro_observations" (
  "id" BIGSERIAL PRIMARY KEY,
  "series_id" UUID NOT NULL REFERENCES "macro_series"("id") ON DELETE CASCADE,
  "obs_date" DATE NOT NULL,
  "raw_value" NUMERIC(20, 6) NOT NULL,
  "value" NUMERIC(20, 6) NOT NULL,
  "source_code" TEXT NOT NULL,
  "has_data" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE("series_id", "obs_date")
);

CREATE INDEX "idx_macro_observations_obs_date" ON "macro_observations"("obs_date");

CREATE TABLE "sync_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "trigger_type" "TriggerType" NOT NULL,
  "status" "RunStatus" NOT NULL,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "finished_at" TIMESTAMPTZ,
  "stats" JSONB,
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "idx_sync_runs_started_at" ON "sync_runs"("started_at" DESC);

CREATE TABLE "sync_run_logs" (
  "id" BIGSERIAL PRIMARY KEY,
  "run_id" UUID NOT NULL REFERENCES "sync_runs"("id") ON DELETE CASCADE,
  "series_key" TEXT,
  "stage" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "idx_sync_run_logs_run_id" ON "sync_run_logs"("run_id");
