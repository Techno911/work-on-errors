import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  async create(data: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    linkUrl?: string;
    relatedId?: string;
  }): Promise<Notification> {
    const notification = this.notificationRepository.create({
      ...data,
      linkUrl: data.linkUrl ?? null,
      relatedId: data.relatedId ?? null,
    });
    return this.notificationRepository.save(notification);
  }

  /**
   * Было ли уже уведомление такого типа по этой сущности (любому адресату).
   *
   * Идемпотентность сторожей без отдельной таблицы состояний: сигнал «доступ не использован»
   * должен уйти ОДИН раз на человека, а не каждый час, пока он не вошёл. Существующая
   * таблица уведомлений и есть журнал того, о чём мы уже сказали.
   */
  async existsFor(type: NotificationType, relatedId: string): Promise<boolean> {
    const count = await this.notificationRepository.count({ where: { type, relatedId } });
    return count > 0;
  }

  async findForUser(userId: string): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async markRead(id: string, userId: string): Promise<Notification> {
    // Ищем и возвращаем строго по паре {id, userId}, иначе 404 — чтобы нельзя было
    // прочитать/пометить чужое уведомление (в т.ч. из другой компании) по его id.
    const notification = await this.notificationRepository.findOne({ where: { id, userId } });
    if (!notification) {
      throw new NotFoundException('Уведомление не найдено');
    }
    notification.isRead = true;
    return this.notificationRepository.save(notification);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notificationRepository.update(
      { userId, isRead: false },
      { isRead: true },
    );
    return { updated: result.affected ?? 0 };
  }

  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.notificationRepository.count({
      where: { userId, isRead: false },
    });
    return { count };
  }

  /** Помечает прочитанными все уведомления пользователя, связанные с конкретной записью */
  async markReadByRelatedId(userId: string, relatedId: string): Promise<void> {
    await this.notificationRepository.update(
      { userId, relatedId, isRead: false },
      { isRead: true },
    );
  }
}
