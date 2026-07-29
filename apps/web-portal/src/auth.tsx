import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

export type Identity = {
  userId: string;
  organizationId: string;
  displayName: string;
  email: string;
  roles: string[];
  permissions: string[];
};
type Auth = {
  identity: Identity | null;
  checking: boolean;
  token: string | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  request(path: string, init?: RequestInit): Promise<Response>;
};
const Context = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const refreshFlight = useRef<Promise<string | null> | null>(null);
  const queryClient = useQueryClient();
  const refresh = async () => {
    if (!refreshFlight.current)
      refreshFlight.current = fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
        .then(async (response) => {
          if (!response.ok) return null;
          const data = await response.json();
          setToken(data.accessToken);
          setIdentity(data.identity);
          return data.accessToken as string;
        })
        .finally(() => {
          refreshFlight.current = null;
        });
    return refreshFlight.current;
  };
  useEffect(() => {
    void refresh().finally(() => setChecking(false));
  }, []);
  const value = useMemo<Auth>(
    () => ({
      identity,
      token,
      checking,
      async login(email, password) {
        const response = await fetch("/api/v1/auth/login", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        if (!response.ok) throw new Error("Email or password is incorrect.");
        const data = await response.json();
        setToken(data.accessToken);
        setIdentity(data.identity);
      },
      async logout() {
        await fetch("/api/v1/auth/logout", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        setToken(null);
        setIdentity(null);
        queryClient.clear();
      },
      async request(path, init = {}) {
        const execute = (access: string | null) =>
          fetch(path, {
            ...init,
            headers: {
              ...init.headers,
              ...(access ? { authorization: `Bearer ${access}` } : {}),
            },
          });
        let response = await execute(token);
        if (response.status === 401) {
          const next = await refresh();
          if (next) response = await execute(next);
        }
        return response;
      },
    }),
    [identity, token, checking],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("AuthProvider missing");
  return value;
}
export function PermissionGate({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const { identity } = useAuth();
  return identity?.permissions.includes(permission) ? children : null;
}
