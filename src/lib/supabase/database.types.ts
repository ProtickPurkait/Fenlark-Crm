// ============================================================================
// Hand-authored to match supabase/migrations/*.sql exactly, in the same shape
// `supabase gen types typescript` would produce. Written by hand here because
// the CLI needs a linked project + access token that this environment doesn't
// have configured.
//
// To regenerate authoritatively once you have the Supabase CLI logged in:
//   npx supabase gen types typescript --project-id bsfofcxagxeqrhbolmuf --schema public > src/lib/supabase/database.types.ts
//
// If you do, diff it against this file first — the RPC return shapes for
// TABLE-returning functions are sometimes flattened differently by the
// generator, and call sites in this app assume the shapes defined below.
// ============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "admin" | "telecaller";

export type LeadStatus =
  | "new"
  | "attempted"
  | "connected"
  | "warm"
  | "rescheduled"
  | "converted"
  | "dead";

export type LeadSource = "manual" | "csv" | "webhook";

export type AuditEvent =
  | "lead_created"
  | "assigned"
  | "reassigned"
  | "unassigned"
  | "status_changed"
  | "remark_added"
  | "reschedule_set"
  | "sla_revoked"
  | "lead_archived";

/** Where a call's duration came from. 'provider' is reserved for a future
 *  cloud-telephony integration writing exact values into the same table. */
export type CallDurationSource = "app_estimate" | "manual" | "provider";

/** 'superseded' = caller started another call; 'sweep' = the app never
 *  reported back and pg_cron closed it (duration is null in that case). */
export type CallEndedReason = "user" | "superseded" | "sweep";

export type FollowUpBucket =
  | "closed"
  | "unscheduled"
  | "overdue"
  | "due_soon"
  | "due_today"
  | "scheduled";

/** pending -> approved | rejected. Both are terminal — see
 *  enforce_sale_immutability() in 1500_sales_commission.sql. */
export type SaleStatus = "pending" | "approved" | "rejected";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          phone: string | null;
          role: UserRole;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          phone?: string | null;
          role?: UserRole;
          is_active?: boolean;
        };
        Update: {
          full_name?: string;
          phone?: string | null;
          // role / is_active / email are frozen for non-admins by trigger —
          // see enforce_user_update_rules() in 0300_helpers_guards.sql.
          role?: UserRole;
          is_active?: boolean;
          email?: string;
        };
        // Required by @supabase/postgrest-js's GenericTable constraint even
        // though this app never uses embedded (foreign-table) selects — an
        // empty array is the correct value, not a placeholder to fill in later.
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          full_name: string;
          phone: string;
          phone_normalized: string;
          email: string | null;
          city: string | null;
          company: string | null;
          business_type: string | null;
          address: string | null;
          notes: string | null;
          source: LeadSource;
          source_meta: Json;
          status: LeadStatus;
          assigned_to: string | null;
          assigned_at: string | null;
          last_contacted_at: string | null;
          scheduled_at: string | null;
          last_remark: string | null;
          sla_revoked_count: number;
          created_by: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          full_name: string;
          phone: string;
          email?: string | null;
          city?: string | null;
          company?: string | null;
          business_type?: string | null;
          address?: string | null;
          notes?: string | null;
          source?: LeadSource;
          source_meta?: Json;
          status?: LeadStatus;
          assigned_to?: string | null;
          created_by?: string | null;
        };
        Update: {
          full_name?: string;
          email?: string | null;
          city?: string | null;
          company?: string | null;
          business_type?: string | null;
          address?: string | null;
          notes?: string | null;
          status?: LeadStatus;
          scheduled_at?: string | null;
          last_remark?: string | null;
          // assigned_to is intentionally omittable here for typing purposes,
          // but a telecaller UPDATE that changes it is rejected by RLS'
          // WITH CHECK and by enforce_lead_update_rules(). Reassignment should
          // go through admin_assign_leads() / admin_round_robin_assign().
          assigned_to?: string | null;
        };
        Relationships: [];
      };
      lead_history_logs: {
        Row: {
          id: number;
          lead_id: string;
          actor_id: string | null;
          actor_kind: "user" | "system";
          event_type: AuditEvent;
          from_status: LeadStatus | null;
          to_status: LeadStatus | null;
          from_assignee: string | null;
          to_assignee: string | null;
          remark: string | null;
          scheduled_at: string | null;
          note: string | null;
          created_at: string;
        };
        // The table is append-only and written exclusively by the
        // log_lead_change() trigger (SECURITY DEFINER) — there is no INSERT
        // policy for `authenticated`, and UPDATE/DELETE always raise. Insert
        // and Update are typed as `Partial<Row>` rather than `never` on
        // purpose: `never` breaks @supabase/supabase-js's generic bound on
        // Row for THIS table (and cascades into `never`/`undefined` showing
        // up in .rpc() calls elsewhere in the app — the library's client type
        // parameter is threaded globally, so one malformed table entry can
        // poison unrelated inference). The real guard against writes is RLS
        // and the append-only trigger in Postgres, not this file.
        Insert: Partial<Database["public"]["Tables"]["lead_history_logs"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["lead_history_logs"]["Row"]>;
        Relationships: [];
      };
      call_sessions: {
        Row: {
          id: string;
          lead_id: string;
          caller_id: string | null;
          started_at: string;
          ended_at: string | null;
          duration_seconds: number | null;
          duration_source: CallDurationSource;
          ended_reason: CallEndedReason | null;
          created_at: string;
        };
        // Written exclusively by start_call_session / end_call_session.
        // `authenticated` has no INSERT/UPDATE/DELETE grant on this table at
        // all (migration 1100), so these shapes exist only to satisfy the
        // postgrest-js generic bound — same reasoning as lead_history_logs.
        Insert: Partial<Database["public"]["Tables"]["call_sessions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["call_sessions"]["Row"]>;
        Relationships: [];
      };
      system_settings: {
        Row: {
          id: boolean;
          stale_recycling_enabled: boolean;
          stale_sla_hours: number;
          whatsapp_template: string;
          round_robin_cursor: number;
          report_timezone: string;
          admin_whatsapp_number: string | null;
          daily_report_template: string;
          updated_by: string | null;
          updated_at: string;
        };
        // Same `never`-avoidance note as lead_history_logs above. Use the
        // admin_update_settings() RPC instead of a raw UPDATE in app code —
        // it validates the SLA range and stamps updated_by consistently.
        Insert: Partial<Database["public"]["Tables"]["system_settings"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["system_settings"]["Row"]>;
        Relationships: [];
      };
      sales: {
        Row: {
          id: string;
          lead_id: string;
          telecaller_id: string | null;
          status: SaleStatus;
          commission_amount: number;
          sale_note: string | null;
          submitted_at: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          rejection_reason: string | null;
          acknowledged_at: string | null;
          created_at: string;
          updated_at: string;
        };
        // Written exclusively by caller_log_sale / admin_approve_sale /
        // admin_reject_sale / caller_acknowledge_sale — `authenticated` has no
        // INSERT/UPDATE/DELETE grant on this table at all (migration 1500).
        // Same `never`-avoidance note as lead_history_logs above.
        Insert: Partial<Database["public"]["Tables"]["sales"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["sales"]["Row"]>;
        Relationships: [];
      };
      attendance: {
        Row: {
          id: string;
          telecaller_id: string | null;
          work_date: string;
          clock_in_at: string;
          clock_out_at: string | null;
          created_at: string;
          updated_at: string;
        };
        // Written exclusively by caller_clock_in() / caller_clock_out() —
        // `authenticated` has no INSERT/UPDATE/DELETE grant on this table at
        // all (migration 1900). Same `never`-avoidance note as
        // lead_history_logs above.
        Insert: Partial<Database["public"]["Tables"]["attendance"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["attendance"]["Row"]>;
        Relationships: [];
      };
    };
    Views: {
      telecaller_directory: {
        Row: {
          id: string;
          full_name: string;
          role: UserRole;
          is_active: boolean;
        };
        Relationships: [];
      };
      lead_queue: {
        Row: Database["public"]["Tables"]["leads"]["Row"] & {
          follow_up_bucket: FollowUpBucket;
          queue_rank: number;
          sla_hours_remaining: number | null;
        };
        Relationships: [];
      };
      // Non-sensitive slice of system_settings. Telecallers read this; the
      // full row is admin-only as of migration 1000.
      app_settings: {
        Row: {
          whatsapp_template: string;
          report_timezone: string;
          admin_whatsapp_number: string | null;
          daily_report_template: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      owns_lead: {
        Args: { p_lead_id: string };
        Returns: boolean;
      };
      normalize_phone: {
        Args: { p_phone: string };
        Returns: string;
      };
      log_call_interaction: {
        Args: {
          p_lead_id: string;
          p_status: LeadStatus;
          p_remark: string;
          p_scheduled_at?: string | null;
        };
        Returns: Database["public"]["Tables"]["leads"]["Row"];
      };
      my_dashboard_stats: {
        Args: Record<string, never>;
        Returns: {
          calls_made_today: number;
          followups_pending: number;
          followups_overdue: number;
          assigned_total: number;
          untouched_new: number;
        }[];
      };
      admin_import_leads: {
        Args: { p_rows: Json; p_source?: LeadSource };
        Returns: {
          inserted: number;
          skipped_duplicate: number;
          skipped_invalid: number;
        }[];
      };
      admin_assign_leads: {
        Args: { p_lead_ids: string[]; p_user_id: string | null };
        Returns: number;
      };
      admin_round_robin_assign: {
        Args: { p_lead_ids: string[]; p_user_ids: string[] };
        Returns: {
          user_id: string;
          full_name: string;
          assigned_count: number;
        }[];
      };
      admin_archive_lead: {
        Args: { p_lead_id: string; p_reason?: string | null };
        Returns: void;
      };
      // Leads with any sale history are archived instead of destroyed — see
      // migration 1600. `deleted` and `archived_instead` should be summed to
      // get the total number of ids actually acted on.
      admin_delete_leads: {
        Args: { p_lead_ids: string[] };
        Returns: {
          deleted: number;
          archived_instead: number;
        }[];
      };
      admin_check_duplicate_phones: {
        Args: { p_phones: string[] };
        Returns: {
          phone_normalized: string;
          existing_lead_id: string;
          existing_full_name: string;
        }[];
      };
      admin_update_settings: {
        Args: {
          p_enabled?: boolean | null;
          p_sla_hours?: number | null;
          p_whatsapp_template?: string | null;
          p_admin_whatsapp_number?: string | null;
          p_daily_report_template?: string | null;
        };
        Returns: Database["public"]["Tables"]["system_settings"]["Row"];
      };
      admin_run_recycle_now: {
        Args: Record<string, never>;
        Returns: number;
      };
      admin_dashboard_summary: {
        Args: Record<string, never>;
        Returns: {
          total_leads: number;
          unassigned: number;
          active_callers: number;
          sla_revoked_total: number;
          // jsonb object keyed by lead_status, e.g. { "new": 12, "warm": 3 }.
          // Statuses with a zero count are absent, not zero — callers must
          // merge onto emptyStatusCounts() rather than trusting the keys.
          status_counts: Record<string, number>;
        }[];
      };
      sla_hours: {
        Args: Record<string, never>;
        Returns: number;
      };
      start_call_session: {
        Args: { p_lead_id: string };
        Returns: Database["public"]["Tables"]["call_sessions"]["Row"];
      };
      end_call_session: {
        Args: {
          p_session_id: string;
          p_duration_seconds?: number | null;
          p_source?: CallDurationSource;
        };
        Returns: Database["public"]["Tables"]["call_sessions"]["Row"];
      };
      // Single round trip for both the live-call list and today's per-caller
      // totals — see migration 1300 for why these were merged.
      admin_call_activity: {
        Args: Record<string, never>;
        Returns: {
          active: {
            session_id: string;
            caller_id: string | null;
            caller_name: string | null;
            lead_id: string;
            lead_name: string;
            lead_phone: string;
            started_at: string;
          }[];
          stats: {
            caller_id: string;
            caller_name: string;
            calls_today: number;
            talk_seconds: number;
            longest_call: number;
          }[];
        }[];
      };
      admin_set_user_role: {
        Args: { p_user_id: string; p_role: UserRole };
        Returns: void;
      };
      admin_set_user_active: {
        Args: { p_user_id: string; p_active: boolean };
        Returns: void;
      };
      caller_log_sale: {
        Args: { p_lead_id: string; p_note?: string | null };
        Returns: Database["public"]["Tables"]["sales"]["Row"];
      };
      admin_approve_sale: {
        Args: { p_sale_id: string };
        Returns: Database["public"]["Tables"]["sales"]["Row"];
      };
      admin_reject_sale: {
        Args: { p_sale_id: string; p_reason: string };
        Returns: Database["public"]["Tables"]["sales"]["Row"];
      };
      caller_acknowledge_sale: {
        Args: { p_sale_id: string };
        Returns: void;
      };
      my_wallet_summary: {
        Args: Record<string, never>;
        Returns: {
          balance: number;
          approved_count: number;
          pending_count: number;
          unseen_rejections: number;
        }[];
      };
      caller_clock_in: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["attendance"]["Row"];
      };
      caller_clock_out: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["attendance"]["Row"];
      };
      my_daily_report_summary: {
        Args: { p_date: string };
        Returns: {
          warm_leads_count: number;
          converted_count: number;
          schedules_count: number;
          appointments_count: number;
        }[];
      };
    };
    Enums: {
      user_role: UserRole;
      lead_status: LeadStatus;
      lead_source: LeadSource;
      audit_event: AuditEvent;
      sale_status: SaleStatus;
    };
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Views<T extends keyof Database["public"]["Views"]> =
  Database["public"]["Views"][T]["Row"];
export type Functions<T extends keyof Database["public"]["Functions"]> =
  Database["public"]["Functions"][T];

export type Lead = Tables<"leads">;
export type LeadQueueRow = Views<"lead_queue">;
export type UserProfile = Tables<"users">;
export type LeadHistoryLog = Tables<"lead_history_logs">;
export type SystemSettings = Tables<"system_settings">;
export type CallSession = Tables<"call_sessions">;
export type Sale = Tables<"sales">;
export type Attendance = Tables<"attendance">;
