import type WebSocket from 'ws';

import type { ConversationState } from '../orchestrator/service';

type RealtimeRole = 'provider' | 'manager' | 'monitor';
type RealtimeScope = 'session' | 'global';

type TranscriptLine = {
  speaker: 'customer' | 'ai' | 'manager' | 'agent' | 'system';
  text: string;
  createdAt: string;
};

type SessionRuntime = {
  callSessionId: string;
  callerNumber?: string;
  providerCallId?: string;
  state: ConversationState;
  transcriptLines: TranscriptLine[];
  createdAt: string;
  lastActivityAt: string;
};

type ConnectionRef = {
  socket: WebSocket;
  role: RealtimeRole;
  scope: RealtimeScope;
  callSessionId?: string;
};

const MAX_TRANSCRIPT_LINES = 500;

export class RealtimeHub {
  private runtimes = new Map<string, SessionRuntime>();
  private sessionConnections = new Map<string, Set<ConnectionRef>>();
  private globalConnections = new Set<ConnectionRef>();
  private socketIndex = new Map<WebSocket, ConnectionRef>();

  join(input: {
    socket: WebSocket;
    role: RealtimeRole;
    scope: RealtimeScope;
    callSessionId?: string;
  }) {
    const ref: ConnectionRef = {
      socket: input.socket,
      role: input.role,
      scope: input.scope
    };

    if (input.callSessionId) {
      ref.callSessionId = input.callSessionId;
      this.ensureRuntime(input.callSessionId);
    }

    this.socketIndex.set(input.socket, ref);

    if (input.scope === 'global') {
      this.globalConnections.add(ref);
      return ref;
    }

    if (!input.callSessionId) {
      throw new Error('callSessionId is required for session scope');
    }

    const connections = this.sessionConnections.get(input.callSessionId) ?? new Set<ConnectionRef>();
    connections.add(ref);
    this.sessionConnections.set(input.callSessionId, connections);

    return ref;
  }

  leave(socket: WebSocket) {
    const ref = this.socketIndex.get(socket);

    if (!ref) {
      return;
    }

    this.socketIndex.delete(socket);

    if (ref.scope === 'global') {
      this.globalConnections.delete(ref);
      return;
    }

    if (!ref.callSessionId) {
      return;
    }

    const connections = this.sessionConnections.get(ref.callSessionId);

    if (!connections) {
      return;
    }

    connections.delete(ref);

    if (connections.size === 0) {
      this.sessionConnections.delete(ref.callSessionId);
    }
  }

  ensureRuntime(callSessionId: string) {
    const existing = this.runtimes.get(callSessionId);

    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const runtime: SessionRuntime = {
      callSessionId,
      state: {},
      transcriptLines: [],
      createdAt: now,
      lastActivityAt: now
    };

    this.runtimes.set(callSessionId, runtime);
    return runtime;
  }

  getRuntime(callSessionId: string) {
    return this.runtimes.get(callSessionId) ?? null;
  }

  getState(callSessionId: string) {
    return this.ensureRuntime(callSessionId).state;
  }

  patchState(callSessionId: string, patch: ConversationState) {
    const runtime = this.ensureRuntime(callSessionId);
    runtime.state = {
      ...runtime.state,
      ...patch
    };
    runtime.lastActivityAt = new Date().toISOString();
    return runtime.state;
  }

  setCaller(callSessionId: string, callerNumber?: string) {
    if (!callerNumber) {
      return;
    }

    const runtime = this.ensureRuntime(callSessionId);
    runtime.callerNumber = callerNumber;
    runtime.lastActivityAt = new Date().toISOString();
  }

  setProviderCallId(callSessionId: string, providerCallId?: string) {
    if (!providerCallId) {
      return;
    }

    const runtime = this.ensureRuntime(callSessionId);
    runtime.providerCallId = providerCallId;
    runtime.lastActivityAt = new Date().toISOString();
  }

  addTranscriptLine(
    callSessionId: string,
    line: TranscriptLine
  ) {
    const runtime = this.ensureRuntime(callSessionId);
    runtime.transcriptLines.push(line);

    if (runtime.transcriptLines.length > MAX_TRANSCRIPT_LINES) {
      runtime.transcriptLines.shift();
    }

    runtime.lastActivityAt = new Date().toISOString();
  }

  buildTranscript(callSessionId: string) {
    const runtime = this.runtimes.get(callSessionId);

    if (!runtime) {
      return '';
    }

    return runtime.transcriptLines
      .map((line) => `${line.speaker}: ${line.text}`)
      .join('\n');
  }

  getSnapshot(callSessionId: string) {
    const runtime = this.ensureRuntime(callSessionId);
    const connections = this.sessionConnections.get(callSessionId);

    return {
      callSessionId: runtime.callSessionId,
      callerNumber: runtime.callerNumber ?? null,
      providerCallId: runtime.providerCallId ?? null,
      state: runtime.state,
      transcriptPreview: runtime.transcriptLines.slice(-20),
      transcriptCount: runtime.transcriptLines.length,
      subscriberCount: connections?.size ?? 0,
      createdAt: runtime.createdAt,
      lastActivityAt: runtime.lastActivityAt
    };
  }

  peekSnapshot(callSessionId: string) {
    const runtime = this.runtimes.get(callSessionId);

    if (!runtime) {
      return null;
    }

    const connections = this.sessionConnections.get(callSessionId);

    return {
      callSessionId: runtime.callSessionId,
      callerNumber: runtime.callerNumber ?? null,
      providerCallId: runtime.providerCallId ?? null,
      state: runtime.state,
      transcriptPreview: runtime.transcriptLines.slice(-20),
      transcriptCount: runtime.transcriptLines.length,
      subscriberCount: connections?.size ?? 0,
      createdAt: runtime.createdAt,
      lastActivityAt: runtime.lastActivityAt
    };
  }

  listSnapshots() {
    return Array.from(this.runtimes.keys())
      .map((callSessionId) => this.getSnapshot(callSessionId))
      .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
  }

  broadcastSession(callSessionId: string, message: Record<string, unknown>) {
    const payload = JSON.stringify(message);
    const connections = this.sessionConnections.get(callSessionId);

    if (connections) {
      for (const ref of connections) {
        if (ref.socket.readyState === ref.socket.OPEN) {
          ref.socket.send(payload);
        }
      }
    }

    for (const ref of this.globalConnections) {
      if (ref.socket.readyState === ref.socket.OPEN) {
        ref.socket.send(payload);
      }
    }
  }

  clearRuntime(callSessionId: string) {
    this.runtimes.delete(callSessionId);
  }
}

export type { RealtimeRole, RealtimeScope };
