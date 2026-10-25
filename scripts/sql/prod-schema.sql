-- ИСТОРИЧЕСКИЙ СНИМОК: последний автоматический экспорт в git — f0d836d, 09.09.2026.
-- Актуальность относительно живой БД 14.09.2026 без сервера НЕ установлена.
-- Новые выкат/схема/RESTORE формируют единый комплект backups/release-... с SHA-256.
-- Для восстановления выбирайте комплект по release.json; см. RESTORE.md.
--
-- PostgreSQL database dump
--

\restrict 6QUqHG3p4Ym5EyBLjhaXoQFKl7m24vTDhknv3RTYcq0x7efxKxR8LkROLgQhSgR

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: attestation_attempts_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attestation_attempts_status_enum AS ENUM (
    'assigned',
    'submitted',
    'ai_graded',
    'graded'
);


--
-- Name: attestation_tests_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attestation_tests_status_enum AS ENUM (
    'generating',
    'draft',
    'active',
    'closed'
);


--
-- Name: entries_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.entries_status_enum AS ENUM (
    'draft',
    'submitted',
    'reviewed'
);


--
-- Name: entries_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.entries_type_enum AS ENUM (
    'call',
    'chat'
);


--
-- Name: invites_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invites_status_enum AS ENUM (
    'pending',
    'accepted',
    'expired'
);


--
-- Name: notifications_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notifications_type_enum AS ENUM (
    'entry_submitted',
    'entry_reviewed',
    'entry_needs_revision',
    'sprint_started',
    'sprint_deadline',
    'invite_accepted',
    'crm_error',
    'help_requested',
    'rop_bonus',
    'launch',
    'stt_error',
    'crm_connected',
    'playbook_candidate',
    'attestation_assigned',
    'attestation_ready_to_review',
    'attestation_result',
    'access_not_used',
    'team_changed'
);


--
-- Name: playbook_cards_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.playbook_cards_status_enum AS ENUM (
    'candidate',
    'active',
    'dismissed'
);


--
-- Name: sprints_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sprints_status_enum AS ENUM (
    'active',
    'completed',
    'archived'
);


--
-- Name: users_role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.users_role_enum AS ENUM (
    'superadmin',
    'owner',
    'reviewer',
    'manager',
    'tracker'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievements (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "userId" uuid NOT NULL,
    type character varying NOT NULL,
    "earnedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: attestation_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attestation_answers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "attemptId" uuid NOT NULL,
    "questionId" uuid NOT NULL,
    "answerText" text DEFAULT ''::text NOT NULL,
    "aiSuggestedScore" integer,
    "aiSuggestedReasoning" text,
    "reviewerScore" integer,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: attestation_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attestation_attempts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "testId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    status public.attestation_attempts_status_enum DEFAULT 'assigned'::public.attestation_attempts_status_enum NOT NULL,
    "startedAt" timestamp without time zone,
    "submittedAt" timestamp without time zone,
    "gradedAt" timestamp without time zone,
    "gradedBy" character varying,
    "totalScorePercent" numeric(5,1),
    passed boolean,
    "failedCritical" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: attestation_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attestation_questions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "testId" uuid NOT NULL,
    "cardId" uuid,
    type character varying(20) NOT NULL,
    "isCritical" boolean DEFAULT false NOT NULL,
    weight integer DEFAULT 1 NOT NULL,
    "questionText" text NOT NULL,
    "referenceAnswer" text NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: attestation_tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attestation_tests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "companyId" uuid NOT NULL,
    title character varying(255) NOT NULL,
    status public.attestation_tests_status_enum DEFAULT 'generating'::public.attestation_tests_status_enum NOT NULL,
    "passingScorePercent" integer DEFAULT 75 NOT NULL,
    deadline date,
    "formVariant" character varying(1) DEFAULT 'A'::character varying NOT NULL,
    "originalTestId" uuid,
    "createdBy" character varying NOT NULL,
    "generationError" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "closedAt" timestamp without time zone,
    "isQuiz" boolean DEFAULT false NOT NULL
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    logo_url character varying(500),
    calls_per_week integer DEFAULT 5 NOT NULL,
    chats_per_week integer DEFAULT 5 NOT NULL,
    manager_deadline_day character varying(20) DEFAULT 'friday'::character varying NOT NULL,
    reviewer_deadline_day character varying(20) DEFAULT 'friday'::character varying NOT NULL,
    threshold_good_calls integer DEFAULT 5 NOT NULL,
    threshold_good_chats integer DEFAULT 5 NOT NULL,
    threshold_great_calls integer DEFAULT 8 NOT NULL,
    threshold_great_chats integer DEFAULT 8 NOT NULL,
    "callsEnabled" boolean DEFAULT true NOT NULL,
    "chatsEnabled" boolean DEFAULT true NOT NULL,
    "minSelfReviewCorrectChars" integer DEFAULT 50 NOT NULL,
    "minSelfReviewImproveChars" integer DEFAULT 80 NOT NULL,
    "minSelfReviewSuggestionsChars" integer DEFAULT 0 NOT NULL,
    "minReviewChars" integer DEFAULT 150 NOT NULL,
    "onboardingCompleted" boolean DEFAULT false NOT NULL,
    call_sources jsonb DEFAULT '["Fireflies.ai", "OTR.AI", "Вручную"]'::jsonb NOT NULL,
    chat_sources jsonb DEFAULT '["Instagram", "Telegram", "WhatsApp", "VK", "Другое"]'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    gamification_enabled boolean DEFAULT true NOT NULL,
    reviewer_can_edit_gamification boolean DEFAULT false NOT NULL,
    xp_settings jsonb DEFAULT '{"streakBonus": 25, "entrySubmitted": 3, "reviewNoErrors": 0, "reviewReceived": 2, "weeklyGoodZone": 30, "weeklyGreatZone": 60, "selfReviewComplete": 10}'::jsonb NOT NULL,
    achievement_settings jsonb DEFAULT '{"sniperThreshold": 3, "writerThreshold": 5, "great3xThreshold": 3, "streak7Threshold": 7, "streak30Threshold": 30}'::jsonb NOT NULL,
    reviewer_can_edit_review_templates boolean DEFAULT false NOT NULL,
    review_norms jsonb DEFAULT '{"maxHoursToRespond": 24, "minReviewCharsAvg": 150, "minReviewsPerWeek": 0, "qualityThresholdPct": 80}'::jsonb NOT NULL,
    report_channels jsonb DEFAULT '{"weeklyAccountability": {"emails": [], "telegramChatIds": []}}'::jsonb NOT NULL,
    rop_bonus jsonb DEFAULT '{"tiers": [{"amount": 20000, "thresholdPct": 95}, {"amount": 16000, "thresholdPct": 80}], "enabled": false}'::jsonb NOT NULL,
    transcription jsonb DEFAULT '{"enabled": true, "monthlyMinutesLimit": 300}'::jsonb NOT NULL,
    timezone character varying(64) DEFAULT 'Europe/Moscow'::character varying NOT NULL,
    offer_token character varying(64),
    offer_accepted_at timestamp without time zone,
    trial_ends_at timestamp without time zone,
    work_started_at timestamp without time zone,
    telegram_work_chat_id character varying(64),
    telegram_bind_code character varying(32),
    trial_days integer DEFAULT 30 NOT NULL,
    legal_info jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(16) DEFAULT 'launch'::character varying NOT NULL,
    rop_bonus_proposal jsonb DEFAULT '{}'::jsonb NOT NULL,
    pdn_consent_accepted_at timestamp without time zone,
    offer_accepted_ip character varying(64),
    crm_help_requested_at timestamp without time zone,
    license_mode character varying(16) DEFAULT 'trial'::character varying NOT NULL,
    launched_at timestamp without time zone,
    crm_setup_token character varying(64),
    crm_setup_token_expires_at timestamp without time zone,
    pause_info jsonb DEFAULT '{}'::jsonb NOT NULL,
    payment_hold boolean DEFAULT false NOT NULL,
    payment_hold_info jsonb DEFAULT '{}'::jsonb NOT NULL,
    crm_not_applicable boolean DEFAULT false NOT NULL,
    crm_not_applicable_info jsonb DEFAULT '{}'::jsonb NOT NULL,
    crm_hint_snoozed_until timestamp without time zone
);


--
-- Name: company_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    type character varying(32) NOT NULL,
    title character varying(255) NOT NULL,
    details text,
    actor_user_id uuid,
    actor_label character varying(255),
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_connections (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    provider character varying(20) NOT NULL,
    base_url character varying(500) NOT NULL,
    secret_encrypted text NOT NULL,
    user_map jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'unverified'::character varying NOT NULL,
    last_check_at timestamp without time zone,
    last_error character varying(100),
    created_by uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "sprintId" uuid NOT NULL,
    "managerId" uuid NOT NULL,
    "companyId" uuid NOT NULL,
    type public.entries_type_enum NOT NULL,
    "entryNumber" integer NOT NULL,
    "entryDate" date NOT NULL,
    source character varying,
    "sourceCustom" character varying,
    transcription text,
    "selfReviewCorrect" text,
    "selfReviewImprove" text,
    "selfReviewSuggestions" text,
    "reviewText" text,
    "reviewerId" uuid,
    "reviewedAt" timestamp without time zone,
    status public.entries_status_enum DEFAULT 'draft'::public.entries_status_enum NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "deletedAt" timestamp without time zone,
    "crmCallId" character varying(255),
    "crmProvider" character varying(20),
    "crmCallMetadata" jsonb,
    "reviewEmbedding" jsonb,
    "submittedAt" timestamp without time zone
);


--
-- Name: entry_audio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entry_audio (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "entryId" uuid NOT NULL,
    "fileUrl" character varying NOT NULL,
    "originalFileName" character varying NOT NULL,
    "fileSize" integer DEFAULT 0 NOT NULL,
    "durationSec" integer DEFAULT 0 NOT NULL,
    status character varying DEFAULT 'converting'::character varying NOT NULL,
    "errorMessage" text,
    provider character varying DEFAULT 'salutespeech'::character varying NOT NULL,
    "providerTaskId" character varying,
    "transcriptionResult" text,
    "appliedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: entry_error_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entry_error_tags (
    "entriesId" uuid NOT NULL,
    "errorTagsId" uuid NOT NULL
);


--
-- Name: entry_screenshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entry_screenshots (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "entryId" uuid NOT NULL,
    "fileUrl" character varying NOT NULL,
    "fileName" character varying NOT NULL,
    "fileSize" integer NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "extractedText" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: error_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.error_tags (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "companyId" uuid NOT NULL,
    name character varying NOT NULL,
    description character varying,
    color character varying DEFAULT '#F97316'::character varying NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invites (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying NOT NULL,
    email character varying NOT NULL,
    role character varying DEFAULT 'manager'::character varying NOT NULL,
    status public.invites_status_enum DEFAULT 'pending'::public.invites_status_enum NOT NULL,
    "companyId" uuid NOT NULL,
    "fullName" character varying(255),
    "invitedById" uuid,
    "expiresAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "userId" uuid NOT NULL,
    type public.notifications_type_enum NOT NULL,
    title character varying NOT NULL,
    message text NOT NULL,
    "linkUrl" character varying,
    "isRead" boolean DEFAULT false NOT NULL,
    "relatedId" character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: playbook_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playbook_cards (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "companyId" uuid NOT NULL,
    "errorTagId" uuid,
    title character varying(255) NOT NULL,
    "ruleText" text,
    examples jsonb DEFAULT '[]'::jsonb NOT NULL,
    status public.playbook_cards_status_enum DEFAULT 'candidate'::public.playbook_cards_status_enum NOT NULL,
    "occurrenceCount" integer DEFAULT 0 NOT NULL,
    trend character varying(20) DEFAULT 'stable'::character varying NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    "ownerId" uuid,
    "ownerName" character varying(150),
    "confirmedAt" timestamp without time zone,
    "confirmedBy" character varying,
    "dismissedAt" timestamp without time zone,
    "dismissedBy" character varying,
    "dismissedReason" text,
    "occurrenceCountAtDismissal" integer,
    "reviewDueAt" date,
    version integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "draftRuleText" text,
    "detectionSource" character varying(20) DEFAULT 'tag'::character varying NOT NULL,
    "sourceEntryIds" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "lastOccurrenceAt" timestamp without time zone,
    "autoResolvedHint" boolean DEFAULT false NOT NULL,
    "overdueNotifiedAt" timestamp without time zone
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    token character varying(500) NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    is_revoked boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: review_template_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_template_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "templateId" character varying NOT NULL,
    "previousContent" text NOT NULL,
    "newContent" text NOT NULL,
    "changedBy" character varying NOT NULL,
    "changedByName" character varying(150) NOT NULL,
    version integer NOT NULL,
    "changedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: review_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_templates (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "companyId" uuid NOT NULL,
    name character varying(255) NOT NULL,
    content text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdBy" character varying NOT NULL,
    "createdByName" character varying(150),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: rop_bonus_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rop_bonus_snapshots (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    period character varying(7) NOT NULL,
    on_time_count integer NOT NULL,
    late_count integer NOT NULL,
    on_time_pct integer,
    max_hours_to_respond integer NOT NULL,
    tiers jsonb NOT NULL,
    amount integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    short_count integer DEFAULT 0 NOT NULL,
    min_review_chars integer DEFAULT 150 NOT NULL,
    workdays_only boolean DEFAULT true NOT NULL,
    rop_name character varying(255)
);


--
-- Name: share_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.share_tokens (
    id uuid NOT NULL,
    "entryId" uuid NOT NULL,
    "issuedBy" uuid NOT NULL,
    "revokedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sprints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sprints (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "companyId" uuid NOT NULL,
    "startDate" date NOT NULL,
    "endDate" date NOT NULL,
    label character varying(50) NOT NULL,
    status public.sprints_status_enum DEFAULT 'active'::public.sprints_status_enum NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: staff_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_signals (
    key character varying(64) NOT NULL,
    signal_id character varying(128) NOT NULL,
    stage character varying(64) DEFAULT ''::character varying NOT NULL,
    text text NOT NULL,
    first_seen_at timestamp without time zone DEFAULT now() NOT NULL,
    last_sent_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: telegram_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_contacts (
    username character varying(64) NOT NULL,
    chat_id character varying(32) NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    user_id uuid
);


--
-- Name: telegram_detected_chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_detected_chats (
    chat_id character varying(64) NOT NULL,
    title character varying(255),
    is_admin boolean DEFAULT false NOT NULL,
    bound_company_id uuid,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: transcription_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transcription_usage (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "companyId" uuid NOT NULL,
    "entryAudioId" uuid,
    seconds integer NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: user_gamification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_gamification (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "userId" uuid NOT NULL,
    "totalXp" integer DEFAULT 0 NOT NULL,
    "currentStreak" integer DEFAULT 0 NOT NULL,
    "bestStreak" integer DEFAULT 0 NOT NULL,
    "lastStreakWeek" character varying(10),
    "consecutiveNoErrorReviews" integer DEFAULT 0 NOT NULL,
    "consecutiveFullSelfReviews" integer DEFAULT 0 NOT NULL,
    "consecutiveGreatWeeks" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    streak_freezes integer DEFAULT 0 NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    password character varying(255) NOT NULL,
    full_name character varying(255) NOT NULL,
    role public.users_role_enum DEFAULT 'manager'::public.users_role_enum NOT NULL,
    company_id uuid,
    color character varying(7),
    avatar_url character varying(500),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    onboarding_seen_at timestamp without time zone,
    telegram_link_token character varying(32),
    telegram_link_token_expires_at timestamp with time zone,
    pdn_consent_accepted_at timestamp without time zone,
    lna_acknowledged_at timestamp without time zone,
    pdn_consent_ip character varying(64),
    last_login_at timestamp without time zone,
    activation_token character varying(64),
    activation_token_expires_at timestamp without time zone,
    releases_seen_version character varying(16)
);


--
-- Name: watchdog_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watchdog_runs (
    key character varying(64) NOT NULL,
    last_run_at timestamp without time zone DEFAULT now() NOT NULL,
    last_sent_at timestamp without time zone,
    last_signal_count integer DEFAULT 0 NOT NULL
);


--
-- Name: xp_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.xp_transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "userId" uuid NOT NULL,
    amount integer NOT NULL,
    reason character varying NOT NULL,
    "entryId" uuid,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: xp_transactions PK_143e97bb9eccbc09ac6a341f2cc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xp_transactions
    ADD CONSTRAINT "PK_143e97bb9eccbc09ac6a341f2cc" PRIMARY KEY (id);


--
-- Name: achievements PK_1bc19c37c6249f70186f318d71d; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT "PK_1bc19c37c6249f70186f318d71d" PRIMARY KEY (id);


--
-- Name: review_templates PK_1efdfa46a67617abec3b858a4ac; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_templates
    ADD CONSTRAINT "PK_1efdfa46a67617abec3b858a4ac" PRIMARY KEY (id);


--
-- Name: entries PK_23d4e7e9b58d9939f113832915b; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT "PK_23d4e7e9b58d9939f113832915b" PRIMARY KEY (id);


--
-- Name: error_tags PK_333142b766403e658866f426f2f; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_tags
    ADD CONSTRAINT "PK_333142b766403e658866f426f2f" PRIMARY KEY (id);


--
-- Name: entry_screenshots PK_52bed847412ee3e8fb768cae85a; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entry_screenshots
    ADD CONSTRAINT "PK_52bed847412ee3e8fb768cae85a" PRIMARY KEY (id);


--
-- Name: review_template_history PK_6559d109c51c173c21c2423c792; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_template_history
    ADD CONSTRAINT "PK_6559d109c51c173c21c2423c792" PRIMARY KEY (id);


--
-- Name: sprints PK_6800aa2e0f508561812c4b9afb4; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sprints
    ADD CONSTRAINT "PK_6800aa2e0f508561812c4b9afb4" PRIMARY KEY (id);


--
-- Name: notifications PK_6a72c3c0f683f6462415e653c3a; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY (id);


--
-- Name: entry_error_tags PK_7c87e8ee228a4466ef6d3a52e85; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entry_error_tags
    ADD CONSTRAINT "PK_7c87e8ee228a4466ef6d3a52e85" PRIMARY KEY ("entriesId", "errorTagsId");


--
-- Name: refresh_tokens PK_7d8bee0204106019488c4c50ffa; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY (id);


--
-- Name: users PK_a3ffb1c0c8416b9fc6f907b7433; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY (id);


--
-- Name: invites PK_aa52e96b44a714372f4dd31a0af; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT "PK_aa52e96b44a714372f4dd31a0af" PRIMARY KEY (id);


--
-- Name: companies PK_d4bc3e82a314fa9e29f652c2c22; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT "PK_d4bc3e82a314fa9e29f652c2c22" PRIMARY KEY (id);


--
-- Name: user_gamification PK_db92d24015cda11113d1a3cad80; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_gamification
    ADD CONSTRAINT "PK_db92d24015cda11113d1a3cad80" PRIMARY KEY (id);


--
-- Name: invites UQ_33fd8a248db1cd832baa8aa25bf; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT "UQ_33fd8a248db1cd832baa8aa25bf" UNIQUE (code);


--
-- Name: user_gamification UQ_4f2db3f62e0aaa6a40540e7c27e; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_gamification
    ADD CONSTRAINT "UQ_4f2db3f62e0aaa6a40540e7c27e" UNIQUE ("userId");


--
-- Name: users UQ_97672ac88f789774dd47f7c8be3; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE (email);


--
-- Name: rop_bonus_snapshots UQ_rop_bonus_snapshots_company_period; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rop_bonus_snapshots
    ADD CONSTRAINT "UQ_rop_bonus_snapshots_company_period" UNIQUE (company_id, period);


--
-- Name: attestation_answers attestation_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestation_answers
    ADD CONSTRAINT attestation_answers_pkey PRIMARY KEY (id);


--
-- Name: attestation_attempts attestation_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestation_attempts
    ADD CONSTRAINT attestation_attempts_pkey PRIMARY KEY (id);


--
-- Name: attestation_questions attestation_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestation_questions
    ADD CONSTRAINT attestation_questions_pkey PRIMARY KEY (id);


--
-- Name: attestation_tests attestation_tests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestation_tests
    ADD CONSTRAINT attestation_tests_pkey PRIMARY KEY (id);


--
-- Name: company_events company_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_events
    ADD CONSTRAINT company_events_pkey PRIMARY KEY (id);


--
-- Name: crm_connections crm_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_connections
    ADD CONSTRAINT crm_connections_pkey PRIMARY KEY (id);


--
-- Name: entry_audio entry_audio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entry_audio
    ADD CONSTRAINT entry_audio_pkey PRIMARY KEY (id);


--
-- Name: playbook_cards playbook_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook_cards
    ADD CONSTRAINT playbook_cards_pkey PRIMARY KEY (id);


--
-- Name: rop_bonus_snapshots rop_bonus_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rop_bonus_snapshots
    ADD CONSTRAINT rop_bonus_snapshots_pkey PRIMARY KEY (id);


--
-- Name: share_tokens share_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_tokens
    ADD CONSTRAINT share_tokens_pkey PRIMARY KEY (id);


--
-- Name: staff_signals staff_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_signals
    ADD CONSTRAINT staff_signals_pkey PRIMARY KEY (key, signal_id);


--
-- Name: telegram_contacts telegram_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_contacts
    ADD CONSTRAINT telegram_contacts_pkey PRIMARY KEY (username);


--
-- Name: telegram_detected_chats telegram_detected_chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_detected_chats
    ADD CONSTRAINT telegram_detected_chats_pkey PRIMARY KEY (chat_id);


--
-- Name: transcription_usage transcription_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transcription_usage
    ADD CONSTRAINT transcription_usage_pkey PRIMARY KEY (id);


--
-- Name: watchdog_runs watchdog_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchdog_runs
    ADD CONSTRAINT watchdog_runs_pkey PRIMARY KEY (key);


--
-- Name: IDX_0569c120c6a8f9cd702777924c; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_0569c120c6a8f9cd702777924c" ON public.entries USING btree ("companyId");


--
-- Name: IDX_2adde31e350b7792ed52ae76b7; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_2adde31e350b7792ed52ae76b7" ON public.entries USING btree ("companyId", status);


--
-- Name: IDX_3f02bb90279035ad91cb7167a1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_3f02bb90279035ad91cb7167a1" ON public.entry_error_tags USING btree ("errorTagsId");


--
-- Name: IDX_65bf173755bd19d75244d8154c; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_65bf173755bd19d75244d8154c" ON public.entries USING btree ("sprintId", "managerId");


--
-- Name: IDX_7abbcf313626a2c3c5d294cb6c; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_7abbcf313626a2c3c5d294cb6c" ON public.entries USING btree ("managerId");


--
-- Name: IDX_7ae6334059289559722437bcc1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_7ae6334059289559722437bcc1" ON public.users USING btree (company_id);


--
-- Name: IDX_7f1352bc3e387d920af8b200e0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_7f1352bc3e387d920af8b200e0" ON public.entries USING btree ("sprintId");


--
-- Name: IDX_7f6a94c510e84daf666cdd21f3; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_7f6a94c510e84daf666cdd21f3" ON public.entry_error_tags USING btree ("entriesId");


--
-- Name: IDX_816b98fc4ef51e80e8238b9397; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_816b98fc4ef51e80e8238b9397" ON public.entries USING btree (status);


--
-- Name: IDX_97672ac88f789774dd47f7c8be; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_97672ac88f789774dd47f7c8be" ON public.users USING btree (email);


--
-- Name: idx_attestation_attempts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attestation_attempts_user ON public.attestation_attempts USING btree ("userId");


--
-- Name: idx_attestation_questions_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attestation_questions_test ON public.attestation_questions USING btree ("testId");


--
-- Name: idx_attestation_tests_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attestation_tests_company_status ON public.attestation_tests USING btree ("companyId", status);


--
-- Name: idx_company_events_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_events_company ON public.company_events USING btree (company_id);


--
-- Name: idx_company_events_company_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_events_company_created ON public.company_events USING btree (company_id, created_at);


--
-- Name: idx_entries_reviewer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entries_reviewer ON public.entries USING btree ("reviewerId");


--
-- Name: idx_entry_audio_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entry_audio_status ON public.entry_audio USING btree (status);


--
-- Name: idx_notifications_user_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_read ON public.notifications USING btree ("userId", "isRead");


--
-- Name: idx_playbook_cards_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playbook_cards_company ON public.playbook_cards USING btree ("companyId");


--
-- Name: idx_playbook_cards_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playbook_cards_company_status ON public.playbook_cards USING btree ("companyId", status);


--
-- Name: idx_refresh_tokens_user_revoked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_user_revoked ON public.refresh_tokens USING btree (user_id, is_revoked);


--
-- Name: idx_share_tokens_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_share_tokens_entry ON public.share_tokens USING btree ("entryId");


--
-- Name: idx_sprints_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sprints_company_status ON public.sprints USING btree ("companyId", status);


--
-- Name: idx_tg_contacts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_contacts_user ON public.telegram_contacts USING btree (user_id);


--
-- Name: idx_tu_company_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tu_company_created ON public.transcription_usage USING btree ("companyId", "createdAt");


--
-- Name: idx_users_telegram_link_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_telegram_link_token ON public.users USING btree (telegram_link_token) WHERE (telegram_link_token IS NOT NULL);


--
-- Name: idx_xp_transactions_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xp_transactions_user_created ON public.xp_transactions USING btree ("userId", "createdAt");


--
-- Name: uq_attestation_answers_attempt_question; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_attestation_answers_attempt_question ON public.attestation_answers USING btree ("attemptId", "questionId");


--
-- Name: uq_attestation_attempts_test_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_attestation_attempts_test_user ON public.attestation_attempts USING btree ("testId", "userId");


--
-- Name: uq_companies_crm_setup_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_companies_crm_setup_token ON public.companies USING btree (crm_setup_token) WHERE (crm_setup_token IS NOT NULL);


--
-- Name: uq_companies_offer_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_companies_offer_token ON public.companies USING btree (offer_token);


--
-- Name: uq_companies_telegram_bind_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_companies_telegram_bind_code ON public.companies USING btree (telegram_bind_code) WHERE (telegram_bind_code IS NOT NULL);


--
-- Name: uq_companies_telegram_work_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_companies_telegram_work_chat ON public.companies USING btree (telegram_work_chat_id) WHERE (telegram_work_chat_id IS NOT NULL);


--
-- Name: uq_crm_connections_company; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_crm_connections_company ON public.crm_connections USING btree (company_id);


--
-- Name: uq_entries_company_crm_call; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_entries_company_crm_call ON public.entries USING btree ("companyId", "crmCallId") WHERE (("crmCallId" IS NOT NULL) AND ("deletedAt" IS NULL));


--
-- Name: uq_entries_manager_sprint_type_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_entries_manager_sprint_type_number ON public.entries USING btree ("managerId", "sprintId", type, "entryNumber") WHERE ("deletedAt" IS NULL);


--
-- Name: uq_entry_audio_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_entry_audio_entry ON public.entry_audio USING btree ("entryId");


--
-- Name: uq_playbook_cards_company_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_playbook_cards_company_tag ON public.playbook_cards USING btree ("companyId", "errorTagId") WHERE ("errorTagId" IS NOT NULL);


--
-- Name: uq_sprints_company_start; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_sprints_company_start ON public.sprints USING btree ("companyId", "startDate");


--
-- Name: uq_users_activation_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_users_activation_token ON public.users USING btree (activation_token) WHERE (activation_token IS NOT NULL);


--
-- Name: entry_screenshots FK_0ec846e7e157073536f5d63be27; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entry_screenshots
    ADD CONSTRAINT "FK_0ec846e7e157073536f5d63be27" FOREIGN KEY ("entryId") REFERENCES public.entries(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens FK_3ddc983c5f7bcf132fd8732c3f4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: entry_error_tags FK_3f02bb90279035ad91cb7167a17; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entry_error_tags
    ADD CONSTRAINT "FK_3f02bb90279035ad91cb7167a17" FOREIGN KEY ("errorTagsId") REFERENCES public.error_tags(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_gamification FK_4f2db3f62e0aaa6a40540e7c27e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_gamification
    ADD CONSTRAINT "FK_4f2db3f62e0aaa6a40540e7c27e" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: invites FK_512a5c477fc936b04516d7a2d57; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT "FK_512a5c477fc936b04516d7a2d57" FOREIGN KEY ("invitedById") REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notifications FK_692a909ee0fa9383e7859f9b406; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT "FK_692a909ee0fa9383e7859f9b406" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sprints FK_78d460b5bd243da031339d87b40; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sprints
    ADD CONSTRAINT "FK_78d460b5bd243da031339d87b40" FOREIGN KEY ("companyId") REFERENCES public.companies(id);


--
-- Name: entries FK_7abbcf313626a2c3c5d294cb6cd; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT "FK_7abbcf313626a2c3c5d294cb6cd" FOREIGN KEY ("managerId") REFERENCES public.users(id);


--
-- Name: users FK_7ae6334059289559722437bcc1c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "FK_7ae6334059289559722437bcc1c" FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: entries FK_7f1352bc3e387d920af8b200e07; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT "FK_7f1352bc3e387d920af8b200e07" FOREIGN KEY ("sprintId") REFERENCES public.sprints(id);


--
-- Name: entry_error_tags FK_7f6a94c510e84daf666cdd21f31; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entry_error_tags
    ADD CONSTRAINT "FK_7f6a94c510e84daf666cdd21f31" FOREIGN KEY ("entriesId") REFERENCES public.entries(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: entries FK_d4a4f97c68b57d21c39f3a16d24; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT "FK_d4a4f97c68b57d21c39f3a16d24" FOREIGN KEY ("reviewerId") REFERENCES public.users(id);


--
-- Name: invites FK_d812afa3118384965c84ea84069; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT "FK_d812afa3118384965c84ea84069" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: playbook_cards FK_playbook_cards_error_tag; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook_cards
    ADD CONSTRAINT "FK_playbook_cards_error_tag" FOREIGN KEY ("errorTagId") REFERENCES public.error_tags(id) ON DELETE SET NULL;


--
-- Name: attestation_answers attestation_answers_attemptId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestation_answers
    ADD CONSTRAINT "attestation_answers_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES public.attestation_attempts(id) ON DELETE CASCADE;


--
-- Name: attestation_answers attestation_answers_questionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestation_answers
    ADD CONSTRAINT "attestation_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES public.attestation_questions(id) ON DELETE CASCADE;


--
-- Name: attestation_attempts attestation_attempts_testId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestation_attempts
    ADD CONSTRAINT "attestation_attempts_testId_fkey" FOREIGN KEY ("testId") REFERENCES public.attestation_tests(id) ON DELETE CASCADE;


--
-- Name: attestation_questions attestation_questions_cardId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestation_questions
    ADD CONSTRAINT "attestation_questions_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES public.playbook_cards(id) ON DELETE SET NULL;


--
-- Name: attestation_questions attestation_questions_testId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestation_questions
    ADD CONSTRAINT "attestation_questions_testId_fkey" FOREIGN KEY ("testId") REFERENCES public.attestation_tests(id) ON DELETE CASCADE;


--
-- Name: entry_audio fk_entry_audio_entry; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entry_audio
    ADD CONSTRAINT fk_entry_audio_entry FOREIGN KEY ("entryId") REFERENCES public.entries(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 6QUqHG3p4Ym5EyBLjhaXoQFKl7m24vTDhknv3RTYcq0x7efxKxR8LkROLgQhSgR
