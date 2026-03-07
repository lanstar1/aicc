import type { FastifyInstance } from 'fastify';
import nodemailer from 'nodemailer';

import { env } from '../../config/env';
import { createHttpError } from '../../lib/http';
import { normalizeDigits } from '../../lib/normalize';

export type NotificationChannel = 'email' | 'sms' | 'alimtalk';

export type QueueNotificationInput = {
  callSessionId?: string;
  customerId?: string;
  channel: NotificationChannel;
  recipient: string;
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
};

type NotificationRow = {
  id: string;
  call_session_id: string | null;
  customer_id: string | null;
  channel: NotificationChannel;
  recipient: string;
  subject: string | null;
  body: string;
  status: 'queued' | 'sent' | 'failed';
  provider_message_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type OrderDraftSummaryRow = {
  draft_id: string;
  draft_kind: 'sale' | 'quote';
  warehouse_code: string;
  shipping_method: string | null;
  remark_text: string | null;
  prepayment_required: boolean;
  prepayment_notice_sent: boolean;
  total_amount: number | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_code: string | null;
};

type OrderDraftSummaryLineRow = {
  product_name: string;
  qty: number;
  unit_price: number | null;
  total_amount: number | null;
};

type OrderDraftRecipientRow = {
  draft_id: string;
  call_session_id: string | null;
  customer_id: string | null;
  customer_mobile: string | null;
  customer_phone: string | null;
  caller_number: string | null;
};

export async function queueNotification(
  app: FastifyInstance,
  input: QueueNotificationInput
) {
  const result = await app.db.query<NotificationRow>(
    `
      insert into aicc.notification_delivery (
        call_session_id,
        customer_id,
        channel,
        recipient,
        subject,
        body,
        status,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6, 'queued', $7)
      returning *
    `,
    [
      input.callSessionId ?? null,
      input.customerId ?? null,
      input.channel,
      input.recipient,
      input.subject ?? null,
      input.body,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  const notification = result.rows[0];

  if (!notification) {
    throw createHttpError(500, 'Failed to queue notification');
  }

  if (notification.call_session_id) {
    await appendNotificationEvent(app, notification.call_session_id, notification.channel, {
      status: 'queued',
      recipient: notification.recipient,
      subject: notification.subject
    });
  }

  return notification;
}

export async function sendNotificationById(
  app: FastifyInstance,
  notificationId: string
) {
  const notification = await loadNotification(app, notificationId);
  return dispatchNotification(app, notification);
}

export async function dispatchNotification(
  app: FastifyInstance,
  notification: NotificationRow
) {
  try {
    const provider = await sendViaProvider(notification);

    const result = await app.db.query<NotificationRow>(
      `
        update aicc.notification_delivery
        set
          status = 'sent',
          provider_message_id = $2,
          metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb
        where id = $1
        returning *
      `,
      [
        notification.id,
        provider.providerMessageId,
        JSON.stringify({
          provider: provider.provider,
          deliveredAt: new Date().toISOString()
        })
      ]
    );
    const updated = result.rows[0];

    if (!updated) {
      throw new Error('Failed to update notification status');
    }

    if (updated.call_session_id) {
      await appendNotificationEvent(app, updated.call_session_id, updated.channel, {
        status: 'sent',
        recipient: updated.recipient,
        providerMessageId: updated.provider_message_id,
        provider: provider.provider
      });
    }

    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Notification delivery failed';
    const result = await app.db.query<NotificationRow>(
      `
        update aicc.notification_delivery
        set
          status = 'failed',
          metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb
        where id = $1
        returning *
      `,
      [
        notification.id,
        JSON.stringify({
          lastError: message,
          failedAt: new Date().toISOString()
        })
      ]
    );
    const updated = result.rows[0];

    if (!updated) {
      throw new Error('Failed to update failed notification status');
    }

    if (updated.call_session_id) {
      await appendNotificationEvent(app, updated.call_session_id, updated.channel, {
        status: 'failed',
        recipient: updated.recipient,
        error: message
      });
    }

    throw createHttpError(502, message);
  }
}

export async function listNotifications(
  app: FastifyInstance,
  input: {
    status?: 'queued' | 'sent' | 'failed';
    channel?: NotificationChannel;
    limit: number;
  }
) {
  const result = await app.db.query<NotificationRow>(
    `
      select
        id,
        call_session_id::text,
        customer_id::text,
        channel,
        recipient,
        subject,
        body,
        status,
        provider_message_id,
        metadata,
        created_at::text,
        updated_at::text
      from aicc.notification_delivery
      where
        ($1::text is null or status = $1)
        and ($2::text is null or channel = $2)
      order by created_at desc
      limit $3
    `,
    [input.status ?? null, input.channel ?? null, input.limit]
  );

  return result.rows;
}

export async function queueOrderDraftSummary(
  app: FastifyInstance,
  input: {
    draftId: string;
    channel: NotificationChannel;
    recipient: string;
    callSessionId?: string;
    sendNow?: boolean;
  }
) {
  const summary = await buildOrderDraftSummary(app, input.draftId);
  const queueInput: QueueNotificationInput = {
    channel: input.channel,
    recipient: input.recipient,
    subject: summary.subject,
    body: summary.body,
    metadata: {
      template: 'order_draft_summary',
      draftId: input.draftId
    }
  };

  const callSessionId = input.callSessionId ?? summary.callSessionId;

  if (callSessionId) {
    queueInput.callSessionId = callSessionId;
  }

  if (summary.customerId) {
    queueInput.customerId = summary.customerId;
  }

  const queued = await queueNotification(app, queueInput);

  if (!input.sendNow) {
    return {
      queued,
      sent: null
    };
  }

  const sent = await sendNotificationById(app, queued.id);

  return {
    queued,
    sent
  };
}

export async function autoSendOrderDraftSummary(
  app: FastifyInstance,
  input: {
    draftId: string;
    preferredChannel?: NotificationChannel;
  }
) {
  if (!env.AUTO_ORDER_NOTIFICATION_ENABLED) {
    return {
      attempted: false,
      reason: 'auto_notification_disabled'
    } as const;
  }

  const channel = input.preferredChannel ?? env.AUTO_ORDER_NOTIFICATION_CHANNEL;

  if (channel === 'email') {
    return {
      attempted: false,
      reason: 'email_recipient_not_supported',
      channel
    } as const;
  }

  const recipientInfo = await resolveOrderDraftRecipient(app, input.draftId);

  if (!recipientInfo.recipient) {
    return {
      attempted: false,
      reason: 'recipient_not_found',
      channel
    } as const;
  }

  const queueInput: Parameters<typeof queueOrderDraftSummary>[1] = {
    draftId: input.draftId,
    channel,
    recipient: recipientInfo.recipient,
    sendNow: true
  };

  if (recipientInfo.callSessionId) {
    queueInput.callSessionId = recipientInfo.callSessionId;
  }

  const result = await queueOrderDraftSummary(app, queueInput);

  return {
    attempted: true,
    channel,
    recipient: recipientInfo.recipient,
    ...result
  } as const;
}

async function buildOrderDraftSummary(
  app: FastifyInstance,
  draftId: string
) {
  const headerResult = await app.db.query<OrderDraftSummaryRow & { call_session_id: string | null }>(
    `
      select
        od.id as draft_id,
        od.call_session_id::text,
        od.draft_kind,
        od.warehouse_code,
        od.shipping_method::text,
        od.remark_text,
        od.prepayment_required,
        od.prepayment_notice_sent,
        od.total_amount,
        mc.id::text as customer_id,
        mc.customer_name,
        mc.customer_code
      from aicc.order_draft od
      left join aicc.master_customer mc on mc.id = od.customer_id
      where od.id = $1
      limit 1
    `,
    [draftId]
  );

  const header = headerResult.rows[0];

  if (!header) {
    throw createHttpError(404, 'Order draft not found');
  }

  const lineResult = await app.db.query<OrderDraftSummaryLineRow>(
    `
      select
        product_name,
        qty,
        unit_price,
        total_amount
      from aicc.order_draft_line
      where order_draft_id = $1
      order by created_at asc
    `,
    [draftId]
  );

  const title = header.draft_kind === 'sale' ? '주문 접수 안내' : '견적 안내';
  const subject = `[LANstar] ${title}${header.customer_name ? ` - ${header.customer_name}` : ''}`;
  const lines = lineResult.rows.map((line) => {
    const pricePart =
      line.unit_price !== null ? ` / 단가 ${formatCurrency(line.unit_price)}` : '';
    return `- ${line.product_name} ${Number(line.qty)}개${pricePart}`;
  });

  const footer: string[] = [];

  if (header.shipping_method) {
    footer.push(`배송방법: ${header.shipping_method}`);
  }

  if (header.prepayment_required || header.prepayment_notice_sent) {
    footer.push('선결제 후 출고 진행됩니다.');
  }

  if (header.total_amount !== null) {
    footer.push(`합계: ${formatCurrency(header.total_amount)}`);
  }

  const body = [
    `${title}드립니다.`,
    header.customer_name ? `거래처: ${header.customer_name}` : null,
    ...lines,
    ...footer
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  return {
    customerId: header.customer_id,
    callSessionId: header.call_session_id,
    subject,
    body
  };
}

async function loadNotification(
  app: FastifyInstance,
  notificationId: string
) {
  const result = await app.db.query<NotificationRow>(
    `
      select
        id,
        call_session_id::text,
        customer_id::text,
        channel,
        recipient,
        subject,
        body,
        status,
        provider_message_id,
        metadata,
        created_at::text,
        updated_at::text
      from aicc.notification_delivery
      where id = $1
      limit 1
    `,
    [notificationId]
  );

  const notification = result.rows[0];

  if (!notification) {
    throw createHttpError(404, 'Notification not found');
  }

  return notification;
}

async function resolveOrderDraftRecipient(
  app: FastifyInstance,
  draftId: string
) {
  const result = await app.db.query<OrderDraftRecipientRow>(
    `
      select
        od.id::text as draft_id,
        od.call_session_id::text,
        od.customer_id::text,
        mc.mobile as customer_mobile,
        mc.phone as customer_phone,
        cs.caller_number
      from aicc.order_draft od
      left join aicc.master_customer mc on mc.id = od.customer_id
      left join aicc.call_session cs on cs.id = od.call_session_id
      where od.id = $1
      limit 1
    `,
    [draftId]
  );

  const row = result.rows[0];

  if (!row) {
    throw createHttpError(404, 'Order draft not found');
  }

  const recipient =
    normalizeDigits(row.customer_mobile) ??
    normalizeDigits(row.customer_phone) ??
    normalizeDigits(row.caller_number);

  return {
    callSessionId: row.call_session_id,
    customerId: row.customer_id,
    recipient
  };
}

async function sendViaProvider(notification: NotificationRow) {
  if (env.NOTIFICATION_MOCK_MODE) {
    return {
      provider: 'mock',
      providerMessageId: `mock-${notification.channel}-${Date.now()}`
    };
  }

  if (notification.channel === 'email') {
    return sendEmail(notification);
  }

  if (notification.channel === 'sms') {
    return sendSms(notification);
  }

  return sendAlimtalk(notification);
}

async function sendEmail(notification: NotificationRow) {
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.EMAIL_FROM_ADDRESS) {
    throw new Error('SMTP configuration is incomplete');
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS
          }
        : undefined
  });

  const result = await transporter.sendMail({
    from: `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_FROM_ADDRESS}>`,
    to: notification.recipient,
    subject: notification.subject ?? '(제목 없음)',
    text: notification.body
  });

  return {
    provider: 'smtp',
    providerMessageId: result.messageId
  };
}

async function sendSms(notification: NotificationRow) {
  if (!env.ERP_SMS_WEBHOOK_URL) {
    throw new Error('ERP SMS webhook is not configured');
  }

  const response = await fetch(env.ERP_SMS_WEBHOOK_URL, {
    method: 'POST',
    headers: buildWebhookHeaders(env.ERP_SMS_WEBHOOK_TOKEN),
    body: JSON.stringify({
      to: notification.recipient,
      body: notification.body,
      subject: notification.subject
    })
  });

  if (!response.ok) {
    throw new Error(`SMS webhook failed with status ${response.status}`);
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  return {
    provider: env.SMS_PROVIDER,
    providerMessageId:
      typeof data.messageId === 'string' ? data.messageId : `sms-${Date.now()}`
  };
}

async function sendAlimtalk(notification: NotificationRow) {
  if (!env.ALIMTALK_WEBHOOK_URL) {
    throw new Error('Alimtalk webhook is not configured');
  }

  const response = await fetch(env.ALIMTALK_WEBHOOK_URL, {
    method: 'POST',
    headers: buildWebhookHeaders(env.ALIMTALK_WEBHOOK_TOKEN),
    body: JSON.stringify({
      to: notification.recipient,
      body: notification.body,
      subject: notification.subject
    })
  });

  if (!response.ok) {
    throw new Error(`Alimtalk webhook failed with status ${response.status}`);
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  return {
    provider: 'alimtalk_webhook',
    providerMessageId:
      typeof data.messageId === 'string' ? data.messageId : `alimtalk-${Date.now()}`
  };
}

function buildWebhookHeaders(token?: string) {
  return {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
}

async function appendNotificationEvent(
  app: FastifyInstance,
  callSessionId: string,
  channel: NotificationChannel,
  metadata: Record<string, unknown>
) {
  const eventType = channel === 'email' ? 'email' : 'sms';

  await app.db.query(
    `
      insert into aicc.call_event (
        call_session_id,
        event_type,
        speaker,
        content,
        metadata
      )
      values ($1, $2::aicc.call_event_t, 'system', $3, $4)
    `,
    [
      callSessionId,
      eventType,
      `${channel} notification`,
      JSON.stringify(metadata)
    ]
  );
}

function formatCurrency(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}
