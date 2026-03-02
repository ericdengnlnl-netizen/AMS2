create extension if not exists pgcrypto;

create table if not exists portfolio_meta (
  id uuid primary key default gen_random_uuid(),
  portfolio_id text not null default 'default',
  month text,
  inception_date date not null,
  inception_value numeric(18, 4) not null,
  total_amount numeric(18, 4) not null default 0,
  timing_coefficient numeric(10, 4) not null default 1,
  beta_amount numeric(18, 4),
  actual_invest_amount numeric(18, 4),
  cash_available numeric(18, 4),
  friction_cost numeric(18, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table portfolio_meta add column if not exists portfolio_id text not null default 'default';
alter table portfolio_meta add column if not exists inception_date date;
alter table portfolio_meta add column if not exists inception_value numeric(18, 4);
alter table portfolio_meta add column if not exists month text;

update portfolio_meta
set
  portfolio_id = coalesce(portfolio_id, 'default'),
  inception_date = coalesce(inception_date, to_date(coalesce(month, to_char(current_date, 'YYYY-MM')) || '-01', 'YYYY-MM-DD'), current_date),
  inception_value = coalesce(inception_value, total_amount, 0),
  total_amount = coalesce(total_amount, inception_value, 0),
  timing_coefficient = coalesce(timing_coefficient, 1)
where
  inception_date is null
  or inception_value is null
  or portfolio_id is null
  or total_amount is null
  or timing_coefficient is null;

alter table portfolio_meta alter column inception_date set not null;
alter table portfolio_meta alter column inception_value set not null;
alter table portfolio_meta alter column total_amount set not null;
alter table portfolio_meta alter column timing_coefficient set not null;

with ranked as (
  select
    id,
    row_number() over (
      partition by portfolio_id
      order by coalesce(month, '') desc, created_at desc
    ) as rn
  from portfolio_meta
)
delete from portfolio_meta p
using ranked r
where p.id = r.id
  and r.rn > 1;

create unique index if not exists idx_portfolio_meta_portfolio_id on portfolio_meta(portfolio_id);
create index if not exists idx_portfolio_meta_month on portfolio_meta(month);

create table if not exists allocation_signals (
  id bigserial primary key,
  month text not null,
  step smallint not null default 2,
  major_asset text,
  sub_asset text,
  instrument_name text,
  ts_code text,
  target_ratio numeric(10, 6),
  created_at timestamptz not null default now()
);

create index if not exists idx_allocation_signals_month on allocation_signals(month);

create table if not exists positions (
  id bigserial primary key,
  portfolio_id text not null default 'default',
  month text not null,
  valuation_date date,
  major_asset text,
  sub_asset text,
  instrument_name text not null,
  ts_code text not null,
  target_ratio numeric(10, 6),
  cost_price numeric(18, 6),
  quantity numeric(18, 4),
  cost_amount numeric(18, 4),
  created_at timestamptz not null default now()
);

alter table positions add column if not exists portfolio_id text not null default 'default';
alter table positions add column if not exists valuation_date date;

update positions
set
  portfolio_id = coalesce(portfolio_id, 'default'),
  valuation_date = coalesce(valuation_date, to_date(coalesce(month, to_char(current_date, 'YYYY-MM')) || '-01', 'YYYY-MM-DD'))
where portfolio_id is null or valuation_date is null;

create index if not exists idx_positions_month on positions(month);
create index if not exists idx_positions_code on positions(ts_code);
create index if not exists idx_positions_portfolio on positions(portfolio_id);
create index if not exists idx_positions_portfolio_code on positions(portfolio_id, ts_code);

create table if not exists asset_prices (
  id bigserial primary key,
  trade_date date not null,
  ts_code text not null,
  close_price numeric(18, 6) not null,
  pre_close numeric(18, 6),
  pct_chg numeric(10, 6),
  source text not null default 'tushare',
  created_at timestamptz not null default now(),
  unique(ts_code, trade_date)
);

create index if not exists idx_asset_prices_trade_date on asset_prices(trade_date);
create index if not exists idx_asset_prices_code_date on asset_prices(ts_code, trade_date);

create table if not exists rebalance_records (
  id bigserial primary key,
  portfolio_id text not null default 'default',
  month text not null,
  ts_code text not null,
  instrument_name text not null,
  action text not null check (action in ('BUY', 'SELL', 'ADJUST')),
  from_ratio numeric(10, 6),
  to_ratio numeric(10, 6),
  ratio_change numeric(10, 6),
  record_type text not null default 'transaction' check (record_type in ('transaction', 'timing')),
  effective_date date,
  quantity numeric(18, 4),
  trade_price numeric(18, 6),
  coefficient numeric(10, 6),
  source text not null default 'manual',
  external_id text,
  note text,
  created_at timestamptz not null default now()
);

alter table rebalance_records add column if not exists portfolio_id text not null default 'default';
alter table rebalance_records add column if not exists record_type text not null default 'transaction';
alter table rebalance_records add column if not exists effective_date date;
alter table rebalance_records add column if not exists quantity numeric(18, 4);
alter table rebalance_records add column if not exists trade_price numeric(18, 6);
alter table rebalance_records add column if not exists coefficient numeric(10, 6);
alter table rebalance_records add column if not exists source text not null default 'manual';
alter table rebalance_records add column if not exists external_id text;

update rebalance_records
set
  portfolio_id = coalesce(portfolio_id, 'default'),
  record_type = case when ts_code = '__TIMING__' then 'timing' else coalesce(record_type, 'transaction') end,
  effective_date = coalesce(effective_date, (created_at at time zone 'utc')::date),
  source = coalesce(source, 'manual')
where
  portfolio_id is null
  or record_type is null
  or effective_date is null
  or source is null;

alter table rebalance_records alter column effective_date set not null;

create index if not exists idx_rebalance_records_month on rebalance_records(month);
create index if not exists idx_rebalance_records_code on rebalance_records(ts_code);
create index if not exists idx_rebalance_records_portfolio on rebalance_records(portfolio_id);
create index if not exists idx_rebalance_records_effective_date on rebalance_records(effective_date);
create unique index if not exists idx_rebalance_records_portfolio_external on rebalance_records(portfolio_id, external_id);

create table if not exists portfolio_daily_snapshots (
  id bigserial primary key,
  portfolio_id text not null default 'default',
  trade_date date not null,
  total_value numeric(18, 6) not null,
  nav numeric(20, 10) not null,
  daily_return numeric(20, 10) not null,
  cumulative_return numeric(20, 10) not null,
  annualized_return numeric(20, 10) not null,
  volatility numeric(20, 10) not null,
  sharpe_ratio numeric(20, 10) not null,
  max_drawdown numeric(20, 10) not null,
  cash_value numeric(18, 6) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(portfolio_id, trade_date)
);

create index if not exists idx_portfolio_daily_snapshots_trade_date on portfolio_daily_snapshots(trade_date);
create index if not exists idx_portfolio_daily_snapshots_portfolio on portfolio_daily_snapshots(portfolio_id);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists portfolio_meta_set_updated_at on portfolio_meta;
create trigger portfolio_meta_set_updated_at
before update on portfolio_meta
for each row execute function set_updated_at();

drop trigger if exists portfolio_daily_snapshots_set_updated_at on portfolio_daily_snapshots;
create trigger portfolio_daily_snapshots_set_updated_at
before update on portfolio_daily_snapshots
for each row execute function set_updated_at();
