import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Group, GroupDocument } from "./schemas/group.schema";
import { CreateGroupDto, UpdateGroupDto } from "./dto/group.dto";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { ShortenerService } from "../shortener/shortener.service";
import { AccountService } from "../account/account.service";
import { AccountDocument } from "../account/schemas/account.schema";

@Injectable()
export class GroupService {
  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    private readonly shortenerService: ShortenerService,
    private readonly accountService: AccountService,
  ) {}

  async create(
    createGroupDto: CreateGroupDto,
    ownerId: string,
  ): Promise<Group> {
    // Check max groups limit
    const maxGroupsCount =
      await this.shortenerService.getMaxGroupsCount(ownerId);
    const currentGroupsCount = await this.groupModel
      .countDocuments({
        owner: new Types.ObjectId(ownerId),
      })
      .exec();

    if (currentGroupsCount >= maxGroupsCount) {
      throw new BadRequestException(
        `Bạn đã đạt giới hạn nhóm tối đa: (${maxGroupsCount})`,
      );
    }

    const newGroup = new this.groupModel({
      ...createGroupDto,
      owner: new Types.ObjectId(ownerId),
      members: [
        {
          account: new Types.ObjectId(ownerId),
          role: "owner",
        },
      ],
      links: [],
    });
    newGroup.populate("owner", "username fullname");
    return newGroup.save();
  }

  async findAll(userId: string): Promise<Group[]> {
    return this.groupModel
      .find({
        $or: [
          { owner: new Types.ObjectId(userId) },
          { "members.account": new Types.ObjectId(userId) },
        ],
      })
      .populate("owner", "username fullname")
      .exec();
  }

  async findOne(id: string, userId: string): Promise<Group> {
    const group = await this.groupModel
      .findById(id)
      .populate("owner", "username fullname")
      .populate("members.account", "username fullname")
      .populate("links", "originalUrl shortUrl siteName")
      .exec();

    if (!group) {
      throw new NotFoundException("Group not found");
    }

    const isMember =
      this.getEntityId(group.owner) === userId ||
      group.members.some(
        (member) => this.getEntityId(member.account) === userId,
      );
    if (!isMember) {
      throw new ForbiddenException(
        "You do not have permission to access this group",
      );
    }

    return group;
  }

  // Lightweight findOne without populate for internal use
  async findOneLightweight(id: string): Promise<Group | null> {
    return this.groupModel.findById(id).exec();
  }

  private getEntityId(entity: any): string {
    if (!entity) {
      return "";
    }
    if (typeof entity === "string") {
      return entity;
    }
    if (entity._id) {
      return entity._id.toString();
    }
    return entity.toString();
  }

  private getMemberRole(group: Group, userId: string): string | null {
    if (this.getEntityId(group.owner) === userId) {
      return "owner";
    }
    const member = group.members.find(
      (m) => this.getEntityId(m.account) === userId,
    );
    return member ? member.role : null;
  }

  private isOwner(group: Group, userId: string): boolean {
    return this.getEntityId(group.owner) === userId;
  }

  private isManager(group: Group, userId: string): boolean {
    return this.getMemberRole(group, userId) === "manager";
  }

  async update(
    id: string,
    updateGroupDto: UpdateGroupDto,
    userId: string,
  ): Promise<Group> {
    const group = await this.findOne(id, userId);

    if (!this.isOwner(group, userId)) {
      throw new ForbiddenException("Only the owner can update the group name");
    }

    const updatedGroup = await this.groupModel
      .findByIdAndUpdate(id, { $set: updateGroupDto }, { new: true })
      .exec();

    return updatedGroup!.populate("owner", "username fullname");
  }

  async remove(id: string, userId: string, password?: string): Promise<void> {
    const group = await this.findOne(id, userId);

    if (!this.isOwner(group, userId)) {
      throw new ForbiddenException("Only the owner can delete the group");
    }

    if (password) {
      await this.accountService.validatePasswordById(userId, password);
    }

    await this.groupModel.findByIdAndDelete(id).exec();
    await this.shortenerService.detachGroupFromShorteners(id);
  }

  private async resolveAccountId(userIdOrUsername: string): Promise<string> {
    const isObjectId = Types.ObjectId.isValid(userIdOrUsername);
    if (isObjectId) {
      try {
        await this.accountService.findOne(userIdOrUsername);
        return userIdOrUsername;
      } catch {
        // continue to try username lookup
      }
    }

    let account: AccountDocument | null = null;
    try {
      account = await this.accountService.findOneByUsername(userIdOrUsername);
    } catch {
      account = null;
    }

    if (!account) {
      throw new NotFoundException(
        isObjectId
          ? `Account with id or username '${userIdOrUsername}' not found`
          : `Account with username '${userIdOrUsername}' not found`,
      );
    }

    return account.id.toString();
  }

  async addMember(
    groupId: string,
    userIdToAdd: string,
    role: "manager" | "member" | undefined,
    actorId: string,
  ): Promise<Group> {
    const group = await this.findOne(groupId, actorId);
    const targetAccountId = await this.resolveAccountId(userIdToAdd);

    const actorRole = this.getMemberRole(group, actorId);
    if (!actorRole || (actorRole !== "owner" && actorRole !== "manager")) {
      throw new ForbiddenException(
        "Only the owner or a group manager can add members",
      );
    }

    const targetRole = role || "member";
    if (actorRole === "manager" && targetRole !== "member") {
      throw new ForbiddenException(
        "Group managers can only add members, not managers",
      );
    }

    const existingMember = group.members.find(
      (member) => this.getEntityId(member.account) === targetAccountId,
    );

    if (existingMember) {
      if (existingMember.role === targetRole) {
        return group;
      }
      if (!this.isOwner(group, actorId)) {
        throw new ForbiddenException("Only the owner can change member roles");
      }
      await this.groupModel.updateOne(
        {
          _id: groupId,
          "members.account": new Types.ObjectId(targetAccountId),
        },
        { $set: { "members.$.role": targetRole } },
      );
      return this.findOne(groupId, actorId);
    }

    // Check max members per group limit before adding
    const maxMembersPerGroup =
      await this.shortenerService.getMaxMembersPerGroup(actorId);
    const totalMembers = group.members.length + 1; // +1 for the new member being added

    if (totalMembers > maxMembersPerGroup) {
      throw new BadRequestException(
        `Giới hạn thành viên nhóm là (${maxMembersPerGroup})`,
      );
    }

    await this.groupModel.findByIdAndUpdate(
      groupId,
      {
        $push: {
          members: {
            account: new Types.ObjectId(targetAccountId),
            role: targetRole,
          },
        },
      },
      { new: true },
    );

    return this.findOne(groupId, actorId);
  }

  async getMembers(groupId: string, userId: string): Promise<Group> {
    return this.findOne(groupId, userId);
  }

  async removeMember(
    groupId: string,
    memberId: string,
    actorId: string,
  ): Promise<Group> {
    const group = await this.findOne(groupId, actorId);

    const actorRole = this.getMemberRole(group, actorId);
    if (!actorRole || (actorRole !== "owner" && actorRole !== "manager")) {
      throw new ForbiddenException(
        "Only the owner or a group manager can remove members",
      );
    }

    if (group.owner.toString() === memberId) {
      throw new ForbiddenException("Cannot remove the group owner");
    }

    const targetMember = group.members.find(
      (member) => member.account.toString() === memberId,
    );
    if (!targetMember) {
      throw new NotFoundException("Group member not found");
    }

    if (actorRole === "manager" && targetMember.role !== "member") {
      throw new ForbiddenException(
        "Group managers can only remove members, not managers",
      );
    }

    await this.groupModel.updateOne(
      { _id: groupId },
      { $pull: { members: { account: new Types.ObjectId(memberId) } } },
    );

    return this.findOne(groupId, actorId);
  }

  async addLinks(
    groupId: string,
    links: string[],
    userId: string,
  ): Promise<Group> {
    // Use lightweight check first - only verify permission
    const group = await this.findOneLightweight(groupId);
    if (!group) {
      throw new NotFoundException("Group not found");
    }

    // Check membership
    const isMember =
      this.getEntityId(group.owner) === userId ||
      group.members.some(
        (member) => this.getEntityId(member.account) === userId,
      );
    if (!isMember) {
      throw new ForbiddenException(
        "You do not have permission to access this group",
      );
    }

    const normalizedLinks = links
      .filter((link) => link && link.trim())
      .map((link) => link.trim());

    if (normalizedLinks.length === 0) {
      return this.findOne(groupId, userId);
    }

    // Check max links per group limit
    const maxLinksPerGroup =
      await this.shortenerService.getMaxLinksPerGroup(userId);
    const currentLinkCount = group.links?.length ?? 0;
    const newTotal = currentLinkCount + normalizedLinks.length;
    if (newTotal > maxLinksPerGroup) {
      throw new BadRequestException(
        `Nhóm đã có ${currentLinkCount} liên kết. Giới hạn tối đa là ${maxLinksPerGroup} liên kết/nhóm.`,
      );
    }

    // 1. Batch fetch existing shorteners
    const existingShorteners =
      await this.shortenerService.findExistingShorteners(
        normalizedLinks,
        userId,
      );
    const existingShortenerIds = existingShorteners.map((s) => s._id);

    // 2. Determine which links need to be created
    const foundLinks = new Set<string>();
    existingShorteners.forEach((s) => {
      foundLinks.add(s.originalUrl);
      foundLinks.add(s.shortUrl);
    });

    const linksToCreate = normalizedLinks.filter((link) => {
      if (foundLinks.has(link)) return false;

      // If it's a full short URL like 'host/s/code', check if the code was found
      if (link.includes("/s/")) {
        const code = link.split("/s/")[1].split(/[/?#]/)[0];
        if (foundLinks.has(code)) return false;
      }

      return true;
    });

    // 3. Verify daily limit ONCE before batch creation
    if (linksToCreate.length > 0) {
      await this.shortenerService.verifyDailyLimit(
        userId,
        linksToCreate.length,
      );
    }

    // 4. Batch create missing links using optimized method
    if (linksToCreate.length > 0) {
      const itemsToCreate = linksToCreate.map((url) => ({
        originalUrl: url,
        userId,
      }));

      const createdShorteners =
        await this.shortenerService.createBatch(itemsToCreate);
      existingShortenerIds.push(
        ...createdShorteners.map((s) => (s as any)._id),
      );
    }

    if (existingShortenerIds.length === 0) {
      return this.findOne(groupId, userId);
    }

    // 5. Update group and shorteners concurrently
    await Promise.all([
      this.groupModel
        .findByIdAndUpdate(groupId, {
          $addToSet: { links: { $each: existingShortenerIds } },
        })
        .exec(),
      this.shortenerService.attachGroupsToShorteners(
        existingShortenerIds.map((id) => id.toString()),
        groupId,
      ),
    ]);

    // Return populated group
    return this.findOne(groupId, userId);
  }

  async removeLink(
    groupId: string,
    linkId: string,
    userId: string,
  ): Promise<Group> {
    const group = await this.findOne(groupId, userId);

    const actorRole = this.getMemberRole(group, userId);
    if (!actorRole || (actorRole !== "owner" && actorRole !== "manager")) {
      throw new ForbiddenException(
        "Only the owner or a group manager can remove links from the group",
      );
    }

    await this.groupModel.updateOne(
      { _id: groupId },
      { $pull: { links: new Types.ObjectId(linkId) } },
    );

    await this.shortenerService.detachGroupFromShortener(linkId, groupId);

    return this.findOne(groupId, userId);
  }

  async getLinks(
    groupId: string,
    userId: string,
    search?: string,
    status?: string,
    sortBy = "createdAt",
    sortOrder = "desc",
    page = 1,
    limit = 5,
  ): Promise<{ data: any[]; page: number; totalPages: number }> {
    const group = await this.findOne(groupId, userId);

    const linkIds = group.links.map((link) => link.toString());

    const links = await this.shortenerService.findByIds(
      linkIds,
      search,
      status,
      sortBy,
      sortOrder,
      page,
      limit,
    );

    const totalLinks = await this.shortenerService.countByIds(
      linkIds,
      search,
      status,
    );

    const totalPages = Math.max(1, Math.ceil(totalLinks / limit));

    return {
      data: links,
      page,
      totalPages,
    };
  }
}
