import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database as GeneratedDatabase, Json } from "./database.generated";

// PostgreSQL introspection cannot see that the BEFORE INSERT trigger supplies
// the immutable snapshot. Callers must let that trigger choose the version.
type Attempts = GeneratedDatabase["public"]["Tables"]["attempts"];
export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Tables"> & {
    Tables: Omit<GeneratedDatabase["public"]["Tables"], "attempts"> & {
      attempts: Omit<Attempts, "Insert"> & {
        Insert: Omit<Attempts["Insert"], "assessment_version_id"> & { assessment_version_id?: never };
      };
    };
  };
};

export type AppDatabaseClient = SupabaseClient<Database>;
export type { Json, Tables, TablesUpdate } from "./database.generated";

export function isJsonObject(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Domain interfaces and provider payloads are not Json index signatures. Apply
// the same JSON encoding used on the wire before writing them to JSONB columns.
export function toJson(value: unknown): Json {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Expected a JSON value");
  return JSON.parse(encoded) as Json;
}
