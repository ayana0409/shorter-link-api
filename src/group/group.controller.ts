import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Patch,
  Delete,
  Param,
  Req,
  UseGuards,
  Query,
} from "@nestjs/common";
import { GroupService } from "./group.service";
import {
  CreateGroupDto,
  UpdateGroupDto,
  AddLinksToGroupDto,
  AddGroupMemberDto,
} from "./dto/group.dto";
import { Group } from "./schemas/group.schema";
import { AuthGuard } from "../auth/auth.guard";
import { Request } from "express";
import { ShortenerService } from "../shortener/shortener.service";

@Controller("groups")
@UseGuards(AuthGuard)
export class GroupController {
  constructor(
    private readonly groupService: GroupService,
    private readonly shortenerService: ShortenerService,
  ) {}

  private getRequestUserId(req: any): string {
    return req.user?._id || req.user?.sub || req.user?.id;
  }

  @Post()
  async create(@Body() createGroupDto: CreateGroupDto, @Req() req: any) {
    return this.groupService.create(createGroupDto, this.getRequestUserId(req));
  }

  @Get()
  async findAll(@Req() req: any) {
    return this.groupService.findAll(this.getRequestUserId(req));
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @Req() req: any) {
    return this.groupService.findOne(
      id,
      this.getRequestUserId(req),
      req.user?.role,
    );
  }

  @Put(":id")
  async update(
    @Param("id") id: string,
    @Body() updateGroupDto: UpdateGroupDto,
    @Req() req: any,
  ) {
    return this.groupService.update(
      id,
      updateGroupDto,
      this.getRequestUserId(req),
    );
  }

  @Patch(":id")
  async partialUpdate(
    @Param("id") id: string,
    @Body() updateGroupDto: UpdateGroupDto,
    @Req() req: any,
  ) {
    return this.groupService.update(
      id,
      updateGroupDto,
      this.getRequestUserId(req),
    );
  }

  @Delete(":id")
  async remove(
    @Param("id") id: string,
    @Body() body: { password?: string },
    @Req() req: any,
  ) {
    return this.groupService.remove(
      id,
      this.getRequestUserId(req),
      req.user?.role,
      body?.password,
    );
  }

  @Post(":id/members")
  async addMember(
    @Param("id") id: string,
    @Body() addMemberDto: AddGroupMemberDto,
    @Req() req: any,
  ) {
    return this.groupService.addMember(
      id,
      addMemberDto.userId,
      addMemberDto.role,
      req.user._id,
    );
  }

  @Get(":id/members")
  async getMembers(@Param("id") id: string, @Req() req: any) {
    return this.groupService.getMembers(id, req.user._id, req.user?.role);
  }

  @Delete(":id/members/:memberId")
  async removeMember(
    @Param("id") id: string,
    @Param("memberId") memberId: string,
    @Req() req: any,
  ) {
    return this.groupService.removeMember(
      id,
      memberId,
      req.user._id,
      req.user?.role,
    );
  }

  @Post(":id/links")
  async addLinks(
    @Param("id") id: string,
    @Body() addLinksDto: AddLinksToGroupDto,
    @Req() req: any,
  ) {
    return this.groupService.addLinks(id, addLinksDto.links, req.user._id);
  }

  @Delete(":id/links/:linkId")
  async removeLink(
    @Param("id") id: string,
    @Param("linkId") linkId: string,
    @Req() req: any,
  ) {
    return this.groupService.removeLink(
      id,
      linkId,
      req.user._id,
      req.user?.role,
    );
  }

  @Get(":id/links")
  async getLinks(
    @Param("id") id: string,
    @Req() req: any,
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("sortBy") sortBy = "createdAt",
    @Query("sortOrder") sortOrder = "desc",
    @Query("page") page = "1",
    @Query("limit") limit = "5",
  ) {
    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 5;
    return this.groupService.getLinks(
      id,
      req.user._id,
      req.user?.role,
      search,
      status,
      sortBy,
      sortOrder,
      pageNumber,
      limitNumber,
    );
  }

  @Get(":id/limits")
  async getGroupLimits(@Param("id") id: string) {
    const group = await this.groupService.findOneLightweight(id);
    if (!group) {
      return {
        maxGroupsCount: null,
        maxMembersPerGroup: null,
        maxLinksPerGroup: null,
      };
    }
    const ownerId = group.owner.toString();
    const [maxGroupsCount, maxMembersPerGroup, maxLinksPerGroup] =
      await Promise.all([
        this.shortenerService.getMaxGroupsCount(ownerId),
        this.shortenerService.getMaxMembersPerGroup(ownerId),
        this.shortenerService.getMaxLinksPerGroup(ownerId),
      ]);
    return { maxGroupsCount, maxMembersPerGroup, maxLinksPerGroup };
  }
}
