import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://dqlmmzquzcjnrobfnser.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxbG1tenF1emNqbnJvYmZuc2VyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMDc1NTIsImV4cCI6MjA4OTc4MzU1Mn0.43k5zVmtY51uqO0jz0dFYaH130k5YQLO0YXoS2zMTN4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
