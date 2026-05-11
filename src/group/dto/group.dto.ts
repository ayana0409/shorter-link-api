import {
  IsArray,
  ArrayNotEmpty,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
} from "class-validator";

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class UpdateGroupDto {
  @IsString()
  @IsNotEmpty()
  name?: string;
}

export class AddLinksToGroupDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  links!: string[];
}

export class AddGroupMemberDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsOptional()
  @IsIn(["manager", "member"])
  role?: "manager" | "member";
}
