// Run with: mongosh "mongodb://localhost:27017/ayphr" scripts/migrate-to-teams.js
// Or: docker exec -i <mongo-container> mongosh ayphr < scripts/migrate-to-teams.js
//
// Migrates a database from the legacy user-centric subscription/team model to
// the new team-only model. Idempotent: safe to run more than once.

function uuid() {
  return new ObjectId().toHexString();
}

print('Migrating database...');

// 1. Drop stale indexes.
try { db.users.dropIndex('stripeCustomerId_1'); print('dropped users.stripeCustomerId_1'); } catch (e) { print('users.stripeCustomerId_1 not present (ok)'); }
try { db.teams.dropIndex('managerUuid_1'); print('dropped teams.managerUuid_1'); } catch (e) { print('teams.managerUuid_1 not present (ok)'); }

// 2. Backfill team names and tiers.
db.teams.find({}).forEach((team) => {
  const $set = {};
  if (!team.name) {
    const manager = db.users.findOne({ uuid: team.managerUuid });
    $set.name = (manager && manager.username) ? `${manager.username}'s Team` : 'Team';
  }
  if (!team.tier) $set.tier = 'free';
  if (!team.credits) {
    const now = new Date();
    $set.credits = { periodStart: now, monthlyUsed: 0, additional: 0, onHold: 0 };
  }
  if (!team.createdAt) $set.createdAt = new Date();
  if (!team.updatedAt) $set.updatedAt = new Date();
  if (Object.keys($set).length > 0) {
    db.teams.updateOne({ _id: team._id }, { $set });
  }
});

// 3. Migrate users.
db.users.find({}).forEach((user) => {
  let teamId = user.teamId;
  if (!teamId && Array.isArray(user.teamIds) && user.teamIds.length > 0) {
    teamId = user.teamIds[0];
  }
  if (!teamId) {
    const managed = db.teams.findOne({ managerUuid: user.uuid });
    if (managed) teamId = managed.id;
  }
  if (!teamId) {
    const now = new Date();
    teamId = uuid();
    db.teams.insertOne({
      id: teamId,
      name: `${user.username}'s Team`,
      managerUuid: user.uuid,
      tier: 'free',
      credits: { periodStart: now, monthlyUsed: 0, additional: 0, onHold: 0 },
      createdAt: now,
      updatedAt: now,
    });
  }

  const team = db.teams.findOne({ id: teamId });
  const isManager = !!(team && team.managerUuid === user.uuid);
  const role = user.teamRole || (isManager ? 'manager' : 'member');

  const $set = {
    teamId: teamId,
    teamRole: role,
  };
  $set[`teamRoles.${teamId}`] = role;

  const $unset = {
    stripeCustomerId: '',
    paidSubscriptions: '',
    attachedSubscriptions: '',
  };

  const $addToSet = { teamIds: teamId };

  db.users.updateOne({ _id: user._id }, { $set, $unset, $addToSet });
});

print('Migration complete.');