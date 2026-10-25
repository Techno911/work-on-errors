export enum XpReason {
  ENTRY_SUBMITTED = 'entry_submitted',           // +5
  SELF_REVIEW_COMPLETE = 'self_review_complete', // +10
  REVIEW_RECEIVED = 'review_received',           // +5
  REVIEW_NO_ERRORS = 'review_no_errors',         // +15 бонус
  WEEKLY_GOOD_ZONE = 'weekly_good_zone',         // +15
  WEEKLY_GREAT_ZONE = 'weekly_great_zone',       // +30
  STREAK_BONUS = 'streak_bonus',                 // +5 за каждые 4 недели стрика
}
