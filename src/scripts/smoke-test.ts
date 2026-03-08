import WebSocket from 'ws';

type CheckResult = {
  name: string;
  ok: boolean;
  durationMs: number;
  status?: number;
  detail?: string;
};

type CliOptions = {
  baseUrl: string;
  adminToken?: string;
  realtimeToken?: string;
  withWs: boolean;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checks: CheckResult[] = [];

  checks.push(await runHttpCheck('health', `${options.baseUrl}/health`));
  checks.push(await runHttpCheck('ready', `${options.baseUrl}/ready`));
  checks.push(await runHttpCheck('health.details', `${options.baseUrl}/health/details`));
  checks.push(await runHttpCheck('admin.console', `${options.baseUrl}/admin-console`));
  checks.push(await runHttpCheck('meta.sources', `${options.baseUrl}/api/v1/meta/sources`));
  checks.push(await runHttpCheck('meta.go_live', `${options.baseUrl}/api/v1/meta/go-live`));
  checks.push(
    await runHttpCheck(
      'admin.summary',
      `${options.baseUrl}/api/v1/admin/summary`,
      buildRequestInit(options.adminToken)
    )
  );
  checks.push(
    await runHttpCheck(
      'notifications.list',
      `${options.baseUrl}/api/v1/notifications?limit=1`,
      buildRequestInit(options.adminToken)
    )
  );
  checks.push(await runHttpCheck('orders.drafts', `${options.baseUrl}/api/v1/orders/drafts?limit=1`));

  if (options.withWs) {
    checks.push(await runWebSocketCheck(options));
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(
    JSON.stringify(
      {
        baseUrl: options.baseUrl,
        checkedAt: new Date().toISOString(),
        passed: failed.length === 0,
        total: checks.length,
        failed: failed.length,
        checks
      },
      null,
      2
    )
  );

  process.exit(failed.length === 0 ? 0 : 1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--base-url' && next) {
      options.baseUrl = next;
      index += 1;
      continue;
    }

    if (arg === '--admin-token' && next) {
      options.adminToken = next;
      index += 1;
      continue;
    }

    if (arg === '--realtime-token' && next) {
      options.realtimeToken = next;
      index += 1;
      continue;
    }

    if (arg === '--no-ws') {
      options.withWs = false;
      continue;
    }
  }

  const fallbackBaseUrl =
    process.env.SMOKE_BASE_URL ??
    process.env.PUBLIC_BASE_URL ??
    `http://127.0.0.1:${process.env.PORT ?? '3000'}`;

  const resolved: CliOptions = {
    baseUrl: stripTrailingSlash(options.baseUrl ?? fallbackBaseUrl),
    withWs: options.withWs ?? true
  };

  const adminToken = options.adminToken ?? process.env.ADMIN_API_TOKEN;

  if (adminToken) {
    resolved.adminToken = adminToken;
  }

  const realtimeToken = options.realtimeToken ?? process.env.REALTIME_WS_TOKEN;

  if (realtimeToken) {
    resolved.realtimeToken = realtimeToken;
  }

  return resolved;
}

async function runHttpCheck(
  name: string,
  url: string,
  init?: RequestInit
): Promise<CheckResult> {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, init);
    const ok = response.status >= 200 && response.status < 300;

    const result: CheckResult = {
      name,
      ok,
      status: response.status,
      durationMs: Date.now() - startedAt
    };

    if (!ok) {
      result.detail = await safeReadBody(response);
    }

    return result;
  } catch (error) {
    const result: CheckResult = {
      name,
      ok: false,
      durationMs: Date.now() - startedAt
    };

    result.detail = error instanceof Error ? error.message : 'Request failed';
    return result;
  }
}

async function runWebSocketCheck(options: CliOptions): Promise<CheckResult> {
  const startedAt = Date.now();
  const wsUrl = buildWsMonitorUrl(options.baseUrl, options.realtimeToken);

  return new Promise<CheckResult>((resolve) => {
    const socket = new WebSocket(wsUrl, {
      headers: options.realtimeToken
        ? {
            'x-realtime-token': options.realtimeToken
          }
        : undefined
    });

    const timeout = setTimeout(() => {
      socket.terminate();
      resolve({
        name: 'realtime.monitor.ws',
        ok: false,
        durationMs: Date.now() - startedAt,
        detail: 'WebSocket timeout'
      });
    }, 5000);

    socket.once('message', (raw) => {
      clearTimeout(timeout);
      socket.close();

      const text = raw.toString();
      const ok = text.includes('"type":"connected"');

      const result: CheckResult = {
        name: 'realtime.monitor.ws',
        ok,
        durationMs: Date.now() - startedAt
      };

      if (!ok) {
        result.detail = text;
      }

      resolve(result);
    });

    socket.once('error', (error) => {
      clearTimeout(timeout);
      resolve({
        name: 'realtime.monitor.ws',
        ok: false,
        durationMs: Date.now() - startedAt,
        detail: error.message
      });
    });
  });
}

function buildWsMonitorUrl(baseUrl: string, realtimeToken?: string) {
  const wsBaseUrl = baseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  const url = new URL('/api/v1/realtime/ws/monitor', wsBaseUrl);
  url.searchParams.set('role', 'monitor');

  if (realtimeToken) {
    url.searchParams.set('token', realtimeToken);
  }

  return url.toString();
}

function buildRequestInit(adminToken?: string): RequestInit | undefined {
  const headers = buildAuthHeaders(adminToken);

  if (!headers) {
    return undefined;
  }

  return { headers };
}

async function safeReadBody(response: Response) {
  try {
    return await response.text();
  } catch {
    return `HTTP ${response.status}`;
  }
}

function buildAuthHeaders(adminToken?: string) {
  if (!adminToken) {
    return undefined;
  }

  return {
    'x-admin-token': adminToken
  };
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

void main();
