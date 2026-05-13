import {
  IsString,
  IsNumber,
  IsBoolean,
  Min,
  IsOptional,
} from "class-validator";

export class CreateLevelDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsNumber()
  @Min(0)
  dailyShortenLimit!: number;

  @IsBoolean()
  @IsOptional()
  allowPassword?: boolean;

  @IsBoolean()
  @IsOptional()
  allowCustomExpiration?: boolean;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  maxGroupsCount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  maxMembersPerGroup?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  maxLinksPerGroup?: number;
}
