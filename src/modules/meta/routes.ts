import type { FastifyPluginAsync } from 'fastify';

import { env } from '../../config/env';

const metaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/sources', async () => {
    const result = await app.db.query(
      `
        select brand, source_name, sheet_name, header_row, first_data_row, guide_price_col, active
        from aicc.vendor_sheet_catalog
        order by brand asc, source_name asc, sheet_name asc
      `
    );

    return {
      items: result.rows
    };
  });

  app.get('/go-live', async () => {
    const [
      customersResult,
      productsResult,
      vendorCatalogsResult,
      techModelsResult,
      techChunksResult
    ] = await Promise.all([
      app.db.query<{ count: string }>('select count(*)::text as count from aicc.master_customer'),
      app.db.query<{ count: string }>('select count(*)::text as count from aicc.master_product'),
      app.db.query<{ count: string }>('select count(*)::text as count from aicc.vendor_sheet_catalog'),
      app.db.query<{ count: string }>('select count(*)::text as count from aicc.tech_model'),
      app.db.query<{ count: string }>('select count(*)::text as count from aicc.tech_qa_chunk')
    ]);

    const publicBaseUrl = env.PUBLIC_BASE_URL ?? 'https://lanstar-aicc-api.onrender.com';
    const dataCounts = {
      customers: Number(customersResult.rows[0]?.count ?? 0),
      products: Number(productsResult.rows[0]?.count ?? 0),
      vendorCatalogs: Number(vendorCatalogsResult.rows[0]?.count ?? 0),
      techModels: Number(techModelsResult.rows[0]?.count ?? 0),
      techChunks: Number(techChunksResult.rows[0]?.count ?? 0)
    };
    const readiness = {
      dataSeeded:
        dataCounts.customers > 0 &&
        dataCounts.products > 0 &&
        dataCounts.vendorCatalogs > 0 &&
        dataCounts.techModels > 0 &&
        dataCounts.techChunks > 0,
      ecountReady: Boolean(
        env.ERP_BASE_URL && env.ERP_COM_CODE && env.ERP_USER_ID && env.ERP_API_CERT_KEY
      ),
      openAiReady: Boolean(env.OPENAI_API_KEY),
      twilioVoiceReady: Boolean(env.PUBLIC_BASE_URL && env.TWILIO_AUTH_TOKEN),
      twilioMediaReady: Boolean(env.PUBLIC_BASE_URL && env.TWILIO_STREAM_TOKEN),
      adminReady: Boolean(env.ADMIN_API_TOKEN),
      realtimeMonitorReady: Boolean(env.REALTIME_WS_TOKEN),
      notificationsReady:
        env.NOTIFICATION_MOCK_MODE ||
        Boolean(env.ERP_SMS_WEBHOOK_URL || env.ALIMTALK_WEBHOOK_URL || env.SMTP_HOST)
    };

    return {
      service: {
        publicBaseUrl,
        adminConsoleUrl: `${publicBaseUrl}/admin-console`
      },
      twilio: {
        voiceWebhookUrl: `${publicBaseUrl}/api/v1/twilio/voice/inbound`,
        statusWebhookUrl: `${publicBaseUrl}/api/v1/twilio/voice/status`,
        mediaStreamPath: '/api/v1/twilio/media-stream/:callSessionId/:token?',
        authTokenConfigured: Boolean(env.TWILIO_AUTH_TOKEN),
        streamTokenConfigured: Boolean(env.TWILIO_STREAM_TOKEN)
      },
      dataCounts,
      readiness,
      nextSteps: buildNextSteps(readiness)
    };
  });
};

export default metaRoutes;

function buildNextSteps(readiness: {
  dataSeeded: boolean;
  ecountReady: boolean;
  openAiReady: boolean;
  twilioVoiceReady: boolean;
  twilioMediaReady: boolean;
  adminReady: boolean;
  realtimeMonitorReady: boolean;
  notificationsReady: boolean;
}) {
  const steps: string[] = [];

  if (!readiness.dataSeeded) {
    steps.push('Render Postgres에 import:data를 다시 실행해 기준 데이터를 적재하세요.');
  }

  if (!readiness.openAiReady) {
    steps.push('OPENAI_API_KEY를 설정하세요.');
  }

  if (!readiness.ecountReady) {
    steps.push('ERP_COM_CODE, ERP_USER_ID, ERP_API_CERT_KEY를 확인하세요.');
  }

  if (!readiness.twilioVoiceReady) {
    steps.push('PUBLIC_BASE_URL과 TWILIO_AUTH_TOKEN을 설정하고 Twilio Voice webhook을 연결하세요.');
  }

  if (!readiness.twilioMediaReady) {
    steps.push('TWILIO_STREAM_TOKEN을 설정하세요.');
  }

  if (!readiness.adminReady) {
    steps.push('ADMIN_API_TOKEN을 설정하세요.');
  }

  if (!readiness.realtimeMonitorReady) {
    steps.push('REALTIME_WS_TOKEN을 설정하세요.');
  }

  if (!readiness.notificationsReady) {
    steps.push('ERP SMS webhook 또는 SMTP/알림톡 설정을 채우세요.');
  }

  if (steps.length === 0) {
    steps.push('Twilio 번호에 대표번호를 연결하고 주문/재고/견적 테스트콜을 진행하세요.');
    steps.push('관리자 콘솔에서 실시간 전사와 takeover 동작을 확인하세요.');
  }

  return steps;
}
