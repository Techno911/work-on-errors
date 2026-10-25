-- v5.9.4 — IDX1-5: недостающие индексы на горячих запросах (N+1/фулскан на растущей истории).
CREATE INDEX IF NOT EXISTS idx_sprints_company_status ON public.sprints ("companyId", status);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_revoked ON public.refresh_tokens (user_id, is_revoked);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications ("userId", "isRead");
CREATE INDEX IF NOT EXISTS idx_xp_transactions_user_created ON public.xp_transactions ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_entries_reviewer ON public.entries ("reviewerId");
