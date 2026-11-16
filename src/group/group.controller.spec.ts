jest.mock("../auth/auth.guard", () => ({
  AuthGuard: class MockAuthGuard {
    canActivate() {
      return true;
    }
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { GroupController } from "./group.controller";
import { GroupService } from "./group.service";
import { ShortenerService } from "../shortener/shortener.service";
import { RespondGroupInvitationDto, AddGroupMemberDto } from "./dto/group.dto";

describe("GroupController - Endpoints Verification", () => {
  let controller: GroupController;
  let groupService: jest.Mocked<Partial<GroupService>>;
  let shortenerService: jest.Mocked<Partial<ShortenerService>>;

  const mockUserId = "user-12345";
  const mockGroupId = "group-99999";
  const mockTargetUserId = "user-67890";

  beforeEach(async () => {
    groupService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      addMember: jest.fn(),
      getMembers: jest.fn(),
      removeMember: jest.fn(),
      getMyInvitations: jest.fn(),
      getSentInvitations: jest.fn(),
      respondToInvitation: jest.fn(),
      cancelInvitation: jest.fn(),
      leaveGroup: jest.fn(),
      addLinks: jest.fn(),
      removeLink: jest.fn(),
      getLinks: jest.fn(),
      findOneLightweight: jest.fn(),
    };

    shortenerService = {
      getMaxGroupsCount: jest.fn().mockResolvedValue(5),
      getMaxMembersPerGroup: jest.fn().mockResolvedValue(10),
      getMaxLinksPerGroup: jest.fn().mockResolvedValue(20),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GroupController],
      providers: [
        {
          provide: GroupService,
          useValue: groupService,
        },
        {
          provide: ShortenerService,
          useValue: shortenerService,
        },
      ],
    }).compile();

    controller = module.get<GroupController>(GroupController);
  });

  describe("GET /groups/invitations/me", () => {
    it("should call groupService.getMyInvitations with requester user ID (Local JWT)", async () => {
      const mockReq = { user: { _id: mockUserId, role: "user" } };
      const expectedInvitations = [
        {
          groupId: mockGroupId,
          groupName: "Dev Team",
          role: "member",
        },
      ];
      (groupService.getMyInvitations as jest.Mock).mockResolvedValue(expectedInvitations);

      const result = await controller.getMyInvitations(mockReq);

      expect(groupService.getMyInvitations).toHaveBeenCalledWith(mockUserId);
      expect(result).toBe(expectedInvitations);
    });

    it("should handle QuickBite SSO token format (sub or id)", async () => {
      const ssoReq = { user: { sub: "sso-sub-111", id: "sso-id-222" } };
      (groupService.getMyInvitations as jest.Mock).mockResolvedValue([]);

      await controller.getMyInvitations(ssoReq);

      expect(groupService.getMyInvitations).toHaveBeenCalledWith("sso-sub-111");
    });
  });

  describe("GET /groups/invitations/sent", () => {
    it("should call groupService.getSentInvitations with requester user ID", async () => {
      const mockReq = { user: { _id: mockUserId } };
      const expectedSent = [
        {
          groupId: mockGroupId,
          groupName: "Sent Group",
          role: "member",
        },
      ];
      (groupService.getSentInvitations as jest.Mock).mockResolvedValue(expectedSent);

      const result = await controller.getSentInvitations(mockReq);

      expect(groupService.getSentInvitations).toHaveBeenCalledWith(mockUserId);
      expect(result).toBe(expectedSent);
    });
  });

  describe("POST /groups/:id/invitations/respond", () => {
    it("should call groupService.respondToInvitation with accept action", async () => {
      const mockReq = { user: { _id: mockUserId } };
      const dto: RespondGroupInvitationDto = { action: "accept" };
      const mockResponse = { _id: mockGroupId, name: "Joined Group" };
      (groupService.respondToInvitation as jest.Mock).mockResolvedValue(mockResponse);

      const result = await controller.respondToInvitation(mockGroupId, dto, mockReq);

      expect(groupService.respondToInvitation).toHaveBeenCalledWith(
        mockGroupId,
        mockUserId,
        "accept",
      );
      expect(result).toBe(mockResponse);
    });

    it("should call groupService.respondToInvitation with reject action", async () => {
      const mockReq = { user: { _id: mockUserId } };
      const dto: RespondGroupInvitationDto = { action: "reject" };
      const mockResponse = { success: true, message: "Rejected" };
      (groupService.respondToInvitation as jest.Mock).mockResolvedValue(mockResponse);

      const result = await controller.respondToInvitation(mockGroupId, dto, mockReq);

      expect(groupService.respondToInvitation).toHaveBeenCalledWith(
        mockGroupId,
        mockUserId,
        "reject",
      );
      expect(result).toBe(mockResponse);
    });
  });

  describe("DELETE /groups/:id/invitations/:targetUserId", () => {
    it("should call groupService.cancelInvitation with actor ID and role", async () => {
      const mockReq = { user: { _id: mockUserId, role: "admin" } };
      const mockUpdatedGroup = { _id: mockGroupId, invitations: [] };
      (groupService.cancelInvitation as jest.Mock).mockResolvedValue(mockUpdatedGroup);

      const result = await controller.cancelInvitation(mockGroupId, mockTargetUserId, mockReq);

      expect(groupService.cancelInvitation).toHaveBeenCalledWith(
        mockGroupId,
        mockTargetUserId,
        mockUserId,
        "admin",
      );
      expect(result).toBe(mockUpdatedGroup);
    });
  });

  describe("POST /groups/:id/members", () => {
    it("should call groupService.addMember with standardized requester ID", async () => {
      const mockReq = { user: { _id: mockUserId } };
      const dto: AddGroupMemberDto = { userId: mockTargetUserId, role: "manager" };
      const mockResultGroup = { _id: mockGroupId, name: "Alpha" };
      (groupService.addMember as jest.Mock).mockResolvedValue(mockResultGroup);

      const result = await controller.addMember(mockGroupId, dto, mockReq);

      expect(groupService.addMember).toHaveBeenCalledWith(
        mockGroupId,
        mockTargetUserId,
        "manager",
        mockUserId,
      );
      expect(result).toBe(mockResultGroup);
    });
  });

  describe("POST /groups/:id/leave", () => {
    it("should call groupService.leaveGroup with standardized requester ID", async () => {
      const mockReq = { user: { _id: mockUserId } };
      const mockResponse = { message: "Bạn đã rời khỏi nhóm thành công." };
      (groupService.leaveGroup as jest.Mock).mockResolvedValue(mockResponse);

      const result = await controller.leaveGroup(mockGroupId, mockReq);

      expect(groupService.leaveGroup).toHaveBeenCalledWith(
        mockGroupId,
        mockUserId,
      );
      expect(result).toBe(mockResponse);
    });
  });
});
