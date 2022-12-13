import { Prisma } from '@prisma/client';

import fetchRequest from '../lib/fetchRequest';
import prisma from '../lib/prisma';
import redis from '../lib/redis';

export default async function getMLS() {
  const sport = await prisma.sport.upsert({
    where: {
      name: 'Soccer',
    },
    update: {
      name: 'Soccer',
    },
    create: {
      name: 'Soccer',
    },
  });

  if (sport) {
    await redis.del(`sportCache:${sport.name.toLowerCase()}`);
    await redis.del(`teamCache:${sport.name.toLowerCase()}`);
    await redis.del(`playerCache:${sport.name.toLowerCase()}`);
  }

  const teamResult = (await fetchRequest(
    `https://sportapi.mlssoccer.com/api/clubs/${new Date().getFullYear()}/98?culture=en-us`
  )) as MLSResult;

  const deletedTeams = [] as string[];
  const leagueName = 'Major League Soccer';
  for (const item of teamResult) {
    try {
      const source = 'MLSsoccer.com';
      const teamIdentifier =
        `${item.optaId}-${leagueName}-${item.slug}`.toLowerCase();

      if (!item.fullName || !item.shortName || !item.abbreviation) continue;

      if (
        !deletedTeams.find(
          (dt) => dt === `${source}-${leagueName.toLowerCase()}`
        )
      ) {
        await prisma.team.deleteMany({
          where: {
            sport: {
              id: sport.id,
            },
            league: leagueName,
            source: source,
          },
        });
        deletedTeams.push(`${source}-${leagueName.toLowerCase()}`);
      }

      const createdTeam = await prisma.team.create({
        data: {
          identifier: teamIdentifier,
          fullName: item.fullName,
          city: item.shortName,
          abbreviation: item.abbreviation,
          shortName: item.shortName,
          league: leagueName,
          source: source,
          sportId: sport.id,
        },
      });

      const rosterResult = (await fetchRequest(
        `https://stats-api.mlssoccer.com/v1/players/seasons?&season_opta_id=${new Date().getFullYear()}&club_opta_id=${
          item.optaId
        }&competition_opta_id=98&page_size=1000&ttl=1800&include=player`
      )) as MLSRosterResult;

      if (!rosterResult || rosterResult.length <= 0) continue;

      const players = [] as Prisma.PlayerCreateManyInput[];
      for (const rosterItem of rosterResult) {
        if (
          !rosterItem.player ||
          !rosterItem.position_generic ||
          !rosterItem.jersey
        )
          continue;
        const team = item;
        const person = rosterItem.player;
        const position = rosterItem.position_generic;
        const lastName = person.last_name;
        const firstName = person.first_name;

        players.push({
          identifier:
            `${person.id}-${leagueName}-${firstName}-${lastName}`.toLowerCase(),
          //updatedAt: new Date(person.updated),
          firstName: firstName,
          lastName: lastName,
          fullName: person.full_name,
          position: position,
          number: rosterItem.jersey,
          headshotUrl: `${team.logoColorUrl}`
            .replaceAll('{formatInstructions}', 't_q-best')
            .replaceAll('%7BformatInstructions%7D', 't_q-best'),
          linkUrl:
            `https://www.mlssoccer.com/players/${firstName}-${lastName}/`.toLocaleLowerCase(),
          source: source,
          teamId: createdTeam.id,
          sportId: sport.id,
        });
      }

      await prisma.player.createMany({
        data: players,
        skipDuplicates: true,
      });
      console.info(createdTeam.fullName, players.length);
    } catch (e) {
      console.log('MLS Error');
      console.error(e);
    }
  }

  return true;
}
