import { getServiceSupabase } from "./supabase";
import { supabaseServiceRoleKey, supabaseUrl } from "./config";

export function serviceClient() {
  return getServiceSupabase(supabaseUrl.value(), supabaseServiceRoleKey.value());
}
