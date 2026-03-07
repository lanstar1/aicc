import 'dotenv/config';

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PUBLIC_BASE_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  ERP_BASE_URL: z.string().url().optional(),
  ERP_COM_CODE: z.string().optional(),
  ERP_USER_ID: z.string().optional(),
  ERP_API_CERT_KEY: z.string().optional(),
  ERP_LAN_TYPE: z.string().default('ko-KR'),
  ERP_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(480),
  ERP_EMP_CD: z.string().optional(),
  ERP_SITE: z.string().optional(),
  ERP_IO_TYPE: z.string().optional(),
  ERP_PJT_CD: z.string().optional(),
  REALTIME_WS_TOKEN: z.string().optional(),
  ADMIN_API_TOKEN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime'),
  OPENAI_REALTIME_VOICE: z.string().default('cedar'),
  OPENAI_REALTIME_TRANSCRIBE_MODEL: z.string().default('gpt-4o-transcribe'),
  OPENAI_SUMMARY_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_REALTIME_LANGUAGE: z.string().default('ko'),
  OPENAI_REALTIME_GREETING: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined)),
  OPENAI_REALTIME_INSTRUCTIONS: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined)),
  TWILIO_STREAM_TOKEN: z.string().optional(),
  SMS_PROVIDER: z.string().default('erp'),
  AUTO_ORDER_NOTIFICATION_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  AUTO_ORDER_NOTIFICATION_CHANNEL: z.enum(['email', 'sms', 'alimtalk']).default('sms'),
  NOTIFICATION_MOCK_MODE: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),
  EMAIL_FROM_NAME: z.string().default('LANstar'),
  EMAIL_FROM_ADDRESS: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  ERP_SMS_WEBHOOK_URL: z.string().url().optional(),
  ERP_SMS_WEBHOOK_TOKEN: z.string().optional(),
  ALIMTALK_WEBHOOK_URL: z.string().url().optional(),
  ALIMTALK_WEBHOOK_TOKEN: z.string().optional(),
  IMPORT_CUSTOMERS_XLSX: z.string().optional(),
  IMPORT_LANSTAR_PRODUCTS_XLSX: z.string().optional(),
  IMPORT_DOMESTIC_PRODUCTS_XLSX: z.string().optional(),
  IMPORT_MERGED_TECH_JSON: z.string().optional(),
  IMPORT_RAW_QNA_JSON: z.string().optional(),
  IMPORT_TALK_ORDER_JSON: z.string().optional(),
  IMPORT_NEXI_XLSX: z.string().optional(),
  IMPORT_IPTIME_URL: z.string().url().optional(),
  IMPORT_NEXT_URL: z.string().url().optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export const env: AppEnv = envSchema.parse(process.env);
