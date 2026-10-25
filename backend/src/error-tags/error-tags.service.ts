import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_ERROR_TAG_COLOR, ErrorTag } from './entities/error-tag.entity';
import { CreateErrorTagDto } from './dto/create-error-tag.dto';
import { UpdateErrorTagDto } from './dto/update-error-tag.dto';

// Инструкции РОПа учат заводить теги вида `#не_выясняет_потребность» — при показе тега
// платформа сама добавляет «#» перед именем (EntryCard, PlaybookCardItem), и без нормализации
// на входе получается «##не_выясняет_потребность». Решётка — оформление показа, не часть имени.
export function normalizeTagName(name: string): string {
  return name.trim().replace(/^#+/, '');
}

@Injectable()
export class ErrorTagsService {
  constructor(
    @InjectRepository(ErrorTag)
    private errorTagsRepository: Repository<ErrorTag>,
  ) {}

  findAll(companyId: string): Promise<ErrorTag[]> {
    return this.errorTagsRepository.find({ where: { companyId }, order: { name: 'ASC' } });
  }

  create(dto: CreateErrorTagDto): Promise<ErrorTag> {
    return this.errorTagsRepository.save(
      // Production has synchronize=false; do not depend on its older SQL default.
      this.errorTagsRepository.create({ ...dto, color: dto.color ?? DEFAULT_ERROR_TAG_COLOR, name: normalizeTagName(dto.name) }),
    );
  }

  async update(id: string, data: UpdateErrorTagDto, companyId?: string): Promise<ErrorTag> {
    const tag = await this.errorTagsRepository.findOne({ where: { id } });
    if (!tag) throw new NotFoundException('Тег не найден');
    if (companyId && tag.companyId !== companyId) throw new ForbiddenException();
    Object.assign(tag, { ...data, name: data.name ? normalizeTagName(data.name) : tag.name });
    return this.errorTagsRepository.save(tag);
  }

  async remove(id: string, companyId?: string): Promise<void> {
    const tag = await this.errorTagsRepository.findOne({ where: { id } });
    if (!tag) throw new NotFoundException('Тег не найден');
    if (companyId && tag.companyId !== companyId) throw new ForbiddenException();
    await this.errorTagsRepository.manager.query(
      `DELETE FROM entry_error_tags WHERE "errorTagId" = $1`,
      [id],
    );
    await this.errorTagsRepository.remove(tag);
  }

  async getUsage(id: string, companyId?: string): Promise<{ tagId: string; count: number }> {
    const tag = await this.errorTagsRepository.findOne({ where: { id } });
    if (!tag) throw new NotFoundException('Тег не найден');
    if (companyId && tag.companyId !== companyId) throw new ForbiddenException();
    const result = await this.errorTagsRepository.manager.query(
      `SELECT COUNT(*) as count FROM entry_error_tags WHERE "errorTagId" = $1`,
      [id],
    );
    return { tagId: id, count: parseInt(result[0]?.count ?? '0') };
  }
}
