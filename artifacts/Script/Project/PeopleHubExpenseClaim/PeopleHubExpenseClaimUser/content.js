// PeopleHubExpenseClaimUser
// Who is the current user, and are they an expense approver?
// The app calls this once at start-up and stores the answer in its View model.
// Roles are maintained in the Cockpit (Security > Roles), never hard-coded per user.
//   - Approver: has the role PeopleHubApproverClaim -> sees all claims and decides them
//   - Requester: every logged-in user -> sees and manages only their own claims

const ROLE_APPROVER = "PeopleHubApproverClaim";

async function main() {
    const user = req.user || {};
    if (!user.id) return { status: 401, data: { error: "Not logged in" } };

    const assigned = await p9.user.getRolesAndGroups(user.id);
    const userRoleIds = (assigned.roles || []).map((r) => String(r.id).toUpperCase());

    const approverRole = await p9.manager.findOne("role", { where: { name: ROLE_APPROVER } });
    const approverRoleId = approverRole ? String(approverRole.id).toUpperCase() : null;

    return {
        status: 200,
        data: {
            username: user.username,
            isRequester: true,
            isApprover: !!approverRoleId && userRoleIds.includes(approverRoleId),
            approverRoleFound: !!approverRoleId,
        },
    };
}

main()
    .then(({ status, data }) => {
        result.statusCode = status;
        result.data = data;
        complete();
    })
    .catch((e) => {
        log.error(e);
        result.statusCode = 500;
        result.data = { error: e.message || String(e) };
        complete();
    });
