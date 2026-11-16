import {
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Group, GroupDocument } from "./schemas/group.schema";
import { CreateGroupDto, UpdateGroupDto } from "./dto/group.dto";
import { ShortenerService } from "../shortener/shortener.service";
import { AccountService } from "../account/account.service";
import { AccountDocument } from "../account/schemas/account.schema";
import { I18nService } from "../common/i18n";
import { NotificationService } from "../notification/notification.service";

@Injectable()
export class GroupService {
  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @Inject(forwardRef(() => ShortenerService))
    private readonly shortenerService: ShortenerService,
    @Inject(forwardRef(() => AccountService))
    private readonly accountService: AccountService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
    private i18n: I18nService,
  ) {}

  /**
   * Helper to resolve a message using the default locale
   */
  private msg(keyPath: string, ...args: any[]): string {
    return this.i18n.t(this.i18n.defaultLocale, keyPath, ...args);
  }

  private isAdminRole(role?: string): boolean {
    return role === "admin";
  }

  /**
   * Cleanup all group memberships and invitations for a deleted account
   */
  async cleanupAccountReferences(accountId: string): Promise<void> {
    const accountObjectId = new Types.ObjectId(accountId);
    await this.groupModel.updateMany(
      {
        $or: [
          { "members.account": accountObjectId },
          { "invitations.account": accountObjectId },
        ],
      },
      {
        $pull: {
          members: { account: accountObjectId },
          invitations: { account: accountObjectId },
        },
      },
    );
  }

  async findByAccountId(
    accountId: string,
    requesterId: string,
    requesterRole?: string,
  ): Promise<Group[]> {
    const accountObjectId = new Types.ObjectId(accountId);
    const groups = await this.groupModel
      .find({
        $or: [
          { owner: accountObjectId },
          { "members.account": accountObjectId },
        ],
      })
      .populate("owner", "username fullname")
      .populate("members.account", "username fullname")
      .populate("links", "originalUrl shortUrl siteName")
      .exec();

    return groups;
  }

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
        this.msg("group.MAX_GROUPS_REACHED", maxGroupsCount),
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

  async findOne(id: string, userId: string, userRole?: string): Promise<Group> {
    const group = await this.groupModel
      .findById(id)
      .populate("owner", "username fullname")
      .populate("members.account", "username fullname")
      .populate("invitations.account", "username fullname")
      .populate("invitations.invitedBy", "username fullname")
      .populate("links", "originalUrl shortUrl siteName")
      .exec();

    if (!group) {
      throw new NotFoundException(this.msg("group.NOT_FOUND"));
    }

    if (!this.isAdminRole(userRole)) {
      const isMember =
        this.getEntityId(group.owner) === userId ||
        group.members.some(
          (member) => this.getEntityId(member.account) === userId,
        );
      if (!isMember) {
        throw new ForbiddenException(this.msg("group.ACCESS_DENIED"));
      }
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
      throw new ForbiddenException(this.msg("group.ONLY_OWNER_UPDATE"));
    }

    const updatedGroup = await this.groupModel
      .findByIdAndUpdate(id, { $set: updateGroupDto }, { new: true })
      .exec();

    return updatedGroup!.populate("owner", "username fullname");
  }

  async remove(
    id: string,
    userId: string,
    userRole?: string,
    password?: string,
  ): Promise<void> {
    const group = await this.findOne(id, userId, userRole);

    if (!this.isAdminRole(userRole) && !this.isOwner(group, userId)) {
      throw new ForbiddenException(this.msg("group.ONLY_OWNER_DELETE"));
    }

    if (!this.isAdminRole(userRole) && password) {
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
          ? this.msg("group.ACCOUNT_NOT_FOUND", userIdOrUsername)
          : this.msg("group.ACCOUNT_NOT_FOUND_BY_USERNAME", userIdOrUsername),
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

    if (targetAccountId === actorId) {
      throw new BadRequestException(this.msg("group.CANNOT_INVITE_SELF"));
    }

    const actorRole = this.getMemberRole(group, actorId);
    if (!actorRole || (actorRole !== "owner" && actorRole !== "manager")) {
      throw new ForbiddenException(this.msg("group.ONLY_OWNER_OR_MANAGER_ADD"));
    }

    const targetRole = role || "member";
    if (actorRole === "manager" && targetRole !== "member") {
      throw new ForbiddenException(
        this.msg("group.MANAGER_CAN_ONLY_ADD_MEMBER"),
      );
    }

    // 1. If target is already a confirmed member
    const existingMember = group.members.find(
      (member) => this.getEntityId(member.account) === targetAccountId,
    );

    if (existingMember) {
      if (existingMember.role === targetRole) {
        return group;
      }
      if (!this.isOwner(group, actorId)) {
        throw new ForbiddenException(this.msg("group.ONLY_OWNER_CHANGE_ROLE"));
      }
      await this.groupModel.updateOne(
        {
          _id: new Types.ObjectId(groupId),
          "members.account": new Types.ObjectId(targetAccountId),
        },
        { $set: { "members.$.role": targetRole } },
      );
      return this.findOne(groupId, actorId);
    }

    // 2. If target already has a pending invitation
    const existingInvite = group.invitations?.find(
      (inv) => this.getEntityId(inv.account) === targetAccountId,
    );

    if (existingInvite) {
      if (existingInvite.role === targetRole) {
        throw new BadRequestException(this.msg("group.ALREADY_INVITED"));
      }
      if (!this.isOwner(group, actorId)) {
        throw new ForbiddenException(this.msg("group.ONLY_OWNER_CHANGE_ROLE"));
      }
      await this.groupModel.updateOne(
        {
          _id: new Types.ObjectId(groupId),
          "invitations.account": new Types.ObjectId(targetAccountId),
        },
        { $set: { "invitations.$.role": targetRole } },
      );
      return this.findOne(groupId, actorId);
    }

    // 3. Check group member capacity (counting current members + pending invitations)
    const ownerId = this.getEntityId(group.owner);
    const maxMembersPerGroup =
      await this.shortenerService.getMaxMembersPerGroup(ownerId);
    const totalCount =
      group.members.length + (group.invitations?.length || 0) + 1;

    if (totalCount > maxMembersPerGroup) {
      throw new BadRequestException(
        this.msg("group.MAX_MEMBERS_REACHED", maxMembersPerGroup),
      );
    }

    // 4. Atomic append to invitations with duplicate prevention
    const targetAccountObjectId = new Types.ObjectId(targetAccountId);
    const actorObjectId = new Types.ObjectId(actorId);

    const updateResult = await this.groupModel.updateOne(
      {
        _id: new Types.ObjectId(groupId),
        "members.account": { $ne: targetAccountObjectId },
        "invitations.account": { $ne: targetAccountObjectId },
      },
      {
        $push: {
          invitations: {
            account: targetAccountObjectId,
            role: targetRole,
            invitedBy: actorObjectId,
            invitedAt: new Date(),
          },
        },
      },
    );

    if (updateResult.matchedCount === 0) {
      const freshGroup = await this.groupModel
        .findById(groupId)
        .lean()
        .exec();
      const isNowMember = freshGroup?.members?.some(
        (m) => this.getEntityId(m.account) === targetAccountId,
      );
      if (isNowMember) {
        throw new BadRequestException(this.msg("group.ALREADY_MEMBER"));
      }
      throw new BadRequestException(this.msg("group.ALREADY_INVITED"));
    }

    // 5. Send real-time notification to the invitee (non-blocking)
    const actorAccount = await this.accountService
      .findOne(actorId)
      .catch(() => null);
    const actorName =
      actorAccount?.fullname || actorAccount?.username || "Một thành viên";
    const roleLabel = targetRole === "manager" ? "Quản lý" : "Thành viên";

    this.notificationService
      .send(targetAccountId, "group_invitation_received", {
        message: `${actorName} đã mời bạn tham gia nhóm "${group.name}" với vai trò ${roleLabel}.`,
        groupId: groupId.toString(),
        groupName: group.name,
        role: targetRole,
        invitedBy: {
          _id: actorId,
          username: actorAccount?.username,
          fullname: actorAccount?.fullname,
        },
      })
      .catch(() => null);

    return this.findOne(groupId, actorId);
  }

  /**
   * Get pending group invitations for the authenticated user
   */
  async getMyInvitations(userId: string): Promise<any[]> {
    const userObjectId = new Types.ObjectId(userId);
    const groups = await this.groupModel
      .find(
        { "invitations.account": userObjectId },
        {
          name: 1,
          owner: 1,
          invitations: { $elemMatch: { account: userObjectId } },
          members: 1,
          createdAt: 1,
        },
      )
      .populate("owner", "username fullname")
      .populate("invitations.invitedBy", "username fullname")
      .lean()
      .exec();

    return groups.map((g: any) => {
      const inv = g.invitations?.[0];
      return {
        groupId: g._id.toString(),
        groupName: g.name,
        owner: g.owner,
        role: inv?.role || "member",
        invitedBy: inv?.invitedBy,
        invitedAt: inv?.invitedAt,
        memberCount: g.members?.length || 0,
        createdAt: g.createdAt,
      };
    });
  }

  /**
   * Get invitations sent by the user or within groups owned by the user
   */
  async getSentInvitations(userId: string): Promise<any[]> {
    const userObjectId = new Types.ObjectId(userId);
    const groups = await this.groupModel
      .find({
        $or: [
          { owner: userObjectId },
          { "invitations.invitedBy": userObjectId },
        ],
        "invitations.0": { $exists: true },
      })
      .populate("owner", "username fullname")
      .populate("invitations.account", "username fullname")
      .populate("invitations.invitedBy", "username fullname")
      .lean()
      .exec();

    const sentList: any[] = [];
    for (const group of groups) {
      const isOwner = this.getEntityId(group.owner) === userId;
      for (const inv of (group as any).invitations || []) {
        const isInviter = this.getEntityId(inv.invitedBy) === userId;
        if (isOwner || isInviter) {
          sentList.push({
            groupId: (group as any)._id.toString(),
            groupName: (group as any).name,
            owner: (group as any).owner,
            role: inv.role || "member",
            account: inv.account,
            invitedBy: inv.invitedBy,
            invitedAt: inv.invitedAt,
            memberCount: (group as any).members?.length || 0,
            canCancel: true,
          });
        }
      }
    }

    return sentList.sort(
      (a, b) =>
        new Date(b.invitedAt).getTime() - new Date(a.invitedAt).getTime(),
    );
  }

  /**
   * Respond to a group invitation (accept or reject)
   */
  async respondToInvitation(
    groupId: string,
    userId: string,
    action: "accept" | "reject",
  ): Promise<any> {
    const userObjectId = new Types.ObjectId(userId);
    const group = await this.groupModel.findById(groupId).exec();

    if (!group) {
      throw new NotFoundException(this.msg("group.NOT_FOUND"));
    }

    const invitation = group.invitations?.find(
      (inv) => this.getEntityId(inv.account) === userId,
    );

    if (!invitation) {
      throw new NotFoundException(this.msg("group.INVITATION_NOT_FOUND"));
    }

    const responderAccount = await this.accountService
      .findOne(userId)
      .catch(() => null);
    const responderName =
      responderAccount?.fullname ||
      responderAccount?.username ||
      "Người dùng";
    const inviterId = this.getEntityId(invitation.invitedBy);

    if (action === "reject") {
      await this.groupModel.updateOne(
        { _id: new Types.ObjectId(groupId) },
        { $pull: { invitations: { account: userObjectId } } },
      );

      // Notify inviter (non-blocking)
      if (inviterId) {
        this.notificationService
          .send(inviterId, "group_invitation_rejected", {
            message: `${responderName} đã từ chối lời mời tham gia nhóm "${group.name}".`,
            groupId,
            groupName: group.name,
            rejectedBy: {
              _id: userId,
              username: responderAccount?.username,
              fullname: responderAccount?.fullname,
            },
          })
          .catch(() => null);
      }

      return {
        success: true,
        message: "Đã từ chối lời mời tham gia nhóm.",
        groupId,
      };
    }

    // Action: "accept"
    const ownerId = this.getEntityId(group.owner);
    const maxMembersPerGroup =
      await this.shortenerService.getMaxMembersPerGroup(ownerId);
    const targetRole = invitation.role || "member";

    // Atomic move from invitations to members with maxMembers condition
    const updated = await this.groupModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(groupId),
        "invitations.account": userObjectId,
        "members.account": { $ne: userObjectId },
        [`members.${maxMembersPerGroup - 1}`]: { $exists: false },
      },
      {
        $pull: { invitations: { account: userObjectId } },
        $push: {
          members: {
            account: userObjectId,
            role: targetRole,
          },
        },
      },
      { new: true },
    );

    if (!updated) {
      // Re-fetch to distinguish between full capacity vs invalid invitation
      const freshGroup = await this.groupModel.findById(groupId).lean().exec();
      if (!freshGroup) {
        throw new NotFoundException(this.msg("group.NOT_FOUND"));
      }
      if ((freshGroup.members?.length ?? 0) >= maxMembersPerGroup) {
        throw new BadRequestException(
          this.msg("group.MAX_MEMBERS_REACHED", maxMembersPerGroup),
        );
      }
      throw new NotFoundException(this.msg("group.INVITATION_NOT_FOUND"));
    }

    // Notify inviter that invitation was accepted (non-blocking)
    if (inviterId) {
      this.notificationService
        .send(inviterId, "group_invitation_accepted", {
          message: `${responderName} đã chấp nhận lời mời tham gia nhóm "${group.name}".`,
          groupId,
          groupName: group.name,
          role: targetRole,
          acceptedBy: {
            _id: userId,
            username: responderAccount?.username,
            fullname: responderAccount?.fullname,
          },
        })
        .catch(() => null);
    }

    return this.findOne(groupId, userId);
  }

  /**
   * Cancel / revoke a pending group invitation
   */
  async cancelInvitation(
    groupId: string,
    targetUserId: string,
    actorId: string,
    actorRole?: string,
  ): Promise<Group> {
    const group = await this.findOne(groupId, actorId, actorRole);
    const currentRole = this.getMemberRole(group, actorId);

    if (
      !this.isAdminRole(actorRole) &&
      (!currentRole || (currentRole !== "owner" && currentRole !== "manager"))
    ) {
      throw new ForbiddenException(
        this.msg("group.ONLY_OWNER_OR_MANAGER_CANCEL_INVITE"),
      );
    }

    const targetObjectId = new Types.ObjectId(targetUserId);
    const invitation = group.invitations?.find(
      (inv) => this.getEntityId(inv.account) === targetUserId,
    );

    if (!invitation) {
      throw new NotFoundException(this.msg("group.INVITATION_NOT_FOUND"));
    }

    // Group manager can only cancel invitations for "member" role
    if (
      !this.isAdminRole(actorRole) &&
      currentRole === "manager" &&
      invitation.role !== "member"
    ) {
      throw new ForbiddenException(
        this.msg("group.MANAGER_CAN_ONLY_REMOVE_MEMBER"),
      );
    }

    await this.groupModel.updateOne(
      { _id: new Types.ObjectId(groupId) },
      { $pull: { invitations: { account: targetObjectId } } },
    );

    return this.findOne(groupId, actorId, actorRole);
  }

  async getMembers(
    groupId: string,
    userId: string,
    userRole?: string,
  ): Promise<Group> {
    return this.findOne(groupId, userId, userRole);
  }

  async removeMember(
    groupId: string,
    memberId: string,
    actorId: string,
    actorRole?: string,
  ): Promise<Group> {
    const group = await this.findOne(groupId, actorId, actorRole);

    const currentRole = this.getMemberRole(group, actorId);
    if (
      !this.isAdminRole(actorRole) &&
      (!currentRole || (currentRole !== "owner" && currentRole !== "manager"))
    ) {
      throw new ForbiddenException(
        this.msg("group.ONLY_OWNER_OR_MANAGER_REMOVE"),
      );
    }

    if (group.owner.toString() === memberId) {
      throw new ForbiddenException(this.msg("group.CANNOT_REMOVE_OWNER"));
    }

    const targetMember = group.members.find(
      (member) => member.account.toString() === memberId,
    );
    if (!targetMember) {
      throw new NotFoundException(this.msg("group.MEMBER_NOT_FOUND"));
    }

    if (
      !this.isAdminRole(actorRole) &&
      currentRole === "manager" &&
      targetMember.role !== "member"
    ) {
      throw new ForbiddenException(
        this.msg("group.MANAGER_CAN_ONLY_REMOVE_MEMBER"),
      );
    }

    await this.groupModel.updateOne(
      { _id: groupId },
      { $pull: { members: { account: new Types.ObjectId(memberId) } } },
    );

    return this.findOne(groupId, actorId);
  }

  /**
   * Leave a group (for members or managers)
   * The owner cannot leave their own group (must transfer ownership or delete).
   */
  async leaveGroup(
    groupId: string,
    userId: string,
  ): Promise<{ message: string }> {
    const group = await this.groupModel.findById(groupId);
    if (!group) {
      throw new NotFoundException(this.msg("group.NOT_FOUND"));
    }

    // 1. Guard: The owner cannot leave the group
    if (group.owner.toString() === userId) {
      throw new BadRequestException(this.msg("group.OWNER_CANNOT_LEAVE"));
    }

    // 2. Check if the user is currently an active member
    const isMember = group.members.some(
      (m) => m.account.toString() === userId,
    );
    if (!isMember) {
      throw new NotFoundException(this.msg("group.NOT_A_MEMBER"));
    }

    // 3. Atomically remove user from members array
    await this.groupModel.updateOne(
      { _id: groupId },
      { $pull: { members: { account: new Types.ObjectId(userId) } } },
    );

    // 4. Send real-time notification to the group owner (non-blocking)
    const actorAccount = await this.accountService
      .findOne(userId)
      .catch(() => null);
    const actorName =
      actorAccount?.fullname || actorAccount?.username || "Một thành viên";

    this.notificationService
      .send(group.owner.toString(), "group_member_left", {
        message: `${actorName} đã rời khỏi nhóm "${group.name}".`,
        groupId: groupId.toString(),
        groupName: group.name,
        userId,
      })
      .catch(() => null);

    return { message: this.msg("group.LEAVE_GROUP_SUCCESS") };
  }

  async addLinks(
    groupId: string,
    links: string[],
    userId: string,
  ): Promise<Group> {
    // Use lightweight check first - only verify permission
    const group = await this.findOneLightweight(groupId);
    if (!group) {
      throw new NotFoundException(this.msg("group.NOT_FOUND"));
    }

    // Check membership
    const isMember =
      this.getEntityId(group.owner) === userId ||
      group.members.some(
        (member) => this.getEntityId(member.account) === userId,
      );
    if (!isMember) {
      throw new ForbiddenException(this.msg("group.ACCESS_DENIED"));
    }

    const normalizedLinks = links
      .filter((link) => link && link.trim())
      .map((link) => link.trim());

    if (normalizedLinks.length === 0) {
      return this.findOne(groupId, userId);
    }

    // Check max links per group limit (based on group owner's level)
    const ownerId = this.getEntityId(group.owner);
    const maxLinksPerGroup =
      await this.shortenerService.getMaxLinksPerGroup(ownerId);
    const currentLinkCount = group.links?.length ?? 0;
    const newTotal = currentLinkCount + normalizedLinks.length;
    if (newTotal > maxLinksPerGroup) {
      throw new BadRequestException(
        this.msg("group.MAX_LINKS_REACHED", currentLinkCount, maxLinksPerGroup),
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

    // 3. Verify daily limit ONCE before batch creation (based on current user's level)
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
    userRole?: string,
  ): Promise<Group> {
    const group = await this.findOne(groupId, userId, userRole);

    const actorRole = this.getMemberRole(group, userId);
    if (
      !this.isAdminRole(userRole) &&
      (!actorRole || (actorRole !== "owner" && actorRole !== "manager"))
    ) {
      throw new ForbiddenException(
        this.msg("group.ONLY_OWNER_OR_MANAGER_REMOVE_LINK"),
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
    userRole?: string,
    search?: string,
    status?: string,
    sortBy = "createdAt",
    sortOrder = "desc",
    page = 1,
    limit = 5,
  ): Promise<{ data: any[]; page: number; totalPages: number }> {
    const group = await this.findOne(groupId, userId, userRole);

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
