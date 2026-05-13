import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Group, GroupDocument } from "./schemas/group.schema";
import { CreateGroupDto, UpdateGroupDto } from "./dto/group.dto";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
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
    const group = await this.findOne(groupId, userId);

    const shortenerIds = [] as Types.ObjectId[];
    const linksToCreate = [] as string[];

    for (const link of links) {
      if (!link || !link.trim()) continue;
      const normalizedLink = link.trim();

      let shortener =
        (await this.shortenerService.findByShortUrlCode(normalizedLink)) ||
        (await this.shortenerService.findByOriginalUrl(normalizedLink));

      if (!shortener) {
        linksToCreate.push(normalizedLink);
      } else {
        shortenerIds.push(new Types.ObjectId(shortener._id));
      }
    }

    if (linksToCreate.length > 0) {
      await this.shortenerService.verifyDailyLimit(
        userId,
        linksToCreate.length,
      );

      for (const url of linksToCreate) {
        const shortener = await this.shortenerService.create({
          originalUrl: url,
          userId,
        });
        shortenerIds.push(new Types.ObjectId(shortener._id));
      }
    }

    if (shortenerIds.length === 0) {
      return group;
    }

    await this.groupModel
      .findByIdAndUpdate(
        groupId,
        { $addToSet: { links: { $each: shortenerIds } } },
        { new: true },
      )
      .exec();

    await this.shortenerService.attachGroupsToShorteners(
      shortenerIds.map((id) => id.toString()),
      groupId,
    );

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
