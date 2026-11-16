import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Identity = { token: string | null; ready: boolean; setToken: (t: string | null) => void };
const Ctx = createContext<Identity>({ token: null, ready: false, setToken: () => {} });
const KEY = "calledit.token";

export function newToken() {
  return Crypto.randomUUID().replace(/-/g, "");
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((t) => {
      setTokenState(t);
      setReady(true);
    });
  }, []);
  const setToken = (t: string | null) => {
    setTokenState(t);
    if (t) AsyncStorage.setItem(KEY, t);
    else AsyncStorage.removeItem(KEY);
  };
  return <Ctx.Provider value={{ token, ready, setToken }}>{children}</Ctx.Provider>;
}

export const useIdentity = () => useContext(Ctx);

export async function loadPasscode() {
  return (await AsyncStorage.getItem("calledit.admin")) ?? "";
}
export async function savePasscode(p: string) {
  await AsyncStorage.setItem("calledit.admin", p);
}
