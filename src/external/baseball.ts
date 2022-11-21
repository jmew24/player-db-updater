import { Prisma } from '@prisma/client';

import fetchRequest from '../lib/fetchRequest';
import prisma from '../lib/prisma';

export default async function getBaseball() {
  const sport = await prisma.sport.upsert({
    where: {
      name: 'Baseball',
    },
    update: {
      name: 'Baseball',
    },
    create: {
      name: 'Baseball',
    },
  });

  const teamResult = (await fetchRequest(
    `https://statsapi.mlb.com/api/v1/teams/`
  )) as MLBResult;

  await prisma.team.deleteMany({
    where: {
      sport: {
        id: sport.id,
      },
      source: 'MLB.com',
    },
  });

  for (const item of teamResult.teams) {
    try {
      const teamIdentifier =
        `${item.id}-${item.sport.name}-${item.locationName}-${item.teamName}`.toLowerCase();

      if (
        !item.name ||
        !item.locationName ||
        !item.abbreviation ||
        !item.teamName
      )
        continue;

      const createdTeam = await prisma.team.create({
        data: {
          identifier: teamIdentifier,
          fullName: item.name,
          city: item.locationName,
          abbreviation: item.abbreviation,
          shortName: item.teamName,
          league: item.sport.name,
          source: 'MLB.com',
          sportId: sport.id,
        },
      });

      const rosterResult = (await fetchRequest(
        `https://statsapi.mlb.com/api/v1/teams/${item.id}/roster/`
      )) as MLBRosterResult;

      if (!rosterResult.roster || rosterResult.roster.length <= 0) continue;

      const roster = rosterResult.roster;
      const players = [] as Prisma.PlayerCreateManyInput[];
      for (const rosterItem of roster) {
        if (
          !rosterItem.person ||
          !rosterItem.position ||
          !rosterItem.person.fullName
        )
          continue;
        const person = rosterItem.person;
        const position = rosterItem.position;
        const lastName = person.fullName.split(' ')[1] ?? person.fullName;
        const firstName = person.fullName.split(' ')[0] ?? person.fullName;

        players.push({
          identifier:
            `${person.id}-${item.sport.name}-${firstName}-${lastName}`.toLowerCase(),
          firstName: firstName,
          lastName: lastName,
          fullName: person.fullName,
          position: position.abbreviation,
          number: parseInt(rosterItem.jerseyNumber || '-1'),
          headshotUrl: `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_426,q_auto:best/v1/people/${person.id}/headshot/67/current`,
          linkUrl:
            `https://www.mlb.com/player/${lastName}-${firstName}`.toLocaleLowerCase(),
          source: 'MLB.com',
          teamId: createdTeam.id,
          sportId: sport.id,
        });
      }

      await prisma.player.createMany({
        data: players,
        skipDuplicates: true,
      });
    } catch (e) {
      console.log('Baseball Error');
      console.error(e);
    }
  }

  return true;
}
