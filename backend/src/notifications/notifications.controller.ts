import { Controller, Get, Patch, Param, ParseUUIDPipe, UseGuards, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findAll(@Request() req: any) {
    return this.notificationsService.findForUser(req.user.id);
  }

  @Get('unread-count')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getUnreadCount(@Request() req: any) {
    return this.notificationsService.getUnreadCount(req.user.id);
  }

  @Patch(':id/read')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markRead(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.notificationsService.markRead(id, req.user.id);
  }

  @Patch('read-all')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markAllRead(@Request() req: any) {
    return this.notificationsService.markAllRead(req.user.id);
  }
}
