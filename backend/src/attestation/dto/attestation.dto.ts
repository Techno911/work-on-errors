import { IsString, IsOptional, MaxLength, IsInt, Min, Max, IsIn, IsDateString } from 'class-validator';

export class GenerateTestDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(100)
  passingScorePercent?: number;
}

export class AssignTestDto {
  @IsOptional()
  @IsDateString()
  deadline?: string;
}

export class SaveAnswerDto {
  @IsString()
  @MaxLength(4000)
  answerText!: string;
}

export class GradeAnswerDto {
  @IsInt()
  @IsIn([0, 1, 2])
  reviewerScore!: 0 | 1 | 2;
}
