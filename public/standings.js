const teamLogoFiles = [
  'Abia Warriors FC.png',
  'Barau FC.png',
  'Bendel Insurance FC.png',
  'Doma United FC.png',
  'Enyimba FC.png',
  'Ikorodu City FC.png',
  'Inter Lagos.png',
  'Kano Pillars FC.png',
  'Katsina United FC.png',
  'Kun Khalifat FC.png',
  'Kwara United FC.png',
  'Nasarawa United FC.png',
  'Niger Tornadoes FC.png',
  'Plateau United FC.png',
  'Ranchers Bees.png',
  'Rangers International FC.png',
  'Rivers United FC.png',
  'Shooting Stars Sports Club (3SC).png',
  'Sporting Lagos FC.png',
  'Warri Wolves.png'
];

function normalizeTeamName(name = '') {
  return String(name)
    .replace(/&/g, ' and ')
    .replace(/[-_]+/g, ' ')
    .replace(/\bFootball Club\b/gi, '')
    .replace(/\bSports Club\b/gi, '')
    .replace(/\bFC\b/gi, '')
    .replace(/\bSC\b/gi, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const teamLogoLookup = new Map(
  teamLogoFiles.map((filename) => [
    normalizeTeamName(filename.replace(/\.png$/i, '')),
    `images/${encodeURIComponent(filename)}`
  ])
);

function getTeamLogo(teamName) {
  return teamLogoLookup.get(normalizeTeamName(teamName));
}

function createTeamCell(teamName) {
  const logo = getTeamLogo(teamName);
  const initials = String(teamName || 'T')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase();

  const logoMarkup = logo
    ? `<img src="${logo}" alt="${teamName}" loading="lazy">`
    : `<span class="badge">${initials}</span>`;

  return `<td><div class="team">${logoMarkup}<span>${teamName}</span></div></td>`;
}

function createStandingRow(standing) {
  const highlight = normalizeTeamName(standing.team) === normalizeTeamName('Doma United FC')
    ? ' class="highlight"'
    : '';

  return `<tr${highlight}>
    <td>${standing.position}</td>
    ${createTeamCell(standing.team)}
    <td>${standing.played}</td>
    <td>${standing.wins}</td>
    <td>${standing.draws}</td>
    <td>${standing.losses}</td>
    <td>${standing.goalsFor}</td>
    <td>${standing.goalsAgainst}</td>
    <td>${standing.goalDifference}</td>
    <td>${standing.points}</td>
  </tr>`;
}

async function loadStandings() {
  const standingsBody = document.getElementById('standingsBody');
  if (!standingsBody) return;

  standingsBody.innerHTML = '<tr><td colspan="10">Loading NPFL standings...</td></tr>';

  try {
    const response = await fetch('/api/npfl/standings');
    const data = await response.json();

    if (!response.ok || !data.success || !Array.isArray(data.standings)) {
      throw new Error(data.error || 'Unable to load NPFL standings.');
    }

    standingsBody.innerHTML = data.standings.map(createStandingRow).join('');
  } catch (error) {
    console.error('NPFL standings loading error:', error);
    standingsBody.innerHTML = '<tr><td colspan="10">Unable to load NPFL standings right now.</td></tr>';
  }
}

loadStandings();