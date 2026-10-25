import { IsString } from 'class-validator';

export class MarkReadDto {
  @IsString()
  id!: string;
}
