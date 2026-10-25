export enum AchievementType {
  SNIPER = 'sniper',       // 3 проверки подряд без тегов ошибок
  WRITER = 'writer',       // 5 самоанализов подряд > 500 символов
  LIGHTNING = 'lightning', // все записи спринта загружены минимум за день до конца (антипрокрастинация)
  GREAT_3X = 'great_3x',  // 3 недели подряд в зоне «Красавчик»
  STREAK_7 = 'streak_7',  // стрик 7 недель
  STREAK_30 = 'streak_30',// стрик 30 недель
  FIRST_SUBMIT = 'first_submit', // первая отправленная запись
}
