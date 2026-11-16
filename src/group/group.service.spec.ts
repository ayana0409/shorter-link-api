import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { Types } from "mongoose";
import { GroupService } from "./group.service";
import { Group } from "./schemas/group.schema";
import { ShortenerService } from "../shortener/shortener.service";
import { AccountService } from "../account/account.service";
import { NotificationService } from "../notification/notification.service";
import { I18nService } from "../common/i18n";
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";

describe("GroupService - Comprehensive Invitation & Membership Tests", () => {
  let service: GroupService;
  let mockGroupModel: any;
  let mockShortenerService: any;
  let mockAccountService: any;
  let mockNotificationService: any;
  let mockI18nService: any;

  const ownerId = new Types.ObjectId().toString();
  const managerId = new Types.ObjectId().toString();
  const memberId = new Types.ObjectId().toString();
  const inviteeId = new Types.ObjectId().toString();
  const groupId = new Types.ObjectId().toString();

  beforeEach(async () => {
    mockGroupModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateMany: jest.fn(),
    };

    mockShortenerService = {
      getMaxMembersPerGroup: jest.fn().mockResolvedValue(5),
    };

    mockAccountService = {
      findOne: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          _id: id,
          username: `user_${id}`,
          fullname: `Full_${id}`,
        }),
      ),
      findOneByUsername: jest.fn().mockImplementation((username: string) =>
        Promise.resolve({
          id: inviteeId,
          _id: inviteeId,
          username,
          fullname: "Invitee",
        }),
      ),
    };

    mockNotificationService = {
      send: jest.fn().mockResolvedValue({}),
    };

    mockI18nService = {
      defaultLocale: "vi-VN",
      t: jest.fn((locale, key, ...args) => `${key}:${args.join(",")}`),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupService,
        {
          provide: getModelToken(Group.name),
          useValue: mockGroupModel,
        },
        {
          provide: ShortenerService,
          useValue: mockShortenerService,
        },
        {
          provide: AccountService,
          useValue: mockAccountService,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
        {
          provide: I18nService,
          useValue: mockI18nService,
        },
      ],
    }).compile();

    service = module.get<GroupService>(GroupService);
  });

  describe("addMember (send invitation & update roles)", () => {
    it("should throw BadRequestException if actor invites themselves", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Test Group",
        owner: new Types.ObjectId(ownerId),
        members: [{ account: new Types.ObjectId(ownerId), role: "owner" }],
        invitations: [],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);

      await expect(
        service.addMember(groupId, ownerId, "member", ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw ForbiddenException if regular member tries to add/invite someone", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Test Group",
        owner: new Types.ObjectId(ownerId),
        members: [
          { account: new Types.ObjectId(ownerId), role: "owner" },
          { account: new Types.ObjectId(memberId), role: "member" },
        ],
        invitations: [],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);

      await expect(
        service.addMember(groupId, inviteeId, "member", memberId),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException if manager tries to invite someone as manager", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Test Group",
        owner: new Types.ObjectId(ownerId),
        members: [
          { account: new Types.ObjectId(ownerId), role: "owner" },
          { account: new Types.ObjectId(managerId), role: "manager" },
        ],
        invitations: [],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);

      await expect(
        service.addMember(groupId, inviteeId, "manager", managerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should return group immediately if target is already a member with same role", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Test Group",
        owner: new Types.ObjectId(ownerId),
        members: [
          { account: new Types.ObjectId(ownerId), role: "owner" },
          { account: new Types.ObjectId(memberId), role: "member" },
        ],
        invitations: [],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);

      const res = await service.addMember(groupId, memberId, "member", ownerId);
      expect(res).toBe(mockGroup);
      expect(mockGroupModel.updateOne).not.toHaveBeenCalled();
    });

    it("should update role directly if target is already member and actor is owner", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Test Group",
        owner: new Types.ObjectId(ownerId),
        members: [
          { account: new Types.ObjectId(ownerId), role: "owner" },
          { account: new Types.ObjectId(memberId), role: "member" },
        ],
        invitations: [],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);
      mockGroupModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.addMember(groupId, memberId, "manager", ownerId);

      expect(mockGroupModel.updateOne).toHaveBeenCalledWith(
        {
          _id: new Types.ObjectId(groupId),
          "members.account": new Types.ObjectId(memberId),
        },
        { $set: { "members.$.role": "manager" } },
      );
    });

    it("should throw ForbiddenException if manager tries to change role of another member", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Test Group",
        owner: new Types.ObjectId(ownerId),
        members: [
          { account: new Types.ObjectId(ownerId), role: "owner" },
          { account: new Types.ObjectId(managerId), role: "manager" },
          { account: new Types.ObjectId(memberId), role: "manager" },
        ],
        invitations: [],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);

      await expect(
        service.addMember(groupId, memberId, "member", managerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw BadRequestException if target is already invited with same role", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Test Group",
        owner: new Types.ObjectId(ownerId),
        members: [{ account: new Types.ObjectId(ownerId), role: "owner" }],
        invitations: [
          {
            account: new Types.ObjectId(inviteeId),
            role: "member",
            invitedBy: new Types.ObjectId(ownerId),
          },
        ],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);

      await expect(
        service.addMember(groupId, inviteeId, "member", ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it("should allow owner to update role of an existing pending invitation", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Test Group",
        owner: new Types.ObjectId(ownerId),
        members: [{ account: new Types.ObjectId(ownerId), role: "owner" }],
        invitations: [
          {
            account: new Types.ObjectId(inviteeId),
            role: "member",
            invitedBy: new Types.ObjectId(ownerId),
          },
        ],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);
      mockGroupModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.addMember(groupId, inviteeId, "manager", ownerId);

      expect(mockGroupModel.updateOne).toHaveBeenCalledWith(
        {
          _id: new Types.ObjectId(groupId),
          "invitations.account": new Types.ObjectId(inviteeId),
        },
        { $set: { "invitations.$.role": "manager" } },
      );
    });

    it("should throw BadRequestException if total members + invitations exceeds max limit", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Test Group",
        owner: new Types.ObjectId(ownerId),
        members: [
          { account: new Types.ObjectId(ownerId), role: "owner" },
          { account: new Types.ObjectId(), role: "member" },
          { account: new Types.ObjectId(), role: "member" },
        ],
        invitations: [
          { account: new Types.ObjectId(), role: "member" },
          { account: new Types.ObjectId(), role: "member" },
        ], // Total = 5, limit = 5 -> +1 = 6 exceeds limit
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);

      await expect(
        service.addMember(groupId, inviteeId, "member", ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle race condition if atomic update matchedCount is 0", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Test Group",
        owner: new Types.ObjectId(ownerId),
        members: [{ account: new Types.ObjectId(ownerId), role: "owner" }],
        invitations: [],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);
      mockGroupModel.updateOne.mockResolvedValue({ matchedCount: 0 });
      mockGroupModel.findById.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            members: [{ account: new Types.ObjectId(inviteeId) }],
          }),
        }),
      });

      await expect(
        service.addMember(groupId, inviteeId, "member", ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it("should successfully send an invitation and push to invitations array", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Alpha Team",
        owner: new Types.ObjectId(ownerId),
        members: [{ account: new Types.ObjectId(ownerId), role: "owner" }],
        invitations: [],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);
      mockGroupModel.updateOne.mockResolvedValue({ matchedCount: 1 });

      const result = await service.addMember(groupId, inviteeId, "member", ownerId);

      expect(mockGroupModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: new Types.ObjectId(groupId),
          "members.account": { $ne: new Types.ObjectId(inviteeId) },
          "invitations.account": { $ne: new Types.ObjectId(inviteeId) },
        }),
        expect.objectContaining({
          $push: {
            invitations: expect.objectContaining({
              account: new Types.ObjectId(inviteeId),
              role: "member",
            }),
          },
        }),
      );
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        inviteeId,
        "group_invitation_received",
        expect.objectContaining({
          groupId,
          groupName: "Alpha Team",
          role: "member",
        }),
      );
      expect(result).toBeDefined();
    });
  });

  describe("getMyInvitations", () => {
    it("should return clean formatted list of pending invitations", async () => {
      const mockDate = new Date();
      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          {
            _id: new Types.ObjectId(groupId),
            name: "Team Beta",
            owner: { _id: ownerId, username: "owner1", fullname: "Group Owner" },
            invitations: [
              {
                role: "manager",
                invitedBy: { _id: ownerId, username: "owner1", fullname: "Group Owner" },
                invitedAt: mockDate,
              },
            ],
            members: [{ account: ownerId, role: "owner" }],
            createdAt: mockDate,
          },
        ]),
      };

      mockGroupModel.find.mockReturnValue(mockQuery);

      const invitations = await service.getMyInvitations(inviteeId);

      expect(mockGroupModel.find).toHaveBeenCalledWith(
        { "invitations.account": new Types.ObjectId(inviteeId) },
        expect.objectContaining({
          name: 1,
          owner: 1,
          invitations: { $elemMatch: { account: new Types.ObjectId(inviteeId) } },
        }),
      );
      expect(invitations).toHaveLength(1);
      expect(invitations[0]).toEqual({
        groupId,
        groupName: "Team Beta",
        owner: { _id: ownerId, username: "owner1", fullname: "Group Owner" },
        role: "manager",
        invitedBy: { _id: ownerId, username: "owner1", fullname: "Group Owner" },
        invitedAt: mockDate,
        memberCount: 1,
        createdAt: mockDate,
      });
    });
  });

  describe("getSentInvitations", () => {
    it("should return clean list of invitations sent by the user or within owned groups", async () => {
      const mockDate = new Date();
      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          {
            _id: new Types.ObjectId(groupId),
            name: "Team Gamma",
            owner: { _id: ownerId, username: "owner1", fullname: "Group Owner" },
            invitations: [
              {
                role: "member",
                account: { _id: inviteeId, username: "invitee1", fullname: "Invitee One" },
                invitedBy: { _id: ownerId, username: "owner1", fullname: "Group Owner" },
                invitedAt: mockDate,
              },
            ],
            members: [{ account: ownerId, role: "owner" }],
          },
        ]),
      };

      mockGroupModel.find.mockReturnValue(mockQuery);

      const sentInvitations = await service.getSentInvitations(ownerId);

      expect(mockGroupModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: [
            { owner: new Types.ObjectId(ownerId) },
            { "invitations.invitedBy": new Types.ObjectId(ownerId) },
          ],
        }),
      );
      expect(sentInvitations).toHaveLength(1);
      expect(sentInvitations[0]).toEqual({
        groupId,
        groupName: "Team Gamma",
        owner: { _id: ownerId, username: "owner1", fullname: "Group Owner" },
        role: "member",
        account: { _id: inviteeId, username: "invitee1", fullname: "Invitee One" },
        invitedBy: { _id: ownerId, username: "owner1", fullname: "Group Owner" },
        invitedAt: mockDate,
        memberCount: 1,
        canCancel: true,
      });
    });
  });

  describe("respondToInvitation (accept / reject)", () => {
    it("should throw NotFoundException if group does not exist", async () => {
      mockGroupModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.respondToInvitation(groupId, inviteeId, "accept"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException if invitation is not found", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        invitations: [],
      };
      mockGroupModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockGroup),
      });

      await expect(
        service.respondToInvitation(groupId, inviteeId, "accept"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should remove invitation and notify inviter on reject", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Alpha Team",
        owner: new Types.ObjectId(ownerId),
        invitations: [
          {
            account: new Types.ObjectId(inviteeId),
            role: "member",
            invitedBy: new Types.ObjectId(ownerId),
          },
        ],
        members: [{ account: new Types.ObjectId(ownerId), role: "owner" }],
      };
      mockGroupModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockGroup),
      });
      mockGroupModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const response = await service.respondToInvitation(groupId, inviteeId, "reject");

      expect(response).toEqual({
        success: true,
        message: "Đã từ chối lời mời tham gia nhóm.",
        groupId,
      });
      expect(mockGroupModel.updateOne).toHaveBeenCalledWith(
        { _id: new Types.ObjectId(groupId) },
        { $pull: { invitations: { account: new Types.ObjectId(inviteeId) } } },
      );
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        ownerId,
        "group_invitation_rejected",
        expect.any(Object),
      );
    });

    it("should atomically move invitation to members on accept", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Alpha Team",
        owner: new Types.ObjectId(ownerId),
        invitations: [
          {
            account: new Types.ObjectId(inviteeId),
            role: "manager",
            invitedBy: new Types.ObjectId(ownerId),
          },
        ],
        members: [{ account: new Types.ObjectId(ownerId), role: "owner" }],
      };
      mockGroupModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockGroup),
      });
      mockGroupModel.findOneAndUpdate.mockResolvedValue({
        ...mockGroup,
        members: [
          ...mockGroup.members,
          { account: new Types.ObjectId(inviteeId), role: "manager" },
        ],
        invitations: [],
      });
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);

      await service.respondToInvitation(groupId, inviteeId, "accept");

      expect(mockGroupModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: new Types.ObjectId(groupId),
          "invitations.account": new Types.ObjectId(inviteeId),
          "members.account": { $ne: new Types.ObjectId(inviteeId) },
        }),
        expect.objectContaining({
          $pull: { invitations: { account: new Types.ObjectId(inviteeId) } },
          $push: {
            members: {
              account: new Types.ObjectId(inviteeId),
              role: "manager",
            },
          },
        }),
        { new: true },
      );
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        ownerId,
        "group_invitation_accepted",
        expect.any(Object),
      );
    });

    it("should throw BadRequestException if group filled up right before accept", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Alpha Team",
        owner: new Types.ObjectId(ownerId),
        invitations: [
          {
            account: new Types.ObjectId(inviteeId),
            role: "member",
            invitedBy: new Types.ObjectId(ownerId),
          },
        ],
        members: [{ account: new Types.ObjectId(ownerId), role: "owner" }],
      };
      mockGroupModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(mockGroup),
      });
      // findOneAndUpdate returns null (condition matched 0)
      mockGroupModel.findOneAndUpdate.mockResolvedValue(null);
      // Re-fetch shows group is now at capacity
      mockGroupModel.findById.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            members: [1, 2, 3, 4, 5],
          }),
        }),
      });

      await expect(
        service.respondToInvitation(groupId, inviteeId, "accept"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("cancelInvitation", () => {
    it("should throw ForbiddenException if regular member tries to cancel invitation", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        owner: new Types.ObjectId(ownerId),
        members: [
          { account: new Types.ObjectId(ownerId), role: "owner" },
          { account: new Types.ObjectId(memberId), role: "member" },
        ],
        invitations: [{ account: new Types.ObjectId(inviteeId), role: "member" }],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);

      await expect(
        service.cancelInvitation(groupId, inviteeId, memberId),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException if invitation to cancel does not exist", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        owner: new Types.ObjectId(ownerId),
        members: [{ account: new Types.ObjectId(ownerId), role: "owner" }],
        invitations: [],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);

      await expect(
        service.cancelInvitation(groupId, inviteeId, ownerId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if manager tries to cancel manager invitation", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        owner: new Types.ObjectId(ownerId),
        members: [
          { account: new Types.ObjectId(ownerId), role: "owner" },
          { account: new Types.ObjectId(managerId), role: "manager" },
        ],
        invitations: [{ account: new Types.ObjectId(inviteeId), role: "manager" }],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);

      await expect(
        service.cancelInvitation(groupId, inviteeId, managerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should allow manager to cancel member invitation", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        owner: new Types.ObjectId(ownerId),
        members: [
          { account: new Types.ObjectId(ownerId), role: "owner" },
          { account: new Types.ObjectId(managerId), role: "manager" },
        ],
        invitations: [{ account: new Types.ObjectId(inviteeId), role: "member" }],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);
      mockGroupModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.cancelInvitation(groupId, inviteeId, managerId);

      expect(mockGroupModel.updateOne).toHaveBeenCalledWith(
        { _id: new Types.ObjectId(groupId) },
        { $pull: { invitations: { account: new Types.ObjectId(inviteeId) } } },
      );
    });

    it("should allow admin role to cancel any invitation", async () => {
      const adminId = new Types.ObjectId().toString();
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        owner: new Types.ObjectId(ownerId),
        members: [{ account: new Types.ObjectId(ownerId), role: "owner" }],
        invitations: [{ account: new Types.ObjectId(inviteeId), role: "manager" }],
      };
      jest.spyOn(service, "findOne").mockResolvedValue(mockGroup as any);
      mockGroupModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.cancelInvitation(groupId, inviteeId, adminId, "admin");

      expect(mockGroupModel.updateOne).toHaveBeenCalledWith(
        { _id: new Types.ObjectId(groupId) },
        { $pull: { invitations: { account: new Types.ObjectId(inviteeId) } } },
      );
    });
  });

  describe("cleanupAccountReferences", () => {
    it("should pull user from all members and invitations across groups", async () => {
      mockGroupModel.updateMany.mockResolvedValue({ modifiedCount: 2 });

      await service.cleanupAccountReferences(inviteeId);

      expect(mockGroupModel.updateMany).toHaveBeenCalledWith(
        {
          $or: [
            { "members.account": new Types.ObjectId(inviteeId) },
            { "invitations.account": new Types.ObjectId(inviteeId) },
          ],
        },
        {
          $pull: {
            members: { account: new Types.ObjectId(inviteeId) },
            invitations: { account: new Types.ObjectId(inviteeId) },
          },
        },
      );
    });
  });

  describe("leaveGroup", () => {
    it("should throw NotFoundException if group does not exist", async () => {
      mockGroupModel.findById.mockResolvedValue(null);

      await expect(service.leaveGroup(groupId, inviteeId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException if owner attempts to leave", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        owner: new Types.ObjectId(ownerId),
        members: [{ account: new Types.ObjectId(ownerId), role: "owner" }],
      };
      mockGroupModel.findById.mockResolvedValue(mockGroup);

      await expect(service.leaveGroup(groupId, ownerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw NotFoundException if user is not a member of the group", async () => {
      const nonMemberId = new Types.ObjectId().toString();
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        owner: new Types.ObjectId(ownerId),
        members: [{ account: new Types.ObjectId(ownerId), role: "owner" }],
      };
      mockGroupModel.findById.mockResolvedValue(mockGroup);

      await expect(service.leaveGroup(groupId, nonMemberId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should successfully remove member, notify owner, and return success message", async () => {
      const mockGroup = {
        _id: new Types.ObjectId(groupId),
        name: "Acme Corp",
        owner: new Types.ObjectId(ownerId),
        members: [
          { account: new Types.ObjectId(ownerId), role: "owner" },
          { account: new Types.ObjectId(inviteeId), role: "member" },
        ],
      };
      mockGroupModel.findById.mockResolvedValue(mockGroup);
      mockGroupModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
      mockAccountService.findOne.mockResolvedValue({
        _id: inviteeId,
        username: "testuser",
        fullname: "Test User",
      });

      const result = await service.leaveGroup(groupId, inviteeId);

      expect(mockGroupModel.updateOne).toHaveBeenCalledWith(
        { _id: groupId },
        { $pull: { members: { account: new Types.ObjectId(inviteeId) } } },
      );
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        ownerId,
        "group_member_left",
        expect.objectContaining({
          groupId,
          groupName: "Acme Corp",
          userId: inviteeId,
        }),
      );
      expect(result).toEqual({
        message: "group.LEAVE_GROUP_SUCCESS:",
      });
    });
  });
});
