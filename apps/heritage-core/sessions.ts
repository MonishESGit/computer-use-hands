import { randomUUID } from "node:crypto";
import type { TenantId } from "./types.js";

export interface OpenDraft {
  memberId: string;
  memberName: string;
}

export interface TellerSession {
  id: string;
  tenant: TenantId;
  user: string;
  lastSeen: number;
  seenInterstitial: boolean;
  openDraft?: OpenDraft;
}

export interface SessionStore {
  create(tenant: TenantId, user: string): TellerSession;
  get(id: string): TellerSession | undefined;
  touch(id: string, idleMs: number): TellerSession | undefined;
  destroy(id: string): void;
  save(session: TellerSession): void;
}

export function createMemorySessions(): SessionStore {
  const sessions = new Map<string, TellerSession>();

  return {
    create(tenant, user) {
      const session: TellerSession = {
        id: randomUUID(),
        tenant,
        user,
        lastSeen: Date.now(),
        seenInterstitial: false,
      };
      sessions.set(session.id, session);
      return session;
    },
    get(id) {
      return sessions.get(id);
    },
    touch(id, idleMs) {
      const session = sessions.get(id);
      if (!session) {
        return undefined;
      }
      if (Date.now() - session.lastSeen > idleMs) {
        sessions.delete(id);
        return undefined;
      }
      session.lastSeen = Date.now();
      return session;
    },
    destroy(id) {
      sessions.delete(id);
    },
    save(session) {
      sessions.set(session.id, session);
    },
  };
}
