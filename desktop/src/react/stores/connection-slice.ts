import type { ServerConnection } from '../services/server-connection';
import { createLocalServerConnection } from '../services/server-connection';

export interface ConnectionSlice {
  serverPort: string | null;
  serverToken: string | null;
  activeServerConnection: ServerConnection | null;
  connected: boolean;
  statusKey: string;
  statusVars: Record<string, string | number>;
  /** Bridge dot: at least one platform connected */
  bridgeDotConnected: boolean;
  wsState: 'connected' | 'reconnecting' | 'disconnected';
  wsReconnectAttempt: number;
  oauthSessionId: string | null;
  setServerPort: (port: string | number | null) => void;
  setServerToken: (token: string | null) => void;
  setActiveServerConnection: (connection: ServerConnection | null) => void;
  setLocalServerConnection: (port: string | number | null, token: string | null) => void;
  setConnected: (connected: boolean) => void;
  setOauthSessionId: (id: string | null) => void;
}

export const createConnectionSlice = (
  set: (partial: Partial<ConnectionSlice>) => void,
  get?: () => Pick<ConnectionSlice, 'serverPort' | 'serverToken'>,
): ConnectionSlice => ({
  serverPort: null,
  serverToken: null,
  activeServerConnection: null,
  connected: false,
  statusKey: 'status.connecting',
  statusVars: {},
  bridgeDotConnected: false,
  wsState: 'disconnected',
  wsReconnectAttempt: 0,
  oauthSessionId: null,
  setServerPort: (port) => {
    const serverPort = port === null || port === undefined ? null : String(port);
    const serverToken = get?.().serverToken ?? null;
    set({
      serverPort,
      activeServerConnection: createLocalServerConnection({ serverPort, serverToken }),
    });
  },
  setServerToken: (token) => {
    const serverPort = get?.().serverPort ?? null;
    set({
      serverToken: token,
      activeServerConnection: createLocalServerConnection({ serverPort, serverToken: token }),
    });
  },
  setActiveServerConnection: (connection) => set({ activeServerConnection: connection }),
  setLocalServerConnection: (port, token) => {
    const serverPort = port === null || port === undefined ? null : String(port);
    set({
      serverPort,
      serverToken: token,
      activeServerConnection: createLocalServerConnection({ serverPort, serverToken: token }),
    });
  },
  setConnected: (connected) => set({ connected }),
  setOauthSessionId: (id) => set({ oauthSessionId: id }),
});
