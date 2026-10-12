"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServiceSupabase = getServiceSupabase;
const supabase_js_1 = require("@supabase/supabase-js");
let cached;
function getServiceSupabase(url, serviceKey) {
    if (!url || !serviceKey)
        throw new Error("Supabase service credentials are not configured.");
    if (!cached)
        cached = (0, supabase_js_1.createClient)(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    return cached;
}
