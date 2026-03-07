export type CallControlTarget = 'sales' | 'tech' | 'none';

export type ActiveCallControl = {
  kind: 'twilio_openai';
  injectAiInstruction: (instruction: string) => Promise<void> | void;
  takeover: (target: CallControlTarget, reason?: string) => Promise<void> | void;
  close?: () => void;
};

export class CallControlRegistry {
  private controls = new Map<string, ActiveCallControl>();

  register(callSessionId: string, control: ActiveCallControl) {
    this.controls.set(callSessionId, control);
  }

  unregister(callSessionId: string, control?: ActiveCallControl) {
    if (!control) {
      this.controls.delete(callSessionId);
      return;
    }

    const current = this.controls.get(callSessionId);

    if (current === control) {
      this.controls.delete(callSessionId);
    }
  }

  get(callSessionId: string) {
    return this.controls.get(callSessionId) ?? null;
  }

  has(callSessionId: string) {
    return this.controls.has(callSessionId);
  }

  listSessionIds() {
    return Array.from(this.controls.keys());
  }
}
