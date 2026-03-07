CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS aicc;

SET search_path TO aicc, public;

CREATE TYPE product_source_t AS ENUM (
  'erp',
  'lanstar_file',
  'vendor_sheet',
  'vendor_excel'
);

CREATE TYPE alias_type_t AS ENUM (
  'product_name',
  'model',
  'spec',
  'manual_alias',
  'llm_generated'
);

CREATE TYPE tech_source_t AS ENUM (
  'merged_json',
  'raw_qna',
  'talk_data',
  'download_board'
);

CREATE TYPE call_intent_t AS ENUM (
  'order',
  'inventory',
  'quote',
  'tech',
  'other'
);

CREATE TYPE handoff_target_t AS ENUM (
  'sales',
  'tech',
  'none'
);

CREATE TYPE call_status_t AS ENUM (
  'ringing',
  'live',
  'handoff',
  'completed',
  'failed'
);

CREATE TYPE call_event_t AS ENUM (
  'asr',
  'ai_reply',
  'erp_call',
  'human_note',
  'handoff',
  'sms',
  'email',
  'system'
);

CREATE TYPE speaker_t AS ENUM (
  'customer',
  'ai',
  'manager',
  'agent',
  'system'
);

CREATE TYPE order_kind_t AS ENUM (
  'sale',
  'quote'
);

CREATE TYPE draft_status_t AS ENUM (
  'draft',
  'confirmed',
  'erp_saved',
  'human_checked',
  'failed'
);

CREATE TYPE delivery_method_t AS ENUM (
  'delivery',
  'pickup',
  'courier_rogen',
  'courier_kd_parcel',
  'courier_kd_freight',
  'quick'
);

CREATE TYPE inventory_status_t AS ENUM (
  'available',
  'short',
  'check_needed'
);

CREATE TYPE price_policy_t AS ENUM (
  'out_price1',
  'out_price2',
  'guide_price',
  'manual'
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE master_customer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_name_normalized TEXT,
  ceo_name TEXT,
  phone TEXT,
  phone_digits TEXT,
  mobile TEXT,
  mobile_digits TEXT,
  address1 TEXT,
  is_yongsan_area BOOLEAN NOT NULL DEFAULT FALSE,
  deposit_required BOOLEAN NOT NULL DEFAULT FALSE,
  deposit_note TEXT,
  credit_limit NUMERIC(18, 2),
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE master_product (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_source product_source_t NOT NULL,
  brand TEXT NOT NULL,
  item_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  model_name TEXT,
  spec_text TEXT,
  dealer_price NUMERIC(18, 2),
  online_price NUMERIC(18, 2),
  guide_price NUMERIC(18, 2),
  vat_included BOOLEAN NOT NULL DEFAULT TRUE,
  shipping_policy TEXT,
  is_lanstar BOOLEAN NOT NULL DEFAULT FALSE,
  search_text TEXT NOT NULL DEFAULT '',
  raw_source_name TEXT,
  raw_sheet_name TEXT NOT NULL DEFAULT '',
  raw_row_no INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_source, brand, item_code, raw_sheet_name)
);

CREATE TABLE product_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES master_product(id) ON DELETE CASCADE,
  alias_text TEXT NOT NULL,
  alias_type alias_type_t NOT NULL,
  confidence NUMERIC(5, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, alias_text)
);

CREATE TABLE vendor_sheet_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL,
  source_name TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  header_row INTEGER NOT NULL,
  first_data_row INTEGER NOT NULL DEFAULT 2,
  item_code_col TEXT,
  model_col TEXT,
  product_name_col TEXT,
  guide_price_col TEXT,
  shipping_col TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand, source_name, sheet_name)
);

CREATE TABLE tech_model (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL DEFAULT 'LANstar',
  model_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT,
  qna_count INTEGER NOT NULL DEFAULT 0,
  search_text TEXT NOT NULL DEFAULT '',
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand, model_name)
);

CREATE TABLE tech_qa_chunk (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tech_model_id UUID REFERENCES tech_model(id) ON DELETE SET NULL,
  source_type tech_source_t NOT NULL,
  raw_product_name TEXT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  search_text TEXT NOT NULL DEFAULT '',
  resolved BOOLEAN,
  answer_quality NUMERIC(5, 4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE call_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_call_id TEXT UNIQUE,
  customer_id UUID REFERENCES master_customer(id) ON DELETE SET NULL,
  caller_number TEXT NOT NULL,
  caller_number_digits TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  intent_type call_intent_t,
  status call_status_t NOT NULL DEFAULT 'ringing',
  handoff_required BOOLEAN NOT NULL DEFAULT FALSE,
  handoff_target handoff_target_t NOT NULL DEFAULT 'none',
  handoff_reason TEXT,
  transcript_full TEXT,
  transcript_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  retention_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '3 months'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE call_event (
  id BIGSERIAL PRIMARY KEY,
  call_session_id UUID NOT NULL REFERENCES call_session(id) ON DELETE CASCADE,
  event_type call_event_t NOT NULL,
  speaker speaker_t NOT NULL,
  content TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_draft (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_session_id UUID REFERENCES call_session(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES master_customer(id) ON DELETE SET NULL,
  draft_kind order_kind_t NOT NULL,
  warehouse_code TEXT NOT NULL CHECK (warehouse_code IN ('10', '30')),
  shipping_method delivery_method_t,
  remark_text TEXT,
  prepayment_required BOOLEAN NOT NULL DEFAULT FALSE,
  prepayment_notice_sent BOOLEAN NOT NULL DEFAULT FALSE,
  requires_human_review BOOLEAN NOT NULL DEFAULT FALSE,
  human_review_reason TEXT,
  total_supply_amount NUMERIC(18, 2),
  total_vat_amount NUMERIC(18, 2),
  total_amount NUMERIC(18, 2),
  status draft_status_t NOT NULL DEFAULT 'draft',
  erp_slip_no TEXT,
  erp_saved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_draft_line (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_draft_id UUID NOT NULL REFERENCES order_draft(id) ON DELETE CASCADE,
  product_id UUID REFERENCES master_product(id) ON DELETE SET NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT,
  matched_model_name TEXT,
  qty NUMERIC(18, 3) NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(18, 2),
  supply_amount NUMERIC(18, 2),
  vat_amount NUMERIC(18, 2),
  total_amount NUMERIC(18, 2),
  price_policy price_policy_t NOT NULL DEFAULT 'manual',
  inventory_status inventory_status_t NOT NULL DEFAULT 'check_needed',
  match_confidence NUMERIC(5, 4),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notification_delivery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_session_id UUID REFERENCES call_session(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES master_customer(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'alimtalk')),
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  provider_message_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_master_customer_phone_digits
  ON master_customer (phone_digits);

CREATE INDEX ix_master_customer_mobile_digits
  ON master_customer (mobile_digits);

CREATE INDEX ix_master_customer_yongsan
  ON master_customer (is_yongsan_area);

CREATE INDEX ix_master_customer_name_trgm
  ON master_customer
  USING gin (customer_name gin_trgm_ops);

CREATE INDEX ix_master_product_name_trgm
  ON master_product
  USING gin (product_name gin_trgm_ops);

CREATE INDEX ix_master_product_model_trgm
  ON master_product
  USING gin ((COALESCE(model_name, '')) gin_trgm_ops);

CREATE INDEX ix_master_product_search_trgm
  ON master_product
  USING gin (search_text gin_trgm_ops);

CREATE INDEX ix_product_alias_text_trgm
  ON product_alias
  USING gin (alias_text gin_trgm_ops);

CREATE INDEX ix_vendor_sheet_catalog_brand_active
  ON vendor_sheet_catalog (brand, active);

CREATE INDEX ix_tech_model_search_trgm
  ON tech_model
  USING gin (search_text gin_trgm_ops);

CREATE INDEX ix_tech_model_model_trgm
  ON tech_model
  USING gin (model_name gin_trgm_ops);

CREATE INDEX ix_tech_qa_chunk_search_trgm
  ON tech_qa_chunk
  USING gin (search_text gin_trgm_ops);

CREATE INDEX ix_call_session_customer_started
  ON call_session (customer_id, started_at DESC);

CREATE INDEX ix_call_session_status_started
  ON call_session (status, started_at DESC);

CREATE INDEX ix_call_session_retention_until
  ON call_session (retention_until);

CREATE INDEX ix_call_event_session_created
  ON call_event (call_session_id, created_at);

CREATE INDEX ix_order_draft_customer_created
  ON order_draft (customer_id, created_at DESC);

CREATE INDEX ix_order_draft_status_created
  ON order_draft (status, created_at DESC);

CREATE INDEX ix_order_draft_line_draft
  ON order_draft_line (order_draft_id);

CREATE INDEX ix_notification_delivery_status_created
  ON notification_delivery (status, created_at DESC);

CREATE TRIGGER trg_master_customer_updated_at
BEFORE UPDATE ON master_customer
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_master_product_updated_at
BEFORE UPDATE ON master_product
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_vendor_sheet_catalog_updated_at
BEFORE UPDATE ON vendor_sheet_catalog
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tech_model_updated_at
BEFORE UPDATE ON tech_model
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_call_session_updated_at
BEFORE UPDATE ON call_session
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_order_draft_updated_at
BEFORE UPDATE ON order_draft
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_order_draft_line_updated_at
BEFORE UPDATE ON order_draft_line
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_notification_delivery_updated_at
BEFORE UPDATE ON notification_delivery
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
