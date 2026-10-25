import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

// SEC-5: раньше share-ссылка была stateless JWT на 30 дней без возможности отозвать —
// текст страницы 401 уже обещал «ссылка была отозвана», но отзывать было нечего.
// jti (payload токена) = id этой строки; verifyToken проверяет revokedAt.
@Entity('share_tokens')
export class ShareToken {
  @PrimaryColumn('uuid')
  id!: string; // jti

  @Index()
  @Column({ type: 'uuid' })
  entryId!: string;

  @Column({ type: 'uuid' })
  issuedBy!: string;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
