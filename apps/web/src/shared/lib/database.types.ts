/* GÉNÉRÉ — ne jamais éditer à la main. Régénérer via P1a §4.3. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      analytics_event_definitions: {
        Row: {
          created_at: string
          description: string
          emission: Database["public"]["Enums"]["analytics_emission"]
          event_name: string
          event_version: number
          family: string
          is_idempotent: boolean
          requires_organization: boolean
          status: Database["public"]["Enums"]["analytics_event_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          emission: Database["public"]["Enums"]["analytics_emission"]
          event_name: string
          event_version?: number
          family: string
          is_idempotent?: boolean
          requires_organization?: boolean
          status?: Database["public"]["Enums"]["analytics_event_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          emission?: Database["public"]["Enums"]["analytics_emission"]
          event_name?: string
          event_version?: number
          family?: string
          is_idempotent?: boolean
          requires_organization?: boolean
          status?: Database["public"]["Enums"]["analytics_event_status"]
          updated_at?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          acquisition_source: string | null
          acquisition_source_record_id: string | null
          actor_type: Database["public"]["Enums"]["analytics_actor_type"]
          actor_user_id: string | null
          appointment_id: string | null
          barber_id: string | null
          causation_id: string | null
          commercial_family:
            | Database["public"]["Enums"]["commercial_family"]
            | null
          correlation_id: string | null
          country_code: string | null
          customer_id: string | null
          dedupe_key: string | null
          event_name: string
          event_origin: Database["public"]["Enums"]["analytics_event_origin"]
          event_version: number
          id: string
          ingested_at: string
          locale: string | null
          location_id: string | null
          occurred_at: string
          organization_id: string | null
          passport_id: string | null
          plan_key: string | null
          platform: string | null
          professional_id: string | null
          properties: Json
          prospect_id: string | null
          queue_entry_id: string | null
          session_id: string | null
        }
        Insert: {
          acquisition_source?: string | null
          acquisition_source_record_id?: string | null
          actor_type: Database["public"]["Enums"]["analytics_actor_type"]
          actor_user_id?: string | null
          appointment_id?: string | null
          barber_id?: string | null
          causation_id?: string | null
          commercial_family?:
            | Database["public"]["Enums"]["commercial_family"]
            | null
          correlation_id?: string | null
          country_code?: string | null
          customer_id?: string | null
          dedupe_key?: string | null
          event_name: string
          event_origin: Database["public"]["Enums"]["analytics_event_origin"]
          event_version?: number
          id?: string
          ingested_at?: string
          locale?: string | null
          location_id?: string | null
          occurred_at?: string
          organization_id?: string | null
          passport_id?: string | null
          plan_key?: string | null
          platform?: string | null
          professional_id?: string | null
          properties?: Json
          prospect_id?: string | null
          queue_entry_id?: string | null
          session_id?: string | null
        }
        Update: {
          acquisition_source?: string | null
          acquisition_source_record_id?: string | null
          actor_type?: Database["public"]["Enums"]["analytics_actor_type"]
          actor_user_id?: string | null
          appointment_id?: string | null
          barber_id?: string | null
          causation_id?: string | null
          commercial_family?:
            | Database["public"]["Enums"]["commercial_family"]
            | null
          correlation_id?: string | null
          country_code?: string | null
          customer_id?: string | null
          dedupe_key?: string | null
          event_name?: string
          event_origin?: Database["public"]["Enums"]["analytics_event_origin"]
          event_version?: number
          id?: string
          ingested_at?: string
          locale?: string | null
          location_id?: string | null
          occurred_at?: string
          organization_id?: string | null
          passport_id?: string | null
          plan_key?: string | null
          platform?: string | null
          professional_id?: string | null
          properties?: Json
          prospect_id?: string | null
          queue_entry_id?: string | null
          session_id?: string | null
        }
        Relationships: []
      }
      analytics_ingestion_rejections: {
        Row: {
          event_name: string | null
          event_origin: string | null
          id: string
          occurred_at: string
          reason: string
          stage: string
        }
        Insert: {
          event_name?: string | null
          event_origin?: string | null
          id?: string
          occurred_at?: string
          reason: string
          stage: string
        }
        Update: {
          event_name?: string | null
          event_origin?: string | null
          id?: string
          occurred_at?: string
          reason?: string
          stage?: string
        }
        Relationships: []
      }
      api_source_health: {
        Row: {
          avg_latency_ms: number | null
          created_at: string
          failure_count: number
          id: string
          is_paused: boolean
          last_error: string | null
          last_failure_at: string | null
          last_request_at: string | null
          last_reset_day: string
          last_reset_month: string
          last_success_at: string | null
          paused_reason: string | null
          rate_limited_count: number
          requests_this_month: number
          requests_today: number
          source_id: string
          success_count: number
          updated_at: string
        }
        Insert: {
          avg_latency_ms?: number | null
          created_at?: string
          failure_count?: number
          id?: string
          is_paused?: boolean
          last_error?: string | null
          last_failure_at?: string | null
          last_request_at?: string | null
          last_reset_day?: string
          last_reset_month?: string
          last_success_at?: string | null
          paused_reason?: string | null
          rate_limited_count?: number
          requests_this_month?: number
          requests_today?: number
          source_id: string
          success_count?: number
          updated_at?: string
        }
        Update: {
          avg_latency_ms?: number | null
          created_at?: string
          failure_count?: number
          id?: string
          is_paused?: boolean
          last_error?: string | null
          last_failure_at?: string | null
          last_request_at?: string | null
          last_reset_day?: string
          last_reset_month?: string
          last_success_at?: string | null
          paused_reason?: string | null
          rate_limited_count?: number
          requests_this_month?: number
          requests_today?: number
          source_id?: string
          success_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_source_health_source_id_fkey"
            columns: ["source_id"]
            referencedRelation: "prospect_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      api_source_limits: {
        Row: {
          created_at: string
          id: string
          max_requests_per_day: number | null
          max_requests_per_minute: number | null
          max_requests_per_month: number | null
          source_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_requests_per_day?: number | null
          max_requests_per_minute?: number | null
          max_requests_per_month?: number | null
          source_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          max_requests_per_day?: number | null
          max_requests_per_minute?: number | null
          max_requests_per_month?: number | null
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_source_limits_source_id_fkey"
            columns: ["source_id"]
            referencedRelation: "prospect_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage: {
        Row: {
          endpoint: string | null
          error: string | null
          id: string
          job_id: string | null
          latency_ms: number | null
          requested_at: string
          source_id: string
          status_code: number | null
          success: boolean
        }
        Insert: {
          endpoint?: string | null
          error?: string | null
          id?: string
          job_id?: string | null
          latency_ms?: number | null
          requested_at?: string
          source_id: string
          status_code?: number | null
          success: boolean
        }
        Update: {
          endpoint?: string | null
          error?: string | null
          id?: string
          job_id?: string | null
          latency_ms?: number | null
          requested_at?: string
          source_id?: string
          status_code?: number | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_job_id_fkey"
            columns: ["job_id"]
            referencedRelation: "prospect_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_usage_source_id_fkey"
            columns: ["source_id"]
            referencedRelation: "prospect_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_claim_tokens: {
        Row: {
          appointment_id: string
          created_at: string
          expires_at: string
          id: string
          redeemed_at: string | null
          redeemed_by: string | null
          token_hash: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          expires_at: string
          id?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          token_hash: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_claim_tokens_appointment_id_fkey"
            columns: ["appointment_id"]
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          barber_id: string
          blocked_range: unknown
          booked_by_user_id: string | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          chair_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          decided_at: string | null
          decided_by: string | null
          ends_at: string
          expires_at: string | null
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          rescheduled_to: string | null
          resolution:
            | Database["public"]["Enums"]["appointment_resolution"]
            | null
          resolution_note: string | null
          service_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          barber_id: string
          blocked_range?: unknown
          booked_by_user_id?: string | null
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          chair_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          decided_at?: string | null
          decided_by?: string | null
          ends_at: string
          expires_at?: string | null
          id?: string
          location_id: string
          notes?: string | null
          organization_id: string
          rescheduled_to?: string | null
          resolution?:
            | Database["public"]["Enums"]["appointment_resolution"]
            | null
          resolution_note?: string | null
          service_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          barber_id?: string
          blocked_range?: unknown
          booked_by_user_id?: string | null
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          chair_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          decided_at?: string | null
          decided_by?: string | null
          ends_at?: string
          expires_at?: string | null
          id?: string
          location_id?: string
          notes?: string | null
          organization_id?: string
          rescheduled_to?: string | null
          resolution?:
            | Database["public"]["Enums"]["appointment_resolution"]
            | null
          resolution_note?: string | null
          service_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_barber_id_fkey"
            columns: ["barber_id"]
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_chair_id_fkey"
            columns: ["chair_id"]
            referencedRelation: "chairs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_customer_id_fkey"
            columns: ["customer_id"]
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_rescheduled_to_fkey"
            columns: ["rescheduled_to"]
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          organization_id: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      barber_availability_exceptions: {
        Row: {
          barber_id: string
          created_at: string
          end_time: string | null
          exception_date: string
          id: string
          is_unavailable: boolean
          organization_id: string
          reason: string | null
          start_time: string | null
          updated_at: string
        }
        Insert: {
          barber_id: string
          created_at?: string
          end_time?: string | null
          exception_date: string
          id?: string
          is_unavailable?: boolean
          organization_id: string
          reason?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Update: {
          barber_id?: string
          created_at?: string
          end_time?: string | null
          exception_date?: string
          id?: string
          is_unavailable?: boolean
          organization_id?: string
          reason?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "barber_availability_exceptions_barber_id_fkey"
            columns: ["barber_id"]
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barber_availability_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      barber_services: {
        Row: {
          barber_id: string
          created_at: string
          organization_id: string
          service_id: string
        }
        Insert: {
          barber_id: string
          created_at?: string
          organization_id: string
          service_id: string
        }
        Update: {
          barber_id?: string
          created_at?: string
          organization_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "barber_services_barber_id_fkey"
            columns: ["barber_id"]
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barber_services_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barber_services_service_id_fkey"
            columns: ["service_id"]
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      barber_working_hours: {
        Row: {
          barber_id: string
          created_at: string
          day_of_week: number
          end_time: string | null
          id: string
          is_off: boolean
          organization_id: string
          second_end_time: string | null
          second_start_time: string | null
          start_time: string | null
          updated_at: string
        }
        Insert: {
          barber_id: string
          created_at?: string
          day_of_week: number
          end_time?: string | null
          id?: string
          is_off?: boolean
          organization_id: string
          second_end_time?: string | null
          second_start_time?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Update: {
          barber_id?: string
          created_at?: string
          day_of_week?: number
          end_time?: string | null
          id?: string
          is_off?: boolean
          organization_id?: string
          second_end_time?: string | null
          second_start_time?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "barber_working_hours_barber_id_fkey"
            columns: ["barber_id"]
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barber_working_hours_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      barbers: {
        Row: {
          created_at: string
          id: string
          is_bookable: boolean
          organization_id: string
          professional_id: string | null
          service_mode_override:
            | Database["public"]["Enums"]["service_mode"]
            | null
          staff_profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_bookable?: boolean
          organization_id: string
          professional_id?: string | null
          service_mode_override?:
            | Database["public"]["Enums"]["service_mode"]
            | null
          staff_profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_bookable?: boolean
          organization_id?: string
          professional_id?: string | null
          service_mode_override?:
            | Database["public"]["Enums"]["service_mode"]
            | null
          staff_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "barbers_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barbers_professional_id_fkey"
            columns: ["professional_id"]
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barbers_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_provider_observations: {
        Row: {
          booking_status: Database["public"]["Enums"]["booking_availability_status"]
          confidence: number
          created_at: string
          detection_method: Database["public"]["Enums"]["booking_provider_detection_method"]
          evidence: string | null
          evidence_url: string | null
          first_seen_at: string
          id: string
          is_current: boolean
          job_id: string | null
          last_seen_at: string
          observed_at: string
          prospect_id: string
          provider_id: string
        }
        Insert: {
          booking_status?: Database["public"]["Enums"]["booking_availability_status"]
          confidence: number
          created_at?: string
          detection_method: Database["public"]["Enums"]["booking_provider_detection_method"]
          evidence?: string | null
          evidence_url?: string | null
          first_seen_at?: string
          id?: string
          is_current?: boolean
          job_id?: string | null
          last_seen_at?: string
          observed_at?: string
          prospect_id: string
          provider_id: string
        }
        Update: {
          booking_status?: Database["public"]["Enums"]["booking_availability_status"]
          confidence?: number
          created_at?: string
          detection_method?: Database["public"]["Enums"]["booking_provider_detection_method"]
          evidence?: string | null
          evidence_url?: string | null
          first_seen_at?: string
          id?: string
          is_current?: boolean
          job_id?: string | null
          last_seen_at?: string
          observed_at?: string
          prospect_id?: string
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_provider_observations_job_id_fkey"
            columns: ["job_id"]
            referencedRelation: "prospect_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_provider_observations_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "booking_provider_observations_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_provider_observations_provider_id_fkey"
            columns: ["provider_id"]
            referencedRelation: "booking_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_provider_observations_provider_id_fkey"
            columns: ["provider_id"]
            referencedRelation: "competitor_analytics"
            referencedColumns: ["provider_id"]
          },
        ]
      }
      booking_providers: {
        Row: {
          created_at: string
          discovery_notes: string | null
          display_name: string
          homepage_url: string | null
          id: string
          is_active: boolean
          is_sentinel: boolean
          key: string
          primary_markets: string[]
          signatures: Json
          supports_compliant_discovery: boolean | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          discovery_notes?: string | null
          display_name: string
          homepage_url?: string | null
          id?: string
          is_active?: boolean
          is_sentinel?: boolean
          key: string
          primary_markets?: string[]
          signatures?: Json
          supports_compliant_discovery?: boolean | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          discovery_notes?: string | null
          display_name?: string
          homepage_url?: string | null
          id?: string
          is_active?: boolean
          is_sentinel?: boolean
          key?: string
          primary_markets?: string[]
          signatures?: Json
          supports_compliant_discovery?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      chairs: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          location_id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          location_id: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chairs_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chairs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_capabilities: {
        Row: {
          capability_group: string
          capability_key: string
          created_at: string
          evidence: string
          status: string
          updated_at: string
        }
        Insert: {
          capability_group: string
          capability_key: string
          created_at?: string
          evidence: string
          status: string
          updated_at?: string
        }
        Update: {
          capability_group?: string
          capability_key?: string
          created_at?: string
          evidence?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      commercial_plan_changes: {
        Row: {
          change_reason: string | null
          changed_by: string | null
          created_at: string
          entitlement_source: Database["public"]["Enums"]["entitlement_source"]
          id: string
          new_plan_key: string
          new_status: Database["public"]["Enums"]["commercial_status"]
          organization_id: string
          previous_plan_key: string | null
          previous_status:
            | Database["public"]["Enums"]["commercial_status"]
            | null
        }
        Insert: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          entitlement_source: Database["public"]["Enums"]["entitlement_source"]
          id?: string
          new_plan_key: string
          new_status: Database["public"]["Enums"]["commercial_status"]
          organization_id: string
          previous_plan_key?: string | null
          previous_status?:
            | Database["public"]["Enums"]["commercial_status"]
            | null
        }
        Update: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          entitlement_source?: Database["public"]["Enums"]["entitlement_source"]
          id?: string
          new_plan_key?: string
          new_status?: Database["public"]["Enums"]["commercial_status"]
          organization_id?: string
          previous_plan_key?: string | null
          previous_status?:
            | Database["public"]["Enums"]["commercial_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_plan_changes_new_plan_key_fkey"
            columns: ["new_plan_key"]
            referencedRelation: "commercial_plans"
            referencedColumns: ["plan_key"]
          },
          {
            foreignKeyName: "commercial_plan_changes_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_plan_changes_previous_plan_key_fkey"
            columns: ["previous_plan_key"]
            referencedRelation: "commercial_plans"
            referencedColumns: ["plan_key"]
          },
        ]
      }
      commercial_plans: {
        Row: {
          commercial_family: Database["public"]["Enums"]["commercial_family"]
          created_at: string
          display_name: string
          is_available: boolean
          is_recommended: boolean
          max_establishments: number
          max_operational_professionals: number | null
          plan_key: string
          price_currency: string
          price_minor: number
          tier: number
          updated_at: string
        }
        Insert: {
          commercial_family: Database["public"]["Enums"]["commercial_family"]
          created_at?: string
          display_name: string
          is_available?: boolean
          is_recommended?: boolean
          max_establishments: number
          max_operational_professionals?: number | null
          plan_key: string
          price_currency?: string
          price_minor: number
          tier: number
          updated_at?: string
        }
        Update: {
          commercial_family?: Database["public"]["Enums"]["commercial_family"]
          created_at?: string
          display_name?: string
          is_available?: boolean
          is_recommended?: boolean
          max_establishments?: number
          max_operational_professionals?: number | null
          plan_key?: string
          price_currency?: string
          price_minor?: number
          tier?: number
          updated_at?: string
        }
        Relationships: []
      }
      customer_favorites: {
        Row: {
          barber_id: string | null
          created_at: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          barber_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          barber_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_favorites_barber_id_fkey"
            columns: ["barber_id"]
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_favorites_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_memberships: {
        Row: {
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          current_period_end: string
          current_period_start: string
          customer_id: string
          id: string
          notes: string | null
          organization_id: string
          plan_id: string
          started_at: string
          status: Database["public"]["Enums"]["customer_membership_status"]
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          current_period_end: string
          current_period_start?: string
          customer_id: string
          id?: string
          notes?: string | null
          organization_id: string
          plan_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["customer_membership_status"]
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          current_period_end?: string
          current_period_start?: string
          customer_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          plan_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["customer_membership_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_memberships_customer_id_fkey"
            columns: ["customer_id"]
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_memberships_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_memberships_plan_id_fkey"
            columns: ["plan_id"]
            referencedRelation: "membership_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_passport_photos: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          storage_path: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          storage_path: string
          user_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_passport_shares: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          label: string | null
          last_accessed_at: string | null
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          label?: string | null
          last_accessed_at?: string | null
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          label?: string | null
          last_accessed_at?: string | null
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_passports: {
        Row: {
          beard_preferences: string | null
          created_at: string
          fade_type: string | null
          id: string
          issued_at: string
          passport_number: string
          preferences_notes: string | null
          side_length: string | null
          top_length: string | null
          updated_at: string
          user_id: string
          usual_haircut: string | null
        }
        Insert: {
          beard_preferences?: string | null
          created_at?: string
          fade_type?: string | null
          id?: string
          issued_at: string
          passport_number: string
          preferences_notes?: string | null
          side_length?: string | null
          top_length?: string | null
          updated_at?: string
          user_id: string
          usual_haircut?: string | null
        }
        Update: {
          beard_preferences?: string | null
          created_at?: string
          fade_type?: string | null
          id?: string
          issued_at?: string
          passport_number?: string
          preferences_notes?: string | null
          side_length?: string | null
          top_length?: string | null
          updated_at?: string
          user_id?: string
          usual_haircut?: string | null
        }
        Relationships: []
      }
      customer_professional_relationships: {
        Row: {
          completed_interaction_count: number
          created_at: string
          customer_user_id: string
          first_completed_at: string
          id: string
          last_completed_at: string
          organization_id: string
          professional_id: string
          updated_at: string
        }
        Insert: {
          completed_interaction_count?: number
          created_at?: string
          customer_user_id: string
          first_completed_at: string
          id?: string
          last_completed_at: string
          organization_id: string
          professional_id: string
          updated_at?: string
        }
        Update: {
          completed_interaction_count?: number
          created_at?: string
          customer_user_id?: string
          first_completed_at?: string
          id?: string
          last_completed_at?: string
          organization_id?: string
          professional_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_professional_relationships_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_professional_relationships_professional_id_fkey"
            columns: ["professional_id"]
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_profiles: {
        Row: {
          appointment_preference:
            | Database["public"]["Enums"]["customer_appointment_preference"]
            | null
          created_at: string
          display_name: string | null
          email: string | null
          haircut_frequency:
            | Database["public"]["Enums"]["customer_haircut_frequency"]
            | null
          id: string
          onboarding_completed_at: string | null
          phone: string | null
          style_notes: string | null
          style_preference:
            | Database["public"]["Enums"]["customer_style_preference"]
            | null
          updated_at: string
          user_id: string
        }
        Insert: {
          appointment_preference?:
            | Database["public"]["Enums"]["customer_appointment_preference"]
            | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          haircut_frequency?:
            | Database["public"]["Enums"]["customer_haircut_frequency"]
            | null
          id?: string
          onboarding_completed_at?: string | null
          phone?: string | null
          style_notes?: string | null
          style_preference?:
            | Database["public"]["Enums"]["customer_style_preference"]
            | null
          updated_at?: string
          user_id: string
        }
        Update: {
          appointment_preference?:
            | Database["public"]["Enums"]["customer_appointment_preference"]
            | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          haircut_frequency?:
            | Database["public"]["Enums"]["customer_haircut_frequency"]
            | null
          id?: string
          onboarding_completed_at?: string | null
          phone?: string | null
          style_notes?: string | null
          style_preference?:
            | Database["public"]["Enums"]["customer_style_preference"]
            | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string | null
          dispatched_at: string | null
          id: string
          last_error: string | null
          locale: string
          locked_at: string | null
          net_request_id: number | null
          next_attempt_at: string
          payload: Json
          provider_message_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["email_delivery_status"]
          stream: Database["public"]["Enums"]["email_stream"]
          template: string
          to_email: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          dispatched_at?: string | null
          id?: string
          last_error?: string | null
          locale?: string
          locked_at?: string | null
          net_request_id?: number | null
          next_attempt_at?: string
          payload?: Json
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_delivery_status"]
          stream?: Database["public"]["Enums"]["email_stream"]
          template: string
          to_email: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          dispatched_at?: string | null
          id?: string
          last_error?: string | null
          locale?: string
          locked_at?: string | null
          net_request_id?: number | null
          next_attempt_at?: string
          payload?: Json
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_delivery_status"]
          stream?: Database["public"]["Enums"]["email_stream"]
          template?: string
          to_email?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_streams: {
        Row: {
          created_at: string
          from_address: string
          from_name: string
          is_enabled: boolean
          reply_to: string | null
          requires_unsubscribe: boolean
          stream: Database["public"]["Enums"]["email_stream"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_address: string
          from_name?: string
          is_enabled?: boolean
          reply_to?: string | null
          requires_unsubscribe?: boolean
          stream: Database["public"]["Enums"]["email_stream"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_address?: string
          from_name?: string
          is_enabled?: boolean
          reply_to?: string | null
          requires_unsubscribe?: boolean
          stream?: Database["public"]["Enums"]["email_stream"]
          updated_at?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body_html: string
          body_text: string
          created_at: string
          locale: string
          stream: Database["public"]["Enums"]["email_stream"]
          subject: string
          template_key: string
          updated_at: string
        }
        Insert: {
          body_html: string
          body_text: string
          created_at?: string
          locale: string
          stream: Database["public"]["Enums"]["email_stream"]
          subject: string
          template_key: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          body_text?: string
          created_at?: string
          locale?: string
          stream?: Database["public"]["Enums"]["email_stream"]
          subject?: string
          template_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_stream_fkey"
            columns: ["stream"]
            referencedRelation: "email_streams"
            referencedColumns: ["stream"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          location_id: string | null
          organization_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["membership_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          location_id?: string | null
          organization_id: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["membership_role"]
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          location_id?: string | null
          organization_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_hours: {
        Row: {
          close_time: string | null
          created_at: string
          day_of_week: number
          id: string
          is_closed: boolean
          location_id: string
          open_time: string | null
          organization_id: string
          second_close_time: string | null
          second_open_time: string | null
          updated_at: string
        }
        Insert: {
          close_time?: string | null
          created_at?: string
          day_of_week: number
          id?: string
          is_closed?: boolean
          location_id: string
          open_time?: string | null
          organization_id: string
          second_close_time?: string | null
          second_open_time?: string | null
          updated_at?: string
        }
        Update: {
          close_time?: string | null
          created_at?: string
          day_of_week?: number
          id?: string
          is_closed?: boolean
          location_id?: string
          open_time?: string | null
          organization_id?: string
          second_close_time?: string | null
          second_open_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_hours_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_hours_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_service_settings: {
        Row: {
          created_at: string
          default_service_mode: Database["public"]["Enums"]["service_mode"]
          location_id: string
          organization_id: string
          queue_call_grace_minutes: number
          queue_capacity_per_barber: number
          queue_geofence_meters: number
          queue_open: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_service_mode?: Database["public"]["Enums"]["service_mode"]
          location_id: string
          organization_id: string
          queue_call_grace_minutes?: number
          queue_capacity_per_barber?: number
          queue_geofence_meters?: number
          queue_open?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_service_mode?: Database["public"]["Enums"]["service_mode"]
          location_id?: string
          organization_id?: string
          queue_call_grace_minutes?: number
          queue_capacity_per_barber?: number
          queue_geofence_meters?: number
          queue_open?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_service_settings_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_service_settings_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          country: string | null
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["location_kind"]
          latitude: number | null
          longitude: number | null
          name: string
          organization_id: string
          postal_code: string | null
          queue_check_in_token: string
          region: string | null
          service_area_center_latitude: number | null
          service_area_center_longitude: number | null
          service_area_radius_km: number | null
          timezone: string
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["location_kind"]
          latitude?: number | null
          longitude?: number | null
          name: string
          organization_id: string
          postal_code?: string | null
          queue_check_in_token?: string
          region?: string | null
          service_area_center_latitude?: number | null
          service_area_center_longitude?: number | null
          service_area_radius_km?: number | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["location_kind"]
          latitude?: number | null
          longitude?: number | null
          name?: string
          organization_id?: string
          postal_code?: string | null
          queue_check_in_token?: string
          region?: string | null
          service_area_center_latitude?: number | null
          service_area_center_longitude?: number | null
          service_area_radius_km?: number | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_withdrawal_requests: {
        Row: {
          created_at: string
          deadline_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          professional_id: string
          requested_at: string
          requested_via: string
          requester_note: string | null
          status: Database["public"]["Enums"]["marketplace_withdrawal_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deadline_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          professional_id: string
          requested_at?: string
          requested_via: string
          requester_note?: string | null
          status?: Database["public"]["Enums"]["marketplace_withdrawal_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deadline_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          professional_id?: string
          requested_at?: string
          requested_via?: string
          requester_note?: string | null
          status?: Database["public"]["Enums"]["marketplace_withdrawal_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_withdrawal_requests_professional_id_fkey"
            columns: ["professional_id"]
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_plans: {
        Row: {
          billing_interval: Database["public"]["Enums"]["billing_interval"]
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          price_cents: number
          updated_at: string
        }
        Insert: {
          billing_interval?: Database["public"]["Enums"]["billing_interval"]
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          price_cents: number
          updated_at?: string
        }
        Update: {
          billing_interval?: Database["public"]["Enums"]["billing_interval"]
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_plans_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["membership_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["membership_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_datasets: {
        Row: {
          created_at: string
          feature_coverage: Json
          feature_schema_version: string
          id: string
          label_distribution: Json
          negative_count: number
          positive_count: number
          random_seed: number
          row_count: number
          snapshot_from: string | null
          snapshot_to: string
          target: Database["public"]["Enums"]["ml_model_target"]
          version: string
        }
        Insert: {
          created_at?: string
          feature_coverage?: Json
          feature_schema_version: string
          id?: string
          label_distribution?: Json
          negative_count?: number
          positive_count?: number
          random_seed?: number
          row_count?: number
          snapshot_from?: string | null
          snapshot_to: string
          target: Database["public"]["Enums"]["ml_model_target"]
          version: string
        }
        Update: {
          created_at?: string
          feature_coverage?: Json
          feature_schema_version?: string
          id?: string
          label_distribution?: Json
          negative_count?: number
          positive_count?: number
          random_seed?: number
          row_count?: number
          snapshot_from?: string | null
          snapshot_to?: string
          target?: Database["public"]["Enums"]["ml_model_target"]
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_datasets_feature_schema_version_fkey"
            columns: ["feature_schema_version"]
            referencedRelation: "ml_feature_schemas"
            referencedColumns: ["version"]
          },
        ]
      }
      ml_feature_schemas: {
        Row: {
          created_at: string
          features: Json
          forbidden_features: string[]
          id: string
          notes: string | null
          version: string
        }
        Insert: {
          created_at?: string
          features?: Json
          forbidden_features?: string[]
          id?: string
          notes?: string | null
          version: string
        }
        Update: {
          created_at?: string
          features?: Json
          forbidden_features?: string[]
          id?: string
          notes?: string | null
          version?: string
        }
        Relationships: []
      }
      ml_metrics: {
        Row: {
          computed_at: string
          created_at: string
          id: string
          metric_key: string
          metric_value: number
          model_version_id: string
          split: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          id?: string
          metric_key: string
          metric_value: number
          model_version_id: string
          split?: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          id?: string
          metric_key?: string
          metric_value?: number
          model_version_id?: string
          split?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_metrics_model_version_id_fkey"
            columns: ["model_version_id"]
            referencedRelation: "ml_model_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_model_versions: {
        Row: {
          artifact_path: string | null
          artifact_sha256: string | null
          created_at: string
          evaluation_notes: string | null
          feature_schema_version: string
          hyperparameters: Json
          id: string
          is_active: boolean
          metrics: Json
          model_key: string
          model_type: string
          model_version: string
          promoted_at: string | null
          promoted_by: string | null
          random_seed: number
          retired_at: string | null
          target: Database["public"]["Enums"]["ml_model_target"]
          training_dataset_version: string | null
        }
        Insert: {
          artifact_path?: string | null
          artifact_sha256?: string | null
          created_at?: string
          evaluation_notes?: string | null
          feature_schema_version: string
          hyperparameters?: Json
          id?: string
          is_active?: boolean
          metrics?: Json
          model_key: string
          model_type: string
          model_version: string
          promoted_at?: string | null
          promoted_by?: string | null
          random_seed?: number
          retired_at?: string | null
          target: Database["public"]["Enums"]["ml_model_target"]
          training_dataset_version?: string | null
        }
        Update: {
          artifact_path?: string | null
          artifact_sha256?: string | null
          created_at?: string
          evaluation_notes?: string | null
          feature_schema_version?: string
          hyperparameters?: Json
          id?: string
          is_active?: boolean
          metrics?: Json
          model_key?: string
          model_type?: string
          model_version?: string
          promoted_at?: string | null
          promoted_by?: string | null
          random_seed?: number
          retired_at?: string | null
          target?: Database["public"]["Enums"]["ml_model_target"]
          training_dataset_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_model_versions_feature_schema_version_fkey"
            columns: ["feature_schema_version"]
            referencedRelation: "ml_feature_schemas"
            referencedColumns: ["version"]
          },
          {
            foreignKeyName: "ml_model_versions_training_dataset_version_fkey"
            columns: ["training_dataset_version"]
            referencedRelation: "ml_datasets"
            referencedColumns: ["version"]
          },
        ]
      }
      ml_predictions: {
        Row: {
          campaign_id: string | null
          created_at: string
          feature_schema_version: string | null
          features_snapshot: Json
          id: string
          is_fallback: boolean
          model_version_id: string | null
          predicted_at: string
          predicted_probability: number
          prospect_id: string
          selected: boolean
          target: Database["public"]["Enums"]["ml_model_target"]
          template_id: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          feature_schema_version?: string | null
          features_snapshot?: Json
          id?: string
          is_fallback?: boolean
          model_version_id?: string | null
          predicted_at?: string
          predicted_probability: number
          prospect_id: string
          selected?: boolean
          target: Database["public"]["Enums"]["ml_model_target"]
          template_id: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          feature_schema_version?: string | null
          features_snapshot?: Json
          id?: string
          is_fallback?: boolean
          model_version_id?: string | null
          predicted_at?: string
          predicted_probability?: number
          prospect_id?: string
          selected?: boolean
          target?: Database["public"]["Enums"]["ml_model_target"]
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_predictions_campaign_id_fkey"
            columns: ["campaign_id"]
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_predictions_campaign_id_fkey"
            columns: ["campaign_id"]
            referencedRelation: "outreach_funnel_stats"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "ml_predictions_model_version_id_fkey"
            columns: ["model_version_id"]
            referencedRelation: "ml_model_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_predictions_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "ml_predictions_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_predictions_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "outreach_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_predictions_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "template_performance"
            referencedColumns: ["template_id"]
          },
        ]
      }
      ml_training_runs: {
        Row: {
          baseline_metrics: Json
          created_at: string
          dataset_version: string | null
          finished_at: string | null
          id: string
          leakage_check_passed: boolean | null
          log_excerpt: string | null
          model_version_id: string | null
          skip_reason: string | null
          started_at: string
          status: string
          train_metrics: Json
          train_rows: number | null
          validation_metrics: Json
          validation_rows: number | null
        }
        Insert: {
          baseline_metrics?: Json
          created_at?: string
          dataset_version?: string | null
          finished_at?: string | null
          id?: string
          leakage_check_passed?: boolean | null
          log_excerpt?: string | null
          model_version_id?: string | null
          skip_reason?: string | null
          started_at?: string
          status?: string
          train_metrics?: Json
          train_rows?: number | null
          validation_metrics?: Json
          validation_rows?: number | null
        }
        Update: {
          baseline_metrics?: Json
          created_at?: string
          dataset_version?: string | null
          finished_at?: string | null
          id?: string
          leakage_check_passed?: boolean | null
          log_excerpt?: string | null
          model_version_id?: string | null
          skip_reason?: string | null
          started_at?: string
          status?: string
          train_metrics?: Json
          train_rows?: number | null
          validation_metrics?: Json
          validation_rows?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_training_runs_dataset_version_fkey"
            columns: ["dataset_version"]
            referencedRelation: "ml_datasets"
            referencedColumns: ["version"]
          },
          {
            foreignKeyName: "ml_training_runs_model_version_id_fkey"
            columns: ["model_version_id"]
            referencedRelation: "ml_model_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          appointment_id: string | null
          body: string | null
          created_at: string
          dedupe_key: string
          id: string
          organization_id: string | null
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          appointment_id?: string | null
          body?: string | null
          created_at?: string
          dedupe_key: string
          id?: string
          organization_id?: string | null
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          appointment_id?: string | null
          body?: string | null
          created_at?: string
          dedupe_key?: string
          id?: string
          organization_id?: string | null
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_appointment_id_fkey"
            columns: ["appointment_id"]
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_commercial_state: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          assignment_note: string | null
          created_at: string
          entitlement_source: Database["public"]["Enums"]["entitlement_source"]
          organization_id: string
          plan_key: string
          provider: string | null
          provider_customer_ref: string | null
          provider_subscription_ref: string | null
          status: Database["public"]["Enums"]["commercial_status"]
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          assignment_note?: string | null
          created_at?: string
          entitlement_source?: Database["public"]["Enums"]["entitlement_source"]
          organization_id: string
          plan_key?: string
          provider?: string | null
          provider_customer_ref?: string | null
          provider_subscription_ref?: string | null
          status?: Database["public"]["Enums"]["commercial_status"]
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          assignment_note?: string | null
          created_at?: string
          entitlement_source?: Database["public"]["Enums"]["entitlement_source"]
          organization_id?: string
          plan_key?: string
          provider?: string | null
          provider_customer_ref?: string | null
          provider_subscription_ref?: string | null
          status?: Database["public"]["Enums"]["commercial_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_commercial_state_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_commercial_state_plan_key_fkey"
            columns: ["plan_key"]
            referencedRelation: "commercial_plans"
            referencedColumns: ["plan_key"]
          },
        ]
      }
      organization_dashboard_layouts: {
        Row: {
          module_order: string[]
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          module_order: string[]
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          module_order?: string[]
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_dashboard_layouts_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_follows: {
        Row: {
          created_at: string
          followed_at: string | null
          follower_user_id: string
          is_following: boolean
          organization_id: string
          unfollowed_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          followed_at?: string | null
          follower_user_id: string
          is_following?: boolean
          organization_id: string
          unfollowed_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          followed_at?: string | null
          follower_user_id?: string
          is_following?: boolean
          organization_id?: string
          unfollowed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_follows_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          booking_request_ttl_minutes: number
          business_type: Database["public"]["Enums"]["business_type"] | null
          country_code: string | null
          created_at: string
          currency: string | null
          id: string
          marketplace_visible: boolean
          name: string
          onboarding_completed_at: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          booking_request_ttl_minutes?: number
          business_type?: Database["public"]["Enums"]["business_type"] | null
          country_code?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          marketplace_visible?: boolean
          name: string
          onboarding_completed_at?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          booking_request_ttl_minutes?: number
          business_type?: Database["public"]["Enums"]["business_type"] | null
          country_code?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          marketplace_visible?: boolean
          name?: string
          onboarding_completed_at?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      outreach_assignments: {
        Row: {
          arm_id: string
          assigned_at: string
          assignment_hash: string
          created_at: string
          experiment_id: string
          id: string
          prospect_id: string
          recipient_id: string | null
        }
        Insert: {
          arm_id: string
          assigned_at?: string
          assignment_hash: string
          created_at?: string
          experiment_id: string
          id?: string
          prospect_id: string
          recipient_id?: string | null
        }
        Update: {
          arm_id?: string
          assigned_at?: string
          assignment_hash?: string
          created_at?: string
          experiment_id?: string
          id?: string
          prospect_id?: string
          recipient_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_assignments_arm_id_fkey"
            columns: ["arm_id"]
            referencedRelation: "experiment_results"
            referencedColumns: ["arm_id"]
          },
          {
            foreignKeyName: "outreach_assignments_arm_id_fkey"
            columns: ["arm_id"]
            referencedRelation: "outreach_experiment_arms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_assignments_experiment_id_fkey"
            columns: ["experiment_id"]
            referencedRelation: "experiment_results"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "outreach_assignments_experiment_id_fkey"
            columns: ["experiment_id"]
            referencedRelation: "outreach_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_assignments_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "outreach_assignments_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_assignments_recipient_id_fkey"
            columns: ["recipient_id"]
            referencedRelation: "outreach_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_campaigns: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          channel: Database["public"]["Enums"]["outreach_channel_kind"]
          completed_at: string | null
          created_at: string
          created_by: string | null
          experiment_id: string | null
          id: string
          max_sends_per_hour: number
          name: string
          selection_filters: Json
          started_at: string | null
          status: Database["public"]["Enums"]["outreach_campaign_status"]
          updated_at: string
          whatsapp_account_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          channel?: Database["public"]["Enums"]["outreach_channel_kind"]
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          experiment_id?: string | null
          id?: string
          max_sends_per_hour?: number
          name: string
          selection_filters?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["outreach_campaign_status"]
          updated_at?: string
          whatsapp_account_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          channel?: Database["public"]["Enums"]["outreach_channel_kind"]
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          experiment_id?: string | null
          id?: string
          max_sends_per_hour?: number
          name?: string
          selection_filters?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["outreach_campaign_status"]
          updated_at?: string
          whatsapp_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_campaigns_experiment_fkey"
            columns: ["experiment_id"]
            referencedRelation: "experiment_results"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "outreach_campaigns_experiment_fkey"
            columns: ["experiment_id"]
            referencedRelation: "outreach_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_campaigns_whatsapp_account_fkey"
            columns: ["whatsapp_account_id"]
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_channel_policies: {
        Row: {
          channel: Database["public"]["Enums"]["outreach_channel_kind"]
          country: string
          created_at: string
          id: string
          policy_notes: string | null
          requires_explicit_opt_in: boolean
          set_by: string | null
          updated_at: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["outreach_channel_kind"]
          country: string
          created_at?: string
          id?: string
          policy_notes?: string | null
          requires_explicit_opt_in?: boolean
          set_by?: string | null
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["outreach_channel_kind"]
          country?: string
          created_at?: string
          id?: string
          policy_notes?: string | null
          requires_explicit_opt_in?: boolean
          set_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      outreach_events: {
        Row: {
          classified_by: string | null
          created_at: string
          event_type: Database["public"]["Enums"]["outreach_event_type"]
          id: string
          metadata: Json
          occurred_at: string
          prospect_id: string
          provider_event_id: string | null
          recipient_id: string
        }
        Insert: {
          classified_by?: string | null
          created_at?: string
          event_type: Database["public"]["Enums"]["outreach_event_type"]
          id?: string
          metadata?: Json
          occurred_at?: string
          prospect_id: string
          provider_event_id?: string | null
          recipient_id: string
        }
        Update: {
          classified_by?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["outreach_event_type"]
          id?: string
          metadata?: Json
          occurred_at?: string
          prospect_id?: string
          provider_event_id?: string | null
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_events_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "outreach_events_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_events_recipient_id_fkey"
            columns: ["recipient_id"]
            referencedRelation: "outreach_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_experiment_arms: {
        Row: {
          arm_key: string
          created_at: string
          experiment_id: string
          id: string
          is_control: boolean
          template_id: string
          weight: number
        }
        Insert: {
          arm_key: string
          created_at?: string
          experiment_id: string
          id?: string
          is_control?: boolean
          template_id: string
          weight?: number
        }
        Update: {
          arm_key?: string
          created_at?: string
          experiment_id?: string
          id?: string
          is_control?: boolean
          template_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_experiment_arms_experiment_id_fkey"
            columns: ["experiment_id"]
            referencedRelation: "experiment_results"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "outreach_experiment_arms_experiment_id_fkey"
            columns: ["experiment_id"]
            referencedRelation: "outreach_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_experiment_arms_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "outreach_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_experiment_arms_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "template_performance"
            referencedColumns: ["template_id"]
          },
        ]
      }
      outreach_experiments: {
        Row: {
          assignment_seed: string
          cohort_booking_provider_id: string | null
          cohort_country: string | null
          cohort_locale: string | null
          cohort_segment_key: string | null
          completed_at: string | null
          cooldown_days: number
          created_at: string
          created_by: string | null
          exploration_pct: number
          hypothesis: string | null
          id: string
          key: string
          max_experiments_per_prospect: number
          min_sample_per_arm: number
          name: string
          primary_metric: Database["public"]["Enums"]["ml_model_target"]
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assignment_seed?: string
          cohort_booking_provider_id?: string | null
          cohort_country?: string | null
          cohort_locale?: string | null
          cohort_segment_key?: string | null
          completed_at?: string | null
          cooldown_days?: number
          created_at?: string
          created_by?: string | null
          exploration_pct?: number
          hypothesis?: string | null
          id?: string
          key: string
          max_experiments_per_prospect?: number
          min_sample_per_arm?: number
          name: string
          primary_metric?: Database["public"]["Enums"]["ml_model_target"]
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assignment_seed?: string
          cohort_booking_provider_id?: string | null
          cohort_country?: string | null
          cohort_locale?: string | null
          cohort_segment_key?: string | null
          completed_at?: string | null
          cooldown_days?: number
          created_at?: string
          created_by?: string | null
          exploration_pct?: number
          hypothesis?: string | null
          id?: string
          key?: string
          max_experiments_per_prospect?: number
          min_sample_per_arm?: number
          name?: string
          primary_metric?: Database["public"]["Enums"]["ml_model_target"]
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_experiments_cohort_booking_provider_id_fkey"
            columns: ["cohort_booking_provider_id"]
            referencedRelation: "booking_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_experiments_cohort_booking_provider_id_fkey"
            columns: ["cohort_booking_provider_id"]
            referencedRelation: "competitor_analytics"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "outreach_experiments_cohort_segment_key_fkey"
            columns: ["cohort_segment_key"]
            referencedRelation: "prospect_segment_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
      outreach_recipients: {
        Row: {
          attempts: number
          blocked_reason: string | null
          campaign_id: string
          converted_at: string | null
          created_at: string
          delivered_at: string | null
          destination: string | null
          experiment_arm: string | null
          experiment_id: string | null
          id: string
          last_error: string | null
          locale: string | null
          ml_prediction_id: string | null
          prospect_id: string
          queued_at: string | null
          read_at: string | null
          rendered_body: string | null
          rendered_variables: Json
          replied_at: string | null
          sales_angle: string | null
          selection_method: string | null
          selection_reason: Json
          sent_at: string | null
          state: Database["public"]["Enums"]["outreach_recipient_state"]
          template_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          blocked_reason?: string | null
          campaign_id: string
          converted_at?: string | null
          created_at?: string
          delivered_at?: string | null
          destination?: string | null
          experiment_arm?: string | null
          experiment_id?: string | null
          id?: string
          last_error?: string | null
          locale?: string | null
          ml_prediction_id?: string | null
          prospect_id: string
          queued_at?: string | null
          read_at?: string | null
          rendered_body?: string | null
          rendered_variables?: Json
          replied_at?: string | null
          sales_angle?: string | null
          selection_method?: string | null
          selection_reason?: Json
          sent_at?: string | null
          state?: Database["public"]["Enums"]["outreach_recipient_state"]
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          blocked_reason?: string | null
          campaign_id?: string
          converted_at?: string | null
          created_at?: string
          delivered_at?: string | null
          destination?: string | null
          experiment_arm?: string | null
          experiment_id?: string | null
          id?: string
          last_error?: string | null
          locale?: string | null
          ml_prediction_id?: string | null
          prospect_id?: string
          queued_at?: string | null
          read_at?: string | null
          rendered_body?: string | null
          rendered_variables?: Json
          replied_at?: string | null
          sales_angle?: string | null
          selection_method?: string | null
          selection_reason?: Json
          sent_at?: string | null
          state?: Database["public"]["Enums"]["outreach_recipient_state"]
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            referencedRelation: "outreach_funnel_stats"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "outreach_recipients_experiment_fkey"
            columns: ["experiment_id"]
            referencedRelation: "experiment_results"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "outreach_recipients_experiment_fkey"
            columns: ["experiment_id"]
            referencedRelation: "outreach_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_recipients_ml_prediction_fkey"
            columns: ["ml_prediction_id"]
            referencedRelation: "ml_predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_recipients_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "outreach_recipients_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_recipients_sales_angle_fkey"
            columns: ["sales_angle"]
            referencedRelation: "outreach_sales_angles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "outreach_recipients_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "outreach_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_recipients_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "template_performance"
            referencedColumns: ["template_id"]
          },
        ]
      }
      outreach_sales_angles: {
        Row: {
          created_at: string
          description: string
          display_name: string
          is_active: boolean
          key: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description: string
          display_name: string
          is_active?: boolean
          key: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string
          display_name?: string
          is_active?: boolean
          key?: string
          sort_order?: number
        }
        Relationships: []
      }
      outreach_templates: {
        Row: {
          allowed_variables: string[]
          approved_at: string | null
          approved_by: string | null
          body: string
          booking_provider_id: string | null
          channel: Database["public"]["Enums"]["outreach_channel_kind"]
          created_at: string
          created_by: string | null
          id: string
          key: string
          locale: string
          name: string
          notes: string | null
          sales_angle: string | null
          segment_key: string | null
          status: Database["public"]["Enums"]["outreach_template_status"]
          updated_at: string
          version: number
        }
        Insert: {
          allowed_variables?: string[]
          approved_at?: string | null
          approved_by?: string | null
          body: string
          booking_provider_id?: string | null
          channel?: Database["public"]["Enums"]["outreach_channel_kind"]
          created_at?: string
          created_by?: string | null
          id?: string
          key: string
          locale: string
          name: string
          notes?: string | null
          sales_angle?: string | null
          segment_key?: string | null
          status?: Database["public"]["Enums"]["outreach_template_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          allowed_variables?: string[]
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          booking_provider_id?: string | null
          channel?: Database["public"]["Enums"]["outreach_channel_kind"]
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string
          locale?: string
          name?: string
          notes?: string | null
          sales_angle?: string | null
          segment_key?: string | null
          status?: Database["public"]["Enums"]["outreach_template_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_templates_booking_provider_id_fkey"
            columns: ["booking_provider_id"]
            referencedRelation: "booking_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_templates_booking_provider_id_fkey"
            columns: ["booking_provider_id"]
            referencedRelation: "competitor_analytics"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "outreach_templates_sales_angle_fkey"
            columns: ["sales_angle"]
            referencedRelation: "outreach_sales_angles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "outreach_templates_segment_key_fkey"
            columns: ["segment_key"]
            referencedRelation: "prospect_segment_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
      plan_capabilities: {
        Row: {
          capability_key: string
          created_at: string
          plan_key: string
        }
        Insert: {
          capability_key: string
          created_at?: string
          plan_key: string
        }
        Update: {
          capability_key?: string
          created_at?: string
          plan_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_capabilities_capability_key_fkey"
            columns: ["capability_key"]
            referencedRelation: "commercial_capabilities"
            referencedColumns: ["capability_key"]
          },
          {
            foreignKeyName: "plan_capabilities_plan_key_fkey"
            columns: ["plan_key"]
            referencedRelation: "commercial_plans"
            referencedColumns: ["plan_key"]
          },
        ]
      }
      platform_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      platform_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          expires_at: string
          id: string
          invited_by: string
          invited_email: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["platform_role"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at: string
          id?: string
          invited_by: string
          invited_email?: string | null
          revoked_at?: string | null
          role: Database["public"]["Enums"]["platform_role"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invited_by?: string
          invited_email?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["platform_role"]
          token_hash?: string
        }
        Relationships: []
      }
      platform_members: {
        Row: {
          created_at: string
          note: string | null
          role: Database["public"]["Enums"]["platform_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          role: Database["public"]["Enums"]["platform_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          role?: Database["public"]["Enums"]["platform_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          recipient_user_id: string
          target_id: string | null
          target_type: string | null
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_user_id: string
          target_id?: string | null
          target_type?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_user_id?: string
          target_id?: string | null
          target_type?: string | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      platform_owner_bootstrap_tokens: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          expires_at: string
          id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          expires_at: string
          id?: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: []
      }
      platform_support_sessions: {
        Row: {
          ended_at: string | null
          id: string
          organization_id: string
          platform_actor_id: string
          reason: string | null
          started_at: string
          target_type: string
          target_user_id: string | null
        }
        Insert: {
          ended_at?: string | null
          id?: string
          organization_id: string
          platform_actor_id: string
          reason?: string | null
          started_at?: string
          target_type: string
          target_user_id?: string | null
        }
        Update: {
          ended_at?: string | null
          id?: string
          organization_id?: string
          platform_actor_id?: string
          reason?: string | null
          started_at?: string
          target_type?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_support_sessions_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_applications: {
        Row: {
          address_line1: string | null
          business_identifier: string | null
          business_name: string
          city: string | null
          country: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          instagram: string | null
          internal_note: string | null
          last_name: string
          organization_id: string | null
          phone: string
          postal_code: string | null
          professional_type: Database["public"]["Enums"]["professional_type"]
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          staff_count: number | null
          status: Database["public"]["Enums"]["professional_application_status"]
          submitted_at: string
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          business_identifier?: string | null
          business_name: string
          city?: string | null
          country?: string | null
          created_at?: string
          email: string
          first_name: string
          id?: string
          instagram?: string | null
          internal_note?: string | null
          last_name: string
          organization_id?: string | null
          phone: string
          postal_code?: string | null
          professional_type: Database["public"]["Enums"]["professional_type"]
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_count?: number | null
          status?: Database["public"]["Enums"]["professional_application_status"]
          submitted_at?: string
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          business_identifier?: string | null
          business_name?: string
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          instagram?: string | null
          internal_note?: string | null
          last_name?: string
          organization_id?: string | null
          phone?: string
          postal_code?: string | null
          professional_type?: Database["public"]["Enums"]["professional_type"]
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_count?: number | null
          status?: Database["public"]["Enums"]["professional_application_status"]
          submitted_at?: string
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_applications_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_claims: {
        Row: {
          claimant_user_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          evidence: string | null
          id: string
          professional_id: string
          state: Database["public"]["Enums"]["professional_claim_status"]
          submitted_at: string
          updated_at: string
        }
        Insert: {
          claimant_user_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          evidence?: string | null
          id?: string
          professional_id: string
          state?: Database["public"]["Enums"]["professional_claim_status"]
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          claimant_user_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          evidence?: string | null
          id?: string
          professional_id?: string
          state?: Database["public"]["Enums"]["professional_claim_status"]
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_claims_professional_id_fkey"
            columns: ["professional_id"]
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_follows: {
        Row: {
          created_at: string
          followed_at: string | null
          follower_user_id: string
          id: string
          professional_id: string
          source: Database["public"]["Enums"]["follow_source"]
          state: Database["public"]["Enums"]["follow_state"]
          unfollowed_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          followed_at?: string | null
          follower_user_id: string
          id?: string
          professional_id: string
          source?: Database["public"]["Enums"]["follow_source"]
          state?: Database["public"]["Enums"]["follow_state"]
          unfollowed_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          followed_at?: string | null
          follower_user_id?: string
          id?: string
          professional_id?: string
          source?: Database["public"]["Enums"]["follow_source"]
          state?: Database["public"]["Enums"]["follow_state"]
          unfollowed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_follows_professional_id_fkey"
            columns: ["professional_id"]
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_interest_request_contacts: {
        Row: {
          booked_by_user_id: string | null
          created_at: string
          customer_email: string | null
          customer_phone: string | null
          request_id: string
          updated_at: string
        }
        Insert: {
          booked_by_user_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_phone?: string | null
          request_id: string
          updated_at?: string
        }
        Update: {
          booked_by_user_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_phone?: string | null
          request_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_interest_request_contacts_request_id_fkey"
            columns: ["request_id"]
            referencedRelation: "professional_interest_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_interest_requests: {
        Row: {
          created_at: string
          customer_display_name: string
          expires_at: string
          id: string
          locale: string
          notes: string | null
          preferred_starts_at: string
          professional_id: string
          resolved_at: string | null
          service_label: string
          status: Database["public"]["Enums"]["interest_request_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_display_name: string
          expires_at: string
          id?: string
          locale?: string
          notes?: string | null
          preferred_starts_at: string
          professional_id: string
          resolved_at?: string | null
          service_label: string
          status?: Database["public"]["Enums"]["interest_request_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_display_name?: string
          expires_at?: string
          id?: string
          locale?: string
          notes?: string | null
          preferred_starts_at?: string
          professional_id?: string
          resolved_at?: string | null
          service_label?: string
          status?: Database["public"]["Enums"]["interest_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_interest_requests_professional_id_fkey"
            columns: ["professional_id"]
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professionals: {
        Row: {
          avatar_url: string | null
          bio: string | null
          claim_state: Database["public"]["Enums"]["professional_claim_state"]
          claimed_at: string | null
          created_at: string
          display_name: string
          handle: string | null
          headline: string | null
          id: string
          is_public: boolean
          source: Database["public"]["Enums"]["professional_source"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          claim_state?: Database["public"]["Enums"]["professional_claim_state"]
          claimed_at?: string | null
          created_at?: string
          display_name: string
          handle?: string | null
          headline?: string | null
          id?: string
          is_public?: boolean
          source?: Database["public"]["Enums"]["professional_source"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          claim_state?: Database["public"]["Enums"]["professional_claim_state"]
          claimed_at?: string | null
          created_at?: string
          display_name?: string
          handle?: string | null
          headline?: string | null
          id?: string
          is_public?: boolean
          source?: Database["public"]["Enums"]["professional_source"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          locale: string | null
          theme: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          locale?: string | null
          theme?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          locale?: string | null
          theme?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      prospect_contacts: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          notes: string | null
          phone_e164: string | null
          prospect_id: string
          role_title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          notes?: string | null
          phone_e164?: string | null
          prospect_id: string
          role_title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          notes?: string | null
          phone_e164?: string | null
          prospect_id?: string
          role_title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_contacts_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_contacts_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_data_quality: {
        Row: {
          computed_at: string
          conflict_count: number
          contact_completeness: number
          created_at: string
          data_freshness_days: number | null
          digital_completeness: number
          enrichment_success: Database["public"]["Enums"]["prospect_tribool"]
          identity_completeness: number
          overall_confidence: number
          prospect_id: string
          source_agreement: number | null
          source_count: number
          updated_at: string
        }
        Insert: {
          computed_at?: string
          conflict_count?: number
          contact_completeness?: number
          created_at?: string
          data_freshness_days?: number | null
          digital_completeness?: number
          enrichment_success?: Database["public"]["Enums"]["prospect_tribool"]
          identity_completeness?: number
          overall_confidence?: number
          prospect_id: string
          source_agreement?: number | null
          source_count?: number
          updated_at?: string
        }
        Update: {
          computed_at?: string
          conflict_count?: number
          contact_completeness?: number
          created_at?: string
          data_freshness_days?: number | null
          digital_completeness?: number
          enrichment_success?: Database["public"]["Enums"]["prospect_tribool"]
          identity_completeness?: number
          overall_confidence?: number
          prospect_id?: string
          source_agreement?: number | null
          source_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_data_quality_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_data_quality_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_duplicates: {
        Row: {
          confidence: number
          created_at: string
          duplicate_of_prospect_id: string
          id: string
          prospect_id: string
          reason: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["prospect_duplicate_status"]
        }
        Insert: {
          confidence: number
          created_at?: string
          duplicate_of_prospect_id: string
          id?: string
          prospect_id: string
          reason: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["prospect_duplicate_status"]
        }
        Update: {
          confidence?: number
          created_at?: string
          duplicate_of_prospect_id?: string
          id?: string
          prospect_id?: string
          reason?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["prospect_duplicate_status"]
        }
        Relationships: [
          {
            foreignKeyName: "prospect_duplicates_duplicate_of_prospect_id_fkey"
            columns: ["duplicate_of_prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_duplicates_duplicate_of_prospect_id_fkey"
            columns: ["duplicate_of_prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_duplicates_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_duplicates_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          prospect_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          prospect_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          prospect_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_events_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_events_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_features: {
        Row: {
          computed_at: string
          confidence: number | null
          created_at: string
          evidence: Json
          evidence_source: string | null
          feature_key: string
          feature_version: string
          id: string
          observed_at: string
          prospect_id: string
          updated_at: string
          value_bool: Database["public"]["Enums"]["prospect_tribool"] | null
          value_numeric: number | null
          value_text: string | null
        }
        Insert: {
          computed_at?: string
          confidence?: number | null
          created_at?: string
          evidence?: Json
          evidence_source?: string | null
          feature_key: string
          feature_version?: string
          id?: string
          observed_at?: string
          prospect_id: string
          updated_at?: string
          value_bool?: Database["public"]["Enums"]["prospect_tribool"] | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Update: {
          computed_at?: string
          confidence?: number | null
          created_at?: string
          evidence?: Json
          evidence_source?: string | null
          feature_key?: string
          feature_version?: string
          id?: string
          observed_at?: string
          prospect_id?: string
          updated_at?: string
          value_bool?: Database["public"]["Enums"]["prospect_tribool"] | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospect_features_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_features_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_fit_scores: {
        Row: {
          breakdown: Json
          classification: Database["public"]["Enums"]["prospect_fit_class"]
          created_at: string
          id: string
          is_current: boolean
          job_id: string | null
          prospect_id: string
          ruleset_version: string
          score: number
          score_kind: string
          scored_at: string
        }
        Insert: {
          breakdown?: Json
          classification: Database["public"]["Enums"]["prospect_fit_class"]
          created_at?: string
          id?: string
          is_current?: boolean
          job_id?: string | null
          prospect_id: string
          ruleset_version: string
          score: number
          score_kind: string
          scored_at?: string
        }
        Update: {
          breakdown?: Json
          classification?: Database["public"]["Enums"]["prospect_fit_class"]
          created_at?: string
          id?: string
          is_current?: boolean
          job_id?: string | null
          prospect_id?: string
          ruleset_version?: string
          score?: number
          score_kind?: string
          scored_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_fit_scores_job_id_fkey"
            columns: ["job_id"]
            referencedRelation: "prospect_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_fit_scores_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_fit_scores_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_identity_matches: {
        Row: {
          candidate_prospect_id: string | null
          confidence: number
          created_at: string
          decided_at: string
          id: string
          job_id: string | null
          matched_attributes: Json
          matching_rule: string
          merge_applied: boolean
          prospect_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          rules_version: string
          source_external_id: string | null
          source_key: string | null
          state: Database["public"]["Enums"]["prospect_identity_match_state"]
        }
        Insert: {
          candidate_prospect_id?: string | null
          confidence: number
          created_at?: string
          decided_at?: string
          id?: string
          job_id?: string | null
          matched_attributes?: Json
          matching_rule: string
          merge_applied?: boolean
          prospect_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          rules_version?: string
          source_external_id?: string | null
          source_key?: string | null
          state: Database["public"]["Enums"]["prospect_identity_match_state"]
        }
        Update: {
          candidate_prospect_id?: string | null
          confidence?: number
          created_at?: string
          decided_at?: string
          id?: string
          job_id?: string | null
          matched_attributes?: Json
          matching_rule?: string
          merge_applied?: boolean
          prospect_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          rules_version?: string
          source_external_id?: string | null
          source_key?: string | null
          state?: Database["public"]["Enums"]["prospect_identity_match_state"]
        }
        Relationships: [
          {
            foreignKeyName: "prospect_identity_matches_candidate_prospect_id_fkey"
            columns: ["candidate_prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_identity_matches_candidate_prospect_id_fkey"
            columns: ["candidate_prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_identity_matches_job_id_fkey"
            columns: ["job_id"]
            referencedRelation: "prospect_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_identity_matches_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_identity_matches_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_job_sources: {
        Row: {
          candidates_found: number
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          job_id: string
          source_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["prospect_job_source_status"]
          updated_at: string
        }
        Insert: {
          candidates_found?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          job_id: string
          source_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["prospect_job_source_status"]
          updated_at?: string
        }
        Update: {
          candidates_found?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          job_id?: string
          source_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["prospect_job_source_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_job_sources_job_id_fkey"
            columns: ["job_id"]
            referencedRelation: "prospect_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_job_sources_source_id_fkey"
            columns: ["source_id"]
            referencedRelation: "prospect_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          failed_at: string | null
          id: string
          job_type: string
          last_error: string | null
          lease_until: string | null
          max_attempts: number
          partition_id: string | null
          payload: Json
          priority: number
          result: Json
          scheduled_at: string
          search_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["prospect_job_status"]
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_at?: string | null
          id?: string
          job_type: string
          last_error?: string | null
          lease_until?: string | null
          max_attempts?: number
          partition_id?: string | null
          payload?: Json
          priority?: number
          result?: Json
          scheduled_at?: string
          search_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["prospect_job_status"]
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_at?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          lease_until?: string | null
          max_attempts?: number
          partition_id?: string | null
          payload?: Json
          priority?: number
          result?: Json
          scheduled_at?: string
          search_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["prospect_job_status"]
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospect_jobs_partition_id_fkey"
            columns: ["partition_id"]
            referencedRelation: "prospect_search_partitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_jobs_search_id_fkey"
            columns: ["search_id"]
            referencedRelation: "prospect_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_locales: {
        Row: {
          computed_at: string
          created_at: string
          detected_country: string | null
          detected_language: string | null
          evidence: Json
          language_confidence: number | null
          language_review_required: boolean
          language_source:
            | Database["public"]["Enums"]["prospect_locale_source"]
            | null
          locale: string | null
          override_at: string | null
          override_by: string | null
          override_locale: string | null
          prospect_id: string
          updated_at: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          detected_country?: string | null
          detected_language?: string | null
          evidence?: Json
          language_confidence?: number | null
          language_review_required?: boolean
          language_source?:
            | Database["public"]["Enums"]["prospect_locale_source"]
            | null
          locale?: string | null
          override_at?: string | null
          override_by?: string | null
          override_locale?: string | null
          prospect_id: string
          updated_at?: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          detected_country?: string | null
          detected_language?: string | null
          evidence?: Json
          language_confidence?: number | null
          language_review_required?: boolean
          language_source?:
            | Database["public"]["Enums"]["prospect_locale_source"]
            | null
          locale?: string | null
          override_at?: string | null
          override_by?: string | null
          override_locale?: string | null
          prospect_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_locales_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_locales_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_locations: {
        Row: {
          address_line: string | null
          city: string | null
          country: string
          created_at: string
          id: string
          is_primary: boolean
          latitude: number | null
          longitude: number | null
          postal_code: string | null
          prospect_id: string
          region: string | null
          updated_at: string
        }
        Insert: {
          address_line?: string | null
          city?: string | null
          country: string
          created_at?: string
          id?: string
          is_primary?: boolean
          latitude?: number | null
          longitude?: number | null
          postal_code?: string | null
          prospect_id: string
          region?: string | null
          updated_at?: string
        }
        Update: {
          address_line?: string | null
          city?: string | null
          country?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          latitude?: number | null
          longitude?: number | null
          postal_code?: string | null
          prospect_id?: string
          region?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_locations_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_locations_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_notes: {
        Row: {
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          prospect_id: string
          updated_at: string
        }
        Insert: {
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          prospect_id: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          prospect_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_notes_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_notes_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_outreach: {
        Row: {
          channel: Database["public"]["Enums"]["prospect_outreach_channel"]
          created_at: string
          direction: Database["public"]["Enums"]["prospect_outreach_direction"]
          id: string
          logged_by: string | null
          occurred_at: string
          prospect_id: string
          summary: string | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["prospect_outreach_channel"]
          created_at?: string
          direction?: Database["public"]["Enums"]["prospect_outreach_direction"]
          id?: string
          logged_by?: string | null
          occurred_at?: string
          prospect_id: string
          summary?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["prospect_outreach_channel"]
          created_at?: string
          direction?: Database["public"]["Enums"]["prospect_outreach_direction"]
          id?: string
          logged_by?: string | null
          occurred_at?: string
          prospect_id?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospect_outreach_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_outreach_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_outreach_eligibility: {
        Row: {
          channel: Database["public"]["Enums"]["outreach_channel_kind"]
          created_at: string
          destination: string | null
          destination_invalid: boolean
          do_not_contact: boolean
          id: string
          is_eligible: boolean
          last_evaluated_at: string
          opt_in_at: string | null
          opt_in_source: string | null
          opt_in_status: Database["public"]["Enums"]["outreach_opt_in_status"]
          opted_out_at: string | null
          prospect_id: string
          suppression_reason: string | null
          updated_at: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["outreach_channel_kind"]
          created_at?: string
          destination?: string | null
          destination_invalid?: boolean
          do_not_contact?: boolean
          id?: string
          is_eligible?: boolean
          last_evaluated_at?: string
          opt_in_at?: string | null
          opt_in_source?: string | null
          opt_in_status?: Database["public"]["Enums"]["outreach_opt_in_status"]
          opted_out_at?: string | null
          prospect_id: string
          suppression_reason?: string | null
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["outreach_channel_kind"]
          created_at?: string
          destination?: string | null
          destination_invalid?: boolean
          do_not_contact?: boolean
          id?: string
          is_eligible?: boolean
          last_evaluated_at?: string
          opt_in_at?: string | null
          opt_in_source?: string | null
          opt_in_status?: Database["public"]["Enums"]["outreach_opt_in_status"]
          opted_out_at?: string | null
          prospect_id?: string
          suppression_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_outreach_eligibility_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_outreach_eligibility_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_professionals: {
        Row: {
          created_at: string
          id: string
          match_confidence: number | null
          matching_rule: string | null
          professional_id: string
          prospect_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_confidence?: number | null
          matching_rule?: string | null
          professional_id: string
          prospect_id: string
        }
        Update: {
          created_at?: string
          id?: string
          match_confidence?: number | null
          matching_rule?: string | null
          professional_id?: string
          prospect_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_professionals_professional_id_fkey"
            columns: ["professional_id"]
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_professionals_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_professionals_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_publication_eligibility: {
        Row: {
          block_reason: string | null
          created_at: string
          distinct_source_count: number
          evaluated_at: string
          has_trust_anchor: boolean
          is_eligible: boolean
          prospect_id: string
          updated_at: string
        }
        Insert: {
          block_reason?: string | null
          created_at?: string
          distinct_source_count?: number
          evaluated_at?: string
          has_trust_anchor?: boolean
          is_eligible?: boolean
          prospect_id: string
          updated_at?: string
        }
        Update: {
          block_reason?: string | null
          created_at?: string
          distinct_source_count?: number
          evaluated_at?: string
          has_trust_anchor?: boolean
          is_eligible?: boolean
          prospect_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_publication_eligibility_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_publication_eligibility_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_score_rulesets: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          notes: string | null
          score_kind: string
          updated_at: string
          version: string
          weights: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          score_kind: string
          updated_at?: string
          version: string
          weights?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          score_kind?: string
          updated_at?: string
          version?: string
          weights?: Json
        }
        Relationships: []
      }
      prospect_scores: {
        Row: {
          bucket: Database["public"]["Enums"]["prospect_score_bucket"]
          created_at: string
          factors: Json
          id: string
          prospect_id: string
          score: number
          scored_at: string
        }
        Insert: {
          bucket: Database["public"]["Enums"]["prospect_score_bucket"]
          created_at?: string
          factors?: Json
          id?: string
          prospect_id: string
          score: number
          scored_at?: string
        }
        Update: {
          bucket?: Database["public"]["Enums"]["prospect_score_bucket"]
          created_at?: string
          factors?: Json
          id?: string
          prospect_id?: string
          score?: number
          scored_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_scores_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_scores_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_search_partitions: {
        Row: {
          center_latitude: number | null
          center_longitude: number | null
          city: string | null
          completed_at: string | null
          country: string
          created_at: string
          depth: number
          duplicate_results: number
          duration_ms: number | null
          error: string | null
          estimated_cost_usd: number | null
          id: string
          job_id: string | null
          parent_partition_id: string | null
          postal_code: string | null
          query: string | null
          radius_km: number | null
          raw_results: number
          region: string | null
          requests: number
          retries: number
          saturated: boolean
          search_id: string
          source_key: string
          started_at: string | null
          status: Database["public"]["Enums"]["prospect_search_partition_status"]
          unique_results: number
          updated_at: string
        }
        Insert: {
          center_latitude?: number | null
          center_longitude?: number | null
          city?: string | null
          completed_at?: string | null
          country: string
          created_at?: string
          depth?: number
          duplicate_results?: number
          duration_ms?: number | null
          error?: string | null
          estimated_cost_usd?: number | null
          id?: string
          job_id?: string | null
          parent_partition_id?: string | null
          postal_code?: string | null
          query?: string | null
          radius_km?: number | null
          raw_results?: number
          region?: string | null
          requests?: number
          retries?: number
          saturated?: boolean
          search_id: string
          source_key: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["prospect_search_partition_status"]
          unique_results?: number
          updated_at?: string
        }
        Update: {
          center_latitude?: number | null
          center_longitude?: number | null
          city?: string | null
          completed_at?: string | null
          country?: string
          created_at?: string
          depth?: number
          duplicate_results?: number
          duration_ms?: number | null
          error?: string | null
          estimated_cost_usd?: number | null
          id?: string
          job_id?: string | null
          parent_partition_id?: string | null
          postal_code?: string | null
          query?: string | null
          radius_km?: number | null
          raw_results?: number
          region?: string | null
          requests?: number
          retries?: number
          saturated?: boolean
          search_id?: string
          source_key?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["prospect_search_partition_status"]
          unique_results?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_search_partitions_job_id_fkey"
            columns: ["job_id"]
            referencedRelation: "prospect_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_search_partitions_parent_partition_id_fkey"
            columns: ["parent_partition_id"]
            referencedRelation: "prospect_search_partitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_search_partitions_search_id_fkey"
            columns: ["search_id"]
            referencedRelation: "prospect_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_searches: {
        Row: {
          city: string | null
          completed_at: string | null
          country: string
          created_at: string
          created_by: string | null
          entity_type: string
          id: string
          keywords: string[]
          label: string | null
          latitude: number | null
          longitude: number | null
          max_depth: number
          max_partitions: number
          max_requests: number
          max_results: number | null
          max_runtime_seconds: number
          planner_version: string
          postal_code: string | null
          radius_km: number | null
          region: string | null
          source_keys: string[]
          started_at: string | null
          status: string
          totals: Json
          updated_at: string
        }
        Insert: {
          city?: string | null
          completed_at?: string | null
          country: string
          created_at?: string
          created_by?: string | null
          entity_type?: string
          id?: string
          keywords?: string[]
          label?: string | null
          latitude?: number | null
          longitude?: number | null
          max_depth?: number
          max_partitions?: number
          max_requests?: number
          max_results?: number | null
          max_runtime_seconds?: number
          planner_version?: string
          postal_code?: string | null
          radius_km?: number | null
          region?: string | null
          source_keys?: string[]
          started_at?: string | null
          status?: string
          totals?: Json
          updated_at?: string
        }
        Update: {
          city?: string | null
          completed_at?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          entity_type?: string
          id?: string
          keywords?: string[]
          label?: string | null
          latitude?: number | null
          longitude?: number | null
          max_depth?: number
          max_partitions?: number
          max_requests?: number
          max_results?: number | null
          max_runtime_seconds?: number
          planner_version?: string
          postal_code?: string | null
          radius_km?: number | null
          region?: string | null
          source_keys?: string[]
          started_at?: string | null
          status?: string
          totals?: Json
          updated_at?: string
        }
        Relationships: []
      }
      prospect_segment_definitions: {
        Row: {
          created_at: string
          description: string
          display_name: string
          key: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description: string
          display_name: string
          key: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string
          display_name?: string
          key?: string
          sort_order?: number
        }
        Relationships: []
      }
      prospect_segments: {
        Row: {
          assigned_at: string
          created_at: string
          id: string
          prospect_id: string
          rationale: Json
          segment_key: string
          segmenter_version: string
        }
        Insert: {
          assigned_at?: string
          created_at?: string
          id?: string
          prospect_id: string
          rationale?: Json
          segment_key: string
          segmenter_version?: string
        }
        Update: {
          assigned_at?: string
          created_at?: string
          id?: string
          prospect_id?: string
          rationale?: Json
          segment_key?: string
          segmenter_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_segments_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_segments_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_social_profiles: {
        Row: {
          created_at: string
          external_id: string | null
          follower_count: number | null
          handle: string | null
          id: string
          is_business_account: boolean | null
          last_checked_at: string | null
          platform: Database["public"]["Enums"]["prospect_social_platform"]
          prospect_id: string
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          follower_count?: number | null
          handle?: string | null
          id?: string
          is_business_account?: boolean | null
          last_checked_at?: string | null
          platform: Database["public"]["Enums"]["prospect_social_platform"]
          prospect_id: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          external_id?: string | null
          follower_count?: number | null
          handle?: string | null
          id?: string
          is_business_account?: boolean | null
          last_checked_at?: string | null
          platform?: Database["public"]["Enums"]["prospect_social_platform"]
          prospect_id?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospect_social_profiles_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_social_profiles_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_source_records: {
        Row: {
          confidence: number | null
          created_at: string
          external_id: string | null
          external_type: string | null
          fetched_at: string
          id: string
          job_id: string | null
          last_verified_at: string | null
          prospect_id: string | null
          raw_payload: Json
          source_id: string
          source_url: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          external_id?: string | null
          external_type?: string | null
          fetched_at?: string
          id?: string
          job_id?: string | null
          last_verified_at?: string | null
          prospect_id?: string | null
          raw_payload?: Json
          source_id: string
          source_url?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          external_id?: string | null
          external_type?: string | null
          fetched_at?: string
          id?: string
          job_id?: string | null
          last_verified_at?: string | null
          prospect_id?: string | null
          raw_payload?: Json
          source_id?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospect_source_records_job_id_fkey"
            columns: ["job_id"]
            referencedRelation: "prospect_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_source_records_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_source_records_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_source_records_source_id_fkey"
            columns: ["source_id"]
            referencedRelation: "prospect_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_sources: {
        Row: {
          config: Json
          created_at: string
          display_name: string
          id: string
          independence_group: string | null
          is_enabled: boolean
          is_identity_trust_anchor: boolean
          key: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          display_name: string
          id?: string
          independence_group?: string | null
          is_enabled?: boolean
          is_identity_trust_anchor?: boolean
          key: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          display_name?: string
          id?: string
          independence_group?: string | null
          is_enabled?: boolean
          is_identity_trust_anchor?: boolean
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      prospect_suppressions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          prospect_id: string | null
          reason: string
          scope: Database["public"]["Enums"]["prospect_suppression_scope"]
          value: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          prospect_id?: string | null
          reason: string
          scope: Database["public"]["Enums"]["prospect_suppression_scope"]
          value?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          prospect_id?: string | null
          reason?: string
          scope?: Database["public"]["Enums"]["prospect_suppression_scope"]
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospect_suppressions_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_suppressions_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_tags: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          prospect_id: string
          tag: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          prospect_id: string
          tag: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          prospect_id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_tags_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospect_tags_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospects: {
        Row: {
          canonical_name: string
          converted_organization_id: string | null
          country: string
          created_at: string
          current_booking_provider_id: string | null
          current_score: number | null
          current_score_bucket:
            | Database["public"]["Enums"]["prospect_score_bucket"]
            | null
          do_not_contact: boolean
          email: string | null
          entity_kind: Database["public"]["Enums"]["prospect_entity_kind"]
          estimated_barber_count: number | null
          fadeup_fit_class:
            | Database["public"]["Enums"]["prospect_fit_class"]
            | null
          fadeup_fit_score: number | null
          first_discovered_at: string
          id: string
          last_enriched_at: string | null
          migration_potential_class:
            | Database["public"]["Enums"]["prospect_fit_class"]
            | null
          migration_potential_score: number | null
          outreach_unsubscribe_token: string
          parent_group_id: string | null
          phone_e164: string | null
          rating: number | null
          review_count: number | null
          status: Database["public"]["Enums"]["prospect_pipeline_stage"]
          type: Database["public"]["Enums"]["prospect_type"]
          updated_at: string
          website_domain: string | null
          website_url: string | null
        }
        Insert: {
          canonical_name: string
          converted_organization_id?: string | null
          country: string
          created_at?: string
          current_booking_provider_id?: string | null
          current_score?: number | null
          current_score_bucket?:
            | Database["public"]["Enums"]["prospect_score_bucket"]
            | null
          do_not_contact?: boolean
          email?: string | null
          entity_kind?: Database["public"]["Enums"]["prospect_entity_kind"]
          estimated_barber_count?: number | null
          fadeup_fit_class?:
            | Database["public"]["Enums"]["prospect_fit_class"]
            | null
          fadeup_fit_score?: number | null
          first_discovered_at?: string
          id?: string
          last_enriched_at?: string | null
          migration_potential_class?:
            | Database["public"]["Enums"]["prospect_fit_class"]
            | null
          migration_potential_score?: number | null
          outreach_unsubscribe_token?: string
          parent_group_id?: string | null
          phone_e164?: string | null
          rating?: number | null
          review_count?: number | null
          status?: Database["public"]["Enums"]["prospect_pipeline_stage"]
          type: Database["public"]["Enums"]["prospect_type"]
          updated_at?: string
          website_domain?: string | null
          website_url?: string | null
        }
        Update: {
          canonical_name?: string
          converted_organization_id?: string | null
          country?: string
          created_at?: string
          current_booking_provider_id?: string | null
          current_score?: number | null
          current_score_bucket?:
            | Database["public"]["Enums"]["prospect_score_bucket"]
            | null
          do_not_contact?: boolean
          email?: string | null
          entity_kind?: Database["public"]["Enums"]["prospect_entity_kind"]
          estimated_barber_count?: number | null
          fadeup_fit_class?:
            | Database["public"]["Enums"]["prospect_fit_class"]
            | null
          fadeup_fit_score?: number | null
          first_discovered_at?: string
          id?: string
          last_enriched_at?: string | null
          migration_potential_class?:
            | Database["public"]["Enums"]["prospect_fit_class"]
            | null
          migration_potential_score?: number | null
          outreach_unsubscribe_token?: string
          parent_group_id?: string | null
          phone_e164?: string | null
          rating?: number | null
          review_count?: number | null
          status?: Database["public"]["Enums"]["prospect_pipeline_stage"]
          type?: Database["public"]["Enums"]["prospect_type"]
          updated_at?: string
          website_domain?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospects_converted_organization_id_fkey"
            columns: ["converted_organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_current_booking_provider_id_fkey"
            columns: ["current_booking_provider_id"]
            referencedRelation: "booking_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_current_booking_provider_id_fkey"
            columns: ["current_booking_provider_id"]
            referencedRelation: "competitor_analytics"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "prospects_parent_group_id_fkey"
            columns: ["parent_group_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "prospects_parent_group_id_fkey"
            columns: ["parent_group_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      queue_entries: {
        Row: {
          barber_id: string | null
          booked_by_user_id: string | null
          called_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          service_id: string | null
          service_started_at: string | null
          status: Database["public"]["Enums"]["queue_status"]
          updated_at: string
        }
        Insert: {
          barber_id?: string | null
          booked_by_user_id?: string | null
          called_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          id?: string
          location_id: string
          notes?: string | null
          organization_id: string
          service_id?: string | null
          service_started_at?: string | null
          status?: Database["public"]["Enums"]["queue_status"]
          updated_at?: string
        }
        Update: {
          barber_id?: string | null
          booked_by_user_id?: string | null
          called_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          id?: string
          location_id?: string
          notes?: string | null
          organization_id?: string
          service_id?: string | null
          service_started_at?: string | null
          status?: Database["public"]["Enums"]["queue_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_entries_barber_id_fkey"
            columns: ["barber_id"]
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_entries_customer_id_fkey"
            columns: ["customer_id"]
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_entries_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_entries_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_entries_service_id_fkey"
            columns: ["service_id"]
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_categories: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_locations: {
        Row: {
          created_at: string
          location_id: string
          organization_id: string
          service_id: string
        }
        Insert: {
          created_at?: string
          location_id: string
          organization_id: string
          service_id: string
        }
        Update: {
          created_at?: string
          location_id?: string
          organization_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_locations_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_locations_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_locations_service_id_fkey"
            columns: ["service_id"]
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_mode_changes: {
        Row: {
          barber_id: string | null
          change_kind: Database["public"]["Enums"]["service_mode_change_kind"]
          changed_by_user_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          location_id: string
          new_mode: Database["public"]["Enums"]["service_mode"] | null
          new_queue_open: boolean | null
          organization_id: string
          previous_mode: Database["public"]["Enums"]["service_mode"] | null
          previous_queue_open: boolean | null
          scope: Database["public"]["Enums"]["service_mode_scope"]
        }
        Insert: {
          barber_id?: string | null
          change_kind: Database["public"]["Enums"]["service_mode_change_kind"]
          changed_by_user_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          location_id: string
          new_mode?: Database["public"]["Enums"]["service_mode"] | null
          new_queue_open?: boolean | null
          organization_id: string
          previous_mode?: Database["public"]["Enums"]["service_mode"] | null
          previous_queue_open?: boolean | null
          scope: Database["public"]["Enums"]["service_mode_scope"]
        }
        Update: {
          barber_id?: string | null
          change_kind?: Database["public"]["Enums"]["service_mode_change_kind"]
          changed_by_user_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          location_id?: string
          new_mode?: Database["public"]["Enums"]["service_mode"] | null
          new_queue_open?: boolean | null
          organization_id?: string
          previous_mode?: Database["public"]["Enums"]["service_mode"] | null
          previous_queue_open?: boolean | null
          scope?: Database["public"]["Enums"]["service_mode_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "service_mode_changes_barber_id_fkey"
            columns: ["barber_id"]
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_mode_changes_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_mode_changes_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_mode_overrides: {
        Row: {
          barber_id: string | null
          cleared_at: string | null
          cleared_by_user_id: string | null
          created_at: string
          created_by_user_id: string | null
          expires_at: string | null
          id: string
          location_id: string
          mode: Database["public"]["Enums"]["service_mode"]
          organization_id: string
          scope: Database["public"]["Enums"]["service_mode_scope"]
          starts_at: string
          updated_at: string
        }
        Insert: {
          barber_id?: string | null
          cleared_at?: string | null
          cleared_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          expires_at?: string | null
          id?: string
          location_id: string
          mode: Database["public"]["Enums"]["service_mode"]
          organization_id: string
          scope: Database["public"]["Enums"]["service_mode_scope"]
          starts_at?: string
          updated_at?: string
        }
        Update: {
          barber_id?: string | null
          cleared_at?: string | null
          cleared_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          expires_at?: string | null
          id?: string
          location_id?: string
          mode?: Database["public"]["Enums"]["service_mode"]
          organization_id?: string
          scope?: Database["public"]["Enums"]["service_mode_scope"]
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_mode_overrides_barber_id_fkey"
            columns: ["barber_id"]
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_mode_overrides_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_mode_overrides_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          buffer_after_minutes: number
          buffer_before_minutes: number
          category_id: string | null
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          organization_id: string
          price_cents: number
          updated_at: string
        }
        Insert: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          duration_minutes: number
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          price_cents: number
          updated_at?: string
        }
        Update: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey"
            columns: ["category_id"]
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          is_public: boolean
          location_id: string | null
          organization_id: string
          title: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          is_public?: boolean
          location_id?: string | null
          organization_id: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          is_public?: boolean
          location_id?: string | null
          organization_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_profiles_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_profiles_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      time_blocks: {
        Row: {
          barber_id: string
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          location_id: string | null
          organization_id: string
          reason: string | null
          starts_at: string
          updated_at: string
        }
        Insert: {
          barber_id: string
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          location_id?: string | null
          organization_id: string
          reason?: string | null
          starts_at: string
          updated_at?: string
        }
        Update: {
          barber_id?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          location_id?: string | null
          organization_id?: string
          reason?: string | null
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_blocks_barber_id_fkey"
            columns: ["barber_id"]
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_blocks_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_blocks_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_entries: {
        Row: {
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          desired_barber_id: string | null
          desired_service_id: string | null
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          status: Database["public"]["Enums"]["waitlist_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          desired_barber_id?: string | null
          desired_service_id?: string | null
          id?: string
          location_id: string
          notes?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["waitlist_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          desired_barber_id?: string | null
          desired_service_id?: string | null
          id?: string
          location_id?: string
          notes?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["waitlist_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_customer_id_fkey"
            columns: ["customer_id"]
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_desired_barber_id_fkey"
            columns: ["desired_barber_id"]
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_desired_service_id_fkey"
            columns: ["desired_service_id"]
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_accounts: {
        Row: {
          access_token_env_var: string
          created_at: string
          display_phone_number: string | null
          id: string
          is_active: boolean
          label: string
          phone_number_id: string
          provider_mode: string
          updated_at: string
          waba_id: string
        }
        Insert: {
          access_token_env_var?: string
          created_at?: string
          display_phone_number?: string | null
          id?: string
          is_active?: boolean
          label: string
          phone_number_id: string
          provider_mode?: string
          updated_at?: string
          waba_id: string
        }
        Update: {
          access_token_env_var?: string
          created_at?: string
          display_phone_number?: string | null
          id?: string
          is_active?: boolean
          label?: string
          phone_number_id?: string
          provider_mode?: string
          updated_at?: string
          waba_id?: string
        }
        Relationships: []
      }
      whatsapp_conversations: {
        Row: {
          contact_wa_id: string
          created_at: string
          id: string
          last_inbound_at: string | null
          last_outbound_at: string | null
          prospect_id: string | null
          updated_at: string
          whatsapp_account_id: string
        }
        Insert: {
          contact_wa_id: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          prospect_id?: string | null
          updated_at?: string
          whatsapp_account_id: string
        }
        Update: {
          contact_wa_id?: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          prospect_id?: string | null
          updated_at?: string
          whatsapp_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_whatsapp_account_id_fkey"
            columns: ["whatsapp_account_id"]
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          attempts: number
          body: string | null
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          direction: Database["public"]["Enums"]["whatsapp_message_direction"]
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          from_phone_e164: string | null
          id: string
          idempotency_key: string | null
          meta_template_language: string | null
          meta_template_name: string | null
          prospect_id: string | null
          provider_message_id: string | null
          read_at: string | null
          received_at: string | null
          recipient_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["whatsapp_message_status"]
          template_id: string | null
          to_phone_e164: string | null
          updated_at: string
          whatsapp_account_id: string
        }
        Insert: {
          attempts?: number
          body?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          direction: Database["public"]["Enums"]["whatsapp_message_direction"]
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          from_phone_e164?: string | null
          id?: string
          idempotency_key?: string | null
          meta_template_language?: string | null
          meta_template_name?: string | null
          prospect_id?: string | null
          provider_message_id?: string | null
          read_at?: string | null
          received_at?: string | null
          recipient_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["whatsapp_message_status"]
          template_id?: string | null
          to_phone_e164?: string | null
          updated_at?: string
          whatsapp_account_id: string
        }
        Update: {
          attempts?: number
          body?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          direction?: Database["public"]["Enums"]["whatsapp_message_direction"]
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          from_phone_e164?: string | null
          id?: string
          idempotency_key?: string | null
          meta_template_language?: string | null
          meta_template_name?: string | null
          prospect_id?: string | null
          provider_message_id?: string | null
          read_at?: string | null
          received_at?: string | null
          recipient_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["whatsapp_message_status"]
          template_id?: string | null
          to_phone_e164?: string | null
          updated_at?: string
          whatsapp_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospect_publication_queue"
            referencedColumns: ["prospect_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_prospect_id_fkey"
            columns: ["prospect_id"]
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_recipient_id_fkey"
            columns: ["recipient_id"]
            referencedRelation: "outreach_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "outreach_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "template_performance"
            referencedColumns: ["template_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_whatsapp_account_id_fkey"
            columns: ["whatsapp_account_id"]
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_template_mappings: {
        Row: {
          approval_state: string
          created_at: string
          id: string
          last_synced_at: string | null
          meta_template_language: string
          meta_template_name: string
          template_id: string
          updated_at: string
          variable_order: string[]
          whatsapp_account_id: string
        }
        Insert: {
          approval_state?: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          meta_template_language: string
          meta_template_name: string
          template_id: string
          updated_at?: string
          variable_order?: string[]
          whatsapp_account_id: string
        }
        Update: {
          approval_state?: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          meta_template_language?: string
          meta_template_name?: string
          template_id?: string
          updated_at?: string
          variable_order?: string[]
          whatsapp_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_template_mappings_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "outreach_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_template_mappings_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "template_performance"
            referencedColumns: ["template_id"]
          },
          {
            foreignKeyName: "whatsapp_template_mappings_whatsapp_account_id_fkey"
            columns: ["whatsapp_account_id"]
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_webhook_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          processed: boolean
          processed_at: string | null
          processing_error: string | null
          provider_event_id: string
          received_at: string
          signature_valid: boolean
          whatsapp_account_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          provider_event_id: string
          received_at?: string
          signature_valid?: boolean
          whatsapp_account_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          provider_event_id?: string
          received_at?: string
          signature_valid?: boolean
          whatsapp_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_webhook_events_whatsapp_account_id_fkey"
            columns: ["whatsapp_account_id"]
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      competitor_analytics: {
        Row: {
          activated: number | null
          avg_fit_score: number | null
          avg_migration_score: number | null
          claimed: number | null
          contacted: number | null
          discovered: number | null
          display_name: string | null
          is_sentinel: boolean | null
          paid: number | null
          positive_reply: number | null
          provider_id: string | null
          provider_key: string | null
          qualified: number | null
          replied: number | null
        }
        Relationships: []
      }
      experiment_results: {
        Row: {
          activated: number | null
          arm_id: string | null
          arm_key: string | null
          assigned: number | null
          experiment_id: string | null
          experiment_key: string | null
          experiment_name: string | null
          is_control: boolean | null
          min_sample_per_arm: number | null
          paid: number | null
          positive_reply: number | null
          primary_metric: Database["public"]["Enums"]["ml_model_target"] | null
          reached_min_sample: boolean | null
          replied: number | null
          sent: number | null
          status: string | null
          template_key: string | null
        }
        Relationships: []
      }
      outreach_funnel_stats: {
        Row: {
          activated: number | null
          blocked: number | null
          booking_provider_key: string | null
          campaign_id: string | null
          campaign_name: string | null
          claimed: number | null
          country: string | null
          delivered: number | null
          experiment_arm: string | null
          experiment_id: string | null
          locale: string | null
          negative_reply: number | null
          opted_out: number | null
          paid: number | null
          positive_reply: number | null
          queued_or_beyond: number | null
          read: number | null
          recipients: number | null
          replied: number | null
          sales_angle: string | null
          sent: number | null
          template_id: string | null
          template_key: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_recipients_experiment_fkey"
            columns: ["experiment_id"]
            referencedRelation: "experiment_results"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "outreach_recipients_experiment_fkey"
            columns: ["experiment_id"]
            referencedRelation: "outreach_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_recipients_sales_angle_fkey"
            columns: ["sales_angle"]
            referencedRelation: "outreach_sales_angles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "outreach_recipients_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "outreach_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_recipients_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "template_performance"
            referencedColumns: ["template_id"]
          },
        ]
      }
      prospect_publication_queue: {
        Row: {
          block_reason: string | null
          canonical_name: string | null
          country: string | null
          distinct_source_count: number | null
          entity_kind:
            | Database["public"]["Enums"]["prospect_entity_kind"]
            | null
          evaluated_at: string | null
          first_discovered_at: string | null
          has_trust_anchor: boolean | null
          is_eligible: boolean | null
          is_published: boolean | null
          prospect_id: string | null
          prospect_type: Database["public"]["Enums"]["prospect_type"] | null
          website_domain: string | null
        }
        Relationships: []
      }
      prospect_score_distribution: {
        Row: {
          cold_count: number | null
          hot_count: number | null
          low_discrimination_warning: boolean | null
          mean_score: number | null
          median_score: number | null
          p10: number | null
          p25: number | null
          p75: number | null
          p90: number | null
          score_kind: string | null
          scored: number | null
          stddev_score: number | null
          warm_count: number | null
        }
        Relationships: []
      }
      template_performance: {
        Row: {
          activated: number | null
          activation_rate: number | null
          booking_provider_key: string | null
          claimed: number | null
          delivered: number | null
          locale: string | null
          name: string | null
          opted_out: number | null
          paid: number | null
          paid_rate: number | null
          positive_reply: number | null
          positive_reply_rate: number | null
          read: number | null
          recipients: number | null
          replied: number | null
          reply_rate: number | null
          sales_angle: string | null
          segment_key: string | null
          sent: number | null
          status: Database["public"]["Enums"]["outreach_template_status"] | null
          template_id: string | null
          template_key: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_templates_sales_angle_fkey"
            columns: ["sales_angle"]
            referencedRelation: "outreach_sales_angles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "outreach_templates_segment_key_fkey"
            columns: ["segment_key"]
            referencedRelation: "prospect_segment_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: {
        Args: { p_token: string }
        Returns: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["membership_role"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accept_platform_invitation: {
        Args: { p_token: string }
        Returns: {
          created_at: string
          note: string | null
          role: Database["public"]["Enums"]["platform_role"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_appointment_no_show_rule: {
        Args: { p_organization_id: string }
        Returns: number
      }
      apply_starter_services: {
        Args: {
          p_barber_id?: string
          p_location_id: string
          p_organization_id: string
          p_services: Json
        }
        Returns: number
      }
      apply_weekly_hours: {
        Args: {
          p_barber_id?: string
          p_days?: Json
          p_location_id?: string
          p_organization_id: string
        }
        Returns: number
      }
      approve_outreach_template: {
        Args: { p_template_id: string }
        Returns: {
          allowed_variables: string[]
          approved_at: string | null
          approved_by: string | null
          body: string
          booking_provider_id: string | null
          channel: Database["public"]["Enums"]["outreach_channel_kind"]
          created_at: string
          created_by: string | null
          id: string
          key: string
          locale: string
          name: string
          notes: string | null
          sales_angle: string | null
          segment_key: string | null
          status: Database["public"]["Enums"]["outreach_template_status"]
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "outreach_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_commercial_plan: {
        Args: {
          p_note?: string
          p_organization_id: string
          p_plan_key: string
          p_status?: Database["public"]["Enums"]["commercial_status"]
        }
        Returns: string
      }
      book_public_appointment: {
        Args: {
          p_barber_id: string
          p_customer_email?: string
          p_customer_name: string
          p_customer_phone?: string
          p_location_id: string
          p_notes?: string
          p_organization_slug: string
          p_service_id: string
          p_starts_at: string
        }
        Returns: {
          claim_token: string
          ends_at: string
          expires_at: string
          id: string
          is_request: boolean
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
        }[]
      }
      cancel_appointment_as_business: {
        Args: { p_appointment_id: string; p_note?: string }
        Returns: {
          barber_id: string
          blocked_range: unknown
          booked_by_user_id: string | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          chair_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          decided_at: string | null
          decided_by: string | null
          ends_at: string
          expires_at: string | null
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          rescheduled_to: string | null
          resolution:
            | Database["public"]["Enums"]["appointment_resolution"]
            | null
          resolution_note: string | null
          service_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_my_appointment: {
        Args: { p_appointment_id: string }
        Returns: {
          barber_id: string
          blocked_range: unknown
          booked_by_user_id: string | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          chair_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          decided_at: string | null
          decided_by: string | null
          ends_at: string
          expires_at: string | null
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          rescheduled_to: string | null
          resolution:
            | Database["public"]["Enums"]["appointment_resolution"]
            | null
          resolution_note: string | null
          service_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_prospect_job: {
        Args: { p_id: string }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          failed_at: string | null
          id: string
          job_type: string
          last_error: string | null
          lease_until: string | null
          max_attempts: number
          partition_id: string | null
          payload: Json
          priority: number
          result: Json
          scheduled_at: string
          search_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["prospect_job_status"]
          updated_at: string
          worker_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "prospect_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_platform_owner_bootstrap: {
        Args: { p_token: string }
        Returns: {
          created_at: string
          note: string | null
          role: Database["public"]["Enums"]["platform_role"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      classify_outreach_reply: {
        Args: { p_note?: string; p_positive: boolean; p_recipient_id: string }
        Returns: {
          attempts: number
          blocked_reason: string | null
          campaign_id: string
          converted_at: string | null
          created_at: string
          delivered_at: string | null
          destination: string | null
          experiment_arm: string | null
          experiment_id: string | null
          id: string
          last_error: string | null
          locale: string | null
          ml_prediction_id: string | null
          prospect_id: string
          queued_at: string | null
          read_at: string | null
          rendered_body: string | null
          rendered_variables: Json
          replied_at: string | null
          sales_angle: string | null
          selection_method: string | null
          selection_reason: Json
          sent_at: string | null
          state: Database["public"]["Enums"]["outreach_recipient_state"]
          template_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "outreach_recipients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clear_service_mode_temporary_override: {
        Args: {
          p_barber_id?: string
          p_location_id: string
          p_scope: Database["public"]["Enums"]["service_mode_scope"]
        }
        Returns: number
      }
      complete_appointment: {
        Args: { p_appointment_id: string }
        Returns: {
          barber_id: string
          blocked_range: unknown
          booked_by_user_id: string | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          chair_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          decided_at: string | null
          decided_by: string | null
          ends_at: string
          expires_at: string | null
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          rescheduled_to: string | null
          resolution:
            | Database["public"]["Enums"]["appointment_resolution"]
            | null
          resolution_note: string | null
          service_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_marketplace_withdrawal: {
        Args: { p_decision_note?: string; p_request_id: string }
        Returns: {
          completed_at: string
          hours_taken: number
          professional_id: string
        }[]
      }
      complete_onboarding: {
        Args: { p_organization_id: string; p_publish?: boolean }
        Returns: {
          is_published: boolean
          missing_requirements: string[]
          ready_to_book: boolean
          ready_to_publish: boolean
        }[]
      }
      complete_organization_onboarding: {
        Args: {
          p_location_name: string
          p_org_name: string
          p_org_slug: string
          p_timezone?: string
        }
        Returns: {
          location_id: string
          location_name: string
          organization_id: string
          organization_name: string
          organization_slug: string
        }[]
      }
      confirm_booking_request: {
        Args: { p_appointment_id: string }
        Returns: {
          barber_id: string
          blocked_range: unknown
          booked_by_user_id: string | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          chair_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          decided_at: string | null
          decided_by: string | null
          ends_at: string
          expires_at: string | null
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          rescheduled_to: string | null
          resolution:
            | Database["public"]["Enums"]["appointment_resolution"]
            | null
          resolution_note: string | null
          service_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_external_professional: {
        Args: { p_prospect_id: string }
        Returns: string
      }
      create_organization: {
        Args: { p_name: string; p_slug: string }
        Returns: {
          booking_request_ttl_minutes: number
          business_type: Database["public"]["Enums"]["business_type"] | null
          country_code: string | null
          created_at: string
          currency: string | null
          id: string
          marketplace_visible: boolean
          name: string
          onboarding_completed_at: string | null
          slug: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_passport_share: {
        Args: { p_label?: string; p_ttl_hours?: number }
        Returns: {
          expires_at: string
          share_id: string
          token: string
        }[]
      }
      create_platform_invitation: {
        Args: {
          p_expires_in?: string
          p_invited_email?: string
          p_role: Database["public"]["Enums"]["platform_role"]
        }
        Returns: {
          expires_at: string
          id: string
          raw_token: string
        }[]
      }
      create_professional_interest_request: {
        Args: {
          p_customer_email?: string
          p_customer_name: string
          p_customer_phone?: string
          p_locale?: string
          p_notes?: string
          p_preferred_starts_at: string
          p_professional_id: string
          p_service_label: string
        }
        Returns: {
          expires_at: string
          id: string
          preferred_starts_at: string
          professional_display_name: string
          status: Database["public"]["Enums"]["interest_request_status"]
        }[]
      }
      create_prospect_discovery_job: {
        Args: {
          p_job_type: string
          p_payload: Json
          p_priority?: number
          p_source_keys?: string[]
        }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          failed_at: string | null
          id: string
          job_type: string
          last_error: string | null
          lease_until: string | null
          max_attempts: number
          partition_id: string | null
          payload: Json
          priority: number
          result: Json
          scheduled_at: string
          search_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["prospect_job_status"]
          updated_at: string
          worker_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "prospect_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decline_booking_request: {
        Args: { p_appointment_id: string; p_note?: string }
        Returns: {
          barber_id: string
          blocked_range: unknown
          booked_by_user_id: string | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          chair_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          decided_at: string | null
          decided_by: string | null
          ends_at: string
          expires_at: string | null
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          rescheduled_to: string | null
          resolution:
            | Database["public"]["Enums"]["appointment_resolution"]
            | null
          resolution_note: string | null
          service_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      end_platform_support_session: {
        Args: { p_id: string }
        Returns: {
          ended_at: string | null
          id: string
          organization_id: string
          platform_actor_id: string
          reason: string | null
          started_at: string
          target_type: string
          target_user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "platform_support_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_owner_professional: {
        Args: {
          p_bio?: string
          p_display_name?: string
          p_location_id: string
          p_organization_id: string
          p_title?: string
        }
        Returns: string
      }
      expire_interest_requests: { Args: { p_limit?: number }; Returns: number }
      expire_pending_appointments: {
        Args: { p_limit?: number }
        Returns: number
      }
      favorite_shop: { Args: { p_organization_id: string }; Returns: undefined }
      follow_organization: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      follow_professional: {
        Args: { p_professional_id: string }
        Returns: undefined
      }
      get_available_slots: {
        Args: {
          p_barber_id: string
          p_date: string
          p_location_id: string
          p_organization_id: string
          p_service_id: string
          p_slot_step_minutes?: number
        }
        Returns: {
          slot_end: string
          slot_start: string
        }[]
      }
      get_booking_requests: {
        Args: { p_organization_id: string }
        Returns: {
          barber_display_name: string
          barber_id: string
          created_at: string
          customer_email: string
          customer_name: string
          customer_phone: string
          duration_minutes: number
          ends_at: string
          expires_at: string
          id: string
          location_id: string
          location_name: string
          notes: string
          price_cents: number
          service_id: string
          service_name: string
          starts_at: string
        }[]
      }
      get_calendar_appointments: {
        Args: {
          p_barber_id?: string
          p_from: string
          p_location_id?: string
          p_organization_id: string
          p_to: string
        }
        Returns: {
          barber_display_name: string
          barber_id: string
          created_at: string
          currency: string
          customer_name: string
          customer_phone: string
          ends_at: string
          expires_at: string
          id: string
          location_id: string
          location_name: string
          location_timezone: string
          notes: string
          price_cents: number
          resolution: Database["public"]["Enums"]["appointment_resolution"]
          service_id: string
          service_name: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
        }[]
      }
      get_invitation_by_token: {
        Args: { p_token: string }
        Returns: {
          email: string
          expires_at: string
          is_accepted: boolean
          is_expired: boolean
          is_revoked: boolean
          location_name: string
          organization_name: string
          role: Database["public"]["Enums"]["membership_role"]
        }[]
      }
      get_location_queue_check_in: {
        Args: { p_location_id: string }
        Returns: {
          location_id: string
          queue_call_grace_minutes: number
          queue_capacity_per_barber: number
          queue_check_in_token: string
          queue_geofence_meters: number
        }[]
      }
      get_my_access: {
        Args: never
        Returns: {
          application_status: Database["public"]["Enums"]["professional_application_status"]
          customer_available: boolean
          customer_onboarding_completed: boolean
          customer_profile_exists: boolean
          organization_count: number
          owned_organization_count: number
          platform_available: boolean
          platform_role: Database["public"]["Enums"]["platform_role"]
          professional_available: boolean
          signup_intent: string
          user_id: string
        }[]
      }
      get_my_appointments: {
        Args: never
        Returns: {
          barber_display_name: string
          barber_id: string
          created_at: string
          currency: string
          ends_at: string
          expires_at: string
          id: string
          location_id: string
          location_name: string
          location_timezone: string
          organization_id: string
          organization_name: string
          organization_slug: string
          price_cents: number
          resolution: Database["public"]["Enums"]["appointment_resolution"]
          resolution_note: string
          service_id: string
          service_name: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
        }[]
      }
      get_my_favorites: {
        Args: never
        Returns: {
          barber_avatar_url: string
          barber_display_name: string
          barber_id: string
          created_at: string
          favorite_id: string
          organization_id: string
          organization_name: string
          organization_slug: string
        }[]
      }
      get_my_interest_requests: {
        Args: never
        Returns: {
          created_at: string
          expires_at: string
          id: string
          preferred_starts_at: string
          professional_display_name: string
          professional_handle: string
          professional_id: string
          service_label: string
          status: Database["public"]["Enums"]["interest_request_status"]
        }[]
      }
      get_my_professional_application: {
        Args: never
        Returns: {
          business_name: string
          city: string
          email: string
          first_name: string
          id: string
          last_name: string
          organization_id: string
          phone: string
          professional_type: Database["public"]["Enums"]["professional_type"]
          rejection_reason: string
          reviewed_at: string
          status: Database["public"]["Enums"]["professional_application_status"]
          submitted_at: string
        }[]
      }
      get_my_queue_status: {
        Args: never
        Returns: {
          barber_display_name: string
          created_at: string
          id: string
          location_id: string
          location_name: string
          organization_id: string
          organization_name: string
          organization_slug: string
          queue_position: number
          status: Database["public"]["Enums"]["queue_status"]
        }[]
      }
      get_organization_analytics_summary: {
        Args: { p_from?: string; p_organization_id: string; p_to?: string }
        Returns: {
          appointments_cancelled: number
          appointments_completed: number
          appointments_confirmed: number
          appointments_created: number
          appointments_no_show: number
          booking_conversion_rate: number
          booking_starts: number
          distinct_anonymous_sessions: number
          favorites: number
          follows: number
          profile_views: number
          queue_cancellations: number
          queue_completions: number
          queue_conversion_rate: number
          queue_joins: number
          queue_views: number
          repeat_customers: number
          unfavorites: number
          unfollows: number
          unique_authenticated_viewers: number
          unique_customers: number
          window_from: string
          window_to: string
        }[]
      }
      get_organization_entitlements: {
        Args: { p_organization_id: string }
        Returns: {
          commercial_family: Database["public"]["Enums"]["commercial_family"]
          display_name: string
          effective_plan_key: string
          entitlement_source: Database["public"]["Enums"]["entitlement_source"]
          live_capabilities: string[]
          max_establishments: number
          max_operational_professionals: number
          organization_id: string
          packaged_capabilities: string[]
          plan_key: string
          price_currency: string
          price_minor: number
          status: Database["public"]["Enums"]["commercial_status"]
          used_establishments: number
          used_operational_professionals: number
        }[]
      }
      get_organization_readiness: {
        Args: { p_organization_id: string }
        Returns: {
          business_type: Database["public"]["Enums"]["business_type"]
          currency: string
          has_business_type: boolean
          has_currency: boolean
          has_location: boolean
          has_location_address: boolean
          has_location_hours: boolean
          has_professional: boolean
          has_professional_hours: boolean
          has_public_profile: boolean
          has_service: boolean
          has_service_area: boolean
          has_service_at_location: boolean
          has_service_for_professional: boolean
          has_timezone: boolean
          is_published: boolean
          missing_requirements: string[]
          organization_id: string
          ready_to_book: boolean
          ready_to_publish: boolean
        }[]
      }
      get_organization_retention_cohort: {
        Args: { p_from?: string; p_organization_id: string; p_to?: string }
        Returns: {
          first_time_customers: number
          returned_at_all: number
          returned_within_30d: number
          returned_within_60d: number
          returned_within_90d: number
          window_from: string
          window_to: string
        }[]
      }
      get_platform_analytics_funnel: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          appointments_completed: number
          appointments_created: number
          claims_approved: number
          claims_rejected: number
          claims_submitted: number
          converted_professionals: number
          external_profiles_created: number
          organizations_with_activity: number
          passports_issued: number
          plans_assigned: number
          plans_changed: number
          prospects_discovered: number
          prospects_enriched: number
          queue_completions: number
          queue_joins: number
          window_from: string
          window_to: string
        }[]
      }
      get_professional_analytics_summary: {
        Args: { p_from?: string; p_professional_id: string; p_to?: string }
        Returns: {
          appointments_completed: number
          follows: number
          profile_views: number
          queue_completions: number
          relationships_created: number
          repeat_customers: number
          unfollows: number
          unique_authenticated_viewers: number
          unique_customers: number
          window_from: string
          window_to: string
        }[]
      }
      get_public_available_slots: {
        Args: {
          p_barber_id: string
          p_date: string
          p_location_id: string
          p_organization_slug: string
          p_service_id: string
          p_slot_step_minutes?: number
        }
        Returns: {
          slot_end: string
          slot_start: string
        }[]
      }
      get_public_barber: {
        Args: { p_barber_id: string; p_organization_slug: string }
        Returns: {
          avatar_url: string
          barber_id: string
          bio: string
          display_name: string
          location_id: string
          professional_id: string
          title: string
        }[]
      }
      get_public_booking_alternatives: {
        Args: {
          p_exclude_organization_id?: string
          p_latitude?: number
          p_limit?: number
          p_longitude?: number
          p_radius_km?: number
          p_service_query?: string
        }
        Returns: {
          accepts_immediate_booking: boolean
          city: string
          covers_search_point: boolean
          distance_km: number
          is_open_now: boolean
          location_id: string
          location_kind: Database["public"]["Enums"]["location_kind"]
          location_name: string
          marketplace_supply_type: string
          organization_id: string
          organization_name: string
          organization_slug: string
          starting_price_cents: number
        }[]
      }
      get_public_currencies: {
        Args: { p_organization_ids: string[] }
        Returns: {
          currency: string
          organization_id: string
        }[]
      }
      get_public_organization: {
        Args: { p_slug: string }
        Returns: {
          country_code: string
          currency: string
          id: string
          name: string
          slug: string
        }[]
      }
      get_public_professional: {
        Args: { p_professional_id: string }
        Returns: {
          avatar_url: string
          bio: string
          claim_state: Database["public"]["Enums"]["professional_claim_state"]
          display_name: string
          follower_count: number
          handle: string
          headline: string
          id: string
          is_claimed: boolean
        }[]
      }
      get_public_professional_by_handle: {
        Args: { p_handle: string }
        Returns: {
          avatar_url: string
          bio: string
          claim_state: Database["public"]["Enums"]["professional_claim_state"]
          display_name: string
          follower_count: number
          handle: string
          headline: string
          id: string
          is_claimed: boolean
        }[]
      }
      get_public_queue_status: {
        Args: { p_location_id: string; p_organization_slug: string }
        Returns: {
          barber_display_name: string
          display_name: string
          id: string
          queue_position: number
          status: Database["public"]["Enums"]["queue_status"]
        }[]
      }
      get_public_service_state: {
        Args: {
          p_barber_id?: string
          p_location_id: string
          p_organization_slug: string
        }
        Returns: {
          barber_id: string
          booking_accepting_new_entries: boolean
          effective_service_mode: Database["public"]["Enums"]["service_mode"]
          location_id: string
          mode_allows_booking: boolean
          mode_allows_queue: boolean
          mode_expires_at: string
          mode_source: string
          queue_accepting_new_entries: boolean
          queue_open: boolean
        }[]
      }
      get_service_mode_state: {
        Args: { p_location_id: string }
        Returns: {
          barber_display_name: string
          barber_id: string
          barber_service_mode_override: Database["public"]["Enums"]["service_mode"]
          booking_accepting_new_entries: boolean
          effective_service_mode: Database["public"]["Enums"]["service_mode"]
          location_default_service_mode: Database["public"]["Enums"]["service_mode"]
          mode_allows_booking: boolean
          mode_allows_queue: boolean
          mode_expires_at: string
          mode_source: string
          mode_starts_at: string
          queue_accepting_new_entries: boolean
          queue_open: boolean
          scope: Database["public"]["Enums"]["service_mode_scope"]
        }[]
      }
      get_shared_passport: {
        Args: { p_token: string }
        Returns: {
          beard_preferences: string
          display_name: string
          fade_type: string
          preferences_notes: string
          side_length: string
          status: string
          top_length: string
          usual_haircut: string
        }[]
      }
      join_public_queue: {
        Args: {
          p_barber_id?: string
          p_check_in_token?: string
          p_customer_name: string
          p_customer_phone?: string
          p_latitude?: number
          p_location_id: string
          p_longitude?: number
          p_organization_slug: string
          p_service_id?: string
        }
        Returns: {
          created_at: string
          id: string
          status: Database["public"]["Enums"]["queue_status"]
        }[]
      }
      list_marketplace_withdrawal_requests: {
        Args: { p_include_completed?: boolean }
        Returns: {
          deadline_at: string
          decided_at: string
          hours_remaining: number
          id: string
          is_overdue: boolean
          is_still_public: boolean
          professional_display_name: string
          professional_handle: string
          professional_id: string
          requested_at: string
          requested_via: string
          status: Database["public"]["Enums"]["marketplace_withdrawal_status"]
        }[]
      }
      list_my_followed_organizations: {
        Args: never
        Returns: {
          followed_at: string
          organization_id: string
        }[]
      }
      list_my_followed_professionals: {
        Args: never
        Returns: {
          avatar_url: string
          display_name: string
          followed_at: string
          handle: string
          headline: string
          id: string
        }[]
      }
      list_public_barber_services: {
        Args: { p_barber_id: string; p_organization_slug: string }
        Returns: {
          duration_minutes: number
          id: string
          name: string
          price_cents: number
        }[]
      }
      list_public_barbers: {
        Args: {
          p_location_id: string
          p_organization_slug: string
          p_service_id: string
        }
        Returns: {
          avatar_url: string
          barber_id: string
          bio: string
          display_name: string
          title: string
        }[]
      }
      list_public_locations: {
        Args: { p_organization_slug: string }
        Returns: {
          address_line1: string
          address_line2: string
          city: string
          country: string
          id: string
          kind: Database["public"]["Enums"]["location_kind"]
          name: string
          postal_code: string
          region: string
          service_area_center_latitude: number
          service_area_center_longitude: number
          service_area_radius_km: number
          timezone: string
        }[]
      }
      list_public_organization_barbers: {
        Args: { p_organization_slug: string }
        Returns: {
          avatar_url: string
          barber_id: string
          display_name: string
          location_id: string
          location_name: string
          professional_id: string
          title: string
        }[]
      }
      list_public_services: {
        Args: { p_location_id: string; p_organization_slug: string }
        Returns: {
          category_id: string
          category_name: string
          description: string
          duration_minutes: number
          id: string
          name: string
          price_cents: number
        }[]
      }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_all_platform_notifications_read: { Args: never; Returns: number }
      mark_appointment_no_show: {
        Args: { p_appointment_id: string }
        Returns: {
          barber_id: string
          blocked_range: unknown
          booked_by_user_id: string | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          chair_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          decided_at: string | null
          decided_by: string | null
          ends_at: string
          expires_at: string | null
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          rescheduled_to: string | null
          resolution:
            | Database["public"]["Enums"]["appointment_resolution"]
            | null
          resolution_note: string | null
          service_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: undefined
      }
      mark_platform_notification_read: {
        Args: { p_notification_id: string }
        Returns: undefined
      }
      my_organization_has_capability: {
        Args: { p_capability: string; p_organization_id: string }
        Returns: boolean
      }
      normalize_phone_number: {
        Args: { p_country?: string; p_raw: string }
        Returns: string
      }
      offboard_barber: { Args: { p_barber_id: string }; Returns: undefined }
      outreach_block_reason: {
        Args: {
          p_channel: Database["public"]["Enums"]["outreach_channel_kind"]
          p_prospect_id: string
        }
        Returns: string
      }
      override_prospect_booking_provider: {
        Args: { p_note?: string; p_prospect_id: string; p_provider_key: string }
        Returns: {
          booking_status: Database["public"]["Enums"]["booking_availability_status"]
          confidence: number
          created_at: string
          detection_method: Database["public"]["Enums"]["booking_provider_detection_method"]
          evidence: string | null
          evidence_url: string | null
          first_seen_at: string
          id: string
          is_current: boolean
          job_id: string | null
          last_seen_at: string
          observed_at: string
          prospect_id: string
          provider_id: string
        }
        SetofOptions: {
          from: "*"
          to: "booking_provider_observations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      override_prospect_locale: {
        Args: { p_locale: string; p_prospect_id: string }
        Returns: {
          computed_at: string
          created_at: string
          detected_country: string | null
          detected_language: string | null
          evidence: Json
          language_confidence: number | null
          language_review_required: boolean
          language_source:
            | Database["public"]["Enums"]["prospect_locale_source"]
            | null
          locale: string | null
          override_at: string | null
          override_by: string | null
          override_locale: string | null
          prospect_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "prospect_locales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      promote_ml_model: {
        Args: { p_evaluation_notes: string; p_model_version_id: string }
        Returns: {
          artifact_path: string | null
          artifact_sha256: string | null
          created_at: string
          evaluation_notes: string | null
          feature_schema_version: string
          hyperparameters: Json
          id: string
          is_active: boolean
          metrics: Json
          model_key: string
          model_type: string
          model_version: string
          promoted_at: string | null
          promoted_by: string | null
          random_seed: number
          retired_at: string | null
          target: Database["public"]["Enums"]["ml_model_target"]
          training_dataset_version: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ml_model_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prospect_effective_locale: {
        Args: { p_prospect_id: string }
        Returns: string
      }
      publication_block_reason: {
        Args: { p_prospect_id: string }
        Returns: string
      }
      publish_external_professional: {
        Args: { p_note?: string; p_prospect_id: string }
        Returns: string
      }
      reconcile_customer_professional_relationships: {
        Args: { p_professional_id?: string }
        Returns: {
          rows_removed: number
          rows_written: number
        }[]
      }
      recover_stale_prospect_job_leases: { Args: never; Returns: number }
      redeem_appointment_claim: {
        Args: { p_token: string }
        Returns: {
          claimed: boolean
          organization_name: string
          starts_at: string
        }[]
      }
      refresh_prospect_publication_eligibility: {
        Args: { p_prospect_id: string }
        Returns: {
          block_reason: string | null
          created_at: string
          distinct_source_count: number
          evaluated_at: string
          has_trust_anchor: boolean
          is_eligible: boolean
          prospect_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "prospect_publication_eligibility"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      regenerate_location_queue_check_in_token: {
        Args: { p_location_id: string }
        Returns: string
      }
      reissue_platform_owner_bootstrap_token: {
        Args: { p_expires_in?: string }
        Returns: {
          expires_at: string
          id: string
          raw_token: string
        }[]
      }
      remove_favorite: { Args: { p_favorite_id: string }; Returns: undefined }
      request_marketplace_withdrawal: {
        Args: {
          p_professional_id: string
          p_requested_via: string
          p_requester_note?: string
        }
        Returns: {
          deadline_at: string
          id: string
        }[]
      }
      reschedule_appointment: {
        Args: {
          p_appointment_id: string
          p_barber_id?: string
          p_starts_at: string
        }
        Returns: {
          barber_id: string
          blocked_range: unknown
          booked_by_user_id: string | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          chair_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          decided_at: string | null
          decided_by: string | null
          ends_at: string
          expires_at: string | null
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          rescheduled_to: string | null
          resolution:
            | Database["public"]["Enums"]["appointment_resolution"]
            | null
          resolution_note: string | null
          service_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retire_ml_model: {
        Args: { p_model_version_id: string }
        Returns: {
          artifact_path: string | null
          artifact_sha256: string | null
          created_at: string
          evaluation_notes: string | null
          feature_schema_version: string
          hyperparameters: Json
          id: string
          is_active: boolean
          metrics: Json
          model_key: string
          model_type: string
          model_version: string
          promoted_at: string | null
          promoted_by: string | null
          random_seed: number
          retired_at: string | null
          target: Database["public"]["Enums"]["ml_model_target"]
          training_dataset_version: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ml_model_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_professional_application: {
        Args: {
          p_application_id: string
          p_decision: string
          p_internal_note?: string
          p_rejection_reason?: string
        }
        Returns: {
          address_line1: string | null
          business_identifier: string | null
          business_name: string
          city: string | null
          country: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          instagram: string | null
          internal_note: string | null
          last_name: string
          organization_id: string | null
          phone: string
          postal_code: string | null
          professional_type: Database["public"]["Enums"]["professional_type"]
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          staff_count: number | null
          status: Database["public"]["Enums"]["professional_application_status"]
          submitted_at: string
          updated_at: string
          user_id: string
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "professional_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_professional_claim: {
        Args: { p_claim_id: string; p_decision: string; p_note?: string }
        Returns: {
          claimant_user_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          evidence: string | null
          id: string
          professional_id: string
          state: Database["public"]["Enums"]["professional_claim_status"]
          submitted_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "professional_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_invitation: {
        Args: { p_invitation_id: string }
        Returns: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          location_id: string | null
          organization_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["membership_role"]
          token: string
        }
        SetofOptions: {
          from: "*"
          to: "invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_passport_share: {
        Args: { p_share_id: string }
        Returns: undefined
      }
      revoke_platform_invitation: {
        Args: { p_id: string }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          expires_at: string
          id: string
          invited_by: string
          invited_email: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["platform_role"]
          token_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      run_acquisition_maintenance: {
        Args: never
        Returns: {
          expired_requests: number
          outreach_queued: number
        }[]
      }
      run_booking_maintenance: {
        Args: never
        Returns: {
          expired_requests: number
        }[]
      }
      run_email_delivery: {
        Args: never
        Returns: {
          dispatched: number
          reconciled: number
        }[]
      }
      save_business_profile: {
        Args: {
          p_business_type?: Database["public"]["Enums"]["business_type"]
          p_country_code?: string
          p_currency?: string
          p_name?: string
          p_organization_id: string
        }
        Returns: {
          booking_request_ttl_minutes: number
          business_type: Database["public"]["Enums"]["business_type"] | null
          country_code: string | null
          created_at: string
          currency: string | null
          id: string
          marketplace_visible: boolean
          name: string
          onboarding_completed_at: string | null
          slug: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_public_organizations: {
        Args: {
          p_city?: string
          p_country?: string
          p_latitude?: number
          p_limit?: number
          p_longitude?: number
          p_offset?: number
          p_query?: string
          p_radius_km?: number
        }
        Returns: {
          address_line1: string
          city: string
          country: string
          covers_search_point: boolean
          distance_km: number
          is_open_now: boolean
          location_id: string
          location_kind: Database["public"]["Enums"]["location_kind"]
          location_name: string
          organization_id: string
          organization_name: string
          organization_slug: string
          postal_code: string
          queue_waiting_count: number
          region: string
          service_area_radius_km: number
          starting_price_cents: number
          total_count: number
        }[]
      }
      search_public_professionals: {
        Args: {
          p_city?: string
          p_country?: string
          p_entity_type?: string
          p_latitude?: number
          p_limit?: number
          p_longitude?: number
          p_max_price_cents?: number
          p_min_price_cents?: number
          p_offset?: number
          p_open_now_only?: boolean
          p_query?: string
          p_radius_km?: number
          p_service_query?: string
          p_sort?: string
        }
        Returns: {
          address_line1: string
          barber_avatar_url: string
          barber_display_name: string
          barber_id: string
          barber_title: string
          city: string
          country: string
          covers_search_point: boolean
          distance_km: number
          entity_type: string
          is_open_now: boolean
          latitude: number
          location_id: string
          location_kind: Database["public"]["Enums"]["location_kind"]
          location_name: string
          longitude: number
          marketplace_supply_type: string
          organization_id: string
          organization_name: string
          organization_slug: string
          postal_code: string
          professional_id: string
          queue_waiting_count: number
          region: string
          service_area_center_latitude: number
          service_area_center_longitude: number
          service_area_radius_km: number
          starting_price_cents: number
          timezone: string
          total_count: number
        }[]
      }
      set_barber_service_mode_override: {
        Args: {
          p_barber_id: string
          p_mode?: Database["public"]["Enums"]["service_mode"]
        }
        Returns: {
          created_at: string
          id: string
          is_bookable: boolean
          organization_id: string
          professional_id: string | null
          service_mode_override:
            | Database["public"]["Enums"]["service_mode"]
            | null
          staff_profile_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "barbers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_location_queue_open: {
        Args: { p_location_id: string; p_queue_open: boolean }
        Returns: {
          created_at: string
          default_service_mode: Database["public"]["Enums"]["service_mode"]
          location_id: string
          organization_id: string
          queue_call_grace_minutes: number
          queue_capacity_per_barber: number
          queue_geofence_meters: number
          queue_open: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "location_service_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_location_service_mode: {
        Args: {
          p_location_id: string
          p_mode: Database["public"]["Enums"]["service_mode"]
        }
        Returns: {
          created_at: string
          default_service_mode: Database["public"]["Enums"]["service_mode"]
          location_id: string
          organization_id: string
          queue_call_grace_minutes: number
          queue_capacity_per_barber: number
          queue_geofence_meters: number
          queue_open: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "location_service_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_organization_marketplace_visible: {
        Args: { p_organization_id: string; p_visible: boolean }
        Returns: {
          booking_request_ttl_minutes: number
          business_type: Database["public"]["Enums"]["business_type"] | null
          country_code: string | null
          created_at: string
          currency: string | null
          id: string
          marketplace_visible: boolean
          name: string
          onboarding_completed_at: string | null
          slug: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_outreach_campaign_status: {
        Args: {
          p_campaign_id: string
          p_status: Database["public"]["Enums"]["outreach_campaign_status"]
        }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          channel: Database["public"]["Enums"]["outreach_channel_kind"]
          completed_at: string | null
          created_at: string
          created_by: string | null
          experiment_id: string | null
          id: string
          max_sends_per_hour: number
          name: string
          selection_filters: Json
          started_at: string | null
          status: Database["public"]["Enums"]["outreach_campaign_status"]
          updated_at: string
          whatsapp_account_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "outreach_campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_outreach_template_paused: {
        Args: { p_paused: boolean; p_template_id: string }
        Returns: {
          allowed_variables: string[]
          approved_at: string | null
          approved_by: string | null
          body: string
          booking_provider_id: string | null
          channel: Database["public"]["Enums"]["outreach_channel_kind"]
          created_at: string
          created_by: string | null
          id: string
          key: string
          locale: string
          name: string
          notes: string | null
          sales_angle: string | null
          segment_key: string | null
          status: Database["public"]["Enums"]["outreach_template_status"]
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "outreach_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_prospect_source_enabled: {
        Args: { p_enabled: boolean; p_key: string }
        Returns: {
          config: Json
          created_at: string
          display_name: string
          id: string
          independence_group: string | null
          is_enabled: boolean
          is_identity_trust_anchor: boolean
          key: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "prospect_sources"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_prospect_source_paused: {
        Args: { p_key: string; p_paused: boolean; p_reason?: string }
        Returns: {
          avg_latency_ms: number | null
          created_at: string
          failure_count: number
          id: string
          is_paused: boolean
          last_error: string | null
          last_failure_at: string | null
          last_request_at: string | null
          last_reset_day: string
          last_reset_month: string
          last_success_at: string | null
          paused_reason: string | null
          rate_limited_count: number
          requests_this_month: number
          requests_today: number
          source_id: string
          success_count: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "api_source_health"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_service_mode_temporary_override: {
        Args: {
          p_barber_id?: string
          p_expires_at?: string
          p_location_id: string
          p_mode: Database["public"]["Enums"]["service_mode"]
          p_scope: Database["public"]["Enums"]["service_mode_scope"]
        }
        Returns: {
          barber_id: string | null
          cleared_at: string | null
          cleared_by_user_id: string | null
          created_at: string
          created_by_user_id: string | null
          expires_at: string | null
          id: string
          location_id: string
          mode: Database["public"]["Enums"]["service_mode"]
          organization_id: string
          scope: Database["public"]["Enums"]["service_mode_scope"]
          starts_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "service_mode_overrides"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_platform_support_session: {
        Args: {
          p_organization_id: string
          p_reason?: string
          p_target_type: string
          p_target_user_id?: string
        }
        Returns: {
          ended_at: string | null
          id: string
          organization_id: string
          platform_actor_id: string
          reason: string | null
          started_at: string
          target_type: string
          target_user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "platform_support_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_professional_application: {
        Args: {
          p_address_line1?: string
          p_business_identifier?: string
          p_business_name: string
          p_city?: string
          p_country?: string
          p_first_name: string
          p_instagram?: string
          p_last_name: string
          p_phone: string
          p_postal_code?: string
          p_professional_type: Database["public"]["Enums"]["professional_type"]
          p_staff_count?: number
          p_website?: string
        }
        Returns: {
          address_line1: string | null
          business_identifier: string | null
          business_name: string
          city: string | null
          country: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          instagram: string | null
          internal_note: string | null
          last_name: string
          organization_id: string | null
          phone: string
          postal_code: string | null
          professional_type: Database["public"]["Enums"]["professional_type"]
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          staff_count: number | null
          status: Database["public"]["Enums"]["professional_application_status"]
          submitted_at: string
          updated_at: string
          user_id: string
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "professional_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_professional_claim: {
        Args: { p_evidence?: string; p_professional_id: string }
        Returns: string
      }
      suggested_currency_for_country: {
        Args: { p_country_code: string }
        Returns: string
      }
      suggested_timezone_for_country: {
        Args: { p_country_code: string }
        Returns: string
      }
      suppress_prospect_outreach: {
        Args: { p_prospect_id: string; p_reason: string }
        Returns: undefined
      }
      sweep_prospect_publication_eligibility: {
        Args: { p_limit?: number }
        Returns: {
          block_reason: string
          is_eligible: boolean
          prospect_id: string
        }[]
      }
      track_analytics_event: {
        Args: {
          p_barber_id?: string
          p_correlation_id?: string
          p_event_name: string
          p_event_origin: string
          p_locale?: string
          p_location_id?: string
          p_organization_id?: string
          p_professional_id?: string
          p_properties?: Json
          p_session_id?: string
        }
        Returns: undefined
      }
      unfollow_organization: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      unfollow_professional: {
        Args: { p_professional_id: string }
        Returns: undefined
      }
      unsubscribe_prospect_outreach: {
        Args: { p_token: string }
        Returns: {
          unsubscribed: boolean
        }[]
      }
      withdraw_external_professional: {
        Args: { p_note?: string; p_professional_id: string }
        Returns: string
      }
      withdraw_professional_claim: {
        Args: { p_claim_id: string }
        Returns: undefined
      }
    }
    Enums: {
      analytics_actor_type:
        | "anonymous"
        | "customer"
        | "professional"
        | "staff"
        | "platform_admin"
        | "worker"
        | "system"
      analytics_emission: "server" | "client"
      analytics_event_origin:
        | "public_web"
        | "customer_web"
        | "customer_mobile"
        | "pro_web"
        | "backend"
        | "worker"
        | "system"
      analytics_event_status: "wired" | "deferred"
      appointment_resolution:
        | "declined"
        | "expired"
        | "cancelled_by_customer"
        | "cancelled_by_business"
        | "rescheduled"
      appointment_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
      billing_interval: "weekly" | "monthly" | "yearly"
      booking_availability_status: "ACTIVE" | "LISTED_ONLY" | "UNKNOWN"
      booking_provider_detection_method:
        | "booking_url"
        | "outbound_link"
        | "embedded_widget"
        | "iframe_domain"
        | "script_domain"
        | "booking_button_target"
        | "structured_data"
        | "domain_pattern"
        | "provider_directory"
        | "manual_override"
        | "provider_public_page"
      business_type:
        | "solo_professional"
        | "barbershop"
        | "hair_salon"
        | "mixed_salon"
        | "multi_location"
      commercial_family: "free" | "independent" | "salon" | "multi_salon"
      commercial_status: "active" | "past_due" | "canceled"
      customer_appointment_preference: "appointment" | "walk_in" | "either"
      customer_haircut_frequency:
        | "weekly"
        | "every_2_weeks"
        | "every_3_weeks"
        | "monthly"
        | "less_often"
        | "depends"
      customer_membership_status: "active" | "paused" | "cancelled" | "expired"
      customer_style_preference:
        | "fade"
        | "taper"
        | "crop"
        | "buzz"
        | "afro"
        | "curly"
        | "long"
        | "beard_focus"
        | "other"
      email_delivery_status: "queued" | "sent" | "failed" | "sending"
      email_stream: "transactional" | "prospecting"
      entitlement_source: "early_access" | "platform_grant" | "billing"
      follow_source: "manual" | "auto"
      follow_state: "following" | "unfollowed"
      interest_request_status: "pending" | "expired" | "withdrawn"
      location_kind: "physical_address" | "service_area"
      marketplace_withdrawal_status: "pending" | "completed" | "rejected"
      membership_role: "owner" | "manager" | "receptionist" | "barber"
      ml_model_target:
        | "reply"
        | "positive_reply"
        | "claim"
        | "activated"
        | "paid"
        | "expected_value"
      notification_type:
        | "booking_request_created"
        | "booking_confirmed"
        | "booking_declined"
        | "booking_expired"
        | "booking_cancelled"
        | "booking_rescheduled"
        | "team_invitation"
      outreach_campaign_status:
        | "draft"
        | "preparing"
        | "ready"
        | "running"
        | "paused"
        | "completed"
        | "cancelled"
        | "failed"
      outreach_channel_kind: "whatsapp" | "email" | "sms"
      outreach_event_type:
        | "queued"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
        | "replied"
        | "positive_reply"
        | "negative_reply"
        | "opted_out"
        | "claim_started"
        | "claim_completed"
        | "registered"
        | "activated"
        | "first_booking"
        | "paid"
      outreach_opt_in_status: "none" | "pending" | "confirmed" | "withdrawn"
      outreach_recipient_state:
        | "blocked"
        | "pending"
        | "queued"
        | "sent"
        | "delivered"
        | "read"
        | "replied"
        | "positive_reply"
        | "negative_reply"
        | "failed"
        | "opted_out"
        | "claimed"
        | "activated"
        | "paid"
      outreach_template_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "paused"
        | "retired"
      platform_role: "platform_owner" | "platform_admin" | "platform_support"
      professional_application_status:
        | "pending_review"
        | "approved"
        | "rejected"
      professional_claim_state: "unclaimed" | "claimed"
      professional_claim_status:
        | "pending"
        | "approved"
        | "rejected"
        | "withdrawn"
      professional_source: "fadeup" | "acquisition"
      professional_type:
        | "barbershop"
        | "independent_barber"
        | "private_studio"
        | "mobile_barber"
      prospect_duplicate_status:
        | "pending"
        | "confirmed_duplicate"
        | "confirmed_distinct"
      prospect_entity_kind: "independent" | "group_parent" | "group_location"
      prospect_fit_class: "HOT" | "WARM" | "COLD"
      prospect_identity_match_state:
        | "MATCHED"
        | "POSSIBLE_MATCH"
        | "REVIEW_REQUIRED"
        | "NOT_MATCHED"
      prospect_job_source_status:
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "skipped"
      prospect_job_status:
        | "queued"
        | "running"
        | "retry"
        | "completed"
        | "failed"
        | "cancelled"
      prospect_locale_source:
        | "verified_business_country"
        | "business_address"
        | "website_language"
        | "provider_locale"
        | "phone_country"
        | "dominant_website_language"
        | "manual_override"
        | "default_fallback"
      prospect_outreach_channel:
        | "email"
        | "phone"
        | "sms"
        | "instagram_dm"
        | "in_person"
        | "other"
      prospect_outreach_direction: "outbound" | "inbound"
      prospect_pipeline_stage:
        | "discovered"
        | "enriched"
        | "qualified"
        | "selected"
        | "contacted"
        | "replied"
        | "demo"
        | "trial"
        | "customer"
        | "lost"
      prospect_score_bucket: "LOW" | "MEDIUM" | "HIGH" | "HOT"
      prospect_search_partition_status:
        | "planned"
        | "running"
        | "completed"
        | "saturated"
        | "subdivided"
        | "skipped"
        | "failed"
      prospect_social_platform:
        | "instagram"
        | "facebook"
        | "tiktok"
        | "twitter"
        | "youtube"
        | "linkedin"
        | "other"
      prospect_suppression_scope:
        | "prospect"
        | "phone"
        | "email"
        | "domain"
        | "instagram_handle"
      prospect_tribool: "TRUE" | "FALSE" | "UNKNOWN" | "NOT_APPLICABLE"
      prospect_type: "barbershop" | "independent_barber"
      queue_status:
        | "waiting"
        | "called"
        | "in_service"
        | "completed"
        | "cancelled"
        | "no_show"
      service_mode: "hybrid" | "reservation_only" | "queue_only" | "unavailable"
      service_mode_change_kind:
        | "location_default"
        | "barber_override"
        | "temporary_override_set"
        | "temporary_override_cleared"
        | "queue_open"
      service_mode_scope: "location" | "barber"
      waitlist_status:
        | "waiting"
        | "notified"
        | "booked"
        | "cancelled"
        | "expired"
      whatsapp_message_direction: "outbound" | "inbound"
      whatsapp_message_status:
        | "pending"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
        | "received"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      analytics_actor_type: [
        "anonymous",
        "customer",
        "professional",
        "staff",
        "platform_admin",
        "worker",
        "system",
      ],
      analytics_emission: ["server", "client"],
      analytics_event_origin: [
        "public_web",
        "customer_web",
        "customer_mobile",
        "pro_web",
        "backend",
        "worker",
        "system",
      ],
      analytics_event_status: ["wired", "deferred"],
      appointment_resolution: [
        "declined",
        "expired",
        "cancelled_by_customer",
        "cancelled_by_business",
        "rescheduled",
      ],
      appointment_status: [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      billing_interval: ["weekly", "monthly", "yearly"],
      booking_availability_status: ["ACTIVE", "LISTED_ONLY", "UNKNOWN"],
      booking_provider_detection_method: [
        "booking_url",
        "outbound_link",
        "embedded_widget",
        "iframe_domain",
        "script_domain",
        "booking_button_target",
        "structured_data",
        "domain_pattern",
        "provider_directory",
        "manual_override",
        "provider_public_page",
      ],
      business_type: [
        "solo_professional",
        "barbershop",
        "hair_salon",
        "mixed_salon",
        "multi_location",
      ],
      commercial_family: ["free", "independent", "salon", "multi_salon"],
      commercial_status: ["active", "past_due", "canceled"],
      customer_appointment_preference: ["appointment", "walk_in", "either"],
      customer_haircut_frequency: [
        "weekly",
        "every_2_weeks",
        "every_3_weeks",
        "monthly",
        "less_often",
        "depends",
      ],
      customer_membership_status: ["active", "paused", "cancelled", "expired"],
      customer_style_preference: [
        "fade",
        "taper",
        "crop",
        "buzz",
        "afro",
        "curly",
        "long",
        "beard_focus",
        "other",
      ],
      email_delivery_status: ["queued", "sent", "failed", "sending"],
      email_stream: ["transactional", "prospecting"],
      entitlement_source: ["early_access", "platform_grant", "billing"],
      follow_source: ["manual", "auto"],
      follow_state: ["following", "unfollowed"],
      interest_request_status: ["pending", "expired", "withdrawn"],
      location_kind: ["physical_address", "service_area"],
      marketplace_withdrawal_status: ["pending", "completed", "rejected"],
      membership_role: ["owner", "manager", "receptionist", "barber"],
      ml_model_target: [
        "reply",
        "positive_reply",
        "claim",
        "activated",
        "paid",
        "expected_value",
      ],
      notification_type: [
        "booking_request_created",
        "booking_confirmed",
        "booking_declined",
        "booking_expired",
        "booking_cancelled",
        "booking_rescheduled",
        "team_invitation",
      ],
      outreach_campaign_status: [
        "draft",
        "preparing",
        "ready",
        "running",
        "paused",
        "completed",
        "cancelled",
        "failed",
      ],
      outreach_channel_kind: ["whatsapp", "email", "sms"],
      outreach_event_type: [
        "queued",
        "sent",
        "delivered",
        "read",
        "failed",
        "replied",
        "positive_reply",
        "negative_reply",
        "opted_out",
        "claim_started",
        "claim_completed",
        "registered",
        "activated",
        "first_booking",
        "paid",
      ],
      outreach_opt_in_status: ["none", "pending", "confirmed", "withdrawn"],
      outreach_recipient_state: [
        "blocked",
        "pending",
        "queued",
        "sent",
        "delivered",
        "read",
        "replied",
        "positive_reply",
        "negative_reply",
        "failed",
        "opted_out",
        "claimed",
        "activated",
        "paid",
      ],
      outreach_template_status: [
        "draft",
        "pending_approval",
        "approved",
        "paused",
        "retired",
      ],
      platform_role: ["platform_owner", "platform_admin", "platform_support"],
      professional_application_status: [
        "pending_review",
        "approved",
        "rejected",
      ],
      professional_claim_state: ["unclaimed", "claimed"],
      professional_claim_status: [
        "pending",
        "approved",
        "rejected",
        "withdrawn",
      ],
      professional_source: ["fadeup", "acquisition"],
      professional_type: [
        "barbershop",
        "independent_barber",
        "private_studio",
        "mobile_barber",
      ],
      prospect_duplicate_status: [
        "pending",
        "confirmed_duplicate",
        "confirmed_distinct",
      ],
      prospect_entity_kind: ["independent", "group_parent", "group_location"],
      prospect_fit_class: ["HOT", "WARM", "COLD"],
      prospect_identity_match_state: [
        "MATCHED",
        "POSSIBLE_MATCH",
        "REVIEW_REQUIRED",
        "NOT_MATCHED",
      ],
      prospect_job_source_status: [
        "pending",
        "running",
        "completed",
        "failed",
        "skipped",
      ],
      prospect_job_status: [
        "queued",
        "running",
        "retry",
        "completed",
        "failed",
        "cancelled",
      ],
      prospect_locale_source: [
        "verified_business_country",
        "business_address",
        "website_language",
        "provider_locale",
        "phone_country",
        "dominant_website_language",
        "manual_override",
        "default_fallback",
      ],
      prospect_outreach_channel: [
        "email",
        "phone",
        "sms",
        "instagram_dm",
        "in_person",
        "other",
      ],
      prospect_outreach_direction: ["outbound", "inbound"],
      prospect_pipeline_stage: [
        "discovered",
        "enriched",
        "qualified",
        "selected",
        "contacted",
        "replied",
        "demo",
        "trial",
        "customer",
        "lost",
      ],
      prospect_score_bucket: ["LOW", "MEDIUM", "HIGH", "HOT"],
      prospect_search_partition_status: [
        "planned",
        "running",
        "completed",
        "saturated",
        "subdivided",
        "skipped",
        "failed",
      ],
      prospect_social_platform: [
        "instagram",
        "facebook",
        "tiktok",
        "twitter",
        "youtube",
        "linkedin",
        "other",
      ],
      prospect_suppression_scope: [
        "prospect",
        "phone",
        "email",
        "domain",
        "instagram_handle",
      ],
      prospect_tribool: ["TRUE", "FALSE", "UNKNOWN", "NOT_APPLICABLE"],
      prospect_type: ["barbershop", "independent_barber"],
      queue_status: [
        "waiting",
        "called",
        "in_service",
        "completed",
        "cancelled",
        "no_show",
      ],
      service_mode: ["hybrid", "reservation_only", "queue_only", "unavailable"],
      service_mode_change_kind: [
        "location_default",
        "barber_override",
        "temporary_override_set",
        "temporary_override_cleared",
        "queue_open",
      ],
      service_mode_scope: ["location", "barber"],
      waitlist_status: [
        "waiting",
        "notified",
        "booked",
        "cancelled",
        "expired",
      ],
      whatsapp_message_direction: ["outbound", "inbound"],
      whatsapp_message_status: [
        "pending",
        "sent",
        "delivered",
        "read",
        "failed",
        "received",
      ],
    },
  },
} as const
