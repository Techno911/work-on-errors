import client from './client';
import type { GamificationConfig, XpSettings, AchievementSettings } from '@/types';

export interface GamificationProfile {
  level: number;
  title: string;
  emoji: string;
  nextXp: number | null;
  totalXp: number;
  weeklyXp: number;
  currentStreak: number;
  bestStreak: number;
  achievements: { type: string; earnedAt: string }[];
  xpHistory: { week: string; xp: number }[];
}

export interface LeaderboardEntry {
  id: string;
  fullName: string;
  color: string | null;
  avatarUrl: string | null;
  totalXp: number;
  weeklyXp: number;
  currentStreak: number;
  level: number;
  levelTitle: string;
  levelEmoji: string;
  achievementCount: number;
}

export const gamificationApi = {
  getMyProfile: () => client.get<GamificationProfile>('/gamification/profile'),
  getLeaderboard: (companyId: string) =>
    client.get<LeaderboardEntry[]>(`/gamification/leaderboard/${companyId}`),
  getConfig: (companyId: string) =>
    client.get<GamificationConfig>(`/gamification/config/${companyId}`),
  updateConfig: (
    companyId: string,
    data: Partial<{ xpSettings: Partial<XpSettings>; achievementSettings: Partial<AchievementSettings> }>,
  ) => client.patch<GamificationConfig>(`/gamification/config/${companyId}`, data),
};
