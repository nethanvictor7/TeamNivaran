import { PrismaClient, UserStatus } from "@cdep/identity-prisma-client";
import { hash } from "argon2";

const prisma = new PrismaClient();

const permissionCodes = [
  "case:create",
  "case:read",
  "case:update",
  "case:assign",
  "case:cancel",
  "case:external-reference:manage",
  "case:external-reference:resolve",
  "integration:source:read",
  "integration:source:manage",
  "integration:connector:read",
  "integration:connector:manage",
  "integration:connector:test",
  "integration:connector:run",
  "integration:trigger:read",
  "integration:payload:read",
  "integration:replay",
  "integration:journey:read",
  "integration:correlation:resolve",
  "evidence:upload",
  "evidence:read",
  "evidence:metadata:update",
  "evidence:version:create",
  "evidence:download",
  "evidence:verify",
  "evidence:hold",
  "workflow:definition:manage",
  "workflow:definition:read",
  "workflow:start",
  "workflow:read",
  "workflow:reopen",
  "workflow:withdraw",
  "workflow:task:read",
  "workflow:task:claim",
  "workflow:task:assign",
  "workflow:comment",
  "validation:run",
  "correction:request",
  "decision:recommend",
  "decision:read",
  "assessment:generate",
  "assessment:request",
  "assessment:read",
  "assessment:cancel",
  "assessment:feedback",
  "assessment:accept",
  "assessment:operations",
  "ai-governance:read",
  "ai-governance:manage",
  "ai-governance:test",
  "ai-governance:publish",
  "ai-governance:kill-switch",
  "review:read",
  "review:submit",
  "decision:approve",
  "decision:reject",
  "proof:verify",
  "proof:create",
  "proof:read",
  "proof:retry",
  "ledger:status:read",
  "ledger:reconcile",
  "audit:read",
  "audit:search",
  "audit:detail",
  "audit:journey",
  "audit:verify",
  "audit:operations",
  "audit:operate",
  "report:run",
  "export:request",
  "artifact:download",
  "user:manage",
  "role:manage",
  "configuration:manage",
];

const roleDefinitions: Record<
  string,
  { description: string; permissions: string[] }
> = {
  "platform-admin": {
    description: "Full local platform administration",
    permissions: permissionCodes,
  },
  "organization-admin": {
    description: "Organization configuration, users, cases, and integrations",
    permissions: [
      "case:create",
      "case:read",
      "case:update",
      "case:assign",
      "case:cancel",
      "case:external-reference:manage",
      "integration:source:read",
      "integration:source:manage",
      "integration:connector:read",
      "integration:connector:manage",
      "integration:connector:test",
      "integration:connector:run",
      "integration:trigger:read",
      "integration:replay",
      "integration:journey:read",
      "integration:correlation:resolve",
      "evidence:upload",
      "evidence:read",
      "evidence:metadata:update",
      "evidence:version:create",
      "evidence:download",
      "evidence:verify",
      "evidence:hold",
      "workflow:definition:manage",
      "workflow:definition:read",
      "workflow:start",
      "workflow:read",
      "workflow:reopen",
      "workflow:withdraw",
      "workflow:task:read",
      "workflow:task:claim",
      "workflow:task:assign",
      "workflow:comment",
      "validation:run",
      "correction:request",
      "decision:recommend",
      "decision:read",
      "decision:approve",
      "decision:reject",
      "assessment:request",
      "assessment:read",
      "assessment:cancel",
      "assessment:feedback",
      "assessment:accept",
      "assessment:operations",
      "ai-governance:read",
      "ai-governance:manage",
      "ai-governance:test",
      "ai-governance:publish",
      "ai-governance:kill-switch",
      "proof:create",
      "proof:read",
      "proof:verify",
      "proof:retry",
      "ledger:status:read",
      "ledger:reconcile",
      "audit:search",
      "audit:detail",
      "audit:journey",
      "audit:verify",
      "audit:operations",
      "report:run",
      "export:request",
      "artifact:download",
      "user:manage",
      "role:manage",
      "configuration:manage",
    ],
  },
  "case-manager": {
    description: "Case ownership and operational correlation resolution",
    permissions: [
      "case:create",
      "case:read",
      "case:update",
      "case:assign",
      "case:cancel",
      "case:external-reference:manage",
      "integration:trigger:read",
      "integration:replay",
      "integration:journey:read",
      "integration:correlation:resolve",
    ],
  },
  analyst: {
    description: "Case analysis and integration visibility",
    permissions: [
      "case:read",
      "case:update",
      "evidence:upload",
      "evidence:read",
      "evidence:metadata:update",
      "evidence:version:create",
      "evidence:download",
      "assessment:generate",
      "assessment:request",
      "assessment:read",
      "assessment:cancel",
      "assessment:feedback",
      "proof:create",
      "proof:read",
      "proof:verify",
      "workflow:start",
      "workflow:read",
      "workflow:task:read",
      "workflow:task:claim",
      "validation:run",
      "integration:source:read",
      "integration:connector:read",
      "integration:trigger:read",
      "integration:journey:read",
    ],
  },
  reviewer: {
    description: "Independent case and journey review",
    permissions: [
      "case:read",
      "evidence:read",
      "evidence:download",
      "assessment:read",
      "assessment:feedback",
      "assessment:accept",
      "proof:read",
      "proof:verify",
      "review:read",
      "review:submit",
      "workflow:read",
      "workflow:task:read",
      "workflow:task:claim",
      "workflow:comment",
      "correction:request",
      "integration:trigger:read",
      "integration:journey:read",
    ],
  },
  auditor: {
    description:
      "Read-only audit access including reason-gated raw payload review",
    permissions: [
      "case:read",
      "evidence:read",
      "evidence:download",
      "evidence:verify",
      "assessment:read",
      "review:read",
      "proof:verify",
      "proof:read",
      "ledger:status:read",
      "audit:read",
      "audit:search",
      "audit:detail",
      "audit:journey",
      "audit:verify",
      "report:run",
      "export:request",
      "artifact:download",
      "integration:source:read",
      "integration:connector:read",
      "integration:trigger:read",
      "integration:payload:read",
      "integration:journey:read",
    ],
  },
  "evidence-officer": {
    description: "Evidence intake, metadata, version, and controlled access",
    permissions: [
      "case:read",
      "evidence:upload",
      "evidence:read",
      "evidence:metadata:update",
      "evidence:version:create",
      "evidence:download",
      "evidence:verify",
      "proof:create",
      "proof:read",
      "proof:verify",
    ],
  },
  recommender: {
    description: "Human decision recommendation without final authority",
    permissions: [
      "case:read",
      "evidence:read",
      "evidence:download",
      "workflow:read",
      "workflow:task:read",
      "workflow:task:claim",
      "workflow:comment",
      "decision:recommend",
      "decision:read",
      "assessment:read",
      "assessment:feedback",
      "assessment:accept",
      "proof:read",
      "proof:verify",
    ],
  },
  approver: {
    description: "Independent final human approval or rejection",
    permissions: [
      "case:read",
      "evidence:read",
      "evidence:download",
      "workflow:read",
      "workflow:task:read",
      "workflow:task:claim",
      "workflow:comment",
      "decision:approve",
      "decision:reject",
      "decision:read",
      "proof:create",
      "proof:read",
      "proof:verify",
    ],
  },
};

async function seed(): Promise<void> {
  const email = (
    process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@cdep.local"
  ).toLowerCase();
  const configuredPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!configuredPassword || configuredPassword.length < 16) {
    throw new Error(
      "BOOTSTRAP_ADMIN_PASSWORD must contain at least 16 characters.",
    );
  }
  const password: string = configuredPassword;
  const organizationName =
    process.env.BOOTSTRAP_ORGANIZATION_NAME ?? "CDEP Local Bank";

  const organization = await prisma.organization.upsert({
    where: { code: "CDEP-LOCAL" },
    update: { name: organizationName },
    create: { code: "CDEP-LOCAL", name: organizationName },
  });

  for (const code of permissionCodes) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, description: `Allows ${code.replace(":", " ")}` },
    });
  }

  const user = await prisma.user.upsert({
    where: { emailNormalized: email },
    update: {
      emailDisplay: email,
      displayName: "CDEP Administrator",
      passwordHash: await hash(password, { type: 2 }),
      status: UserStatus.ACTIVE,
      passwordChangedAt: new Date(),
    },
    create: {
      emailNormalized: email,
      emailDisplay: email,
      displayName: "CDEP Administrator",
      passwordHash: await hash(password, { type: 2 }),
      status: UserStatus.ACTIVE,
      passwordChangedAt: new Date(),
    },
  });

  await prisma.organizationMembership.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
    update: { status: "ACTIVE" },
    create: {
      organizationId: organization.id,
      userId: user.id,
      status: "ACTIVE",
    },
  });

  const permissions = await prisma.permission.findMany({
    where: { code: { in: permissionCodes } },
  });
  const permissionsByCode = new Map(
    permissions.map((permission) => [permission.code, permission]),
  );
  const roles = new Map<
    string,
    Awaited<ReturnType<typeof prisma.role.upsert>>
  >();
  for (const [name, definition] of Object.entries(roleDefinitions)) {
    const role = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: organization.id, name } },
      update: { description: definition.description },
      create: {
        organizationId: organization.id,
        name,
        description: definition.description,
        system: true,
      },
    });
    roles.set(name, role);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: definition.permissions.map((code) => ({
        roleId: role.id,
        permissionId: permissionsByCode.get(code)!.id,
      })),
    });
  }
  const role = roles.get("platform-admin")!;
  await prisma.userRole.upsert({
    where: {
      userId_roleId_organizationId: {
        userId: user.id,
        roleId: role.id,
        organizationId: organization.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: role.id,
      organizationId: organization.id,
    },
  });

  async function seedWorkflowUser(
    emailValue: string,
    displayName: string,
    roleNames: string[],
  ) {
    const normalized = emailValue.toLowerCase();
    const workflowUser = await prisma.user.upsert({
      where: { emailNormalized: normalized },
      update: {
        emailDisplay: normalized,
        displayName,
        passwordHash: await hash(password, { type: 2 }),
        status: UserStatus.ACTIVE,
        passwordChangedAt: new Date(),
      },
      create: {
        emailNormalized: normalized,
        emailDisplay: normalized,
        displayName,
        passwordHash: await hash(password, { type: 2 }),
        status: UserStatus.ACTIVE,
        passwordChangedAt: new Date(),
      },
    });
    await prisma.organizationMembership.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: workflowUser.id,
        },
      },
      update: { status: "ACTIVE" },
      create: {
        organizationId: organization.id,
        userId: workflowUser.id,
        status: "ACTIVE",
      },
    });
    for (const roleName of roleNames) {
      const workflowRole = roles.get(roleName)!;
      await prisma.userRole.upsert({
        where: {
          userId_roleId_organizationId: {
            userId: workflowUser.id,
            roleId: workflowRole.id,
            organizationId: organization.id,
          },
        },
        update: {},
        create: {
          userId: workflowUser.id,
          roleId: workflowRole.id,
          organizationId: organization.id,
        },
      });
    }
  }

  await seedWorkflowUser(
    process.env.BOOTSTRAP_REVIEWER_EMAIL ?? "reviewer@cdep.local",
    "CDEP Reviewer and Recommender",
    ["reviewer", "recommender"],
  );
  await seedWorkflowUser(
    process.env.BOOTSTRAP_APPROVER_EMAIL ?? "approver@cdep.local",
    "CDEP Independent Approver",
    ["approver"],
  );
  await seedWorkflowUser(
    process.env.BOOTSTRAP_AUDITOR_EMAIL ?? "auditor@cdep.local",
    "CDEP Read-only Auditor",
    ["auditor"],
  );

  const otherOrganization = await prisma.organization.upsert({
    where: { code: "CDEP-OTHER" },
    update: { name: "CDEP Other Bank" },
    create: { code: "CDEP-OTHER", name: "CDEP Other Bank" },
  });
  const outsiderEmail = (
    process.env.BOOTSTRAP_OUTSIDER_EMAIL ?? "outsider@cdep.local"
  ).toLowerCase();
  const outsider = await prisma.user.upsert({
    where: { emailNormalized: outsiderEmail },
    update: {
      emailDisplay: outsiderEmail,
      displayName: "CDEP Other Organization Reviewer",
      passwordHash: await hash(password, { type: 2 }),
      status: UserStatus.ACTIVE,
      passwordChangedAt: new Date(),
    },
    create: {
      emailNormalized: outsiderEmail,
      emailDisplay: outsiderEmail,
      displayName: "CDEP Other Organization Reviewer",
      passwordHash: await hash(password, { type: 2 }),
      status: UserStatus.ACTIVE,
      passwordChangedAt: new Date(),
    },
  });
  await prisma.organizationMembership.upsert({
    where: {
      organizationId_userId: {
        organizationId: otherOrganization.id,
        userId: outsider.id,
      },
    },
    update: { status: "ACTIVE" },
    create: {
      organizationId: otherOrganization.id,
      userId: outsider.id,
      status: "ACTIVE",
    },
  });
  const outsiderRole = await prisma.role.upsert({
    where: {
      organizationId_name: {
        organizationId: otherOrganization.id,
        name: "reviewer",
      },
    },
    update: { description: "Other organization Workflow reader" },
    create: {
      organizationId: otherOrganization.id,
      name: "reviewer",
      description: "Other organization Workflow reader",
      system: true,
    },
  });
  await prisma.rolePermission.deleteMany({
    where: { roleId: outsiderRole.id },
  });
  await prisma.rolePermission.createMany({
    data: [
      "case:read",
      "workflow:read",
      "workflow:task:read",
      "workflow:definition:read",
      "decision:read",
      "assessment:read",
    ].map((code) => ({
      roleId: outsiderRole.id,
      permissionId: permissionsByCode.get(code)!.id,
    })),
  });
  await prisma.userRole.upsert({
    where: {
      userId_roleId_organizationId: {
        userId: outsider.id,
        roleId: outsiderRole.id,
        organizationId: otherOrganization.id,
      },
    },
    update: {},
    create: {
      userId: outsider.id,
      roleId: outsiderRole.id,
      organizationId: otherOrganization.id,
    },
  });
}

seed()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
