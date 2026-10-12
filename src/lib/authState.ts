import type { User } from "firebase/auth";
import { useAuth } from "../context/AuthContext";

export type AuthState = { user: User | null; authLoading: boolean };

/** Typed view of the JavaScript auth context for TypeScript screens. */
export function useAuthState(): AuthState {
  return useAuth() as unknown as AuthState;
}
